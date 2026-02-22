# Setup Guide: AI Shopping Chatbot for Shopify

## Prerequisites
- n8n instance running (local or hosted)
- Groq API key (free at console.groq.com)
- Access to your Shopify store's theme editor

## Step 1: Set Up n8n Workflow

1. Open your n8n instance (default: http://localhost:5678)
2. Click "Add workflow" → then the "..." menu → "Import from file"
3. Select `workflow-webhook.json`
4. You'll see a "Groq – Parse Intent" node with a red warning — this needs credentials:
   a. Double-click the "Groq – Parse Intent" node
   b. Click the credential dropdown → "Create new credential"
   c. Type: "Header Auth"
   d. Name: `Groq API Key`
   e. Header Name: `Authorization`
   f. Header Value: `Bearer gsk_YOUR_GROQ_API_KEY_HERE`
   g. Save
5. Click "Save" to save the workflow
6. Toggle the workflow to "Active" (top-right switch)
7. Note your webhook URL — it will be: `http://YOUR_N8N_HOST:5678/webhook/shopify-chat`

### Test the webhook:
```bash
curl -X POST http://localhost:5678/webhook/shopify-chat \
  -H "Content-Type: application/json" \
  -d '{"message": "show me shirts"}'
```
You should get a JSON response with product search results.

## Step 2: Make n8n Accessible from the Internet

Your Shopify store's customers need to reach your n8n webhook from their browsers. Options:

**Option A: ngrok (Quick demo/testing)**
```bash
ngrok http 5678
```
Copy the `https://xxxx.ngrok.io` URL. Your webhook URL becomes:
`https://xxxx.ngrok.io/webhook/shopify-chat`

**Option B: Deploy n8n to a VPS**
Use a cloud server with a domain + SSL certificate.
Your webhook URL becomes: `https://your-domain.com/webhook/shopify-chat`

**Option C: n8n Cloud**
If using n8n cloud, your webhook URL is already public:
`https://your-instance.app.n8n.cloud/webhook/shopify-chat`

## Step 3: Add Chat Widget to Your Shopify Store

1. Go to your Shopify admin: `https://the-fashion-company-3.myshopify.com/admin`
2. Navigate to: **Online Store → Themes → Actions → Edit Code**
3. **Upload the JS file:**
   - In the left sidebar, find the `Assets` folder
   - Click "Add a new asset"
   - Upload `chat-widget.js`
4. **Add the widget to your theme layout:**
   - In the left sidebar, open `Layout` → `theme.liquid`
   - Find the `</body>` tag (near the bottom)
   - **Just BEFORE `</body>`**, paste:
   ```html
   <!-- AI Shopping Chatbot -->
   <script>
     window.CHATBOT_CONFIG = {
       webhookUrl: "YOUR_N8N_WEBHOOK_URL_HERE"
     };
   </script>
   <script src="{{ 'chat-widget.js' | asset_url }}" defer></script>
   ```
   - Replace `YOUR_N8N_WEBHOOK_URL_HERE` with your actual n8n webhook URL from Step 2
5. Click **Save**

## Step 4: Test It

1. Visit your store: `https://the-fashion-company-3.myshopify.com`
2. You should see a purple chat bubble in the bottom-right corner
3. Click it — the chat panel opens with a welcome message
4. Try these messages:
   - "show me shirts" → should return product search results
   - "add a dress to my cart" → should add to cart and show checkout link
   - "I want to checkout" → should provide checkout URL
5. If anything fails, check the browser console (F12 → Console) for errors

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Chat bubble doesn't appear | Check browser console for JS errors. Verify `chat-widget.js` is in Assets |
| "Failed to fetch" error | n8n webhook not reachable. Check URL and CORS headers. Make sure ngrok/server is running |
| CORS error in console | The webhook node should have CORS headers configured. Re-import the workflow if needed |
| "Credential not found" error in n8n | Re-create the Groq API credential in the Groq – Parse Intent node |
| Empty response | Check n8n execution log (Executions tab) for errors in the workflow |
| Products not found | The store uses Shopify Storefront API. Make sure the token `bdcbffa7e49282474f618c9e8aa7d8b7` is valid |

## File Structure

```
shopify-chatbot-demo/
├── workflow-webhook.json      # n8n workflow with webhook trigger and CORS
├── chat-widget.js             # Self-contained storefront chat widget
└── SETUP.md                   # This setup guide
```

## How It Works

1. Customer visits the Shopify store
2. Chat bubble appears in bottom-right corner (injected by `chat-widget.js`)
3. Customer clicks bubble → chat panel opens with welcome message
4. Customer types a message (e.g., "show me shirts")
5. JavaScript sends POST request to n8n webhook with `{ "message": "show me shirts" }`
6. n8n workflow processes:
   - Groq AI parses intent (search/cart/checkout)
   - Shopify Storefront API executes the action
   - Response is formatted and returned
7. Chat widget displays the response with product cards, checkout links, etc.

## Customization

### Change the chat bubble color
Edit the `#5C6AC4` color values in `chat-widget.js` to match your brand.

### Change the welcome message
Find this line in `chat-widget.js` and modify:
```javascript
addMessage('assistant', "Hi! I can help you find products...");
```

### Use a different webhook URL dynamically
```javascript
window.ShopifyChatbot.setWebhookUrl('https://your-new-url.com/webhook/shopify-chat');
```
