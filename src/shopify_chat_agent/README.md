# Selvia Agent - AI Shopping Assistant for Shopify

A conversational AI shopping assistant that integrates with Shopify storefronts. Powered by Groq LLM for natural language understanding and n8n for workflow automation.

## Overview

Selvia Agent provides a chat widget that allows customers to:
- **Search for products** using natural language ("show me shirts", "find blue dresses")
- **Add items to cart** ("add a jacket to my cart")
- **Proceed to checkout** ("I want to checkout")

## Architecture

```
Customer visits Shopify store
    │
    ▼
┌─────────────────────────┐
│   Chat Widget (JS)      │  ◄── chat-widget.js injected in theme
│   Fixed bottom-right    │
└───────────┬─────────────┘
            │ POST { message: "..." }
            ▼
┌─────────────────────────┐
│   n8n Webhook           │  ◄── workflow-webhook.json
│   /webhook/shopify-chat │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Groq LLM (Llama 3.3)  │  Parses intent: search/cart/checkout
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Shopify Storefront    │  GraphQL API for products/cart
│   API                   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Response to Customer  │  Products, cart confirmation, checkout URL
└─────────────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `workflow-webhook.json` | n8n workflow that handles chat messages, parses intent with Groq LLM, and interacts with Shopify Storefront API |
| `chat-widget.js` | Self-contained JavaScript chat widget with Selvia branding. Injected into Shopify theme |
| `credentials-template.json` | Template showing required credentials structure (credentials must be created manually in n8n) |
| `README.md` | This documentation file |

## Workflow Details

The n8n workflow (`workflow-webhook.json`) contains the following nodes:

### 1. Chat Webhook
- **Type:** Webhook (POST)
- **Path:** `/webhook/shopify-chat`
- **Input:** `{ "message": "customer message" }`
- **CORS:** Enabled for cross-origin requests from Shopify

### 2. Groq - Parse Intent
- **Type:** HTTP Request to Groq API
- **Model:** `llama-3.3-70b-versatile`
- **Purpose:** Analyzes customer message and extracts:
  - `intent`: "search", "cart", or "checkout"
  - `search_query` or `product_name`: The product to find
  - `quantity`: Number of items (default: 1)

### 3. Parse Groq Response
- **Type:** Function node
- **Purpose:** Extracts structured data from LLM response, cleans search terms

### 4. Switch - Intent
- **Type:** Switch node
- **Routes to:**
  - Search → Shopify - Search Products
  - Cart → Cart - Search Product → Cart - Extract Variant → Cart - Create and Add → Cart - Format Response
  - Checkout → Shopify - Create Checkout

### 5. Shopify API Nodes
- **Shopify - Search Products:** Searches products using Storefront GraphQL API
- **Cart - Search Product:** Finds product variant for cart
- **Cart - Create and Add:** Creates cart and adds item using `cartCreate` mutation
- **Cart - Format Response:** Formats cart response with checkout URL

### 6. Set - Final Response
- **Type:** Set node
- **Purpose:** Returns JSON response to the chat widget

## Setup Instructions

### Prerequisites
- n8n instance (local or cloud)
- Groq API key (free at https://console.groq.com)
- Access to Shopify store theme editor

### Step 1: Import Workflow into n8n

1. Open n8n at `http://localhost:5678`
2. Click **Add workflow** → **...** menu → **Import from file**
3. Select `workflow-webhook.json`
4. Click **Save**

### Step 2: Configure Groq API Credential

1. In the workflow, double-click the **"Groq - Parse Intent"** node
2. Click the credential dropdown → **Create new credential**
3. Configure as follows:

| Field | Value |
|-------|-------|
| Credential Type | Header Auth |
| Name | `Groq API Key` |
| Header Name | `Authorization` |
| Header Value | `Bearer gsk_YOUR_GROQ_API_KEY` |

4. Click **Save** on the credential
5. Click **Save** on the workflow

### Step 3: Activate the Workflow

1. Toggle the **Publish** switch (top-right of workflow editor)
2. The webhook URL will be: `http://YOUR_N8N_HOST:5678/webhook/shopify-chat`

### Step 4: Test the Webhook

```bash
# Linux/Mac
curl -X POST http://localhost:5678/webhook/shopify-chat \
  -H "Content-Type: application/json" \
  -d '{"message": "show me shirts"}'

# Windows PowerShell
Invoke-RestMethod -Uri "http://localhost:5678/webhook/shopify-chat" `
  -Method POST -ContentType "application/json" `
  -Body '{"message": "show me shirts"}'
```

### Step 5: Make n8n Accessible (for Production)

For customers to use the chat, n8n must be accessible from the internet:

**Option A: ngrok (Testing)**
```bash
ngrok http 5678
# Use the https://xxxx.ngrok.io URL
```

**Option B: Deploy to VPS**
- Deploy n8n to a cloud server with SSL
- Use URL: `https://your-domain.com/webhook/shopify-chat`

**Option C: n8n Cloud**
- URL: `https://your-instance.app.n8n.cloud/webhook/shopify-chat`

### Step 6: Add Chat Widget to Shopify

#### 6.1 Upload JavaScript File

1. Go to Shopify Admin → **Online Store** → **Themes**
2. Click **...** → **Edit code**
3. In the sidebar, find **Assets** folder
4. Click **Add a new asset** → Upload `chat-widget.js`

#### 6.2 Add Widget to Theme Layout

1. In the code editor, open **Layout** → **theme.liquid**
2. Find the `</body>` tag (near the bottom)
3. Add this code **just before** `</body>`:

```html
<!-- Selvia Agent - AI Shopping Assistant -->
<script>
  window.CHATBOT_CONFIG = {
    webhookUrl: "YOUR_N8N_WEBHOOK_URL_HERE"
  };
</script>
<script src="{{ 'chat-widget.js' | asset_url }}" defer></script>
```

4. Replace `YOUR_N8N_WEBHOOK_URL_HERE` with your actual webhook URL
5. Click **Save**

## Chat Widget Features

- **Fixed Position:** Stays at bottom-right of viewport while scrolling
- **Selvia Branding:**
  - "Selvia Agent" label above chat bubble
  - "Selvia Agent" in chat header
  - "Powered by Selvia" in footer
- **Responsive:** Adapts to mobile screens
- **Accessible:** ARIA labels, keyboard navigation, Escape to close
- **Product Display:** Shows product cards with images, titles, prices
- **Cart Integration:** Displays checkout button after adding to cart

## Customization

### Change Chat Color
Edit `chat-widget.js` and replace `#5C6AC4` with your brand color.

### Change Welcome Message
Find this line in `chat-widget.js`:
```javascript
addMessage('assistant', "Hi! I'm Selvia, your shopping assistant...");
```

### Change Webhook URL Dynamically
```javascript
window.ShopifyChatbot.setWebhookUrl('https://new-url.com/webhook/shopify-chat');
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Chat bubble not visible | Check browser console (F12) for JS errors. Verify file is in Assets |
| "Failed to fetch" error | n8n not reachable. Check webhook URL and ensure n8n is running |
| CORS error | Workflow has CORS headers configured. Re-import if needed |
| "Error in workflow" | Check n8n Executions tab for detailed error. Usually credential issue |
| Empty/wrong response | Check n8n execution log. Verify Groq credential is correct |
| Products not found | Verify Shopify Storefront API token is valid |

## Shopify Store Configuration

This demo uses:
- **Store:** `the-fashion-company-3.myshopify.com`
- **Storefront Access Token:** `bdcbffa7e49282474f618c9e8aa7d8b7`

To use with a different store, update the URLs and tokens in the workflow nodes:
- `Shopify - Search Products`
- `Cart - Search Product`
- `Cart - Create and Add`

## License

Internal use only - Selvia Engine
