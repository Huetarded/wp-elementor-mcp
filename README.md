# Elementor WordPress MCP Server

A Model Context Protocol (MCP) server for interacting with WordPress and Elementor. This server provides AI assistants with the ability to manage WordPress content, posts, pages, media, and Elementor templates through the WordPress REST API.

## Features

- **WordPress Content Management**: Full CRUD operations for posts and pages
- **True Elementor Integration**: Create, read, and update real Elementor content with sections, columns, and widgets
- **Automatic Post/Page Detection**: Elementor functions intelligently work with both posts and pages
- **Rich Content Creation**: Build complex layouts with headings, text editors, buttons, images, and styling
- **Content Conversion**: Transform regular WordPress content into Elementor-powered pages
- **Automatic Cache Busting**: Elementor cache is automatically cleared after updates for immediate visibility
- **Media Management**: Upload and manage WordPress media library
- **Environment Variable Support**: Easy configuration via environment variables
- **Authentication**: Secure connection using WordPress application passwords
- **Type-Safe**: Built with TypeScript for better development experience

## Prerequisites

- Node.js 18 or higher
- WordPress site with REST API enabled
- WordPress Application Password (not regular password)
- Elementor plugin (for Elementor-specific features)

## Installation

### Option 1: NPX (Recommended)
The easiest way to use this MCP server:

```bash
npx wp-elementor-mcp
```

### Option 2: Local Development
For local development or modification:

1. Clone this repository:
   ```bash
   git clone https://github.com/Huetarded/wp-elementor-mcp.git
   cd wp-elementor-mcp
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the server:
   ```bash
   npm run build
   ```

## WordPress Setup

### Creating an Application Password

1. Log into your WordPress admin dashboard
2. Go to **Users** → **Profile** (or **Users** → **All Users** → Edit your user)
3. Scroll down to **Application Passwords** section
4. Enter a name for the application (e.g., "MCP Server")
5. Click **Add New Application Password**
6. **Important**: Copy the generated password immediately - you won't see it again!

### Required WordPress Permissions

Your WordPress user should have sufficient permissions to:
- Create, edit, and delete posts/pages
- Upload media files
- Access Elementor data (if using Elementor features)

## Usage

### Configuration (Environment Variables - Recommended)

The recommended way to configure the MCP server is through environment variables. Add this configuration to your MCP client (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "elementor-wordpress": {
      "command": "npx",
      "args": ["wp-elementor-mcp"],
      "env": {
        "WORDPRESS_BASE_URL": "https://yoursite.com",
        "WORDPRESS_USERNAME": "your-wp-username",
        "WORDPRESS_APPLICATION_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

**Environment Variables:**
- `WORDPRESS_BASE_URL`: Your WordPress site URL (e.g., `https://yoursite.com`)
- `WORDPRESS_USERNAME`: Your WordPress username
- `WORDPRESS_APPLICATION_PASSWORD`: The application password you generated

### Alternative: Manual Configuration

If you prefer not to use environment variables, you can manually configure the connection:

1. Start the MCP server without environment variables
2. Use the `configure_wordpress` tool with your WordPress credentials:
   - **baseUrl**: Your WordPress site URL (e.g., `https://yoursite.com`)
   - **username**: Your WordPress username
   - **applicationPassword**: The application password you generated

### Running the Server Locally

```bash
npm start
```

## Available Tools

### WordPress Configuration
- `configure_wordpress` - Set up connection to your WordPress site (optional if environment variables are configured)

### Posts & Pages
- `get_posts` - Retrieve WordPress posts with filtering options
- `get_post` - Get a specific post by ID
- `create_post` - Create new posts
- `update_post` - Update existing posts
- `get_pages` - Retrieve WordPress pages
- `create_page` - Create new WordPress pages
- `update_page` - Update existing WordPress pages

### Elementor
- `get_elementor_templates` - Get Elementor templates (requires Elementor Pro)
- `get_elementor_data` - Get Elementor page/post data
- `update_elementor_data` - Update Elementor page/post data (automatically clears cache)

### Elementor Incremental Updates (NEW!)
For better performance and handling of large pages:
- `get_elementor_elements` - Get a simplified list of all elements and their IDs
- `get_elementor_widget` - Get a specific widget from an Elementor page
- `update_elementor_widget` - Update a specific widget (incremental update)
- `update_elementor_section` - Update multiple widgets within a section (batch update)
- `get_elementor_data_chunked` - Get Elementor data in smaller, manageable chunks
- `backup_elementor_data` - Create a backup before making changes

### Media
- `get_media` - Browse WordPress media library
- `upload_media` - Upload files to WordPress media library

## Example Usage

Here are some example commands you can use with an MCP client:


### Create a Post
```
Create a new WordPress post with title "Hello World" and content "<h1>Welcome to my blog!</h1><p>This is my first post created via MCP.</p>"
```

### Create a Page
```
Create a new WordPress page with title "About Us" and content "<h1>About Our Company</h1><p>Learn more about our mission and values.</p>"
```

### Update a Page
```
Update page ID 5 with new title "Updated About Page" and add additional content about our team
```

### Get Elementor Data
```
Get the Elementor data for page ID 9
```

### Create Elementor Content
```
Update page ID 37 with Elementor content including a hero section with heading "Welcome to Our Site", a text widget with introduction content, and a call-to-action button
```

### Convert Regular Content to Elementor
```
Update post ID 31 to use Elementor with a section containing a heading widget, text editor widget with rich content, and an image widget
```

### Upload Media
```
Upload the image file at /path/to/image.jpg to WordPress with title "My Image" and alt text "A beautiful image"
```

### Incremental Elementor Updates (Performance Optimized)

#### Get All Elements Overview
```
Get a list of all elements in page ID 15 to see their IDs and types
```

#### Update Single Widget
```
Update the HTML widget with ID "621ef73f" in page ID 15 with new content "<p>Updated content here</p>"
```

#### Update Widget Settings
```
Update widget "abc123" in page ID 20, changing the text color to #FF0000 and font size to 24px
```

#### Batch Update Section
```
Update section "section456" in page ID 25 with multiple widget changes: update HTML widget "widget1" content and heading widget "widget2" title
```

#### Get Page Data in Chunks
```
Get page ID 30 Elementor data in chunks of 3 elements each, starting with chunk 0
```

#### Backup Before Changes
```
Create a backup of page ID 10 Elementor data with name "before_major_update"
```

## Development

### Building
```bash
npm run build
```

### Development Mode (with auto-rebuild)
```bash
npm run dev
```

### Project Structure
```
├── src/
│   └── index.ts          # Main MCP server implementation
├── dist/                 # Compiled JavaScript output
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Performance & Efficiency

### Problem with Large Elementor Pages
When working with complex Elementor pages, MCP clients often struggle with:
- Large JSON data transfers (pages can be 500KB+ of data)
- Memory constraints when processing entire page structures
- Slow response times for simple content updates
- Risk of data corruption when updating massive JSON structures

### Solution: Incremental Updates
This MCP server now provides several approaches to handle large Elementor pages more efficiently:

1. **Widget-Level Updates**: Update individual widgets without touching the rest of the page
2. **Section-Level Batch Updates**: Update multiple widgets within a specific section
3. **Chunked Data Retrieval**: Get page data in smaller, manageable pieces
4. **Element Discovery**: Get a lightweight overview of all elements and their IDs
5. **Backup System**: Create safe backups before making changes

### When to Use Each Approach

| Method | Best For | Data Size | Use Case |
|--------|----------|-----------|----------|
| `update_elementor_data` | Small pages, complete rebuilds | Full page data | Traditional full-page updates |
| `update_elementor_widget` | Single widget changes | ~1-10KB | Updating text, images, simple content |
| `update_elementor_section` | Related widget updates | ~10-50KB | Updating a section's content at once |
| `get_elementor_data_chunked` | Large page analysis | ~20-100KB per chunk | Exploring large pages safely |
| `get_elementor_elements` | Page discovery | ~5-20KB | Finding widgets to update |

## Troubleshooting

### Connection Issues
- Verify your WordPress site has the REST API enabled
- Check that your application password is correct
- Ensure your WordPress user has sufficient permissions
- Try accessing `https://yoursite.com/wp-json/wp/v2/` in your browser

### Elementor Issues
- Elementor template features require Elementor Pro
- Make sure Elementor is activated and up to date
- The `get_elementor_data` and `update_elementor_data` functions work with both posts and pages (automatically detects the correct endpoint)
- If you experience timeouts with Elementor functions, ensure you're using version 1.2.2 or later
- Some Elementor endpoints may not be available depending on your setup

### Permission Errors
- Verify your WordPress user role has necessary capabilities
- Check if any security plugins are blocking REST API access
- Ensure proper authentication headers are being sent

## Security Notes

- Never share your application passwords
- Use HTTPS for your WordPress site in production
- Consider IP restrictions for sensitive operations
- Regularly rotate application passwords

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve this MCP server.

## License

MIT License - see LICENSE file for details. 