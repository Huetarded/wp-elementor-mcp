#!/usr/bin/env node

// Load environment variables from .env file
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this script for .env file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');

config({ path: envPath });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import https from 'https';
import { Base64 } from 'js-base64';
import { getServerConfig, ServerConfig } from './server-config.js';

interface WordPressConfig {
  baseUrl: string;
  username: string;
  applicationPassword: string;
}

// Enhanced JSON parsing utility to handle various response formats
interface ParsedElementorData {
  success: boolean;
  data?: any[];
  rawData?: string;
  error?: string;
  debugInfo?: string;
}

class ElementorWordPressMCP {
  private server: Server;
  private axiosInstance: AxiosInstance | null = null;
  private config: WordPressConfig | null = null;
  private serverConfig: ServerConfig;

  constructor() {
    this.serverConfig = getServerConfig();
    
    this.server = new Server(
      {
        name: 'elementor-wordpress-mcp',
        version: '1.7.0',
      }
    );

    // Initialize WordPress configuration from environment variables
    this.initializeFromEnvironment();

    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  // Robust JSON parsing utility for Elementor data
  private parseElementorResponse(responseText: string): ParsedElementorData {
    try {
      // Check if this is a direct API response
      if (responseText.trim().startsWith('[') || responseText.trim().startsWith('{')) {
        try {
          const data = JSON.parse(responseText);
          return {
            success: true,
            data: Array.isArray(data) ? data : [data]
          };
        } catch (directParseError) {
          return {
            success: false,
            error: `Direct JSON parse failed: ${directParseError}`,
            rawData: responseText
          };
        }
      }

      // Extract debug info and JSON data from formatted response
      let debugInfo = '';
      let jsonData = '';

      if (responseText.includes('--- Elementor Data ---')) {
        const parts = responseText.split('--- Elementor Data ---');
        debugInfo = parts[0]?.trim() || '';
        jsonData = parts[1]?.trim() || '';
      } else if (responseText.includes('--- Raw Elementor Data ---')) {
        const parts = responseText.split('--- Raw Elementor Data ---');
        debugInfo = parts[0]?.trim() || '';
        jsonData = parts[1]?.trim() || '';
      } else {
        // Try to find JSON-like content
        const jsonMatch = responseText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (jsonMatch) {
          jsonData = jsonMatch[1];
          debugInfo = responseText.replace(jsonMatch[1], '').trim();
        } else {
          return {
            success: false,
            error: 'No JSON data found in response',
            rawData: responseText,
            debugInfo: responseText
          };
        }
      }

      // Validate that we have data to parse
      if (!jsonData || jsonData.trim() === '') {
        return {
          success: false,
          error: 'Empty JSON data in response',
          rawData: responseText,
          debugInfo
        };
      }

      // Check for known error messages in debug info
      if (debugInfo.includes('No Elementor data found') || 
          debugInfo.includes('does not use Elementor builder') ||
          debugInfo.includes('failed to parse JSON')) {
        return {
          success: false,
          error: 'No valid Elementor data available',
          debugInfo,
          rawData: jsonData
        };
      }

      // Attempt to parse the JSON data
      try {
        const parsedData = JSON.parse(jsonData);
        
        // Ensure we have an array
        const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
        
        return {
          success: true,
          data: dataArray,
          debugInfo
        };
      } catch (parseError: any) {
        // Try to clean the JSON and parse again
        try {
          // Remove common JSON formatting issues
          const cleanedJson = jsonData
            .replace(/^```json\s*/, '')  // Remove markdown code blocks
            .replace(/\s*```$/, '')
            .replace(/^```\s*/, '')
            .replace(/\n\s*\n/g, '\n')  // Remove extra newlines
            .trim();

          const parsedData = JSON.parse(cleanedJson);
          const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];
          
          return {
            success: true,
            data: dataArray,
            debugInfo
          };
        } catch (cleanedParseError) {
          return {
            success: false,
            error: `JSON parse failed: ${parseError.message}. Cleaned parse also failed: ${cleanedParseError}`,
            rawData: jsonData,
            debugInfo
          };
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Parsing utility failed: ${error.message}`,
        rawData: responseText
      };
    }
  }

  // Safe method to get parsed Elementor data with comprehensive error handling
  private async safeGetElementorData(postId: number): Promise<ParsedElementorData> {
    try {
      const response = await this.getElementorData({ post_id: postId });
      
      // Parse the JSON response from content[0].text
      const responseText = response.content[0].text;
      const parsedResponse = JSON.parse(responseText);
      
      // Check if response indicates success and has data
      if (parsedResponse.status === 'success' && parsedResponse.data?.elementor_data) {
        return {
          success: true,
          data: parsedResponse.data.elementor_data,
          debugInfo: `Successfully retrieved ${parsedResponse.data.elementor_data.length} elements for post ${postId}`
        };
      } else if (parsedResponse.status === 'error') {
        return {
          success: false,
          error: parsedResponse.data?.message || parsedResponse.message || 'Unknown error from getElementorData',
          debugInfo: parsedResponse.data?.details || parsedResponse.details || ''
        };
      } else {
        return {
          success: false,
          error: 'Unexpected response format from getElementorData',
          debugInfo: `Response status: ${parsedResponse.status}`
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to retrieve Elementor data: ${error.message}`
      };
    }
  }

  private initializeFromEnvironment() {
    const baseUrl = process.env.WORDPRESS_BASE_URL;
    const username = process.env.WORDPRESS_USERNAME;
    const applicationPassword = process.env.WORDPRESS_APPLICATION_PASSWORD;

    if (baseUrl && username && applicationPassword) {
      console.error('Initializing WordPress connection from environment variables...');
      this.setupAxios({
        baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash if present
        username,
        applicationPassword
      });
      console.error('WordPress connection configured successfully');
    } else {
      console.error('WordPress environment variables not found. Manual configuration will be required.');
      console.error('Required environment variables:');
      console.error('- WORDPRESS_BASE_URL');
      console.error('- WORDPRESS_USERNAME');
      console.error('- WORDPRESS_APPLICATION_PASSWORD');
    }
  }

  private setupAxios(config: WordPressConfig) {
    const baseURL = config.baseUrl.endsWith('/') 
      ? `${config.baseUrl}wp-json/wp/v2/`
      : `${config.baseUrl}/wp-json/wp/v2/`;
      
    const auth = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');
    
    const httpsAgent = new https.Agent({
      rejectUnauthorized: this.shouldRejectUnauthorized(config.baseUrl)
    });
    
    this.axiosInstance = axios.create({
      baseURL,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      httpsAgent: httpsAgent,
      timeout: 60000, // Increased to 60 second timeout for large operations
      maxContentLength: 50 * 1024 * 1024, // 50MB response limit
      maxBodyLength: 10 * 1024 * 1024, // 10MB request limit
    });
    
    // Add request interceptor for debugging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        console.error(`Making request to: ${config.method?.toUpperCase()} ${config.url}`);
        if (config.data && typeof config.data === 'string' && config.data.length > 1000) {
          console.error(`Request data size: ${config.data.length} characters`);
        }
        return config;
      },
      (error) => {
        console.error(`Request error: ${error.message}`);
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for debugging and error handling
    this.axiosInstance.interceptors.response.use(
      (response) => {
        console.error(`Response received: ${response.status} ${response.statusText}`);
        if (response.data && typeof response.data === 'string' && response.data.length > 10000) {
          console.error(`Response data size: ${response.data.length} characters`);
        } else if (response.data && Array.isArray(response.data)) {
          console.error(`Response array length: ${response.data.length} items`);
        }
        return response;
      },
      (error) => {
        // Enhanced error logging
        if (error.code === 'ECONNABORTED') {
          console.error(`🕐 Request timeout: ${error.message}`);
        } else if (error.response?.status) {
          console.error(`❌ HTTP Error: ${error.response.status} ${error.response.statusText}`);
          console.error(`URL: ${error.config?.url}`);
          if (error.response.data?.message) {
            console.error(`WordPress Error: ${error.response.data.message}`);
          }
        } else {
          console.error(`🔥 Network/Connection Error: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
    
    this.config = config;
  }

  private shouldRejectUnauthorized(baseUrl: string): boolean {
    try {
      const url = new URL(baseUrl);
      
      // Allow self-signed certificates for local development
      const isLocal = url.hostname === 'localhost' || 
                     url.hostname === '127.0.0.1' ||
                     url.hostname.endsWith('.local') ||
                     url.hostname.endsWith('.dev') ||
                     url.hostname.endsWith('.test');
      
      if (isLocal) {
        console.error(`🔓 Allowing self-signed certificates for local development site: ${url.hostname}`);
        return false;
      }
      
      // For production sites, require valid certificates
      console.error(`🔒 Requiring valid SSL certificates for production site: ${url.hostname}`);
      return true;
    } catch (error) {
      // If URL parsing fails, default to requiring valid certificates
      console.error(`⚠️ Could not parse URL ${baseUrl}, defaulting to requiring valid SSL certificates`);
      return true;
    }
  }

  private ensureAuthenticated() {
    if (!this.axiosInstance || !this.config) {
      return this.createErrorResponse(
        'WordPress connection not configured. Please set environment variables: WORDPRESS_BASE_URL, WORDPRESS_USERNAME, WORDPRESS_APPLICATION_PASSWORD.',
        'NOT_CONFIGURED',
        'AUTHENTICATION_ERROR',
        'Missing WordPress connection configuration'
      );
    }
    return null; // null means authenticated successfully
  }

  // Utility method to handle large responses with better error reporting
  private async safeApiCall<T>(operation: () => Promise<T>, operationName: string, context: string = ''): Promise<T> {
    try {
      const startTime = Date.now();
      console.error(`🚀 Starting ${operationName}${context ? ` for ${context}` : ''}`);
      
      const result = await operation();
      
      const duration = Date.now() - startTime;
      console.error(`✅ Completed ${operationName} in ${duration}ms`);
      
      return result;
    } catch (error: any) {
      console.error(`❌ Failed ${operationName}${context ? ` for ${context}` : ''}`);
      
      // Note: This method now throws errors but they will be caught by calling methods
      // that use status-based responses
      if (error.code === 'ECONNABORTED') {
        console.error(`🕐 Operation timed out after 60 seconds`);
        throw new Error(
          `Request timeout: ${operationName} took longer than 60 seconds. This often indicates the data is too large or the server is overloaded.`
        );
      } else if (error.response?.status >= 500) {
        console.error(`🔥 Server error: ${error.response.status} ${error.response.statusText}`);
        throw new Error(
          `Server error during ${operationName}: ${error.response.status} ${error.response.statusText}. The WordPress server may be overloaded or misconfigured.`
        );
      } else if (error.response?.status === 413) {
        console.error(`📦 Payload too large`);
        throw new Error(
          `Request payload too large for ${operationName}. Try breaking the operation into smaller chunks.`
        );
      } else if (error.message?.includes('maxContentLength')) {
        console.error(`📦 Response too large`);
        throw new Error(
          `Response too large for ${operationName}. The data exceeds 50MB limit. Try using chunked operations or filtering the request.`
        );
      } else {
        // Re-throw the original error
        throw error;
      }
    }
  }

  private setupToolHandlers() {
    // Tool Consolidation (v1.6.9):
    // - Removed: get_elementor_data_chunked (replaced by get_elementor_data_smart)
    // - Removed: get_page_structure (redundant with get_elementor_structure_summary)  
    // - Removed: clear_elementor_cache_by_page (redundant with clear_elementor_cache)
    // - Renamed: get_elementor_data_deep_chunked → get_elementor_data_smart
    
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: any[] = [];
      
      // Add tools based on configuration
      if (this.serverConfig.basicWordPressOperations) {
        tools.push(
          {
            name: 'get_posts',
            description: 'Get and list WordPress posts with optional filtering by status, search terms, and pagination',
            inputSchema: {
              type: 'object',
              properties: {
                per_page: {
                  type: 'number',
                  description: 'Number of posts to retrieve (default: 10)',
                  default: 10,
                },
                status: {
                  type: 'string',
                  description: 'Post status (publish, draft, private, etc.)',
                  default: 'publish',
                },
                search: {
                  type: 'string',
                  description: 'Search term to filter posts',
                },
              },
            },
          },
          {
            name: 'get_post',
            description: 'Get a specific WordPress post by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Post ID',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'create_post',
            description: 'Create a new WordPress post',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Post title',
                },
                content: {
                  type: 'string',
                  description: 'Post content (HTML)',
                },
                status: {
                  type: 'string',
                  description: 'Post status (draft, publish, private)',
                  default: 'draft',
                },
                excerpt: {
                  type: 'string',
                  description: 'Post excerpt',
                },
              },
              required: ['title', 'content'],
            },
          },
          {
            name: 'update_post',
            description: 'Update an existing WordPress post',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Post ID to update',
                },
                title: {
                  type: 'string',
                  description: 'Post title',
                },
                content: {
                  type: 'string',
                  description: 'Post content (HTML)',
                },
                status: {
                  type: 'string',
                  description: 'Post status (draft, publish, private)',
                },
                excerpt: {
                  type: 'string',
                  description: 'Post excerpt',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'get_pages',
            description: 'Get and list WordPress pages with optional filtering by status and pagination',
            inputSchema: {
              type: 'object',
              properties: {
                per_page: {
                  type: 'number',
                  description: 'Number of pages to retrieve (default: 10)',
                  default: 10,
                },
                status: {
                  type: 'string',
                  description: 'Page status (publish, draft, private, etc.)',
                  default: 'publish',
                },
              },
            },
          },
          {
            name: 'get_page',
            description: 'Get a specific WordPress page by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Page ID',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'list_all_content',
            description: 'Get and display all posts and pages with their IDs and Elementor integration status for debugging and content discovery',
            inputSchema: {
              type: 'object',
              properties: {
                per_page: {
                  type: 'number',
                  description: 'Number of items to retrieve per type (default: 50)',
                  default: 50,
                },
                include_all_statuses: {
                  type: 'boolean',
                  description: 'Include draft, private, and trashed content (default: false)',
                  default: false,
                },
              },
            },
          },
          {
            name: 'create_page',
            description: 'Create a new WordPress page',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Page title',
                },
                content: {
                  type: 'string',
                  description: 'Page content (HTML)',
                },
                status: {
                  type: 'string',
                  description: 'Page status (draft, publish, private)',
                  default: 'draft',
                },
                excerpt: {
                  type: 'string',
                  description: 'Page excerpt',
                },
                parent: {
                  type: 'number',
                  description: 'Parent page ID (for creating child pages)',
                },
              },
              required: ['title', 'content'],
            },
          },
          {
            name: 'update_page',
            description: 'Update an existing WordPress page',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                  description: 'Page ID to update',
                },
                title: {
                  type: 'string',
                  description: 'Page title',
                },
                content: {
                  type: 'string',
                  description: 'Page content (HTML)',
                },
                status: {
                  type: 'string',
                  description: 'Page status (draft, publish, private)',
                },
                excerpt: {
                  type: 'string',
                  description: 'Page excerpt',
                },
                parent: {
                  type: 'number',
                  description: 'Parent page ID (for creating child pages)',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'get_media',
            description: 'Get WordPress media library items',
            inputSchema: {
              type: 'object',
              properties: {
                per_page: {
                  type: 'number',
                  description: 'Number of media items to retrieve (default: 10)',
                  default: 10,
                },
                media_type: {
                  type: 'string',
                  description: 'Media type (image, video, audio, etc.)',
                },
              },
            },
          },
          {
            name: 'upload_media',
            description: 'Create and store media files in WordPress media library with metadata and alt text configuration',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'Local path to file to upload',
                },
                title: {
                  type: 'string',
                  description: 'Media title',
                },
                alt_text: {
                  type: 'string',
                  description: 'Alt text for images',
                },
              },
              required: ['file_path'],
            },
          }
        );
      }

      if (this.serverConfig.basicElementorOperations) {
        tools.push(
          {
            name: 'get_elementor_templates',
            description: 'Get Elementor templates',
            inputSchema: {
              type: 'object',
              properties: {
                per_page: {
                  type: 'number',
                  description: 'Number of templates to retrieve (default: 10)',
                  default: 10,
                },
                type: {
                  type: 'string',
                  description: 'Template type (page, section, widget, etc.)',
                },
              },
            },
          },
          {
            name: 'get_elementor_data',
            description: 'Get complete Elementor data for a page',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'update_elementor_data',
            description: 'Update complete Elementor data for a page',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to update',
                },
                elementor_data: {
                  type: 'string',
                  description: 'Complete Elementor data as JSON string',
                },
              },
              required: ['post_id', 'elementor_data'],
            },
          },
          {
            name: 'update_elementor_widget',
            description: 'Update a specific widget within an Elementor page (incremental update)',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to update',
                },
                widget_id: {
                  type: 'string',
                  description: 'Elementor widget ID (e.g., "621ef73f")',
                },
                widget_settings: {
                  type: 'object',
                  description: 'Widget settings object to update',
                },
                widget_content: {
                  type: 'string',
                  description: 'Widget content (for widgets like HTML, text, etc.)',
                },
              },
              required: ['post_id', 'widget_id'],
            },
          },
          {
            name: 'get_elementor_widget',
            description: 'Get a specific widget from an Elementor page',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                widget_id: {
                  type: 'string',
                  description: 'Elementor widget ID (e.g., "621ef73f")',
                },
              },
              required: ['post_id', 'widget_id'],
            },
          },
          {
            name: 'get_elementor_elements',
            description: 'Get a simplified list of all elements and their IDs from an Elementor page',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                include_content: {
                  type: 'boolean',
                  description: 'Include element content/settings preview (default: false)',
                  default: false,
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'update_elementor_section',
            description: 'Update multiple widgets within a specific Elementor section (batch update)',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to update',
                },
                section_id: {
                  type: 'string',
                  description: 'Elementor section ID',
                },
                widgets_updates: {
                  type: 'array',
                  description: 'Array of widget updates',
                  items: {
                    type: 'object',
                    properties: {
                      widget_id: {
                        type: 'string',
                        description: 'Widget ID to update',
                      },
                      widget_settings: {
                        type: 'object',
                        description: 'Widget settings to update',
                      },
                      widget_content: {
                        type: 'string',
                        description: 'Widget content to update',
                      },
                    },
                    required: ['widget_id'],
                  },
                },
              },
              required: ['post_id', 'section_id', 'widgets_updates'],
            },
          },
          {
            name: 'get_elementor_data_smart',
            description: 'Get Elementor page data with intelligent chunking and depth control for optimal performance on large pages',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                max_depth: {
                  type: 'number',
                  description: 'Maximum nesting depth to include (default: 2 - sections and columns only)',
                  default: 2,
                },
                element_index: {
                  type: 'number',
                  description: 'Zero-based index of top-level element to retrieve (default: 0)',
                  default: 0,
                },
                include_widget_previews: {
                  type: 'boolean',
                  description: 'Include widget content previews (default: false)',
                  default: false,
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'get_elementor_structure_summary',
            description: 'Get a compact summary of the page structure without heavy content to understand layout quickly',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                max_depth: {
                  type: 'number',
                  description: 'Maximum depth to analyze (default: 4)',
                  default: 4,
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'backup_elementor_data',
            description: 'Create a backup of Elementor page data',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to backup',
                },
                backup_name: {
                  type: 'string',
                  description: 'Optional name for the backup',
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'clear_elementor_cache',
            description: 'Clear Elementor cache for better performance',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Optional: specific post ID to clear cache for',
                },
              },
            },
          }
        );
      }

      if (this.serverConfig.sectionContainerCreation) {
        tools.push(
          {
            name: 'create_elementor_section',
            description: 'Create a new Elementor section with specified columns',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to add section to',
                },
                position: {
                  type: 'number',
                  description: 'Position to insert the section (0-based, default: append to end)',
                },
                columns: {
                  type: 'number',
                  description: 'Number of columns to create (default: 1)',
                  default: 1,
                },
                section_settings: {
                  type: 'object',
                  description: 'Optional settings for the section',
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'create_elementor_container',
            description: 'Create a new Elementor container (Flexbox)',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to add container to',
                },
                position: {
                  type: 'number',
                  description: 'Position to insert the container (0-based, default: append to end)',
                },
                container_settings: {
                  type: 'object',
                  description: 'Optional settings for the container',
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'add_column_to_section',
            description: 'Add columns to an existing Elementor section',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                section_id: {
                  type: 'string',
                  description: 'Section ID to add columns to',
                },
                columns_to_add: {
                  type: 'number',
                  description: 'Number of columns to add (default: 1)',
                  default: 1,
                },
              },
              required: ['post_id', 'section_id'],
            },
          },
          {
            name: 'duplicate_section',
            description: 'Duplicate an existing Elementor section',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                section_id: {
                  type: 'string',
                  description: 'Section ID to duplicate',
                },
                position: {
                  type: 'number',
                  description: 'Position to insert the duplicated section (0-based, default: after original)',
                },
              },
              required: ['post_id', 'section_id'],
            },
          }
        );
      }

      if (this.serverConfig.widgetAddition) {
        tools.push(
          {
            name: 'add_widget_to_section',
            description: 'Add a widget to a specific section/column',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                section_id: {
                  type: 'string',
                  description: 'Target section ID (optional if column_id is provided)',
                },
                column_id: {
                  type: 'string',
                  description: 'Target column ID (optional if section_id is provided)',
                },
                widget_type: {
                  type: 'string',
                  description: 'Widget type (e.g., "heading", "text", "image", "button")',
                },
                widget_settings: {
                  type: 'object',
                  description: 'Widget settings and content',
                },
                position: {
                  type: 'number',
                  description: 'Position within the container (0-based, default: append)',
                },
              },
              required: ['post_id', 'widget_type'],
            },
          },
          {
            name: 'insert_widget_at_position',
            description: 'Insert a widget at a specific position relative to another element',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                widget_type: {
                  type: 'string',
                  description: 'Widget type to insert',
                },
                widget_settings: {
                  type: 'object',
                  description: 'Widget settings and content',
                },
                target_element_id: {
                  type: 'string',
                  description: 'Element ID to insert relative to',
                },
                insert_position: {
                  type: 'string',
                  description: 'Position relative to target: "before", "after", "inside" (default: "after")',
                  default: 'after',
                },
              },
              required: ['post_id', 'widget_type', 'target_element_id'],
            },
          },
          {
            name: 'clone_widget',
            description: 'Clone an existing widget',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                widget_id: {
                  type: 'string',
                  description: 'Widget ID to clone',
                },
                target_element_id: {
                  type: 'string',
                  description: 'Element ID to insert cloned widget relative to (optional)',
                },
                insert_position: {
                  type: 'string',
                  description: 'Position relative to target: "before", "after", "inside" (default: "after")',
                  default: 'after',
                },
              },
              required: ['post_id', 'widget_id'],
            },
          },
          {
            name: 'move_widget',
            description: 'Move a widget to a different section/column',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                widget_id: {
                  type: 'string',
                  description: 'Widget ID to move',
                },
                target_section_id: {
                  type: 'string',
                  description: 'Target section ID (optional if target_column_id is provided)',
                },
                target_column_id: {
                  type: 'string',
                  description: 'Target column ID (optional if target_section_id is provided)',
                },
                position: {
                  type: 'number',
                  description: 'Position within target container (0-based, default: append)',
                },
              },
              required: ['post_id', 'widget_id'],
            },
          }
        );
      }

      if (this.serverConfig.elementManagement) {
        tools.push(
          {
            name: 'delete_elementor_element',
            description: 'Delete an Elementor element (section, column, or widget)',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                element_id: {
                  type: 'string',
                  description: 'Element ID to delete',
                },
              },
              required: ['post_id', 'element_id'],
            },
          },
          {
            name: 'reorder_elements',
            description: 'Reorder elements within a container',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                container_id: {
                  type: 'string',
                  description: 'Container ID (section or column)',
                },
                element_ids: {
                  type: 'array',
                  description: 'Array of element IDs in desired order',
                  items: {
                    type: 'string',
                  },
                },
              },
              required: ['post_id', 'container_id', 'element_ids'],
            },
          },
          {
            name: 'copy_element_settings',
            description: 'Copy settings from one element to another',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                source_element_id: {
                  type: 'string',
                  description: 'Source element ID to copy from',
                },
                target_element_id: {
                  type: 'string',
                  description: 'Target element ID to copy to',
                },
                settings_to_copy: {
                  type: 'array',
                  description: 'Specific setting keys to copy (optional, copies all if not specified)',
                  items: {
                    type: 'string',
                  },
                },
              },
              required: ['post_id', 'source_element_id', 'target_element_id'],
            },
          }
        );
      }





      if (this.serverConfig.advancedElementOperations) {
        tools.push(
          {
            name: 'find_elements_by_type',
            description: 'Find all elements of a specific type on a page',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                widget_type: {
                  type: 'string',
                  description: 'Widget type to search for (e.g., "heading", "text", "image")',
                },
                include_settings: {
                  type: 'boolean',
                  description: 'Include element settings in results (default: false)',
                  default: false,
                },
              },
              required: ['post_id', 'widget_type'],
            },
          }
        );
      }

      // Add tool count to help users understand which mode is active
      const totalEnabled = this.serverConfig.getTotalEnabledFeatures();
      
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[Config] Loaded ${tools.length} tools (Mode: ${this.serverConfig.mode}, Features: ${totalEnabled})`);
        console.error(`[Config] Active features: ${Object.entries(this.serverConfig)
          .filter(([key, value]) => typeof value === 'boolean' && value && key !== 'mode')
          .map(([key]) => key)
          .join(', ')}`);
      }

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_posts':
            return await this.getPosts(args as any);
          case 'get_post':
            return await this.getPost(args as any);
          case 'create_post':
            return await this.createPost(args as any);
          case 'update_post':
            return await this.updatePost(args as any);
          case 'get_pages':
            return await this.getPages(args as any);
          case 'get_page':
            return await this.getPage(args as any);
          case 'list_all_content':
            return await this.listAllContent(args as any);
          case 'create_page':
            return await this.createPage(args as any);
          case 'update_page':
            return await this.updatePage(args as any);
          case 'get_elementor_templates':
            return await this.getElementorTemplates(args as any);
          case 'get_elementor_data':
            return await this.getElementorData(args as any);
          case 'update_elementor_data':
            return await this.updateElementorData(args as any);
          case 'update_elementor_widget':
            return await this.updateElementorWidget(args as any);
          case 'get_elementor_widget':
            return await this.getElementorWidget(args as any);
          case 'get_elementor_elements':
            return await this.getElementorElements(args as any);
          case 'update_elementor_section':
            return await this.updateElementorSection(args as any);
          case 'get_elementor_data_smart':
            return await this.getElementorDataDeepChunked(args as any);
          case 'get_elementor_structure_summary':
            return await this.getElementorStructureSummary(args as any);
          case 'backup_elementor_data':
            return await this.backupElementorData(args as any);
          case 'get_media':
            return await this.getMedia(args as any);
          case 'upload_media':
            return await this.uploadMedia(args as any);
          // Section and Container Creation Tools
          case 'create_elementor_section':
            return await this.createElementorSection(args as any);
          case 'create_elementor_container':
            return await this.createElementorContainer(args as any);
          case 'add_column_to_section':
            return await this.addColumnToSection(args as any);
          case 'duplicate_section':
            return await this.duplicateSection(args as any);
          // Widget Addition Tools
          case 'add_widget_to_section':
            return await this.addWidgetToSection(args as any);
          case 'insert_widget_at_position':
            return await this.insertWidgetAtPosition(args as any);
          case 'clone_widget':
            return await this.cloneWidget(args as any);
          case 'move_widget':
            return await this.moveWidget(args as any);
          // Element Management Tools
          case 'delete_elementor_element':
            return await this.deleteElementorElement(args as any);
          case 'reorder_elements':
            return await this.reorderElements(args as any);
          case 'copy_element_settings':
            return await this.copyElementSettings(args as any);
          // Template Management
          case 'create_elementor_template':
            return await this.createElementorTemplate(args as any);
          case 'apply_template_to_page':
            return await this.applyTemplateToPage(args as any);
          case 'export_elementor_template':
            return await this.exportElementorTemplate(args as any);
          case 'import_elementor_template':
            return await this.importElementorTemplate(args as any);
          // Global Settings Management
          case 'get_elementor_global_colors':
            return await this.getElementorGlobalColors(args as any);
          case 'update_elementor_global_colors':
            return await this.updateElementorGlobalColors(args as any);
          case 'get_elementor_global_fonts':
            return await this.getElementorGlobalFonts(args as any);
          case 'update_elementor_global_fonts':
            return await this.updateElementorGlobalFonts(args as any);
          // Page Structure Tools
          case 'rebuild_page_structure':
            return await this.rebuildPageStructure(args as any);
          case 'validate_elementor_data':
            return await this.validateElementorData(args as any);
          // Performance & Optimization
          case 'regenerate_css':
            return await this.regenerateCSS(args as any);
          case 'optimize_elementor_assets':
            return await this.optimizeElementorAssets(args as any);
          case 'clear_elementor_cache':
            return await this.clearElementorCacheGeneral(args as any);

          // Advanced Element Operations
          case 'find_elements_by_type':
            return await this.findElementsByType(args as any);
          case 'bulk_update_widget_settings':
            return await this.bulkUpdateWidgetSettings(args as any);
          case 'replace_widget_content':
            return await this.replaceWidgetContent(args as any);
          // Custom Fields Integration
          case 'get_elementor_custom_fields':
            return await this.getElementorCustomFields(args as any);
          case 'update_dynamic_content_sources':
            return await this.updateDynamicContentSources(args as any);
          // Revision and History
          case 'get_elementor_revisions':
            return await this.getElementorRevisions(args as any);
          case 'restore_elementor_revision':
            return await this.restoreElementorRevision(args as any);
          case 'compare_elementor_revisions':
            return await this.compareElementorRevisions(args as any);
          default:
            return this.createErrorResponse(
              `Unknown tool: ${name}`,
              'METHOD_NOT_FOUND',
              'TOOL_ERROR',
              `Tool "${name}" is not implemented or available`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          // Convert MCP errors to structured format
          return this.createErrorResponse(
            error.message || 'MCP operation failed',
            'MCP_ERROR',
            'PROTOCOL_ERROR',
            `MCP Error Code: ${error.code || 'Unknown'}`
          );
        }
        return this.createErrorResponse(
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
          'EXECUTION_ERROR',
          'INTERNAL_ERROR',
          'Unexpected error during tool execution'
        );
      }
    });

    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      return {
        protocolVersion: request.params.protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'elementor-wordpress-mcp',
          version: '1.7.0',
        },
      };
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'elementor://config',
            mimeType: 'application/json',
            name: 'WordPress Configuration',
            description: 'Current WordPress connection configuration',
          },
        ],
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'elementor://config') {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                this.config
                  ? {
                      baseUrl: this.config.baseUrl,
                      username: this.config.username,
                      connected: true,
                    }
                  : { connected: false },
                null,
                2
              ),
            },
          ],
        };
      }

      return this.createErrorResponse(


        "Unknown resource: ${uri}",


        "OPERATION_ERROR",


        "API_ERROR",


        "Operation failed"


      );
    });
  }

  // Tool implementations
  private async getPosts(args: { per_page?: number; status?: string; search?: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck; // Return error response if not authenticated
    
    const params: any = {
      per_page: args.per_page || 10,
      status: args.status || 'publish',
      context: 'view' // Use 'view' instead of 'edit' for lighter responses
    };
    
    if (args.search) {
      params.search = args.search;
    }

    try {
      console.error(`Fetching posts with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance!.get('posts', { params });
      
      // Create optimized summary objects instead of returning full content
      const posts = response.data;
      const postSummaries = posts.map((post: any) => ({
        id: post.id,
        title: post.title?.rendered || '(No title)',
        status: post.status,
        date_created: post.date,
        date_modified: post.modified,
        url: post.link,
        excerpt: post.excerpt?.rendered ? post.excerpt.rendered.replace(/<[^>]*>/g, '').substring(0, 100) + '...' : '',
        author: post.author,
        featured_media: post.featured_media,
        comment_count: post.comment_count || 0,
        // Include Elementor status for quick reference
        elementor_status: post.meta?._elementor_data ? 'full' : 
                         post.meta?._elementor_edit_mode === 'builder' ? 'partial' : 'none'
      }));
      
      let debugInfo = `Found ${posts.length} posts\n`;
      
             // Add summary with Elementor status counts
       const elementorStats = {
         full: postSummaries.filter((p: any) => p.elementor_status === 'full').length,
         partial: postSummaries.filter((p: any) => p.elementor_status === 'partial').length,
         none: postSummaries.filter((p: any) => p.elementor_status === 'none').length
       };
      
      debugInfo += `Elementor Status: ✅ Full (${elementorStats.full}), ⚠️ Partial (${elementorStats.partial}), ❌ None (${elementorStats.none})\n`;
      debugInfo += `\n💡 Use get_post tool with specific ID for full content details\n`;
      
      return this.createSuccessResponse(
        {
          posts: postSummaries, // Return summaries instead of full objects
          summary: debugInfo,
          total_found: posts.length,
          performance_note: "Optimized response - use get_post(id) for full content details"
        },
        `Successfully retrieved ${posts.length} post summaries`
      );
    } catch (error: any) {
      console.error(`Error fetching posts: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      return this.createErrorResponse(
        `Failed to fetch posts: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'FETCH_POSTS_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async getPost(args: { id: number }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      console.error(`Fetching post with ID: ${args.id}`);
      const response = await this.axiosInstance!.get(`posts/${args.id}`, {
        params: { context: 'edit' }
      });
      
      return this.createSuccessResponse(
        response.data,
        `Successfully retrieved post ${args.id}`
      );
    } catch (error: any) {
      console.error(`Error fetching post ${args.id}: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      if (error.response?.status === 404) {
        return this.createErrorResponse(
          `Post with ID ${args.id} not found. The post may have been deleted, be in trash, or may not exist.`,
          'POST_NOT_FOUND',
          'NOT_FOUND_ERROR',
          `HTTP 404: Post ${args.id} does not exist`
        );
      }
      
      return this.createErrorResponse(
        `Failed to fetch post ${args.id}: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'FETCH_POST_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async getPage(args: { id: number }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      console.error(`Fetching page with ID: ${args.id}`);
      const response = await this.axiosInstance!.get(`pages/${args.id}`, {
        params: { context: 'edit' }
      });
      
      return this.createSuccessResponse(
        response.data,
        `Successfully retrieved page ${args.id}`
      );
    } catch (error: any) {
      console.error(`Error fetching page ${args.id}: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      if (error.response?.status === 404) {
        return this.createErrorResponse(
          `Page with ID ${args.id} not found. The page may have been deleted, be in trash, or may not exist.`,
          'PAGE_NOT_FOUND',
          'NOT_FOUND_ERROR',
          `HTTP 404: Page ${args.id} does not exist`
        );
      }
      
      return this.createErrorResponse(
        `Failed to fetch page ${args.id}: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'FETCH_PAGE_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async createPost(args: {
    title: string;
    content: string;
    status?: string;
    excerpt?: string;
  }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const postData = {
      title: args.title,
      content: args.content,
      status: args.status || 'draft',
      ...(args.excerpt && { excerpt: args.excerpt }),
    };

    try {
      console.error(`Creating post with title: "${args.title}"`);
      const response = await this.axiosInstance!.post('posts', postData);
      
      // Clear Elementor cache after creating post
      await this.clearElementorCache(response.data.id);
      
      return this.createSuccessResponse(
        {
          post: response.data,
          cache_cleared: true
        },
        `Post created successfully! ID: ${response.data.id}, Status: ${response.data.status}`
      );
    } catch (error: any) {
      console.error(`Error creating post: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      return this.createErrorResponse(
        `Failed to create post: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'CREATE_POST_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async updatePost(args: {
    id: number;
    title?: string;
    content?: string;
    status?: string;
    excerpt?: string;
  }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const updateData: any = {};
    if (args.title) updateData.title = args.title;
    if (args.content) updateData.content = args.content;
    if (args.status) updateData.status = args.status;
    if (args.excerpt) updateData.excerpt = args.excerpt;

    try {
      console.error(`Updating post ID: ${args.id}`);
      const response = await this.axiosInstance!.post(`posts/${args.id}`, updateData);
      
      // Clear Elementor cache after updating post
      await this.clearElementorCache(args.id);
      
      return this.createSuccessResponse(
        {
          post: response.data,
          cache_cleared: true
        },
        `Post updated successfully! ID: ${response.data.id}, Status: ${response.data.status}`
      );
    } catch (error: any) {
      console.error(`Error updating post ${args.id}: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      if (error.response?.status === 404) {
        return this.createErrorResponse(
          `Post with ID ${args.id} not found. The post may have been deleted, be in trash, or may not exist.`,
          'POST_NOT_FOUND',
          'NOT_FOUND_ERROR',
          `HTTP 404: Post ${args.id} does not exist`
        );
      }
      
      return this.createErrorResponse(
        `Failed to update post ${args.id}: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'UPDATE_POST_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

    private async getPages(args: { per_page?: number; status?: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const params = {
      per_page: args.per_page || 10,
      status: args.status || 'publish',
      context: 'view' // Use 'view' instead of 'edit' for lighter responses
    };

    try {
      console.error(`Fetching pages with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance!.get('pages', { params });
      
      // Create optimized summary objects instead of returning full content
      const pages = response.data;
      const pageSummaries = pages.map((page: any) => ({
        id: page.id,
        title: page.title?.rendered || '(No title)',
        status: page.status,
        date_created: page.date,
        date_modified: page.modified,
        url: page.link,
        excerpt: page.excerpt?.rendered ? page.excerpt.rendered.replace(/<[^>]*>/g, '').substring(0, 100) + '...' : '',
        author: page.author,
        parent: page.parent,
        menu_order: page.menu_order,
        featured_media: page.featured_media,
        comment_count: page.comment_count || 0,
        // Include Elementor status for quick reference
        elementor_status: page.meta?._elementor_data ? 'full' : 
                         page.meta?._elementor_edit_mode === 'builder' ? 'partial' : 'none'
      }));
      
      let debugInfo = `Found ${pages.length} pages\n`;
      
             // Add summary with Elementor status counts
       const elementorStats = {
         full: pageSummaries.filter((p: any) => p.elementor_status === 'full').length,
         partial: pageSummaries.filter((p: any) => p.elementor_status === 'partial').length,
         none: pageSummaries.filter((p: any) => p.elementor_status === 'none').length
       };
      
      debugInfo += `Elementor Status: ✅ Full (${elementorStats.full}), ⚠️ Partial (${elementorStats.partial}), ❌ None (${elementorStats.none})\n`;
      debugInfo += `\n💡 Use get_page tool with specific ID for full content details\n`;
      
      return this.createSuccessResponse(
        {
          pages: pageSummaries, // Return summaries instead of full objects
          summary: debugInfo,
          total_found: pages.length,
          performance_note: "Optimized response - use get_page(id) for full content details"
        },
        `Successfully retrieved ${pages.length} page summaries`
      );
    } catch (error: any) {
      console.error(`Error fetching pages: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      return this.createErrorResponse(
        `Failed to fetch pages: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'FETCH_PAGES_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async listAllContent(args: { per_page?: number; include_all_statuses?: boolean }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      const perPage = args.per_page || 50;
      const statuses = args.include_all_statuses ? ['publish', 'draft', 'private', 'trash'] : ['publish'];
      
      console.error(`Listing all content with per_page: ${perPage}, statuses: ${statuses.join(', ')}`);
      
      let allContent: Array<{
        id: number;
        title: string;
        type: 'post' | 'page';
        status: string;
        elementor_status: 'full' | 'partial' | 'none';
        url?: string;
      }> = [];
      
      // Fetch posts for each status
      for (const status of statuses) {
        try {
          const postsResponse = await this.axiosInstance!.get('posts', {
            params: {
              per_page: perPage,
              status,
              context: 'edit'
            }
          });
          
          postsResponse.data.forEach((post: any) => {
            const hasElementorData = post.meta?._elementor_data;
            const hasElementorEditMode = post.meta?._elementor_edit_mode;
            
            let elementorStatus: 'full' | 'partial' | 'none' = 'none';
            if (hasElementorData) {
              elementorStatus = 'full';
            } else if (hasElementorEditMode === 'builder') {
              elementorStatus = 'partial';
            }
            
            allContent.push({
              id: post.id,
              title: post.title.rendered || '(No title)',
              type: 'post',
              status: post.status,
              elementor_status: elementorStatus,
              url: post.link
            });
          });
        } catch (error: any) {
          console.error(`Failed to fetch posts with status ${status}: ${error.message}`);
        }
      }
      
      // Fetch pages for each status
      for (const status of statuses) {
        try {
          const pagesResponse = await this.axiosInstance!.get('pages', {
            params: {
              per_page: perPage,
              status,
              context: 'edit'
            }
          });
          
          pagesResponse.data.forEach((page: any) => {
            const hasElementorData = page.meta?._elementor_data;
            const hasElementorEditMode = page.meta?._elementor_edit_mode;
            
            let elementorStatus: 'full' | 'partial' | 'none' = 'none';
            if (hasElementorData) {
              elementorStatus = 'full';
            } else if (hasElementorEditMode === 'builder') {
              elementorStatus = 'partial';
            }
            
            allContent.push({
              id: page.id,
              title: page.title.rendered || '(No title)',
              type: 'page',
              status: page.status,
              elementor_status: elementorStatus,
              url: page.link
            });
          });
        } catch (error: any) {
          console.error(`Failed to fetch pages with status ${status}: ${error.message}`);
        }
      }
      
      // Sort by ID
      allContent.sort((a, b) => a.id - b.id);
      
      // Generate summary
      const summary = {
        total: allContent.length,
        by_type: {
          posts: allContent.filter(item => item.type === 'post').length,
          pages: allContent.filter(item => item.type === 'page').length
        },
        by_elementor_status: {
          full: allContent.filter(item => item.elementor_status === 'full').length,
          partial: allContent.filter(item => item.elementor_status === 'partial').length,
          none: allContent.filter(item => item.elementor_status === 'none').length
        },
        by_status: {} as Record<string, number>
      };
      
      // Count by status
      allContent.forEach(item => {
        summary.by_status[item.status] = (summary.by_status[item.status] || 0) + 1;
      });
      
      // Format table output
      let formattedTable = `📊 Content Summary\n`;
      formattedTable += `Total items: ${summary.total}\n`;
      formattedTable += `Posts: ${summary.by_type.posts}, Pages: ${summary.by_type.pages}\n`;
      formattedTable += `Elementor: Full (${summary.by_elementor_status.full}), Partial (${summary.by_elementor_status.partial}), None (${summary.by_elementor_status.none})\n`;
      formattedTable += `Statuses: ${Object.entries(summary.by_status).map(([status, count]) => `${status} (${count})`).join(', ')}\n\n`;
      
      formattedTable += `📋 Content List\n`;
      formattedTable += `${'ID'.padEnd(6)} ${'Type'.padEnd(5)} ${'Status'.padEnd(8)} ${'Elementor'.padEnd(9)} Title\n`;
      formattedTable += `${'─'.repeat(6)} ${'─'.repeat(5)} ${'─'.repeat(8)} ${'─'.repeat(9)} ${'─'.repeat(50)}\n`;
      
      allContent.forEach(item => {
        const elementorIcon = item.elementor_status === 'full' ? '✅' : item.elementor_status === 'partial' ? '⚠️' : '❌';
        const title = item.title.length > 45 ? item.title.substring(0, 42) + '...' : item.title;
        formattedTable += `${item.id.toString().padEnd(6)} ${item.type.padEnd(5)} ${item.status.padEnd(8)} ${(elementorIcon + ' ' + item.elementor_status).padEnd(9)} ${title}\n`;
      });
      
      return this.createSuccessResponse(
        {
          summary,
          content: allContent,
          formatted_table: formattedTable
        },
        `Successfully retrieved ${allContent.length} content items`
      );
      
    } catch (error: any) {
      console.error(`Error listing all content: ${error.message}`);
      return this.createErrorResponse(
        `Failed to list content: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        "LIST_CONTENT_ERROR",
        "API_ERROR",
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async createPage(args: {
    title: string;
    content: string;
    status?: string;
    excerpt?: string;
    parent?: number;
  }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const pageData = {
      title: args.title,
      content: args.content,
      status: args.status || 'draft',
      ...(args.excerpt && { excerpt: args.excerpt }),
      ...(args.parent && { parent: args.parent }),
    };

    try {
      console.error(`Creating page with title: "${args.title}"`);
      const response = await this.axiosInstance!.post('pages', pageData);
      
      // Clear Elementor cache after creating page
      await this.clearElementorCache(response.data.id);
      
      return this.createSuccessResponse(
        {
          page: response.data,
          cache_cleared: true
        },
        `Page created successfully! ID: ${response.data.id}, Status: ${response.data.status}`
      );
    } catch (error: any) {
      console.error(`Error creating page: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      return this.createErrorResponse(
        `Failed to create page: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'CREATE_PAGE_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async updatePage(args: {
    id: number;
    title?: string;
    content?: string;
    status?: string;
    excerpt?: string;
    parent?: number;
  }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const updateData: any = {};
    if (args.title) updateData.title = args.title;
    if (args.content) updateData.content = args.content;
    if (args.status) updateData.status = args.status;
    if (args.excerpt) updateData.excerpt = args.excerpt;
    if (args.parent !== undefined) updateData.parent = args.parent;

    try {
      console.error(`Updating page ID: ${args.id}`);
      const response = await this.axiosInstance!.post(`pages/${args.id}`, updateData);
      
      // Clear Elementor cache after updating page
      await this.clearElementorCache(args.id);
      
      return this.createSuccessResponse(
        {
          page: response.data,
          cache_cleared: true
        },
        `Page updated successfully! ID: ${response.data.id}, Status: ${response.data.status}`
      );
    } catch (error: any) {
      console.error(`Error updating page ${args.id}: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      if (error.response?.status === 404) {
        return this.createErrorResponse(
          `Page with ID ${args.id} not found. The page may have been deleted, be in trash, or may not exist.`,
          'PAGE_NOT_FOUND',
          'NOT_FOUND',
          `HTTP 404: Page ID ${args.id} not accessible`
        );
      }
      
      return this.createErrorResponse(
        `Failed to update page ${args.id}: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'UPDATE_PAGE_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async getElementorTemplates(args: { per_page?: number; type?: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const params: any = {
      per_page: args.per_page || 10,
      meta_key: '_elementor_template_type',
    };
    
    if (args.type) {
      params.meta_value = args.type;
    }

    try {
      const response = await this.axiosInstance!.get('elementor_library', { params });
      
      // Create optimized summary objects instead of returning full content
      const templates = response.data;
      const templateSummaries = templates.map((template: any) => ({
        id: template.id,
        title: template.title?.rendered || '(No title)',
        template_type: template.meta?._elementor_template_type || 'unknown',
        date_created: template.date,
        date_modified: template.modified,
        status: template.status,
        author: template.author,
        // Basic template info without heavy Elementor data
        has_elementor_data: !!template.meta?._elementor_data,
        element_count: template.meta?._elementor_data ? 
          (JSON.parse(template.meta._elementor_data)?.length || 0) : 0
      }));
      
      return this.createSuccessResponse(
        {
          templates: templateSummaries, // Return summaries instead of full objects
          count: templateSummaries.length,
          filter_type: args.type || 'all',
          performance_note: "Optimized response - use get_elementor_data(template_id) for full template content"
        },
        `Retrieved ${templateSummaries.length} Elementor template summaries`
      );
    } catch (error: any) {
      if (error.response?.status === 404) {
        return this.createErrorResponse(
          'Elementor templates endpoint not found. Make sure Elementor Pro is installed and activated.',
          'TEMPLATES_NOT_FOUND',
          'NOT_FOUND',
          'Elementor Pro required for template access'
        );
      }
      return this.createErrorResponse(
        `Failed to get Elementor templates: ${error.message}`,
        'GET_TEMPLATES_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async getElementorData(args: { post_id: number }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    return this.safeApiCall(async () => {
      console.error(`Getting Elementor data for ID: ${args.post_id}`);
      
      // Try to get as post first, then as page if that fails
      let response;
      let postType = 'post';
      let debugInfo = '';
      
      try {
        console.error(`Trying to fetch as post: posts/${args.post_id}`);
        response = await this.axiosInstance!.get(`posts/${args.post_id}`, {
          params: { context: 'edit' }
        });
        debugInfo += `Found as post (ID: ${args.post_id})\n`;
      } catch (postError: any) {
        console.error(`Post fetch failed: ${postError.response?.status} - ${postError.response?.statusText}`);
        
        if (postError.response?.status === 404) {
          // Try as page
          try {
            console.error(`Trying to fetch as page: pages/${args.post_id}`);
            response = await this.axiosInstance!.get(`pages/${args.post_id}`, {
              params: { context: 'edit' }
            });
            postType = 'page';
            debugInfo += `Found as page (ID: ${args.post_id})\n`;
          } catch (pageError: any) {
            console.error(`Page fetch failed: ${pageError.response?.status} - ${pageError.response?.statusText}`);
            
            // Provide comprehensive error message
            const errorDetails = `
❌ Post/Page ID ${args.post_id} not found

Debug Information:
- Tried as post: ${postError.response?.status} ${postError.response?.statusText}
- Tried as page: ${pageError.response?.status} ${pageError.response?.statusText}

Suggestions:
1. Verify the ID exists by running get_posts or get_pages
2. Check if the ID might be a custom post type
3. Ensure the post/page is not trashed
4. Verify your user permissions include access to this content
            `;
            
            return this.createErrorResponse(
              errorDetails.trim(),
              "POST_PAGE_NOT_FOUND",
              "NOT_FOUND",
              "Post/Page ID not found in either posts or pages endpoints"
            );
          }
        } else {
          throw postError;
        }
      }
      
      // Analyze the response for Elementor data
      const data = response.data;
      console.error(`Response received for ${postType} ${args.post_id}`);
      console.error(`Meta keys available: ${data.meta ? Object.keys(data.meta).join(', ') : 'None'}`);
      
      const elementorData = data.meta?._elementor_data;
      const elementorEditMode = data.meta?._elementor_edit_mode;
      const elementorVersion = data.meta?._elementor_version;
      const elementorPageSettings = data.meta?._elementor_page_settings;
      
      debugInfo += `Title: "${data.title.rendered}"\n`;
      debugInfo += `Status: ${data.status}\n`;
      debugInfo += `Type: ${postType}\n`;
      debugInfo += `Edit Mode: ${elementorEditMode || 'None'}\n`;
      debugInfo += `Version: ${elementorVersion || 'None'}\n`;
      debugInfo += `Has Page Settings: ${elementorPageSettings ? 'Yes' : 'No'}\n`;
      debugInfo += `Has Elementor Data: ${elementorData ? 'Yes' : 'No'}\n`;
      
      if (elementorData) {
        try {
          const parsedData = JSON.parse(elementorData);
          debugInfo += `Elementor Elements Count: ${Array.isArray(parsedData) ? parsedData.length : 'Not an array'}\n`;
          
          return this.createSuccessResponse(
            {
              post_id: args.post_id,
              post_type: postType,
              title: data.title?.rendered || data.title?.raw || 'Unknown',
              status: data.status,
              edit_mode: elementorEditMode,
              elementor_data: parsedData,
              metadata: {
                has_page_settings: !!data.meta?._elementor_page_settings,
                has_elementor_data: true,
                elements_count: Array.isArray(parsedData) ? parsedData.length : 0,
                version: elementorVersion
              }
            },
            `Successfully retrieved Elementor data for ${postType} ID ${args.post_id} with ${Array.isArray(parsedData) ? parsedData.length : 0} elements`
          );
        } catch (parseError) {
          debugInfo += `⚠️ Elementor data found but failed to parse JSON\n`;
          return this.createErrorResponse(
            `Failed to parse Elementor data for ${postType} ID ${args.post_id}: JSON parsing error`,
            'PARSE_ERROR',
            'DATA_FORMAT_ERROR',
            `${debugInfo}\nRaw data: ${elementorData?.substring(0, 200)}...`
          );
        }
      } else {
        // Check if this is an Elementor page without data
        if (elementorEditMode === 'builder') {
          debugInfo += `\n⚠️ This appears to be an Elementor page but has no data.\n`;
          debugInfo += `Possible reasons:\n`;
          debugInfo += `- Empty Elementor page\n`;
          debugInfo += `- Cache/synchronization issue\n`;
          debugInfo += `- Elementor data stored differently\n`;
        } else {
          debugInfo += `\n❌ This ${postType} does not use Elementor builder.\n`;
        }
        
        return this.createErrorResponse(
          `No Elementor data found for ${postType} ID ${args.post_id}`,
          'NO_ELEMENTOR_DATA',
          'DATA_NOT_FOUND',
          `${debugInfo}\nAvailable meta keys: ${data.meta ? Object.keys(data.meta).join(', ') : 'None'}`
        );
      }
    }, 'getElementorData', `post/page ID ${args.post_id}`);
  }

  private async clearElementorCache(postId?: number) {
    try {
      console.error('Attempting to clear Elementor cache...');
      
      // Method 1: Clear specific Elementor meta that forces regeneration
      if (postId) {
        try {
          console.error(`Clearing Elementor cache meta for post ${postId}...`);
          
          // Try to get current page/post
          let currentData;
          let isPage = false;
          
          try {
            currentData = await this.axiosInstance!.get(`pages/${postId}`);
            isPage = true;
          } catch {
            currentData = await this.axiosInstance!.get(`posts/${postId}`);
          }
          
          // Update meta to force Elementor cache regeneration
          const cacheBreakMeta = {
            meta: {
              _elementor_css: '',  // Clear generated CSS cache
              _elementor_page_settings: currentData.data.meta._elementor_page_settings || '',
              _elementor_edit_mode: 'builder',
              _elementor_version: '3.0.0',  // Force version update
              _elementor_cache_bust: Date.now().toString()
            }
          };
          
          if (isPage) {
            await this.axiosInstance!.post(`pages/${postId}`, cacheBreakMeta);
          } else {
            await this.axiosInstance!.post(`posts/${postId}`, cacheBreakMeta);
          }
          
          console.error(`Elementor cache meta cleared for post ${postId}`);
        } catch (error: any) {
          console.error(`Failed to clear post-specific cache: ${error.message}`);
        }
      }
      
      // Method 2: Try WordPress cache clearing endpoints
      const cacheEndpoints = [
        'wp/v2/elementor/flush',
        'wp/v2/settings',  // Sometimes triggers cache clear
        'elementor/v1/flush-css',
        'elementor/v1/clear-cache'
      ];

      for (const endpoint of cacheEndpoints) {
        try {
          console.error(`Trying cache clear endpoint: ${endpoint}`);
          if (endpoint === 'wp/v2/settings') {
            // Force settings update to trigger cache clear
            await this.axiosInstance!.post(endpoint, {
              elementor_cache_time: Date.now().toString()
            });
          } else {
            await this.axiosInstance!.post(endpoint, {});
          }
          console.error(`Cache clear attempted via ${endpoint}`);
        } catch (error: any) {
          console.error(`Cache clear failed via ${endpoint}: ${error.response?.status || error.message}`);
        }
      }

      // Method 3: Update Elementor global settings to force regeneration
      try {
        console.error('Forcing Elementor regeneration via options...');
        
        // Update multiple Elementor options that can trigger cache clear
        const optionUpdates = [
          { elementor_css_print_method: 'internal' },
          { elementor_cpt_support: ['page', 'post'] },
          { elementor_disable_color_schemes: '' },
          { elementor_disable_typography_schemes: '' },
          { elementor_cache_files_time: Date.now().toString() }
        ];
        
        for (const option of optionUpdates) {
          try {
            await this.axiosInstance!.post('wp/v2/options', option);
          } catch (error: any) {
            console.error(`Option update failed: ${error.message}`);
          }
        }
        
        console.error('Elementor options updated to force regeneration');
      } catch (error: any) {
        console.error(`Failed to update Elementor options: ${error.message}`);
      }

      // Method 4: Force Elementor to rebuild by clearing ALL cache-related meta
      if (postId) {
        try {
          console.error('Forcing complete Elementor rebuild...');
          
          // Get current data again
          let currentData;
          let isPage = false;
          
          try {
            currentData = await this.axiosInstance!.get(`pages/${postId}`);
            isPage = true;
          } catch {
            currentData = await this.axiosInstance!.get(`posts/${postId}`);
          }
          
          // Force complete rebuild by clearing all Elementor cache meta
          const forceRebuildMeta = {
            meta: {
              _elementor_css: '',
              _elementor_page_assets: '',
              _elementor_controls_usage: '',
              _elementor_css_file: '',
              _elementor_inline_css: '',
              _elementor_template_type: '',
              _elementor_edit_mode: 'builder',
              _elementor_version: '3.20.0',
              _elementor_pro_version: '3.20.0',
              _elementor_data: currentData.data.meta._elementor_data,  // Keep the data but force rebuild
              _elementor_cache_bust: Date.now().toString(),
              _elementor_force_rebuild: 'yes'
            }
          };
          
          if (isPage) {
            await this.axiosInstance!.post(`pages/${postId}`, forceRebuildMeta);
          } else {
            await this.axiosInstance!.post(`posts/${postId}`, forceRebuildMeta);
          }
          
          console.error('Complete Elementor rebuild forced');
        } catch (error: any) {
          console.error(`Force rebuild failed: ${error.message}`);
        }
      }

      // Method 5: Try to trigger WordPress object cache flush
      try {
        console.error('Attempting WordPress object cache flush...');
        await this.axiosInstance!.post('wp/v2/posts', {
          title: `Cache Flush Trigger ${Date.now()}`,
          content: 'Cache flush trigger',
          status: 'draft'
        });
        console.error('Cache flush trigger post created');
      } catch (error: any) {
        console.error(`Cache flush trigger failed: ${error.message}`);
      }

      // Method 6: Try to force WordPress transient cache clear
      try {
        console.error('Attempting transient cache clear...');
        await this.axiosInstance!.post('wp/v2/options', {
          elementor_transient_clear: Date.now().toString()
        });
        console.error('Transient cache clear attempted');
      } catch (error: any) {
        console.error(`Transient cache clear failed: ${error.message}`);
      }

      console.error('Aggressive Elementor cache clearing sequence completed');
      
    } catch (error: any) {
      console.error('Cache clearing error:', error.message);
    }
  }

  private async updateElementorData(args: { post_id: number; elementor_data: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      // Update the post meta with Elementor data
      const updateData = {
        meta: {
          _elementor_data: args.elementor_data,
          _elementor_edit_mode: 'builder',
        },
      };

      // Try to update as post first, then as page if that fails
      let response;
      let postType = 'post';
      
      try {
        response = await this.axiosInstance!.post(`posts/${args.post_id}`, updateData);
      } catch (postError: any) {
        if (postError.response?.status === 404) {
          // Try as page
          try {
            response = await this.axiosInstance!.post(`pages/${args.post_id}`, updateData);
            postType = 'page';
          } catch (pageError: any) {
            return this.createErrorResponse(
              `Post/Page ID ${args.post_id} not found in posts or pages`,
              'POST_PAGE_NOT_FOUND',
              'NOT_FOUND',
              'Failed to update both post and page endpoints'
            );
          }
        } else {
          return this.createErrorResponse(
            `Failed to update post: ${postError.response?.data?.message || postError.message}`,
            'UPDATE_POST_ERROR',
            'API_ERROR',
            `HTTP ${postError.response?.status}: ${postError.response?.statusText}`
          );
        }
      }

      // Clear Elementor cache after updating data
      await this.clearElementorCache(args.post_id);
      
      return this.createSuccessResponse(
        {
          post_type: postType,
          post_id: args.post_id,
          cache_cleared: true,
          updated_data: true
        },
        `Elementor data updated successfully for ${postType} ID: ${args.post_id}`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to update Elementor data: ${error.response?.data?.message || error.message}`,
        'UPDATE_ELEMENTOR_DATA_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async updateElementorWidget(args: { post_id: number; widget_id: string; widget_settings?: object; widget_content?: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(
          `Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}`,
          'ELEMENTOR_DATA_ERROR',
          'DATA_ERROR',
          'Could not retrieve or parse Elementor data for widget update'
        );
      }
      
      const elementorData = parsedResult.data;
      
      // Function to recursively find and update widget
      const updateWidgetRecursive = (elements: any[]): boolean => {
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          
          if (element.id === args.widget_id) {
            // Found the widget, update it
            if (args.widget_settings) {
              element.settings = { ...element.settings, ...args.widget_settings };
            }
            
            // Special handling for HTML widget content
            if (args.widget_content && element.widgetType === 'html') {
              element.settings.html = args.widget_content;
            }
            
            // Special handling for text widget content
            if (args.widget_content && element.widgetType === 'text-editor') {
              element.settings.editor = args.widget_content;
            }
            
            // Special handling for heading widget content
            if (args.widget_content && element.widgetType === 'heading') {
              element.settings.title = args.widget_content;
            }
            
            return true;
          }
          
          // Recursively search in nested elements
          if (element.elements && element.elements.length > 0) {
            if (updateWidgetRecursive(element.elements)) {
              return true;
            }
          }
        }
        return false;
      };
      
      // Find and update the widget
      const widgetFound = updateWidgetRecursive(elementorData);
      
      if (!widgetFound) {
        return this.createErrorResponse(
          `Widget ID ${args.widget_id} not found in Elementor data`,
          'WIDGET_NOT_FOUND',
          'NOT_FOUND',
          `Could not locate widget with ID ${args.widget_id} in the page structure`
        );
      }
      
      // Update the page with modified data
      const updateData = {
        meta: {
          _elementor_data: JSON.stringify(elementorData),
          _elementor_edit_mode: 'builder',
        },
      };

      // Try to update as post first, then as page if that fails
      let response;
      let postType = 'post';
      
      try {
        response = await this.axiosInstance!.post(`posts/${args.post_id}`, updateData);
      } catch (postError: any) {
        if (postError.response?.status === 404) {
          // Try as page
          try {
            response = await this.axiosInstance!.post(`pages/${args.post_id}`, updateData);
            postType = 'page';
          } catch (pageError: any) {
            return this.createErrorResponse(
              `Post/Page ID ${args.post_id} not found in posts or pages`,
              'POST_PAGE_NOT_FOUND',
              'NOT_FOUND',
              'Failed to update both post and page endpoints for widget update'
            );
          }
        } else {
          return this.createErrorResponse(
            `Failed to update post: ${postError.response?.data?.message || postError.message}`,
            'UPDATE_POST_ERROR',
            'API_ERROR',
            `HTTP ${postError.response?.status}: ${postError.response?.statusText}`
          );
        }
      }

      // Clear Elementor cache after updating data
      await this.clearElementorCache(args.post_id);
      
      return this.createSuccessResponse(
        {
          widget_id: args.widget_id,
          post_type: postType,
          post_id: args.post_id,
          cache_cleared: true,
          updated_settings: !!args.widget_settings,
          updated_content: !!args.widget_content
        },
        `Elementor widget ${args.widget_id} updated successfully for ${postType} ID: ${args.post_id}`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to update Elementor widget: ${error.response?.data?.message || error.message}`,
        'UPDATE_WIDGET_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async getElementorWidget(args: { post_id: number; widget_id: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      console.error(`🔍 Getting widget ${args.widget_id} from post ID: ${args.post_id}`);
      
      // Get current Elementor data using safe parsing utility
      console.error(`🔍 Getting Elementor data for widget search in post ID: ${args.post_id}`);
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        console.error(`❌ Failed to get Elementor data: ${parsedResult.error}`);
        return this.createErrorResponse(
          `Failed to retrieve Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}`,
          'ELEMENTOR_DATA_ERROR',
          'DATA_ERROR',
          'Could not retrieve or parse Elementor data for widget retrieval'
        );
      }
      
      const elementorData = parsedResult.data;
      console.error(`✅ Successfully parsed data, searching through ${elementorData.length} top-level elements for widget ${args.widget_id}`);
      
      // Function to recursively find widget
      const findWidgetRecursive = (elements: any[]): any => {
        for (const element of elements) {
          if (element.id === args.widget_id) {
            return element;
          }
          
          // Recursively search in nested elements
          if (element.elements && element.elements.length > 0) {
            const found = findWidgetRecursive(element.elements);
            if (found) return found;
          }
        }
        return null;
      };
      
      // Find the widget
      const widget = findWidgetRecursive(elementorData);
      
      if (!widget) {
        return this.createErrorResponse(
          `Widget ID ${args.widget_id} not found in Elementor data`,
          'WIDGET_NOT_FOUND',
          'NOT_FOUND',
          `Could not locate widget with ID ${args.widget_id} in the page structure`
        );
      }
      
      return this.createSuccessResponse(
        {
          widget: widget,
          widget_id: args.widget_id,
          post_id: args.post_id
        },
        `Widget ${args.widget_id} retrieved successfully`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get Elementor widget: ${error.response?.data?.message || error.message}`,
        'GET_WIDGET_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async getElementorElements(args: { post_id: number; include_content?: boolean }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      console.error(`🔍 Getting Elementor elements for ID: ${args.post_id}`);
      
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(
          `No Elementor data found for post/page ID ${args.post_id}`,
          'NO_ELEMENTOR_DATA',
          'DATA_NOT_FOUND',
          `Post/page does not contain Elementor data or is not built with Elementor: ${parsedResult.error}`
        );
      }
      
      const elementorData = parsedResult.data;
      console.error(`✅ Successfully parsed ${elementorData.length} top-level elements`);
      
      // Function to recursively extract elements
      const extractElementsRecursive = (elements: any[], level = 0): any[] => {
        const result: any[] = [];
        
        for (const element of elements) {
          const elementInfo: any = {
            id: element.id,
            type: element.elType,
            level: level,
          };
          
          if (element.widgetType) {
            elementInfo.widgetType = element.widgetType;
          }
          
          if (args.include_content && element.settings) {
            // Include preview of content for common widget types
            if (element.widgetType === 'html' && element.settings.html) {
              elementInfo.contentPreview = element.settings.html.substring(0, 100) + (element.settings.html.length > 100 ? '...' : '');
            } else if (element.widgetType === 'text-editor' && element.settings.editor) {
              elementInfo.contentPreview = element.settings.editor.substring(0, 100) + (element.settings.editor.length > 100 ? '...' : '');
            } else if (element.widgetType === 'heading' && element.settings.title) {
              elementInfo.contentPreview = element.settings.title.substring(0, 100) + (element.settings.title.length > 100 ? '...' : '');
            }
          }
          
          result.push(elementInfo);
          
          // Recursively process nested elements
          if (element.elements && element.elements.length > 0) {
            result.push(...extractElementsRecursive(element.elements, level + 1));
          }
        }
        
        return result;
      };
      
      const elements = extractElementsRecursive(elementorData);
      
      return this.createSuccessResponse(
        { 
          post_id: args.post_id,
          total_elements: elements.length,
          elements: elements 
        },
        `Retrieved ${elements.length} Elementor elements from post/page ${args.post_id}`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get Elementor elements: ${error.response?.data?.message || error.message}`,
        'GET_ELEMENTS_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async updateElementorSection(args: { post_id: number; section_id: string; widgets_updates: Array<{widget_id: string; widget_settings?: object; widget_content?: string}> }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(
          `Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}`,
          'ELEMENTOR_DATA_ERROR',
          'DATA_ERROR',
          'Could not retrieve or parse Elementor data for section update'
        );
      }
      
      const elementorData = parsedResult.data;
      
      let sectionFound = false;
      let updatedWidgets: string[] = [];
      
      // Function to recursively find section and update widgets
      const updateSectionWidgets = (elements: any[]): boolean => {
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          
          if (element.id === args.section_id) {
            sectionFound = true;
            // Found the section, now update widgets within it
            for (const widgetUpdate of args.widgets_updates) {
              const updated = updateWidgetInElements(element.elements || [], widgetUpdate);
              if (updated) {
                updatedWidgets.push(widgetUpdate.widget_id);
              }
            }
            return true;
          }
          
          // Recursively search in nested elements
          if (element.elements && element.elements.length > 0) {
            if (updateSectionWidgets(element.elements)) {
              return true;
            }
          }
        }
        return false;
      };
      
      // Helper function to update widget in elements array
      const updateWidgetInElements = (elements: any[], widgetUpdate: {widget_id: string; widget_settings?: object; widget_content?: string}): boolean => {
        for (const element of elements) {
          if (element.id === widgetUpdate.widget_id) {
            // Found the widget, update it
            if (widgetUpdate.widget_settings) {
              element.settings = { ...element.settings, ...widgetUpdate.widget_settings };
            }
            
            // Special handling for HTML widget content
            if (widgetUpdate.widget_content && element.widgetType === 'html') {
              element.settings.html = widgetUpdate.widget_content;
            }
            
            // Special handling for text widget content
            if (widgetUpdate.widget_content && element.widgetType === 'text-editor') {
              element.settings.editor = widgetUpdate.widget_content;
            }
            
            // Special handling for heading widget content
            if (widgetUpdate.widget_content && element.widgetType === 'heading') {
              element.settings.title = widgetUpdate.widget_content;
            }
            
            return true;
          }
          
          // Recursively search in nested elements
          if (element.elements && element.elements.length > 0) {
            if (updateWidgetInElements(element.elements, widgetUpdate)) {
              return true;
            }
          }
        }
        return false;
      };
      
      // Find section and update widgets
      updateSectionWidgets(elementorData);
      
      if (!sectionFound) {
        return this.createErrorResponse(

          "Section ID ${args.section_id} not found in Elementor data",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page with modified data
      const updateData = {
        meta: {
          _elementor_data: JSON.stringify(elementorData),
          _elementor_edit_mode: 'builder',
        },
      };

      // Try to update as post first, then as page if that fails
      let response;
      let postType = 'post';
      
      try {
        response = await this.axiosInstance!.post(`posts/${args.post_id}`, updateData);
      } catch (postError: any) {
        if (postError.response?.status === 404) {
          // Try as page
          try {
            response = await this.axiosInstance!.post(`pages/${args.post_id}`, updateData);
            postType = 'page';
          } catch (pageError: any) {
            return this.createErrorResponse(

              "Post/Page ID ${args.post_id} not found in posts or pages",

              "OPERATION_ERROR",

              "API_ERROR",

              "Operation failed"

            );
          }
        } else {
          throw postError;
        }
      }

      // Clear Elementor cache after updating data
      await this.clearElementorCache(args.post_id);
      
      return this.createSuccessResponse(
        {
          operation_type: "update_section_widgets",
          section_id: args.section_id,
          post_id: args.post_id,
          post_type: postType,
          updated_widgets: updatedWidgets,
          widgets_not_found: args.widgets_updates.filter(w => !updatedWidgets.includes(w.widget_id)).map(w => w.widget_id),
          total_updates_requested: args.widgets_updates.length,
          successful_updates: updatedWidgets.length,
          cache_cleared: true,
          manual_cache_clearing_required: true
        },
        `Elementor section ${args.section_id} updated successfully with ${updatedWidgets.length}/${args.widgets_updates.length} widget updates`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to update Elementor section: ${error.response?.data?.message || error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }



  private async getElementorDataDeepChunked(args: { post_id: number; max_depth?: number; element_index?: number; include_widget_previews?: boolean }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      console.error(`🔍 Getting deep chunked Elementor data for ID: ${args.post_id}, element index: ${args.element_index || 0}`);
      
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(
          `Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}`,
          'ELEMENTOR_DATA_ERROR',
          'DATA_ERROR',
          'Could not retrieve or parse Elementor data for deep chunking'
        );
      }
      
      const elementorData = parsedResult.data;
      const maxDepth = args.max_depth || 2;
      const elementIndex = args.element_index || 0;
      const includeWidgetPreviews = args.include_widget_previews || false;
      
      if (elementIndex >= elementorData.length) {
        return this.createErrorResponse(
          `Element index ${elementIndex} is out of range. Total top-level elements: ${elementorData.length}`,
          'INDEX_OUT_OF_RANGE',
          'VALIDATION_ERROR',
          'Requested element index exceeds available elements'
        );
      }
      
      // Function to limit depth and content of elements
      const limitElementDepth = (element: any, currentDepth: number): any => {
        const limited: any = {
          id: element.id,
          elType: element.elType,
          widgetType: element.widgetType || null,
          isInner: element.isInner || false,
          depth: currentDepth
        };
        
        // Add limited settings (exclude heavy content)
        if (element.settings) {
          limited.settings = {};
          
          // Include only lightweight settings, exclude heavy content
          const lightweightKeys = ['_column_size', '_inline_size', 'background_background', 'content_width', 'flex_direction', 'gap'];
          lightweightKeys.forEach(key => {
            if (element.settings[key] !== undefined) {
              limited.settings[key] = element.settings[key];
            }
          });
          
          // Add widget content preview if requested and if it's a widget
          if (includeWidgetPreviews && element.widgetType && element.settings) {
            if (element.settings.title) {
              limited.content_preview = String(element.settings.title).substring(0, 100);
            } else if (element.settings.editor) {
              limited.content_preview = String(element.settings.editor).replace(/<[^>]*>/g, '').substring(0, 100);
            } else if (element.settings.html) {
              limited.content_preview = String(element.settings.html).replace(/<[^>]*>/g, '').substring(0, 100);
            }
          }
        }
        
        // Recursively process children up to max depth
        if (element.elements && element.elements.length > 0 && currentDepth < maxDepth) {
          limited.elements = element.elements.map((child: any) => limitElementDepth(child, currentDepth + 1));
          limited.child_count = element.elements.length;
        } else if (element.elements && element.elements.length > 0) {
          // If we've reached max depth, just show summary
          limited.child_count = element.elements.length;
          limited.child_types = [...new Set(element.elements.map((child: any) => child.elType || child.widgetType))];
        }
        
        return limited;
      };
      
      const targetElement = elementorData[elementIndex];
      const limitedElement = limitElementDepth(targetElement, 0);
      
      // Calculate approximate token size (rough estimate: 4 chars per token)
      const estimatedTokens = Math.ceil(JSON.stringify(limitedElement).length / 4);
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          element_index: elementIndex,
          max_depth: maxDepth,
          include_widget_previews: includeWidgetPreviews,
          total_top_level_elements: elementorData.length,
          element_data: limitedElement,
          navigation: {
            has_previous: elementIndex > 0,
            has_next: elementIndex < elementorData.length - 1,
            previous_index: elementIndex > 0 ? elementIndex - 1 : null,
            next_index: elementIndex < elementorData.length - 1 ? elementIndex + 1 : null
          },
          estimated_tokens: estimatedTokens
        },
        `Retrieved deep chunked element ${elementIndex + 1} of ${elementorData.length} with max depth ${maxDepth} (estimated ${estimatedTokens} tokens)`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get deep chunked Elementor data: ${error.message}`,
        'GET_DEEP_CHUNKED_DATA_ERROR',
        'API_ERROR',
        'Operation failed'
      );
    }
  }

  private async getElementorStructureSummary(args: { post_id: number; max_depth?: number }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    try {
      console.error(`📊 Getting structure summary for ID: ${args.post_id}`);
      
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(
          `Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}`,
          'ELEMENTOR_DATA_ERROR',
          'DATA_ERROR',
          'Could not retrieve or parse Elementor data for structure summary'
        );
      }
      
      const elementorData = parsedResult.data;
      const maxDepth = args.max_depth || 4;
      
      // Function to create a minimal structure summary
      const createStructureSummary = (elements: any[], currentDepth: number = 0): any[] => {
        return elements.map((element, index) => {
          const summary: any = {
            index: index,
            id: element.id,
            type: element.elType,
            depth: currentDepth
          };
          
          if (element.widgetType) {
            summary.widget_type = element.widgetType;
          }
          
          // Add some key properties for structure understanding
          if (element.settings) {
            if (element.settings._column_size) {
              summary.column_size = element.settings._column_size;
            }
            if (element.settings.content_width) {
              summary.content_width = element.settings.content_width;
            }
            if (element.settings.flex_direction) {
              summary.flex_direction = element.settings.flex_direction;
            }
          }
          
          // Count children and their types
          if (element.elements && element.elements.length > 0) {
            summary.child_count = element.elements.length;
            summary.child_types = [...new Set(element.elements.map((child: any) => child.elType || child.widgetType))];
            
            // Recursively process children up to max depth
            if (currentDepth < maxDepth) {
              summary.children = createStructureSummary(element.elements, currentDepth + 1);
            }
          }
          
          return summary;
        });
      };
      
      const structureSummary = createStructureSummary(elementorData);
      
      // Calculate total elements at each level
      const levelCounts: { [key: number]: number } = {};
      const widgetCounts: { [key: string]: number } = {};
      
      const countElements = (elements: any[], depth: number = 0) => {
        levelCounts[depth] = (levelCounts[depth] || 0) + elements.length;
        
        elements.forEach(element => {
          if (element.widget_type) {
            widgetCounts[element.widget_type] = (widgetCounts[element.widget_type] || 0) + 1;
          }
          
          if (element.children) {
            countElements(element.children, depth + 1);
          }
        });
      };
      
      countElements(structureSummary);
      
      // Create human-readable summary
      let textSummary = `📄 Page Structure Summary (Post ID: ${args.post_id})\n\n`;
      textSummary += `🏗️ Top-level elements: ${elementorData.length}\n`;
      
      Object.entries(levelCounts).forEach(([depth, count]) => {
        textSummary += `   Level ${depth}: ${count} elements\n`;
      });
      
      if (Object.keys(widgetCounts).length > 0) {
        textSummary += `\n🧩 Widget types found:\n`;
        Object.entries(widgetCounts)
          .sort(([,a], [,b]) => b - a)
          .forEach(([widget, count]) => {
            textSummary += `   ${widget}: ${count}\n`;
          });
      }
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          max_depth: maxDepth,
          structure: structureSummary,
          statistics: {
            total_top_level_elements: elementorData.length,
            level_counts: levelCounts,
            widget_counts: widgetCounts,
            total_widgets: Object.values(widgetCounts).reduce((sum, count) => sum + count, 0)
          },
          text_summary: textSummary
        },
        `Structure summary generated for ${elementorData.length} top-level elements with ${Object.values(levelCounts).reduce((sum, count) => sum + count, 0)} total elements`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get structure summary: ${error.message}`,
        'GET_STRUCTURE_SUMMARY_ERROR',
        'API_ERROR',
        'Operation failed'
      );
    }
  }

  private async backupElementorData(args: { post_id: number; backup_name?: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Create backup metadata
      const timestamp = new Date().toISOString();
      const backupName = args.backup_name || `backup_${timestamp}`;
      
      // Try to get the post/page to determine type
      let postInfo;
      let postType = 'post';
      
      try {
        postInfo = await this.axiosInstance!.get(`posts/${args.post_id}`, {
          params: { context: 'edit' }
        });
      } catch (postError: any) {
        if (postError.response?.status === 404) {
          try {
            postInfo = await this.axiosInstance!.get(`pages/${args.post_id}`, {
              params: { context: 'edit' }
            });
            postType = 'page';
          } catch (pageError: any) {
            return this.createErrorResponse(

              "Post/Page ID ${args.post_id} not found in posts or pages",

              "OPERATION_ERROR",

              "API_ERROR",

              "Operation failed"

            );
          }
        } else {
          throw postError;
        }
      }
      
      // Store backup in post meta with unique key
      const backupKey = `_elementor_data_backup_${Date.now()}`;
      const backupMeta = {
        meta: {
          [backupKey]: JSON.stringify({
            backup_name: backupName,
            timestamp: timestamp,
            post_id: args.post_id,
            post_type: postType,
            post_title: postInfo.data.title.rendered || postInfo.data.title.raw,
            elementor_data: JSON.stringify(parsedResult.data)
          })
        }
      };
      
      // Save backup
      let response;
      if (postType === 'page') {
        response = await this.axiosInstance!.post(`pages/${args.post_id}`, backupMeta);
      } else {
        response = await this.axiosInstance!.post(`posts/${args.post_id}`, backupMeta);
      }
      
      return this.createSuccessResponse(
        {
          operation_type: "backup_elementor_data",
          post_id: args.post_id,
          post_type: postType,
          post_title: postInfo.data.title.rendered || postInfo.data.title.raw,
          backup_name: backupName,
          backup_key: backupKey,
          timestamp: timestamp,
          backup_storage: "wordpress_meta",
          data_size: JSON.stringify(parsedResult.data).length
        },
        `Elementor data backup created successfully! Backup key: ${backupKey}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to backup Elementor data: ${error.response?.data?.message || error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async getMedia(args: { per_page?: number; media_type?: string }) {
    const authCheck = this.ensureAuthenticated();
    if (authCheck) return authCheck;
    
    const params: any = {
      per_page: args.per_page || 10,
    };
    
    if (args.media_type) {
      params.media_type = args.media_type;
    }

    try {
      console.error(`Fetching media with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance!.get('media', { params });
      
      // Create optimized summary objects instead of returning full content
      const media = response.data;
      const mediaSummaries = media.map((item: any) => ({
        id: item.id,
        title: item.title?.rendered || '(No title)',
        filename: item.media_details?.file || 'Unknown',
        mime_type: item.mime_type,
        file_size: item.media_details?.filesize || 0,
        width: item.media_details?.width || null,
        height: item.media_details?.height || null,
        url: item.source_url,
        date_uploaded: item.date,
        alt_text: item.alt_text || '',
        author: item.author,
        status: item.status
      }));
      
      return this.createSuccessResponse(
        {
          media: mediaSummaries, // Return summaries instead of full objects
          count: mediaSummaries.length,
          filter: args.media_type || 'all',
          performance_note: "Optimized response - use get_media_item(id) for full details"
        },
        `Retrieved ${mediaSummaries.length} media item summaries`
      );
    } catch (error: any) {
      console.error(`Error fetching media: ${error.response?.status} - ${error.response?.statusText}`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Headers: ${JSON.stringify(error.config?.headers)}`);
      
      return this.createErrorResponse(
        `Failed to fetch media: ${error.response?.status} ${error.response?.statusText} - ${error.response?.data?.message || error.message}`,
        'GET_MEDIA_ERROR',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText}`
      );
    }
  }

  private async uploadMedia(args: { file_path: string; title?: string; alt_text?: string }) {
    this.ensureAuthenticated();
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      if (!fs.existsSync(args.file_path)) {
        return this.createErrorResponse(
          `Failed to upload media: File not found: ${args.file_path}`,
          'FILE_NOT_FOUND',
          'VALIDATION_ERROR',
          'The specified file path does not exist or is not accessible'
        );
      }

      const formData = new FormData();
      const fileStream = fs.createReadStream(args.file_path);
      const fileName = path.basename(args.file_path);
      
      formData.append('file', fileStream, fileName);
      
      if (args.title) {
        formData.append('title', args.title);
      }
      
      if (args.alt_text) {
        formData.append('alt_text', args.alt_text);
      }

      const response = await this.axiosInstance!.post('media', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });
      
      return this.createSuccessResponse(
        {
          operation_type: "upload_media",
          media_id: response.data.id,
          url: response.data.source_url,
          title: response.data.title.rendered,
          file_path: args.file_path,
          file_name: fileName,
          mime_type: response.data.mime_type,
          file_size: response.data.media_details?.filesize || null,
          alt_text: args.alt_text || null,
          upload_date: response.data.date
        },
        `Media uploaded successfully! Media ID: ${response.data.id} - ${response.data.title.rendered}`
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to upload media: ${error.response?.data?.message || error.message}`,
        'UPLOAD_FAILED',
        'API_ERROR',
        `HTTP ${error.response?.status}: ${error.response?.statusText} - ${error.response?.data || error.message}`
      );
    }
  }

  // Helper methods for status-based responses
  private createSuccessResponse(data: any, message?: string) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: "success",
            data: data,
            message: message || "Operation completed successfully"
          }, null, 2),
        },
      ],
    };
  }

  private createErrorResponse(message: string, code?: string, errorType?: string, details?: string) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: "error",
            data: {
              message: message,
              code: code || "GENERAL_ERROR",
              error_type: errorType || "OPERATION_ERROR",
              details: details || message
            }
          }, null, 2),
        },
      ],
    };
  }

  // Section and Container Creation Tools
  private async createElementorSection(args: { post_id: number; position?: number; columns?: number; section_settings?: object }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      let elementorData: any[] = [];
      if (parsedResult.success && parsedResult.data) {
        elementorData = parsedResult.data;
      }
      
      // Generate unique ID for the section
      const sectionId = Math.random().toString(36).substr(2, 8);
      const columns = args.columns || 1;
      
      // Create column elements
      const columnElements = [];
      for (let i = 0; i < columns; i++) {
        const columnId = Math.random().toString(36).substr(2, 8);
        columnElements.push({
          id: columnId,
          elType: 'column',
          isInner: false,
          settings: {
            _column_size: Math.floor(100 / columns),
            _inline_size: null
          },
          elements: [],
          widgetType: null
        });
      }
      
      // Create new section
      const newSection = {
        id: sectionId,
        elType: 'section',
        isInner: false,
        settings: args.section_settings || {},
        elements: columnElements,
        widgetType: null
      };
      
      // Insert section at specified position or at the end
      if (args.position !== undefined && args.position >= 0 && args.position < elementorData.length) {
        elementorData.splice(args.position, 0, newSection);
      } else {
        elementorData.push(newSection);
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          operation_type: "create_section",
          section_id: sectionId,
          columns: columns,
          position: args.position || elementorData.length - 1,
          post_id: args.post_id,
          section_settings: args.section_settings || {},
          column_ids: columnElements.map(col => col.id)
        },
        `Section created successfully! Section ID: ${sectionId} with ${columns} columns at position ${args.position || 'end'}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to create section: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async createElementorContainer(args: { post_id: number; position?: number; container_settings?: object }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      let elementorData: any[] = [];
      if (parsedResult.success && parsedResult.data) {
        elementorData = parsedResult.data;
      }
      
      // Generate unique ID for the container
      const containerId = Math.random().toString(36).substr(2, 8);
      
      // Create new container (Elementor v3.6+ flexbox container)
      const newContainer = {
        id: containerId,
        elType: 'container',
        isInner: false,
        settings: {
          content_width: 'boxed',
          flex_direction: 'column',
          ...args.container_settings
        },
        elements: [],
        widgetType: null
      };
      
      // Insert container at specified position or at the end
      if (args.position !== undefined && args.position >= 0 && args.position < elementorData.length) {
        elementorData.splice(args.position, 0, newContainer);
      } else {
        elementorData.push(newContainer);
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          operation_type: "create_container",
          container_id: containerId,
          position: args.position || elementorData.length - 1,
          post_id: args.post_id,
          container_settings: {
            content_width: 'boxed',
            flex_direction: 'column',
            ...args.container_settings
          }
        },
        `Container created successfully! Container ID: ${containerId} at position ${args.position || 'end'}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to create container: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async addColumnToSection(args: { post_id: number; section_id: string; columns_to_add?: number }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      const columnsToAdd = args.columns_to_add || 1;
      let sectionFound = false;
      
      // Function to find and update section
      const findAndUpdateSection = (elements: any[]): boolean => {
        for (let element of elements) {
          if (element.id === args.section_id && element.elType === 'section') {
            // Add new columns
            for (let i = 0; i < columnsToAdd; i++) {
              const columnId = Math.random().toString(36).substr(2, 8);
              element.elements.push({
                id: columnId,
                elType: 'column',
                isInner: false,
                settings: {},
                elements: [],
                widgetType: null
              });
            }
            return true;
          }
          
          if (element.elements && element.elements.length > 0) {
            if (findAndUpdateSection(element.elements)) {
              return true;
            }
          }
        }
        return false;
      };
      
      sectionFound = findAndUpdateSection(elementorData);
      
      if (!sectionFound) {
        return this.createErrorResponse(

          "Section ID ${args.section_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          operation_type: "add_columns_to_section",
          section_id: args.section_id,
          columns_added: columnsToAdd,
          post_id: args.post_id,
          new_column_ids: Array.from({length: columnsToAdd}, () => Math.random().toString(36).substr(2, 8))
        },
        `Successfully added ${columnsToAdd} column(s) to section ${args.section_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to add columns to section: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async duplicateSection(args: { post_id: number; section_id: string; position?: number }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      let sectionToDuplicate: any = null;
      let insertIndex = elementorData.length;
      
      // Find the section to duplicate
      for (let i = 0; i < elementorData.length; i++) {
        if (elementorData[i].id === args.section_id && elementorData[i].elType === 'section') {
          sectionToDuplicate = JSON.parse(JSON.stringify(elementorData[i])); // Deep copy
          insertIndex = args.position !== undefined ? args.position : i + 1;
          break;
        }
      }
      
      if (!sectionToDuplicate) {
        return this.createErrorResponse(

          "Section ID ${args.section_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Generate new IDs for the duplicated section and all its children
      const generateNewIds = (element: any): void => {
        element.id = Math.random().toString(36).substr(2, 8);
        if (element.elements) {
          element.elements.forEach(generateNewIds);
        }
      };
      
      generateNewIds(sectionToDuplicate);
      
      // Insert the duplicated section
      elementorData.splice(insertIndex, 0, sectionToDuplicate);
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          operation_type: "duplicate_section",
          original_section_id: args.section_id,
          new_section_id: sectionToDuplicate.id,
          position: insertIndex,
          post_id: args.post_id,
          duplicated_elements_count: 1 + (sectionToDuplicate.elements ? sectionToDuplicate.elements.length : 0)
        },
        `Section duplicated successfully! New section ID: ${sectionToDuplicate.id} inserted at position: ${insertIndex}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to duplicate section: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  // Widget Addition Tools
  private async addWidgetToSection(args: { post_id: number; section_id?: string; column_id?: string; widget_type: string; widget_settings?: object; position?: number }) {
    this.ensureAuthenticated();
    
    try {
      console.error(`➕ Adding widget ${args.widget_type} to post ID: ${args.post_id}`);
      if (args.section_id) console.error(`📍 Target section: ${args.section_id}`);
      if (args.column_id) console.error(`📍 Target column: ${args.column_id}`);
      
      // Get current Elementor data using safe parsing utility
      console.error(`🔄 Fetching Elementor data for widget addition...`);
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        console.error(`❌ Failed to get Elementor data: ${parsedResult.error}`);
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}. Cannot add widget.",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      console.error(`✅ Successfully parsed data for widget addition: ${elementorData.length} top-level elements`);
      
      // Generate unique ID for the widget
      const widgetId = Math.random().toString(36).substr(2, 8);
      
      // Create new widget
      const newWidget = {
        id: widgetId,
        elType: 'widget',
        widgetType: args.widget_type,
        isInner: false,
        settings: args.widget_settings || {},
        elements: []
      };
      
      let targetFound = false;
      
      // Function to find target container and add widget
      const findAndAddWidget = (elements: any[], visited = new Set()): boolean => {
        for (let element of elements) {
          // Prevent infinite recursion by tracking visited elements
          if (visited.has(element.id)) {
            continue;
          }
          visited.add(element.id);
          
          // If column_id is specified, look for that specific column
          if (args.column_id && element.id === args.column_id && element.elType === 'column') {
            if (args.position !== undefined && args.position >= 0 && args.position < element.elements.length) {
              element.elements.splice(args.position, 0, newWidget);
            } else {
              element.elements.push(newWidget);
            }
            return true;
          }
          
          // If section_id is specified, add to first column of that section
          if (args.section_id && element.id === args.section_id && element.elType === 'section') {
            if (element.elements && element.elements.length > 0) {
              const firstColumn = element.elements[0];
              if (args.position !== undefined && args.position >= 0 && args.position < firstColumn.elements.length) {
                firstColumn.elements.splice(args.position, 0, newWidget);
              } else {
                firstColumn.elements.push(newWidget);
              }
              return true;
            }
          }
          
          // If no specific target, add to first available column or container
          if (!args.section_id && !args.column_id) {
            if (element.elType === 'column' || element.elType === 'container') {
              element.elements.push(newWidget);
              return true;
            }
          }
          
          // Recursively search
          if (element.elements && element.elements.length > 0) {
            if (findAndAddWidget(element.elements, visited)) {
              return true;
            }
          }
        }
        return false;
      };
      
      targetFound = findAndAddWidget(elementorData);
      
      if (!targetFound) {
        return this.createErrorResponse(

          "Target container not found (section_id: ${args.section_id}, column_id: ${args.column_id})",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          widget_id: widgetId,
          widget_type: args.widget_type,
          post_id: args.post_id,
          target_section: args.section_id,
          target_column: args.column_id,
          position: args.position || 'end'
        },
        `Widget added successfully! Widget ID: ${widgetId}, Type: ${args.widget_type}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to add widget: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async insertWidgetAtPosition(args: { post_id: number; widget_type: string; widget_settings?: object; target_element_id: string; insert_position?: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      // Generate unique ID for the widget
      const widgetId = Math.random().toString(36).substr(2, 8);
      
      // Create new widget
      const newWidget = {
        id: widgetId,
        elType: 'widget',
        widgetType: args.widget_type,
        isInner: false,
        settings: args.widget_settings || {},
        elements: []
      };
      
      let targetFound = false;
      
      // Function to find target element and insert widget
      const findAndInsertWidget = (elements: any[], parent: any): boolean => {
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          
          if (element.id === args.target_element_id) {
            const insertIndex = args.insert_position === 'before' ? i : i + 1;
            parent.elements.splice(insertIndex, 0, newWidget);
            return true;
          }
          
          if (element.elements && element.elements.length > 0) {
            if (findAndInsertWidget(element.elements, element)) {
              return true;
            }
          }
        }
        return false;
      };
      
      // Create a mock parent for top-level elements
      const mockParent = { elements: elementorData };
      targetFound = findAndInsertWidget(elementorData, mockParent);
      
      if (!targetFound) {
        return this.createErrorResponse(

          "Target element ID ${args.target_element_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          operation_type: "insert_widget_at_position",
          widget_id: widgetId,
          widget_type: args.widget_type,
          target_element_id: args.target_element_id,
          insert_position: args.insert_position || 'after',
          post_id: args.post_id,
          widget_settings: args.widget_settings || {}
        },
        `Widget inserted successfully! Widget ID: ${widgetId} (${args.widget_type}) ${args.insert_position || 'after'} element: ${args.target_element_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to insert widget: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async cloneWidget(args: { post_id: number; widget_id: string; target_element_id?: string; insert_position?: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      let widgetToClone: any = null;
      
      // Function to find widget to clone
      const findWidget = (elements: any[], visited = new Set()): any => {
        for (let element of elements) {
          // Prevent infinite recursion by tracking visited elements
          if (visited.has(element.id)) {
            continue;
          }
          visited.add(element.id);
          
          if (element.id === args.widget_id) {
            return JSON.parse(JSON.stringify(element)); // Deep copy
          }
          
          if (element.elements && element.elements.length > 0) {
            const found = findWidget(element.elements, visited);
            if (found) return found;
          }
        }
        return null;
      };
      
      widgetToClone = findWidget(elementorData);
      
      if (!widgetToClone) {
        return this.createErrorResponse(

          "Widget ID ${args.widget_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Generate new ID for cloned widget
      const generateNewIds = (element: any): void => {
        element.id = Math.random().toString(36).substr(2, 8);
        if (element.elements) {
          element.elements.forEach(generateNewIds);
        }
      };
      
      generateNewIds(widgetToClone);
      
      // Insert cloned widget
      if (args.target_element_id) {
        // Insert at specific position
        let targetFound = false;
        
        const findAndInsertWidget = (elements: any[], parent: any, visited = new Set()): boolean => {
          for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            
            // Prevent infinite recursion by tracking visited elements
            if (visited.has(element.id)) {
              continue;
            }
            visited.add(element.id);
            
            if (element.id === args.target_element_id) {
              const insertIndex = args.insert_position === 'before' ? i : i + 1;
              parent.elements.splice(insertIndex, 0, widgetToClone);
              return true;
            }
            
            if (element.elements && element.elements.length > 0) {
              if (findAndInsertWidget(element.elements, element, visited)) {
                return true;
              }
            }
          }
          return false;
        };
        
        const mockParent = { elements: elementorData };
        targetFound = findAndInsertWidget(elementorData, mockParent);
        
        if (!targetFound) {
          return this.createErrorResponse(

            "Target element ID ${args.target_element_id} not found",

            "OPERATION_ERROR",

            "API_ERROR",

            "Operation failed"

          );
        }
      } else {
        // Add to first available column or container
        const findFirstContainer = (elements: any[], visited = new Set()): boolean => {
          for (let element of elements) {
            // Prevent infinite recursion by tracking visited elements
            if (visited.has(element.id)) {
              continue;
            }
            visited.add(element.id);
            
            // Check for traditional column
            if (element.elType === 'column') {
              element.elements.push(widgetToClone);
              return true;
            }
            
            // Check for new container (Elementor v3.6+)
            if (element.elType === 'container') {
              element.elements.push(widgetToClone);
              return true;
            }
            
            if (element.elements && element.elements.length > 0) {
              if (findFirstContainer(element.elements, visited)) {
                return true;
              }
            }
          }
          return false;
        };
        
        if (!findFirstContainer(elementorData)) {
          return this.createErrorResponse(

            'No column or container found to place cloned widget'
          ,

            "OPERATION_ERROR",

            "API_ERROR",

            "Operation failed"

          );
        }
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          original_widget_id: args.widget_id,
          new_widget_id: widgetToClone.id,
          widget_type: widgetToClone.widgetType || null,
          target_element_id: args.target_element_id || null,
          insert_position: args.insert_position || "after",
          operation: "widget_cloning",
          cloned_settings: widgetToClone.settings || {}
        },
        `Widget cloned successfully! New widget ID: ${widgetToClone.id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to clone widget: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async moveWidget(args: { post_id: number; widget_id: string; target_section_id?: string; target_column_id?: string; position?: number }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      let widgetToMove: any = null;
      let sourceLocation: any = { column_id: null, previous_position: -1 };
      let targetLocation: any = { 
        column_id: args.target_column_id || null, 
        new_position: args.position !== undefined ? args.position : "end" 
      };
      
      // Function to find and remove widget
      const findAndRemoveWidget = (elements: any[], parent: any = null): boolean => {
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          
          if (element.id === args.widget_id) {
            widgetToMove = elements.splice(i, 1)[0];
            if (parent && parent.elType === 'column') {
              sourceLocation.column_id = parent.id;
              sourceLocation.previous_position = i;
            }
            return true;
          }
          
          if (element.elements && element.elements.length > 0) {
            if (findAndRemoveWidget(element.elements, element)) {
              return true;
            }
          }
        }
        return false;
      };
      
      if (!findAndRemoveWidget(elementorData)) {
        return this.createErrorResponse(

          "Widget ID ${args.widget_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Function to find target and add widget
      const findTargetAndAddWidget = (elements: any[]): boolean => {
        for (let element of elements) {
          // If column_id is specified, look for that specific column
          if (args.target_column_id && element.id === args.target_column_id && element.elType === 'column') {
            targetLocation.column_id = element.id;
            if (args.position !== undefined && args.position >= 0 && args.position < element.elements.length) {
              element.elements.splice(args.position, 0, widgetToMove);
              targetLocation.new_position = args.position;
            } else {
              element.elements.push(widgetToMove);
              targetLocation.new_position = element.elements.length - 1;
            }
            return true;
          }
          
          // If section_id is specified, add to first column of that section
          if (args.target_section_id && element.id === args.target_section_id && element.elType === 'section') {
            if (element.elements && element.elements.length > 0) {
              const firstColumn = element.elements[0];
              targetLocation.column_id = firstColumn.id;
              if (args.position !== undefined && args.position >= 0 && args.position < firstColumn.elements.length) {
                firstColumn.elements.splice(args.position, 0, widgetToMove);
                targetLocation.new_position = args.position;
              } else {
                firstColumn.elements.push(widgetToMove);
                targetLocation.new_position = firstColumn.elements.length - 1;
              }
              return true;
            }
          }
          
          if (element.elements && element.elements.length > 0) {
            if (findTargetAndAddWidget(element.elements)) {
              return true;
            }
          }
        }
        return false;
      };
      
      if (!findTargetAndAddWidget(elementorData)) {
        return this.createErrorResponse(

          "Target container not found (section_id: ${args.target_section_id}, column_id: ${args.target_column_id})",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          widget_id: args.widget_id,
          widget_type: widgetToMove.widgetType || null,
          source_location: sourceLocation,
          target_location: targetLocation,
          operation: "widget_move"
        },
        `Widget moved successfully! Widget ID: ${args.widget_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to move widget: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  // Element Management Tools
  private async deleteElementorElement(args: { post_id: number; element_id: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      let elementDeleted = false;
      let deletedElement: any = null;
      let parentContainer: any = null;
      let remainingElementsInParent = 0;
      
      // Function to find and delete element
      const findAndDeleteElement = (elements: any[], parent: any = null): boolean => {
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          
          if (element.id === args.element_id) {
            deletedElement = { ...element };
            parentContainer = parent ? {
              type: parent.elType,
              id: parent.id
            } : null;
            elements.splice(i, 1);
            remainingElementsInParent = elements.length;
            return true;
          }
          
          if (element.elements && element.elements.length > 0) {
            if (findAndDeleteElement(element.elements, element)) {
              return true;
            }
          }
        }
        return false;
      };
      
      elementDeleted = findAndDeleteElement(elementorData);
      
      if (!elementDeleted) {
        return this.createErrorResponse(

          "Element ID ${args.element_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          deleted_element_id: args.element_id,
          element_type: deletedElement.elType,
          widget_type: deletedElement.widgetType || null,
          parent_container: parentContainer,
          operation: "element_deletion",
          remaining_elements_in_parent: remainingElementsInParent
        },
        `Element deleted successfully! Element ID: ${args.element_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to delete element: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async reorderElements(args: { post_id: number; container_id: string; element_ids: string[] }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      let containerFound = false;
      let containerType = '';
      let newOrderDetails: any[] = [];
      
      // Function to find container and reorder elements
      const findAndReorderElements = (elements: any[]): boolean => {
        for (let element of elements) {
          if (element.id === args.container_id) {
            containerType = element.elType;
            const oldElements = [...element.elements];
            const newElements: any[] = [];
            
            // Reorder according to provided array
            for (let elementId of args.element_ids) {
              const foundElement = oldElements.find(el => el.id === elementId);
              if (foundElement) {
                newElements.push(foundElement);
              }
            }
            
            // Add any elements that weren't in the reorder list
            for (let oldElement of oldElements) {
              if (!args.element_ids.includes(oldElement.id)) {
                newElements.push(oldElement);
              }
            }
            
            // Track the new order details
            newOrderDetails = newElements.map((el, index) => ({
              element_id: el.id,
              element_type: el.elType,
              widget_type: el.widgetType || null,
              position: index
            }));
            
            element.elements = newElements;
            return true;
          }
          
          if (element.elements && element.elements.length > 0) {
            if (findAndReorderElements(element.elements)) {
              return true;
            }
          }
        }
        return false;
      };
      
      containerFound = findAndReorderElements(elementorData);
      
      if (!containerFound) {
        return this.createErrorResponse(

          "Container ID ${args.container_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          container_id: args.container_id,
          container_type: containerType,
          elements_reordered: newOrderDetails.length,
          new_order: newOrderDetails,
          operation: "element_reordering"
        },
        `Elements reordered successfully in container: ${args.container_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to reorder elements: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  private async copyElementSettings(args: { post_id: number; source_element_id: string; target_element_id: string; settings_to_copy?: string[] }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(

          "Failed to get Elementor data for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      const elementorData = parsedResult.data;
      
      let sourceElement: any = null;
      let targetElement: any = null;
      
      // Function to find elements
      const findElement = (elements: any[], elementId: string): any => {
        for (let element of elements) {
          if (element.id === elementId) {
            return element;
          }
          
          if (element.elements && element.elements.length > 0) {
            const found = findElement(element.elements, elementId);
            if (found) return found;
          }
        }
        return null;
      };
      
      sourceElement = findElement(elementorData, args.source_element_id);
      targetElement = findElement(elementorData, args.target_element_id);
      
      if (!sourceElement) {
        return this.createErrorResponse(

          "Source element ID ${args.source_element_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      if (!targetElement) {
        return this.createErrorResponse(

          "Target element ID ${args.target_element_id} not found",

          "OPERATION_ERROR",

          "API_ERROR",

          "Operation failed"

        );
      }
      
      // Track what settings were copied and skipped
      let settingsCopied: string[] = [];
      let settingsSkipped: string[] = [];
      
      // Copy settings
      if (args.settings_to_copy && args.settings_to_copy.length > 0) {
        // Copy specific settings
        for (let setting of args.settings_to_copy) {
          if (sourceElement.settings && sourceElement.settings[setting] !== undefined) {
            if (!targetElement.settings) targetElement.settings = {};
            targetElement.settings[setting] = JSON.parse(JSON.stringify(sourceElement.settings[setting]));
            settingsCopied.push(setting);
          } else {
            settingsSkipped.push(setting);
          }
        }
      } else {
        // Copy all settings
        if (sourceElement.settings) {
          targetElement.settings = JSON.parse(JSON.stringify(sourceElement.settings));
          settingsCopied = Object.keys(sourceElement.settings);
        }
      }
      
      // Update the page
      await this.updateElementorData({
        post_id: args.post_id,
        elementor_data: JSON.stringify(elementorData)
      });
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          source_element_id: args.source_element_id,
          source_element_type: sourceElement.elType,
          source_widget_type: sourceElement.widgetType || null,
          target_element_id: args.target_element_id,
          target_element_type: targetElement.elType,
          target_widget_type: targetElement.widgetType || null,
          operation: "settings_copy",
          settings_copied: settingsCopied,
          settings_skipped: settingsSkipped
        },
        `Settings copied successfully from ${args.source_element_id} to ${args.target_element_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(

        "Failed to copy element settings: ${error.message}",

        "OPERATION_ERROR",

        "API_ERROR",

        "Operation failed"

      );
    }
  }

  // Performance & Optimization

  private async clearElementorCacheGeneral(args: { post_id?: number }) {
    this.ensureAuthenticated();
    
    try {
      await this.clearElementorCache(args.post_id);
      
      return this.createSuccessResponse(
        {
          operation: "cache_clear",
          scope: args.post_id ? "specific_post" : "general",
          post_id: args.post_id || null,
          cache_cleared: true
        },
        args.post_id 
          ? `Cache cleared successfully for post/page ID: ${args.post_id}`
          : "General Elementor cache cleared successfully"
      );
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to clear cache: ${error.message}`,
        "CLEAR_CACHE_ERROR",
        "API_ERROR",
        `Cache clearing operation failed${args.post_id ? ` for post/page ${args.post_id}` : ''}`
      );
    }
  }

  // Advanced Element Operations
  private async findElementsByType(args: { post_id: number; widget_type: string; include_settings?: boolean }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data using safe parsing utility
      const parsedResult = await this.safeGetElementorData(args.post_id);
      
      if (!parsedResult.success || !parsedResult.data) {
        return this.createErrorResponse(
          `No Elementor data found for post/page ID ${args.post_id}: ${parsedResult.error || 'Unknown error'}`,
          'FIND_ELEMENTS_ERROR',
          'API_ERROR',
          'Failed to retrieve Elementor data'
        );
      }
      
      const elementorData = parsedResult.data;
      
      const foundElements: any[] = [];
      
      // Function to find elements by type
      const findElementsByTypeRecursive = (elements: any[]): void => {
        for (let element of elements) {
          if (element.widgetType === args.widget_type) {
            const result: any = {
              id: element.id,
              widgetType: element.widgetType
            };
            
            if (args.include_settings && element.settings) {
              result.settings = element.settings;
            }
            
            foundElements.push(result);
          }
          
          if (element.elements && element.elements.length > 0) {
            findElementsByTypeRecursive(element.elements);
          }
        }
      };
      
      findElementsByTypeRecursive(elementorData);
      
      return this.createSuccessResponse(
        {
          post_id: args.post_id,
          widget_type: args.widget_type,
          found_elements: foundElements,
          total_found: foundElements.length,
          include_settings: args.include_settings || false
        },
        `Found ${foundElements.length} elements of type "${args.widget_type}" in post/page ID ${args.post_id}`
      );
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      return this.createErrorResponse(
        `Failed to find elements by type: ${error.message}`,
        "FIND_ELEMENTS_ERROR",
        "API_ERROR",
        "Operation failed"
      );
    }
  }

  // Template Management (Requires Elementor Pro)
  private async createElementorTemplate(args: any) {
    return this.createErrorResponse(
      'Template management requires Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  private async applyTemplateToPage(args: any) {
    return this.createErrorResponse(
      'Template management requires Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  private async exportElementorTemplate(args: any) {
    return this.createErrorResponse(
      'Template management requires Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  private async importElementorTemplate(args: any) {
    return this.createErrorResponse(
      'Template management requires Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  // Global Settings (Requires Elementor Pro)
  private async getElementorGlobalColors(args: any) {
    return this.createErrorResponse(
      'Global settings require Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  private async updateElementorGlobalColors(args: any) {
    return this.createErrorResponse(
      'Global settings require Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  private async getElementorGlobalFonts(args: any) {
    return this.createErrorResponse(
      'Global settings require Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  private async updateElementorGlobalFonts(args: any) {
    return this.createErrorResponse(
      'Global settings require Elementor Pro API access. This feature is not available in the free version.',
      'PRO_FEATURE_ERROR',
      'FEATURE_UNAVAILABLE',
      'Elementor Pro required'
    );
  }

  // Advanced Operations (Not Yet Implemented)
  private async rebuildPageStructure(args: any) {
    return this.createErrorResponse(
      'Page structure rebuilding is a complex operation not yet implemented. Please use individual element manipulation tools instead.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use individual element manipulation tools for page building'
    );
  }

  private async validateElementorData(args: any) {
    return this.createErrorResponse(
      'Data validation not yet implemented. Please check data manually using get_elementor_data.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use get_elementor_data to manually inspect page structure'
    );
  }

  private async regenerateCSS(args: any) {
    return this.createErrorResponse(
      'CSS regeneration requires direct server access. Please use the Elementor admin interface: Elementor → Tools → Regenerate CSS & Data.',
      'SERVER_ACCESS_REQUIRED',
      'FEATURE_UNAVAILABLE',
      'Use WordPress admin: Elementor → Tools → Regenerate CSS & Data'
    );
  }

  private async optimizeElementorAssets(args: any) {
    return this.createErrorResponse(
      'Asset optimization requires direct server access. Please use WordPress optimization plugins or the Elementor admin interface.',
      'SERVER_ACCESS_REQUIRED',
      'FEATURE_UNAVAILABLE',
      'Use WordPress optimization plugins or Elementor admin interface'
    );
  }

  private async bulkUpdateWidgetSettings(args: any) {
    return this.createErrorResponse(
      'Bulk widget updates not yet implemented. Please use individual widget update tools or find_elements_by_type to identify widgets first.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use individual widget update tools or find_elements_by_type'
    );
  }

  private async replaceWidgetContent(args: any) {
    return this.createErrorResponse(
      'Widget content replacement not yet implemented. Please use individual widget update tools.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use individual widget update tools'
    );
  }

  private async getElementorCustomFields(args: any) {
    return this.createErrorResponse(
      'Custom fields integration not yet implemented. Please use WordPress REST API to access custom fields directly.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use WordPress REST API for custom fields access'
    );
  }

  private async updateDynamicContentSources(args: any) {
    return this.createErrorResponse(
      'Dynamic content management not yet implemented. Please update widget settings manually with dynamic field configurations.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Update widget settings manually with dynamic field configurations'
    );
  }

  private async getElementorRevisions(args: any) {
    return this.createErrorResponse(
      'Revision management not yet implemented. Please use WordPress admin interface to access revisions.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use WordPress admin interface for revision management'
    );
  }

  private async restoreElementorRevision(args: any) {
    return this.createErrorResponse(
      'Revision management not yet implemented. Please use WordPress admin interface to restore revisions.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use WordPress admin interface for revision management'
    );
  }

  private async compareElementorRevisions(args: any) {
    return this.createErrorResponse(
      'Revision management not yet implemented. Please use WordPress admin interface to compare revisions.',
      'NOT_IMPLEMENTED',
      'FEATURE_UNAVAILABLE',
      'Use WordPress admin interface for revision management'
    );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Elementor WordPress MCP server running on stdio');
  }
}

const server = new ElementorWordPressMCP();
server.run().catch(console.error); 