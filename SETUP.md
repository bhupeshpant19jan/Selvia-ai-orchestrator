# Shopify Product Search Chat - n8n Workflow

## Overview
A conversational chat interface that lets users search, browse, and purchase products from your Shopify store (The Fashion Company), powered by Groq LLM. Includes session context retention, cart management, and checkout via Shopify cart permalink URLs.

## Features
- **Product Search** - Natural language product search with fuzzy matching
- **Cart Management** - Add, remove, view, and clear cart items
- **Checkout** - Generate Shopify checkout URLs with cart contents
- **Session Context** - Follow-up questions reference earlier products and conversation history
- **Multi-Intent Support** - Handles search, cart, and checkout intents in a single flow

## Flow
1. **Chat Trigger** - User sends a message via the n8n chat widget
2. **Load Session Context** - Loads conversation history, known products, and cart state from `$getWorkflowStaticData('global')`
3. **Groq - Extract Query** - LLM extracts intent (search, add_to_cart, remove_from_cart, view_cart, checkout, clear_cart)
4. **Parse Query** - Structures the extracted intent and passes cart data
5. **Route by Intent** - Switch node routes to search flow OR cart flow based on intent
6. **Search Flow:**
   - **Shopify - Fetch Products** - Fetches all products from Shopify Admin API
   - **Merge & Format Results** - Filters products locally using fuzzy word matching; ranks by relevance score
7. **Cart Flow:**
   - **Cart Manager** - Handles add/remove/view/checkout/clear operations using session cart state
   - Generates Shopify cart permalink URLs for checkout: `https://store.myshopify.com/cart/{variantId}:{qty}`
8. **Groq - Format Response** - LLM crafts a conversational response (product info or cart summary)
9. **Extract Final Response** - Pulls the response text from Groq output
10. **Save Context** - Saves conversation exchange, product metadata, and cart state to session
11. **Respond to Webhook** - Returns the response to the chat widget

## Setup Instructions

### 1. Shopify Admin API Access
- Go to your Shopify Admin: https://the-fashion-company-3.myshopify.com/admin
- Navigate to **Settings** > **Apps and sales channels** > **Develop apps**
- Create a new app (e.g., "n8n Product Chat")
- Configure Admin API scopes:
  - `read_products`
  - `read_inventory`
- Install the app and copy the **Admin API access token**

### 2. Import Workflow into n8n
- Open your n8n instance
- **Workflows** > **Import from File**
- Select `shopify-product-chat-workflow-2.json`

### 3. Configure Credentials in n8n

#### Groq API Key
- Credentials > Add > Header Auth
  - Name: `Header Auth account`
  - Header Name: `Authorization`
  - Header Value: `Bearer YOUR_GROQ_API_KEY`

#### Shopify OAuth2
- Credentials > Add > Shopify OAuth2 API
  - Shop Subdomain: `the-fashion-company-3`
  - Client ID and Secret from your Shopify app

### 4. Activate and Test
- Toggle workflow to **Active**
- Click **Chat** to open the test chat
- Try queries like:
  - "Show me dresses"
  - "Do you have any jackets?"
  - "Find me a shirt for party"
  - "Tell me more about the first one" (follow-up)
  - "Add the dress to my cart" (cart operation)
  - "What's in my cart?" (view cart)
  - "I want to checkout" (generates checkout URL)

## Store Details
- **Domain:** the-fashion-company-3.myshopify.com
- **API Version:** 2024-01
- **Products:** 4 (small catalog; all fetched per request and filtered locally)

## Notes
- Products are fetched in full and filtered locally using word matching for relevance (Shopify REST API `title=` does exact match only, not search)
- Returns top 5 products per query, ranked by relevance score
- Includes pricing, availability, links, and descriptions
- Groq free tier: 30 requests/min (each chat message uses 2 Groq calls)
- Session context is stored in n8n workflow static data (memory); resets on workflow restart
- Cart uses Shopify cart permalink URLs (`/cart/{variantId}:{qty}`) — no additional API calls or credentials needed
- Checkout redirects user to Shopify's native checkout with cart pre-populated

## Supported Intents
| Intent | Example Queries | Action |
|--------|----------------|--------|
| `search` | "Show me dresses", "Find jackets" | Search and filter products |
| `add_to_cart` | "Add the dress to my cart", "I'll take the jacket" | Add product to session cart |
| `remove_from_cart` | "Remove the dress", "Take out the jacket" | Remove product from cart |
| `view_cart` | "What's in my cart?", "Show my basket" | Display cart contents and total |
| `checkout` | "I want to checkout", "Take me to payment" | Generate Shopify checkout URL |
| `clear_cart` | "Clear my cart", "Empty my basket" | Remove all items from cart |
| `details` | "Tell me more about the first one" | Show product details |
| `followup` | "What about a smaller size?" | Context-aware follow-up |

---

## Test Suite

Four test scripts validate the workflow components, Shopify API integration, cart/checkout functionality, and performance.

### Test 1: E2E Component Tests (`test-e2e.js`)

Validates each component of the pipeline independently. Run with:
```
NODE_PATH=/tmp/node_modules node test-e2e.js
```

| # | Test | Input | Expected Output |
|---|------|-------|-----------------|
| 1 | **n8n is running** | `GET http://localhost:5678/healthz` | HTTP 200 |
| 2a | **Groq API responds** | POST to Groq with system prompt for query extraction and user message `"Show me dresses"` | HTTP 200 |
| 2b | **Response contains JSON** | Groq response body | Contains `{` and `}` (valid JSON structure) |
| 2c | **Extracted search_query present** | Parsed JSON from Groq | `search_query` field is non-empty (e.g. `"dresses"`) |
| 2d | **Extracted intent present** | Parsed JSON from Groq | `intent` field is non-empty (e.g. `"search"`) |
| 3a | **Context-aware extraction responds** | POST to Groq with conversation history (`"Show me dresses"` → products listed) and follow-up `"Tell me more about the first one"` | HTTP 200 |
| 3b | **Recognizes follow-up intent** | Parsed JSON from Groq context-aware extraction | `intent` is `"followup"` OR `references_previous` is `true` |
| 4a | **Format response succeeds** | POST to Groq with mock product data (Summer Floral Dress, $49.99) and user query `"Show me dresses"` | HTTP 200 |
| 4b | **Response mentions product name** | Groq formatted response text | Contains `"Summer Floral"` or `"Dress"` |
| 4c | **Response includes price** | Groq formatted response text | Contains `"49.99"` or `"$"` |
| 5a | **Session initialized** | Create empty session in simulated static data | Session object exists with `history` and `products` |
| 5b | **Exchange saved to history** | Push `{user, assistant}` pair to session history | `history.length === 1` |
| 5c | **Product metadata saved** | Save product with id, title, url, price, type, available | `Object.keys(products).length === 1` |
| 5d | **Context loaded correctly** | Format history into context string | String includes `"Show me dresses"` |
| 5e | **Known products formatted** | Format product metadata into display string | String includes `"Summer Floral Dress"` |
| 5f | **History capped at 10** | Push 15 more exchanges then trim | `history.length === 10` |
| 5g | **Products capped at 20** | Add 25 products then trim oldest | `Object.keys(products).length === 20` |
| 5h | **Stale session cleaned up** | Create session with `lastActive` 2 hours ago; run cleanup | Stale session is deleted |
| **Cart Logic (Unit)** | | | |
| 6a | **Add item by fuzzy match** | `addToCart(session, "summer dress")` | Finds and adds "Summer Floral Dress" |
| 6b | **Cart has 1 item after add** | Check `session.cart.length` | `length === 1` |
| 6c | **Add item with quantity** | `addToCart(session, "party shirt", 2)` | Cart has 2 items, shirt qty is 2 |
| 6d | **View cart total correct** | `viewCart(session)` | Total is $129.97 (49.99 + 39.99*2) |
| 6e | **View cart count includes quantities** | `viewCart(session)` | Count is 3 (1 + 2) |
| 6f | **Add same item increases qty** | `addToCart(session, "floral dress")` | Dress quantity becomes 2 |
| 6g | **Checkout URL contains variant IDs** | `generateCheckoutUrl(session)` | URL contains `44444444444444:2,55555555555555:2` |
| 6h | **Remove item from cart** | `removeFromCart(session, "party shirt")` | Cart length is 1 |
| 6i | **Remove non-existent fails gracefully** | `removeFromCart(session, "jacket")` | Returns `{ success: false }` |
| 6j | **Clear cart empties all** | `clearCart(session)` | Cart length is 0 |
| 6k | **Empty cart view shows empty** | `viewCart(session)` after clear | `{ empty: true }` |
| 6l | **Empty cart checkout URL is null** | `generateCheckoutUrl(session)` | Returns `null` |
| **Cart Intent Extraction** | | | |
| 7a | **Intent: add to cart** | `"Add the dress to my cart"` → Groq | `intent === "add_to_cart"` |
| 7b | **Intent: view cart** | `"What's in my basket?"` → Groq | `intent === "view_cart"` |
| 7c | **Intent: checkout** | `"I want to checkout now"` → Groq | `intent === "checkout"` |
| 8 | **Chat WebSocket endpoint reachable** | WebSocket connect to `ws://localhost:5678/chat/{webhookId}` | Connection opens (then closes due to fake executionId) |

**Total: 34 tests**

---

### Test 2: Shopify API Query Tests (`test-shopify-api.js`)

Tests Groq query extraction for various inputs, local product filtering logic, and response formatting. Tracks response time for every API call. Run with:
```
node test-shopify-api.js
```

| # | Test | Input | Expected Output |
|---|------|-------|-----------------|
| **n8n Health** | | | |
| 1 | n8n is running | `GET http://localhost:5678/healthz` | HTTP 200 |
| **Groq Broad Query** | | | |
| 2a | Groq extraction responds | `"Show me everything you have"` → Groq | HTTP 200 |
| 2b | Extracted broad search query | Parsed JSON | `search_query` field exists (may be `null` for vague input) |
| **Query Extraction Variations** | | | |
| 3a | Extract: "Show me dresses" | `"Show me dresses"` → Groq | `search_query` contains `"dress"` |
| 3b | Extract: "Do you have any jackets?" | `"Do you have any jackets?"` → Groq | `search_query` contains `"jacket"` |
| 3c | Extract: "What shirts are available?" | `"What shirts are available?"` → Groq | `search_query` contains `"shirt"` |
| 3d | Extract: "I want something under $50" | `"I want something under $50"` → Groq | `search_query` is non-empty |
| 3e | Extract: "Show me your best sellers" | `"Show me your best sellers"` → Groq | `search_query` is non-empty |
| 3f | Extract: "Find me a shirt for party" | `"Find me a shirt for party"` → Groq | `search_query` contains `"shirt"` |
| 3g | Follow-up: "Add the white shirt to my basket" | `"Add the white shirt to my basket"` with conversation history from previous party shirt query and known product `[White Party Shirt] $39.99` | `search_query` contains `"white shirt"` |
| 3h | Follow-up recognizes checkout intent | Same as 3g | `intent` is `"checkout"`, `"add_to_cart"`, or `"followup"` — OR `references_previous` is `true` |
| **Local Filtering Logic** (mock products: Summer Floral Dress, Leather Biker Jacket, Cotton Casual Shirt, Denim Skinny Jeans, White Party Shirt) | | | |
| 4a | Filter "dress" | `filterProducts(mockProducts, "dress")` | First result is `"Summer Floral Dress"` |
| 4b | Filter "jacket" | `filterProducts(mockProducts, "jacket")` | First result is `"Leather Biker Jacket"` |
| 4c | Filter "shirt" | `filterProducts(mockProducts, "shirt")` | First result is `"Cotton Casual Shirt"` (both shirts returned) |
| 4d | Filter "leather" | `filterProducts(mockProducts, "leather")` | First result is `"Leather Biker Jacket"` (matched via title + tags + description) |
| 4e | Filter "summer" | `filterProducts(mockProducts, "summer")` | First result is `"Summer Floral Dress"` (matched via title + tags) |
| 4f | Filter no match | `filterProducts(mockProducts, "xyz_no_match")` | Returns all 5 products (fallback) |
| 4g | Filter empty query | `filterProducts(mockProducts, "")` | Returns all 5 products |
| 4h | Filter "summer dress" | `filterProducts(mockProducts, "summer dress")` | First result is `"Summer Floral Dress"` (score 2: matches both words) |
| 4i | Filter "shirt party" finds White Party Shirt first | `filterProducts(mockProducts, "shirt party")` | First result is `"White Party Shirt"` (score 2: "shirt" in title/type + "party" in title/tags) |
| 4j | White Party Shirt ranks above Cotton Casual Shirt | Same as 4i | `"White Party Shirt"` appears before `"Cotton Casual Shirt"` in results |
| **Groq Response Formatting** | | | |
| 5a | Format response succeeds | POST to Groq with 2 mock products (Summer Floral Dress $49.99, Leather Biker Jacket $129.99) and query `"Show me dresses and jackets"` | HTTP 200 |
| 5b | Response mentions product names | Groq formatted text | Contains `"Summer Floral"` or `"Dress"` |
| 5c | Response includes prices | Groq formatted text | Contains `"49.99"` or `"$"` |
| 5d | Response includes links | Groq formatted text | Contains `"products/"` or `"shopify"` |
| **Cart Intent Extraction** | | | |
| 6a | Cart intent: add to cart | `"Add the summer dress to my cart"` → Groq | `intent === "add_to_cart"` |
| 6b | Product reference extracted | Same as 6a | `product_reference` contains `"summer dress"` |
| 6c | Cart intent: view cart | `"What's in my cart?"` → Groq | `intent === "view_cart"` |
| 6d | Cart intent: remove from cart | `"Remove the jacket from my basket"` → Groq | `intent === "remove_from_cart"` |
| 6e | Product reference: jacket | Same as 6d | `product_reference` contains `"jacket"` |
| 6f | Cart intent: checkout | `"I want to checkout"` → Groq | `intent === "checkout"` |
| 6g | Cart intent: clear cart | `"Clear my cart please"` → Groq | `intent === "clear_cart"` |
| 6h | Cart intent: checkout variation | `"Take me to checkout"` → Groq | `intent === "checkout"` |
| **Cart URL Generation Logic** | | | |
| 7a | Single item cart URL | `generateCheckoutUrl([{variantId: "123", qty: 1}])` | URL is `/cart/123:1` |
| 7b | Multi-item cart URL | 2 items with different variants | URL contains both `variantId:qty` pairs |
| 7c | Empty cart returns null | `generateCheckoutUrl([])` | Returns `null` |
| 7d | Cart with quantity > 1 | Item with qty 5 | URL contains `:5` |
| **Cart Operations Logic** | | | |
| 8a | Add first item to cart | `addToCart("prod-1")` | Cart length is 1 |
| 8b | Add second item (qty 2) | `addToCart("prod-2", 2)` | Cart length is 2 |
| 8c | View cart shows correct count | `viewCart()` | Count is 2 |
| 8d | View cart calculates total | `viewCart()` | Total is $129.97 |
| 8e | Add same item increases qty | `addToCart("prod-1")` | Qty becomes 2 |
| 8f | Remove item from cart | `removeFromCart("prod-1")` | Cart length is 1 |
| 8g | Remove non-existent fails | `removeFromCart("prod-99")` | Returns `{ success: false }` |
| 8h | Clear cart empties all | `clearCart()` | Cart length is 0 |
| 8i | Add unknown product fails | `addToCart("unknown")` | Returns `{ success: false }` |

**Total: 46 tests** — each API call's response time is recorded and displayed in a summary table.

---

### Test 3: Shopify API Stress / Latency Test (`test-shopify-stress.js`)

Makes 50 sequential GET requests to the Shopify storefront search/suggest API with varied query parameters. Measures per-call latency and writes full results to `shopify-stress-results.json`. Run with:
```
node test-shopify-stress.js
```

**Endpoint tested:** `GET https://the-fashion-company-3.myshopify.com/search/suggest.json?q={term}&resources[type]=product`

This is the public storefront search suggestion API (no authentication required). It returns product suggestions matching the query term.

#### Query Groups (50 calls total)

| Group | Queries (10 each) | Purpose |
|-------|-------------------|---------|
| 1. Product keywords | shirt, dress, jacket, jeans, pants, shoes, hat, belt, scarf, bag | Test search by product type names |
| 2. Style/occasion | party, formal, casual, summer, winter, elegant, sporty, classic, modern, vintage | Test search by style descriptors |
| 3. Colors | white, black, red, blue, green, pink, brown, grey, navy, beige | Test search by color attributes |
| 4. Materials | cotton, leather, silk, denim, wool, linen, polyester, suede, velvet, satin | Test search by material/fabric |
| 5. Multi-word | white shirt, summer dress, leather jacket, party wear, cotton shirt, formal pants, blue jeans, black shoes, red dress, silk scarf | Test compound search queries |

#### Expected Output

Each call is expected to return HTTP 200. The test records:

| Field | Description |
|-------|-------------|
| `latencyMs` | Time from request start to response fully received |
| `status` | HTTP status code (expect 200) |
| `bodySizeBytes` | Response payload size |
| `productCount` | Number of product suggestions returned |

#### Statistics Computed

- **Min / Max / Average / Median** latency
- **P90, P95, P99** percentiles
- **Latency distribution** histogram (buckets: <100ms, 100-300ms, 300-500ms, 500ms-1s, 1-2s, >2s)
- **Slowest 5** and **Fastest 5** calls
- **Total** aggregate time across all 50 calls

#### Last Run Results (2026-01-28)

| Metric | Value |
|--------|-------|
| Total calls | 50 |
| Successful | 50 (100%) |
| Failed | 0 |
| Min latency | 142ms |
| Max latency | 271ms |
| Average | 180ms |
| Median | 174ms |
| P90 | 208ms |
| P95 | 224ms |
| P99 | 271ms |
| Total time | 9,002ms |

All 50 calls landed in the 100-300ms bucket. Queries returning product matches (e.g. "shirt", "cotton", "leather") were slightly slower (200-270ms) due to larger response payloads. Zero-result queries averaged ~165ms.

#### Output File

Full per-call data is written to `shopify-stress-results.json` with this structure:
```json
{
  "timestamp": "ISO-8601",
  "store": "the-fashion-company-3.myshopify.com",
  "totalCalls": 50,
  "statistics": { "latency": { "min", "max", "avg", "median", "p90", "p95", "p99" }, "buckets": { ... } },
  "calls": [
    { "index": 1, "label": "...", "path": "...", "status": 200, "latencyMs": 232, "bodySizeBytes": 2253, "productCount": 1, "error": null },
    ...
  ]
}
```

---

### Test 4: Cart & Checkout Latency Test (`test-cart-latency.js`)

Tests the latency of cart-related operations including Groq intent extraction for cart operations, local cart URL generation, and Shopify cart permalink accessibility. Run with:
```
node test-cart-latency.js
```

#### Query Groups (35 Groq calls)

| Group | Count | Example Queries | Expected Intent |
|-------|-------|-----------------|-----------------|
| Add to cart | 10 | "Add the dress to my cart", "Put the jacket in my basket" | `add_to_cart` |
| View cart | 5 | "What's in my cart?", "Show me my basket" | `view_cart` |
| Checkout | 10 | "I want to checkout", "Take me to checkout", "Ready to pay" | `checkout` |
| Remove from cart | 5 | "Remove the dress from my cart", "Take out the jacket" | `remove_from_cart` |
| Clear cart | 5 | "Clear my cart", "Empty my basket" | `clear_cart` |

#### Additional Tests

| Test | Count | Description |
|------|-------|-------------|
| Cart URL generation | 20 | Local computation of Shopify cart permalink URLs |
| Permalink accessibility | 5 | HTTP HEAD requests to validate cart URLs |

#### Last Run Results (2026-01-28)

| Metric | Value |
|--------|-------|
| Total Groq queries | 35 |
| Successful | 35 (100%) |
| Correct intents | 30 (85.7%) |
| Min latency | 85ms |
| Max latency | 295ms |
| Average | 145ms |
| Median | 140ms |
| P90 | 244ms |
| P95 | 295ms |
| P99 | 295ms |
| Rate limit waits | 1 |

**Intent Accuracy by Group:**
| Group | Accuracy | Avg Latency |
|-------|----------|-------------|
| add | 9/10 (90%) | 186ms |
| view | 4/5 (80%) | 150ms |
| checkout | 9/10 (90%) | 138ms |
| remove | 5/5 (100%) | 111ms |
| clear | 3/5 (60%) | 106ms |

**Cart URL Generation:**
- Average latency: 0.05ms (local computation)
- Average URL length: 109 characters

#### Output File

Full per-call data is written to `cart-latency-results.json` with this structure:
```json
{
  "timestamp": "ISO-8601",
  "store": "the-fashion-company-3.myshopify.com",
  "statistics": {
    "groq": { "totalQueries", "successCount", "correctIntents", "accuracyPct", "latency": {...}, "byGroup": {...} },
    "urlGeneration": { "count", "avgLatencyMs", "avgUrlLength" },
    "permalink": { "count", "successCount", "avgLatencyMs" }
  },
  "groqResults": [...],
  "urlGenerationResults": [...],
  "permalinkResults": [...]
}
```
