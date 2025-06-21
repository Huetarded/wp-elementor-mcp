#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Test configuration
const VALIDATION_CONFIG = {
  modes: ['essential', 'standard', 'advanced', 'full'],
  expectedToolCounts: {
    essential: 22,  // Basic WordPress + Elementor operations
    standard: 33,   // + Section and widget management
    advanced: 34,   // + Performance and advanced operations
    full: 34        // + All pro features (template, global, custom fields)
  }
};

// Track validation results
const validationResults = {
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  details: []
};

async function runValidationTest() {
  console.log('🔍 Starting Elementor MCP Tool Validation\n');
  console.log('=' .repeat(80));
  console.log('This test validates tool schemas, arguments, and basic structure');
  console.log('without requiring WordPress credentials.\n');
  
  for (const mode of VALIDATION_CONFIG.modes) {
    console.log(`\n🎯 Validating mode: ${mode.toUpperCase()}`);
    console.log('─'.repeat(40));
    
    await validateMode(mode);
  }
  
  // Print final summary
  printValidationSummary();
}

async function validateMode(mode) {
  let client = null;
  let transport = null;
  
  try {
    // Start server with specific mode
    const env = { ...process.env, ELEMENTOR_MCP_MODE: mode };
    
    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env
    });

    client = new Client({
      name: 'validation-test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    
    // Get all available tools for this mode
    const { tools } = await client.listTools();
    
    console.log(`📊 Found ${tools.length} tools in ${mode} mode`);
    
    // Check expected tool count
    const expectedCount = VALIDATION_CONFIG.expectedToolCounts[mode];
    if (tools.length !== expectedCount) {
      console.log(`⚠️  Expected ${expectedCount} tools, found ${tools.length}`);
      validationResults.warnings++;
    }
    
    // Validate each tool
    for (const tool of tools) {
      await validateTool(client, tool, mode);
    }
    
  } catch (error) {
    console.error(`❌ Failed to validate mode ${mode}:`, error.message);
    validationResults.failed++;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

async function validateTool(client, tool, mode) {
  validationResults.total++;
  const validationStart = Date.now();
  
  try {
    // 1. Schema Validation
    const schemaValidation = validateToolSchema(tool);
    if (!schemaValidation.valid) {
      throw new Error(`Schema validation failed: ${schemaValidation.error}`);
    }
    
    // 2. Name Convention Validation
    const nameValidation = validateToolNaming(tool.name);
    if (!nameValidation.valid) {
      console.log(`  ⚠️  ${tool.name} - ${nameValidation.warning}`);
      validationResults.warnings++;
    }
    
    // 3. Description Quality Check
    const descValidation = validateDescription(tool.description);
    if (!descValidation.valid) {
      console.log(`  ⚠️  ${tool.name} - ${descValidation.warning}`);
      validationResults.warnings++;
    }
    
    // 4. Input Schema Validation
    const inputValidation = validateInputSchema(tool);
    if (!inputValidation.valid) {
      throw new Error(`Input schema validation failed: ${inputValidation.error}`);
    }
    
    // 5. Category Classification Check
    const category = classifyTool(tool.name);
    
    const duration = Date.now() - validationStart;
    console.log(`  ✅ ${tool.name} - VALID (${duration}ms) [${category}]`);
    
    validationResults.passed++;
    validationResults.details.push({
      tool: tool.name,
      mode,
      status: 'VALID',
      duration,
      category,
      warnings: []
    });
    
  } catch (error) {
    const duration = Date.now() - validationStart;
    console.log(`  ❌ ${tool.name} - INVALID (${duration}ms): ${error.message}`);
    
    validationResults.failed++;
    validationResults.details.push({
      tool: tool.name,
      mode,
      status: 'INVALID',
      duration,
      error: error.message
    });
  }
}

function validateToolSchema(tool) {
  // Check basic required properties
  if (!tool.name || typeof tool.name !== 'string') {
    return { valid: false, error: 'Missing or invalid tool name' };
  }
  
  if (!tool.description || typeof tool.description !== 'string') {
    return { valid: false, error: 'Missing or invalid tool description' };
  }
  
  // Check tool name format
  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
    return { valid: false, error: 'Tool name must use snake_case format' };
  }
  
  // Check description length
  if (tool.description.length < 10) {
    return { valid: false, error: 'Description too short (minimum 10 characters)' };
  }
  
  // Check inputSchema if present
  if (tool.inputSchema) {
    if (typeof tool.inputSchema !== 'object') {
      return { valid: false, error: 'Invalid inputSchema type' };
    }
    
    // Check required fields
    if (tool.inputSchema.required && !Array.isArray(tool.inputSchema.required)) {
      return { valid: false, error: 'inputSchema.required must be an array' };
    }
    
    // Check properties
    if (tool.inputSchema.properties && typeof tool.inputSchema.properties !== 'object') {
      return { valid: false, error: 'inputSchema.properties must be an object' };
    }
  }
  
  return { valid: true };
}

function validateToolNaming(toolName) {
  const namingPatterns = {
    get: /^get_/,
    create: /^create_/,
    update: /^update_/,
    delete: /^delete_/,
    add: /^add_/,
    configure: /^configure_/,
    clear: /^clear_/,
    backup: /^backup_/,
    find: /^find_/,
    duplicate: /^duplicate_/,
    clone: /^clone_/,
    move: /^move_/,
    copy: /^copy_/,
    reorder: /^reorder_/,
    insert: /^insert_/
  };
  
  const hasValidPrefix = Object.values(namingPatterns).some(pattern => pattern.test(toolName));
  
  if (!hasValidPrefix) {
    return { 
      valid: false, 
      warning: `Tool name doesn't follow standard action naming convention` 
    };
  }
  
  return { valid: true };
}

function validateDescription(description) {
  // Check for helpful description patterns
  const hasAction = /\b(get|create|update|delete|add|configure|clear|backup|find|duplicate|clone|move|copy|reorder|insert)\b/i.test(description);
  
  if (!hasAction) {
    return { 
      valid: false, 
      warning: `Description should clearly state the action performed` 
    };
  }
  
  // Check for overly generic descriptions
  const genericPhrases = ['manage', 'handle', 'work with', 'process'];
  const isGeneric = genericPhrases.some(phrase => description.toLowerCase().includes(phrase));
  
  if (isGeneric) {
    return { 
      valid: false, 
      warning: `Description could be more specific (avoid generic terms)` 
    };
  }
  
  return { valid: true };
}

function validateInputSchema(tool) {
  if (!tool.inputSchema) {
    return { valid: true }; // No schema is valid for some tools
  }
  
  const schema = tool.inputSchema;
  
  // Check for common required parameters that should have proper types
  if (schema.properties) {
    const commonFields = {
      post_id: 'number',
      id: 'number',
      widget_id: 'string',
      section_id: 'string',
      title: 'string',
      content: 'string',
      per_page: 'number'
    };
    
    for (const [field, expectedType] of Object.entries(commonFields)) {
      if (schema.properties[field] && schema.properties[field].type !== expectedType) {
        return { 
          valid: false, 
          error: `Field '${field}' should be of type '${expectedType}', found '${schema.properties[field].type}'` 
        };
      }
    }
  }
  
  // Check that required fields exist in properties
  if (schema.required && schema.properties) {
    for (const requiredField of schema.required) {
      if (!schema.properties[requiredField]) {
        return { 
          valid: false, 
          error: `Required field '${requiredField}' not defined in properties` 
        };
      }
    }
  }
  
  return { valid: true };
}

function classifyTool(toolName) {
  const categories = {
    'WordPress Core': ['get_posts', 'get_post', 'create_post', 'update_post', 'get_pages', 'get_page', 'create_page', 'update_page', 'get_media', 'upload_media', 'configure_wordpress', 'list_all_content'],
    'Basic Elementor': ['get_elementor_data', 'update_elementor_data', 'get_elementor_widget', 'update_elementor_widget', 'get_elementor_elements', 'update_elementor_section', 'get_elementor_data_smart', 'get_elementor_structure_summary', 'get_elementor_templates'],
    'Section Management': ['create_elementor_section', 'create_elementor_container', 'add_column_to_section', 'duplicate_section'],
    'Widget Operations': ['add_widget_to_section', 'insert_widget_at_position', 'clone_widget', 'move_widget'],
    'Element Management': ['delete_elementor_element', 'reorder_elements', 'copy_element_settings'],

          'Performance': ['clear_elementor_cache'],
    'Advanced Operations': ['find_elements_by_type', 'backup_elementor_data'],
    'Templates': ['create_template', 'update_template', 'delete_template'],
    'Global Settings': ['get_global_colors', 'update_global_colors', 'get_global_fonts', 'update_global_fonts'],
    'Custom Fields': ['get_custom_fields', 'update_custom_fields'],
    'Revisions': ['get_revisions', 'restore_revision']
  };
  
  for (const [category, tools] of Object.entries(categories)) {
    if (tools.includes(toolName)) {
      return category;
    }
  }
  
  return 'Uncategorized';
}

function printValidationSummary() {
  console.log('\n' + '=' .repeat(80));
  console.log('📋 VALIDATION SUMMARY');
  console.log('=' .repeat(80));
  
  console.log(`\n📊 Overall Results:`);
  console.log(`   Total Tools Validated: ${validationResults.total}`);
  console.log(`   ✅ Valid: ${validationResults.passed}`);
  console.log(`   ❌ Invalid: ${validationResults.failed}`);
  console.log(`   ⚠️  Warnings: ${validationResults.warnings}`);
  
  const validationRate = validationResults.total > 0 ? 
    (validationResults.passed / validationResults.total * 100).toFixed(1) : 0;
  console.log(`   📈 Validation Rate: ${validationRate}%`);
  
  // Group results by mode
  const byMode = {};
  validationResults.details.forEach(result => {
    if (!byMode[result.mode]) {
      byMode[result.mode] = { valid: 0, invalid: 0 };
    }
    
    if (result.status === 'VALID') byMode[result.mode].valid++;
    else if (result.status === 'INVALID') byMode[result.mode].invalid++;
  });
  
  console.log(`\n📋 Results by Mode:`);
  Object.entries(byMode).forEach(([mode, stats]) => {
    const total = stats.valid + stats.invalid;
    const rate = total > 0 ? (stats.valid / total * 100).toFixed(1) : 0;
    console.log(`   ${mode.toUpperCase()}: ${total} tools (${rate}% valid)`);
    console.log(`     ✅ Valid: ${stats.valid}`);
    console.log(`     ❌ Invalid: ${stats.invalid}`);
  });
  
  // Group by category
  const byCategory = {};
  validationResults.details.forEach(result => {
    if (result.category) {
      if (!byCategory[result.category]) {
        byCategory[result.category] = { valid: 0, invalid: 0 };
      }
      
      if (result.status === 'VALID') byCategory[result.category].valid++;
      else if (result.status === 'INVALID') byCategory[result.category].invalid++;
    }
  });
  
  console.log(`\n🏷️  Results by Category:`);
  Object.entries(byCategory).forEach(([category, stats]) => {
    const total = stats.valid + stats.invalid;
    if (total > 0) {
      const rate = (stats.valid / total * 100).toFixed(1);
      console.log(`   ${category}: ${total} tools (${rate}% valid)`);
    }
  });
  
  // Show invalid tools if any
  const invalidTools = validationResults.details.filter(r => r.status === 'INVALID');
  if (invalidTools.length > 0) {
    console.log(`\n❌ Invalid Tools (${invalidTools.length}):`);
    invalidTools.forEach(invalid => {
      console.log(`   • ${invalid.tool} (${invalid.mode}): ${invalid.error}`);
    });
  }
  
  // Performance analysis
  const validResults = validationResults.details.filter(r => r.duration > 0);
  if (validResults.length > 0) {
    const avgDuration = validResults.reduce((sum, r) => sum + r.duration, 0) / validResults.length;
    const maxDuration = Math.max(...validResults.map(r => r.duration));
    
    console.log(`\n⚡ Validation Performance:`);
    console.log(`   Average Validation Time: ${avgDuration.toFixed(1)}ms`);
    console.log(`   Max Validation Time: ${maxDuration}ms`);
  }
  
  console.log(`\n${validationResults.failed === 0 ? '🎉' : '⚠️'} Validation completed!`);
  
  if (validationResults.failed === 0) {
    console.log('✅ All tools have valid schemas and structure!');
  } else {
    console.log(`❌ ${validationResults.failed} tools have structural issues.`);
  }
  
  if (validationResults.warnings > 0) {
    console.log(`⚠️  ${validationResults.warnings} tools have minor warnings to address.`);
  }
  
  console.log('\n💡 This validation test checks tool structure and schemas.');
  console.log('   Run the comprehensive test with WordPress credentials for full functionality testing.');
}

// Run the validation
runValidationTest().catch(error => {
  console.error('💥 Validation suite failed:', error);
  process.exit(1);
}); 