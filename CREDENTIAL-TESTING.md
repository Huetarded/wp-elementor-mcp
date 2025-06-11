# 🧪 Testing with WordPress Credentials

This guide walks you through testing the Elementor MCP with real WordPress credentials to validate all the enhanced features work correctly, including the new structured JSON response format.

## 🚀 Quick Setup

### 1. Create Your Credentials File
```bash
# Copy the example file
cp env.example .env

# Edit with your actual WordPress details
nano .env  # or use your preferred editor
```

### 2. Fill in Your WordPress Details

Open `.env` and replace the placeholder values:

```env
# Your WordPress site URL (without trailing slash)
WORDPRESS_BASE_URL=https://your-actual-site.com

# WordPress username with appropriate permissions
WORDPRESS_USERNAME=your-actual-username

# WordPress Application Password (NOT your regular password!)
WORDPRESS_APPLICATION_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx

# Optional: Specific post/page IDs for testing
TEST_POST_ID=123
TEST_PAGE_ID=456
```

### 3. Generate WordPress Application Password

⚠️ **Important**: You need an **Application Password**, not your regular WordPress password.

1. Go to your WordPress Admin Dashboard
2. Navigate to **Users → Your Profile**
3. Scroll down to **Application Passwords**
4. Enter a name like "Elementor MCP Testing"
5. Click **Add New Application Password**
6. Copy the generated password (format: `xxxx xxxx xxxx xxxx xxxx xxxx`)

## 🧪 Running Tests

### Test Everything
```bash
npm run test:credentials
```

### Test Specific Components
```bash
# Test enhanced features (debugging, list_all_content, response format)
node test-with-credentials.js enhanced

# Test core validation (schemas, structure, response format)
node test-with-credentials.js validate

# Test comprehensive functionality (all tools with response validation)
node test-with-credentials.js comprehensive
```

### Get Help
```bash
node test-with-credentials.js --help
```

## 🔍 What Gets Tested

### ✅ Enhanced Features
- **`list_all_content`** - Diagnostic tool to find all posts/pages
- **Enhanced error handling** - Better 404 and connection error messages  
- **Debugging output** - Console logging and status indicators
- **Connection validation** - WordPress API accessibility
- **Structured JSON responses** - Consistent `{status: "success"/"error", data: {...}}` format

### ✅ Core Functionality
- WordPress connection and authentication
- Post and page retrieval with meta data
- Elementor data detection and access
- Tool schema validation
- Response format consistency validation

### ✅ Response Format Validation
All tools now return structured JSON responses:

**Success Format:**
```json
{
  "status": "success", 
  "data": {
    /* Actual response data */
  },
  "message": "Operation completed successfully"
}
```

**Error Format:**
```json
{
  "status": "error",
  "data": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "error_type": "ERROR_CATEGORY",
    "details": "Additional context"
  }
}
```

### ✅ Real-World Scenarios
- Finding posts with Elementor data (✅ indicators)
- Handling posts without Elementor data (❌ indicators)
- Mixed content scenarios (⚠️ indicators)
- Error recovery and suggestions
- Structured response parsing and validation

## 🛠️ Expected Results

### With Valid Credentials
```
✅ Environment variables loaded from .env
🌐 WordPress URL: https://your-site.com
👤 Username: your-username
🔑 Application Password: ***set***

✅ All required credentials are present and valid

🚀 Running complete test suite with WordPress credentials...

✅ Found 15 posts
   • Post 123: "Welcome to WordPress!" ✅ Full Elementor data
   • Post 124: "Sample Page" ⚠️ Partial Elementor data  
   • Post 125: "Hello World" ❌ No Elementor data

✅ Enhanced error handling and debugging features validated
✅ list_all_content tool ready for content discovery
✅ All tools return consistent structured JSON responses 📋
✅ Response format validation: 100% compliant
✅ All 404 and connection issues should now be resolved
```

### Response Format Benefits
- **Consistent parsing** - All tools follow the same response structure
- **Better error handling** - Structured error messages with codes and categories  
- **Enhanced debugging** - Rich data structures with detailed context
- **Client compatibility** - Standardized format works across all MCP clients

## 🐛 Troubleshooting

### Connection Issues
- Verify your WordPress URL is correct and accessible
- Check that REST API is enabled (`/wp-json/wp/v2/`)
- Ensure no security plugins are blocking API access

### Authentication Issues  
- Regenerate your Application Password
- Verify username has appropriate permissions
- Test with a different user account

### Response Format Issues
- All tools should return JSON with `status` and `data` fields
- Check for proper JSON formatting in responses
- Validate error responses include required error fields

### No Elementor Data Found
- Install and activate Elementor plugin
- Create at least one page with Elementor
- Check that Elementor data is being saved properly

## 🔒 Security Notes

- Your `.env` file is automatically ignored by git
- Never commit credentials to version control
- Use Application Passwords, not regular passwords
- Rotate Application Passwords regularly

## 📞 Getting Help

If tests fail even with valid credentials, the enhanced error messages and structured responses will guide you to the issue. Common problems and solutions are documented in [TROUBLESHOOTING.md](TROUBLESHOOTING.md). 