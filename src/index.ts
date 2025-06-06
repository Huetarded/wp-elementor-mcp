#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { Base64 } from 'js-base64';

interface WordPressConfig {
  baseUrl: string;
  username: string;
  applicationPassword: string;
}

class ElementorWordPressMCP {
  private server: Server;
  private axiosInstance: AxiosInstance | null = null;
  private config: WordPressConfig | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'elementor-wordpress-mcp',
        version: '1.0.0',
      }
    );

    // Initialize WordPress configuration from environment variables
    this.initializeFromEnvironment();

    this.setupToolHandlers();
    this.setupResourceHandlers();
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
    const auth = Base64.encode(`${config.username}:${config.applicationPassword}`);
    this.axiosInstance = axios.create({
      baseURL: `${config.baseUrl}/wp-json/wp/v2/`,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    this.config = config;
  }

  private ensureAuthenticated() {
    if (!this.axiosInstance || !this.config) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'WordPress connection not configured. Please set environment variables (WORDPRESS_BASE_URL, WORDPRESS_USERNAME, WORDPRESS_APPLICATION_PASSWORD) or use the configure_wordpress tool.'
      );
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'configure_wordpress',
            description: 'Configure WordPress connection with base URL and application password (only needed if environment variables are not set)',
            inputSchema: {
              type: 'object',
              properties: {
                baseUrl: {
                  type: 'string',
                  description: 'WordPress site base URL (e.g., https://yoursite.com)',
                },
                username: {
                  type: 'string',
                  description: 'WordPress username',
                },
                applicationPassword: {
                  type: 'string',
                  description: 'WordPress application password (not regular password)',
                },
              },
              required: ['baseUrl', 'username', 'applicationPassword'],
            },
          },
          {
            name: 'get_posts',
            description: 'Retrieve WordPress posts with optional filtering',
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
            description: 'Retrieve WordPress pages',
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
            name: 'get_elementor_templates',
            description: 'Get Elementor templates (requires Elementor Pro)',
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
            description: 'Get Elementor page/post data',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to get Elementor data for',
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'backup_elementor_data',
            description: 'Create a backup of current Elementor data before making changes',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to backup',
                },
                backup_name: {
                  type: 'string',
                  description: 'Optional backup name (default: timestamp)',
                },
              },
              required: ['post_id'],
            },
          },
          {
            name: 'update_elementor_data',
            description: 'Update Elementor page/post data',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID to update',
                },
                elementor_data: {
                  type: 'string',
                  description: 'Elementor JSON data as string',
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
            name: 'get_elementor_data_chunked',
            description: 'Get Elementor data in smaller chunks to handle large pages more efficiently',
            inputSchema: {
              type: 'object',
              properties: {
                post_id: {
                  type: 'number',
                  description: 'Post/Page ID',
                },
                chunk_size: {
                  type: 'number',
                  description: 'Number of top-level elements per chunk (default: 5)',
                  default: 5,
                },
                chunk_index: {
                  type: 'number',
                  description: 'Zero-based chunk index to retrieve (default: 0)',
                  default: 0,
                },
              },
              required: ['post_id'],
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
            description: 'Upload media file to WordPress',
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
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'configure_wordpress':
            return await this.configureWordPress(args as any);
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
          case 'get_elementor_data_chunked':
            return await this.getElementorDataChunked(args as any);
          case 'backup_elementor_data':
            return await this.backupElementorData(args as any);
          case 'get_media':
            return await this.getMedia(args as any);
          case 'upload_media':
            return await this.uploadMedia(args as any);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
      }
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

      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    });
  }

  // Tool implementations
  private async configureWordPress(args: {
    baseUrl: string;
    username: string;
    applicationPassword: string;
  }) {
    try {
      this.setupAxios(args);
      
      // Test the connection
      const response = await this.axiosInstance!.get('users/me');
      
      return {
        content: [
          {
            type: 'text',
            text: `Successfully connected to WordPress!\nUser: ${response.data.name}\nSite: ${args.baseUrl}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to connect to WordPress: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async getPosts(args: { per_page?: number; status?: string; search?: string }) {
    this.ensureAuthenticated();
    
    const params: any = {
      per_page: args.per_page || 10,
      status: args.status || 'publish',
    };
    
    if (args.search) {
      params.search = args.search;
    }

    const response = await this.axiosInstance!.get('posts', { params });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getPost(args: { id: number }) {
    this.ensureAuthenticated();
    
    const response = await this.axiosInstance!.get(`posts/${args.id}`);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async createPost(args: {
    title: string;
    content: string;
    status?: string;
    excerpt?: string;
  }) {
    this.ensureAuthenticated();
    
    const postData = {
      title: args.title,
      content: args.content,
      status: args.status || 'draft',
      ...(args.excerpt && { excerpt: args.excerpt }),
    };

    const response = await this.axiosInstance!.post('posts', postData);
    
    // Clear Elementor cache after creating post
    await this.clearElementorCache(response.data.id);
    
          return {
        content: [
          {
            type: 'text',
            text: `Post created successfully!\nID: ${response.data.id}\nTitle: ${response.data.title.rendered}\nStatus: ${response.data.status}\nURL: ${response.data.link}

✅ Automatic Elementor cache clearing attempted.
💡 If using Elementor content, manually clear cache: WordPress Admin → Elementor → Tools → Regenerate CSS & Data`,
          },
        ],
      };
  }

  private async updatePost(args: {
    id: number;
    title?: string;
    content?: string;
    status?: string;
    excerpt?: string;
  }) {
    this.ensureAuthenticated();
    
    const updateData: any = {};
    if (args.title) updateData.title = args.title;
    if (args.content) updateData.content = args.content;
    if (args.status) updateData.status = args.status;
    if (args.excerpt) updateData.excerpt = args.excerpt;

    const response = await this.axiosInstance!.post(`posts/${args.id}`, updateData);
    
    // Clear Elementor cache after updating post
    await this.clearElementorCache(args.id);
    
          return {
        content: [
          {
            type: 'text',
            text: `Post updated successfully!\nID: ${response.data.id}\nTitle: ${response.data.title.rendered}\nStatus: ${response.data.status}

✅ Automatic Elementor cache clearing attempted.
💡 If using Elementor content, manually clear cache: WordPress Admin → Elementor → Tools → Regenerate CSS & Data`,
          },
        ],
      };
  }

  private async getPages(args: { per_page?: number; status?: string }) {
    this.ensureAuthenticated();
    
    const params = {
      per_page: args.per_page || 10,
      status: args.status || 'publish',
    };

    const response = await this.axiosInstance!.get('pages', { params });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async createPage(args: {
    title: string;
    content: string;
    status?: string;
    excerpt?: string;
    parent?: number;
  }) {
    this.ensureAuthenticated();
    
    const pageData = {
      title: args.title,
      content: args.content,
      status: args.status || 'draft',
      ...(args.excerpt && { excerpt: args.excerpt }),
      ...(args.parent && { parent: args.parent }),
    };

    const response = await this.axiosInstance!.post('pages', pageData);
    
    // Clear Elementor cache after creating page
    await this.clearElementorCache(response.data.id);
    
          return {
        content: [
          {
            type: 'text',
            text: `Page created successfully!\nID: ${response.data.id}\nTitle: ${response.data.title.rendered}\nStatus: ${response.data.status}\nURL: ${response.data.link}

✅ Automatic Elementor cache clearing attempted.
💡 If using Elementor content, manually clear cache: WordPress Admin → Elementor → Tools → Regenerate CSS & Data`,
          },
        ],
      };
  }

  private async updatePage(args: {
    id: number;
    title?: string;
    content?: string;
    status?: string;
    excerpt?: string;
    parent?: number;
  }) {
    this.ensureAuthenticated();
    
    const updateData: any = {};
    if (args.title) updateData.title = args.title;
    if (args.content) updateData.content = args.content;
    if (args.status) updateData.status = args.status;
    if (args.excerpt) updateData.excerpt = args.excerpt;
    if (args.parent !== undefined) updateData.parent = args.parent;

    const response = await this.axiosInstance!.post(`pages/${args.id}`, updateData);
    
    // Clear Elementor cache after updating page
    await this.clearElementorCache(args.id);
    
          return {
        content: [
          {
            type: 'text',
            text: `Page updated successfully!\nID: ${response.data.id}\nTitle: ${response.data.title.rendered}\nStatus: ${response.data.status}

✅ Automatic Elementor cache clearing attempted.
💡 If using Elementor content, manually clear cache: WordPress Admin → Elementor → Tools → Regenerate CSS & Data`,
          },
        ],
      };
  }

  private async getElementorTemplates(args: { per_page?: number; type?: string }) {
    this.ensureAuthenticated();
    
    const params: any = {
      per_page: args.per_page || 10,
      meta_key: '_elementor_template_type',
    };
    
    if (args.type) {
      params.meta_value = args.type;
    }

    try {
      const response = await this.axiosInstance!.get('elementor_library', { params });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Elementor templates endpoint not found. Make sure Elementor Pro is installed and activated.'
        );
      }
      throw error;
    }
  }

  private async getElementorData(args: { post_id: number }) {
    this.ensureAuthenticated();
    
    try {
      // Try to get as post first, then as page if that fails
      let response;
      let postType = 'post';
      
      try {
        response = await this.axiosInstance!.get(`posts/${args.post_id}`, {
          params: { context: 'edit' }
        });
      } catch (postError: any) {
        if (postError.response?.status === 404) {
          // Try as page
          try {
            response = await this.axiosInstance!.get(`pages/${args.post_id}`, {
              params: { context: 'edit' }
            });
            postType = 'page';
          } catch (pageError: any) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Post/Page ID ${args.post_id} not found in posts or pages`
            );
          }
        } else {
          throw postError;
        }
      }
      
      // Try to get Elementor data from meta
      const elementorData = response.data.meta?._elementor_data;
      
      return {
        content: [
          {
            type: 'text',
            text: elementorData 
              ? JSON.stringify(JSON.parse(elementorData), null, 2)
              : `No Elementor data found for this ${postType} (ID: ${args.post_id}).`,
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to get Elementor data: ${error.response?.data?.message || error.message}`
      );
    }
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
    this.ensureAuthenticated();
    
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
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Post/Page ID ${args.post_id} not found in posts or pages`
            );
          }
        } else {
          throw postError;
        }
      }

      // Clear Elementor cache after updating data
      await this.clearElementorCache(args.post_id);
      
      return {
        content: [
          {
            type: 'text',
            text: `Elementor data updated successfully for ${postType} ID: ${args.post_id}.

⚠️  IMPORTANT: MANUAL CACHE CLEARING REQUIRED
The Elementor cache has been programmatically cleared, but you may need to manually clear additional caches:

🔧 REQUIRED STEPS:
1. Go to WordPress Admin → Elementor → Tools → Regenerate CSS & Data
2. Click "Regenerate Files & Data" 
3. If using caching plugins, clear those caches too
4. Clear browser cache or use incognito/private browsing

🎯 VERIFICATION:
Visit the page to confirm changes are visible. If not, the cache clearing was incomplete.

✅ Automatic cache clearing attempted via API.`,
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to update Elementor data: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async updateElementorWidget(args: { post_id: number; widget_id: string; widget_settings?: object; widget_content?: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data
      const currentElementorData = await this.getElementorData({ post_id: args.post_id });
      const currentDataText = currentElementorData.content[0].text;
      
      if (currentDataText.includes('No Elementor data found')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No Elementor data found for post/page ID ${args.post_id}`
        );
      }
      
      // Parse current data
      let elementorData: any[];
      try {
        elementorData = JSON.parse(currentDataText);
      } catch (parseError) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to parse current Elementor data: ${parseError}`
        );
      }
      
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
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Widget ID ${args.widget_id} not found in Elementor data`
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
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Post/Page ID ${args.post_id} not found in posts or pages`
            );
          }
        } else {
          throw postError;
        }
      }

      // Clear Elementor cache after updating data
      await this.clearElementorCache(args.post_id);
      
      return {
        content: [
          {
            type: 'text',
            text: `Elementor widget ${args.widget_id} updated successfully for ${postType} ID: ${args.post_id}.

⚠️  IMPORTANT: MANUAL CACHE CLEARING REQUIRED
The Elementor cache has been programmatically cleared, but you may need to manually clear additional caches:

🔧 REQUIRED STEPS:
1. Go to WordPress Admin → Elementor → Tools → Regenerate CSS & Data
2. Click "Regenerate Files & Data" 
3. If using caching plugins, clear those caches too
4. Clear browser cache or use incognito/private browsing

🎯 VERIFICATION:
Visit the page to confirm changes are visible. If not, the cache clearing was incomplete.

✅ Widget-specific incremental update completed.`,
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to update Elementor widget: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async getElementorWidget(args: { post_id: number; widget_id: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data
      const currentElementorData = await this.getElementorData({ post_id: args.post_id });
      const currentDataText = currentElementorData.content[0].text;
      
      if (currentDataText.includes('No Elementor data found')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No Elementor data found for post/page ID ${args.post_id}`
        );
      }
      
      // Parse current data
      let elementorData: any[];
      try {
        elementorData = JSON.parse(currentDataText);
      } catch (parseError) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to parse current Elementor data: ${parseError}`
        );
      }
      
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
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Widget ID ${args.widget_id} not found in Elementor data`
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(widget, null, 2),
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to get Elementor widget: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async getElementorElements(args: { post_id: number; include_content?: boolean }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data
      const currentElementorData = await this.getElementorData({ post_id: args.post_id });
      const currentDataText = currentElementorData.content[0].text;
      
      if (currentDataText.includes('No Elementor data found')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No Elementor data found for post/page ID ${args.post_id}`
        );
      }
      
      // Parse current data
      let elementorData: any[];
      try {
        elementorData = JSON.parse(currentDataText);
      } catch (parseError) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to parse current Elementor data: ${parseError}`
        );
      }
      
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
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ 
              post_id: args.post_id,
              total_elements: elements.length,
              elements: elements 
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to get Elementor elements: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async updateElementorSection(args: { post_id: number; section_id: string; widgets_updates: Array<{widget_id: string; widget_settings?: object; widget_content?: string}> }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data
      const currentElementorData = await this.getElementorData({ post_id: args.post_id });
      const currentDataText = currentElementorData.content[0].text;
      
      if (currentDataText.includes('No Elementor data found')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No Elementor data found for post/page ID ${args.post_id}`
        );
      }
      
      // Parse current data
      let elementorData: any[];
      try {
        elementorData = JSON.parse(currentDataText);
      } catch (parseError) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to parse current Elementor data: ${parseError}`
        );
      }
      
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
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Section ID ${args.section_id} not found in Elementor data`
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
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Post/Page ID ${args.post_id} not found in posts or pages`
            );
          }
        } else {
          throw postError;
        }
      }

      // Clear Elementor cache after updating data
      await this.clearElementorCache(args.post_id);
      
      return {
        content: [
          {
            type: 'text',
            text: `Elementor section ${args.section_id} updated successfully for ${postType} ID: ${args.post_id}.

Updated widgets: ${updatedWidgets.join(', ') || 'None'}
Widgets not found: ${args.widgets_updates.filter(w => !updatedWidgets.includes(w.widget_id)).map(w => w.widget_id).join(', ') || 'None'}

⚠️  IMPORTANT: MANUAL CACHE CLEARING REQUIRED
The Elementor cache has been programmatically cleared, but you may need to manually clear additional caches:

🔧 REQUIRED STEPS:
1. Go to WordPress Admin → Elementor → Tools → Regenerate CSS & Data
2. Click "Regenerate Files & Data" 
3. If using caching plugins, clear those caches too
4. Clear browser cache or use incognito/private browsing

🎯 VERIFICATION:
Visit the page to confirm changes are visible. If not, the cache clearing was incomplete.

✅ Section-level batch update completed.`,
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to update Elementor section: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async getElementorDataChunked(args: { post_id: number; chunk_size?: number; chunk_index?: number }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data
      const currentElementorData = await this.getElementorData({ post_id: args.post_id });
      const currentDataText = currentElementorData.content[0].text;
      
      if (currentDataText.includes('No Elementor data found')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No Elementor data found for post/page ID ${args.post_id}`
        );
      }
      
      // Parse current data
      let elementorData: any[];
      try {
        elementorData = JSON.parse(currentDataText);
      } catch (parseError) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to parse current Elementor data: ${parseError}`
        );
      }
      
      const chunkSize = args.chunk_size || 5;
      const chunkIndex = args.chunk_index || 0;
      const totalElements = elementorData.length;
      const totalChunks = Math.ceil(totalElements / chunkSize);
      
      const startIndex = chunkIndex * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, totalElements);
      
      if (chunkIndex >= totalChunks) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Chunk index ${chunkIndex} is out of range. Total chunks: ${totalChunks}`
        );
      }
      
      const chunk = elementorData.slice(startIndex, endIndex);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              post_id: args.post_id,
              chunk_info: {
                chunk_index: chunkIndex,
                chunk_size: chunkSize,
                total_chunks: totalChunks,
                total_elements: totalElements,
                elements_in_chunk: chunk.length,
                start_index: startIndex,
                end_index: endIndex - 1
              },
              chunk_data: chunk
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to get chunked Elementor data: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async backupElementorData(args: { post_id: number; backup_name?: string }) {
    this.ensureAuthenticated();
    
    try {
      // Get current Elementor data
      const currentElementorData = await this.getElementorData({ post_id: args.post_id });
      const currentDataText = currentElementorData.content[0].text;
      
      if (currentDataText.includes('No Elementor data found')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `No Elementor data found for post/page ID ${args.post_id}`
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
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Post/Page ID ${args.post_id} not found in posts or pages`
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
            elementor_data: currentDataText
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
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Elementor data backup created successfully!

Backup Details:
- Post/Page ID: ${args.post_id}
- Post Type: ${postType}
- Post Title: ${postInfo.data.title.rendered || postInfo.data.title.raw}
- Backup Name: ${backupName}
- Backup Key: ${backupKey}
- Timestamp: ${timestamp}

💡 This backup is stored as meta data in the same post/page. You can restore it using the regular update_elementor_data tool with the backed up data if needed.

⚠️  Note: This backup method stores data in WordPress meta. For production use, consider implementing a dedicated backup system with external storage.`,
          },
        ],
      };
    } catch (error: any) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to backup Elementor data: ${error.response?.data?.message || error.message}`
      );
    }
  }

  private async getMedia(args: { per_page?: number; media_type?: string }) {
    this.ensureAuthenticated();
    
    const params: any = {
      per_page: args.per_page || 10,
    };
    
    if (args.media_type) {
      params.media_type = args.media_type;
    }

    const response = await this.axiosInstance!.get('media', { params });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async uploadMedia(args: { file_path: string; title?: string; alt_text?: string }) {
    this.ensureAuthenticated();
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      if (!fs.existsSync(args.file_path)) {
        throw new McpError(ErrorCode.InvalidRequest, `File not found: ${args.file_path}`);
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
      
      return {
        content: [
          {
            type: 'text',
            text: `Media uploaded successfully!\nID: ${response.data.id}\nURL: ${response.data.source_url}\nTitle: ${response.data.title.rendered}`,
          },
        ],
      };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to upload media: ${error.response?.data?.message || error.message}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Elementor WordPress MCP server running on stdio');
  }
}

const server = new ElementorWordPressMCP();
server.run().catch(console.error); 