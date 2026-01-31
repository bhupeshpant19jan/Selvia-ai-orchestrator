# ShopifyAgent — AI Agent Workflow

A simplified n8n workflow that replaces the 12-node manual pipeline (in `../Integration1/`) with a single **AI Agent node** that natively handles LLM reasoning, tool invocation, and conversation memory.

## Architecture

```
Chat Trigger
    |
    v
AI Agent (Tools Agent)
    |-- [LLM]    Groq Chat Model (llama-3.1-8b-instant)
    |-- [Memory] Simple Memory (window: 10 messages)
    |-- [Tool]   HTTP Request Tool - "Search Shopify Products"
    '-- [Tool]   Code Tool - "Cart Manager"
```

**Total: 2 top-level nodes + 4 sub-nodes** (vs 12 nodes in Integration1)

## Comparison with Integration1

| Aspect | Integration1 (Old) | ShopifyAgent (New) |
|--------|-------------------|-------------------|
| Total nodes | 12 | 2 + 4 sub-nodes |
| Groq integration | 2 HTTP Request nodes (manual JSON) | 1 Groq Chat Model sub-node (native) |
| Memory / context | 2 Code nodes (manual load + save) | 1 Simple Memory sub-node (automatic) |
| Intent routing | Code + Switch node (6 branches) | AI Agent decides via LLM reasoning |
| Shopify API | HTTP Request node | HTTP Request Tool (agent invokes when needed) |
| Cart logic | Code node (manual routing) | Code Tool (agent invokes when needed) |
| Response formatting | HTTP Request + Code node | Agent formats natively (single LLM pass) |
| Groq calls per message | 2 (extract + format) | 1+ (agent manages autonomously) |

## Capabilities

Same as Integration1:

- **Product Search** - Natural language search with fuzzy matching
- **Cart Management** - Add, remove, view, clear cart items
- **Checkout** - Shopify cart permalink URLs (`/cart/{variantId}:{qty},...`)
- **Conversation Memory** - Follow-up questions use context from last 10 exchanges
- **Multi-Intent** - Agent handles search, cart, and checkout intents automatically

## Setup

### Prerequisites

- n8n running locally (use `../Integration1/bootstrap.sh` or start with `npx n8n start`)
- Groq API key ([console.groq.com](https://console.groq.com))
- Shopify OAuth2 credentials (same as Integration1)

### Step 1: Create Groq API Credential

The AI Agent uses n8n's **native Groq credential type** (not Header Auth like Integration1).

1. Open n8n UI at `http://localhost:5678`
2. Go to **Credentials** > **Add Credential** > **Groq API**
3. Enter your Groq API key (same key as Integration1, just `gsk_...` without the `Bearer` prefix)
4. Save and note the credential ID

### Step 2: Update Workflow JSON

Edit `shopify-agent-workflow.json` and replace:
```json
"groqApi": {
  "id": "REPLACE_WITH_GROQ_CREDENTIAL_ID",
  "name": "Groq account"
}
```
with your actual Groq credential ID from step 1.

The Shopify OAuth2 credential (`PIgWg1jirQLKTuBC` / "Shopify account") is already configured — reuse the same credential from Integration1.

### Step 3: Import Workflow

1. Go to **Workflows** > **Import from File**
2. Select `shopify-agent-workflow.json`
3. Open the imported workflow

### Step 4: Verify Sub-node Connections

After import, open the AI Agent node and verify:
- **Groq Chat Model** is connected to the LLM slot
- **Simple Memory** is connected to the Memory slot
- **Search Shopify Products** is connected to the Tools slot
- **Cart Manager** is connected to the Tools slot

### Step 5: Activate and Test

1. Toggle the workflow to **Active**
2. Click **Chat** to open the test widget
3. Try these queries:
   - `"Show me dresses"` - Agent calls Search tool, filters results
   - `"Add the first one to my cart"` - Agent calls Cart Manager with product data
   - `"What's in my cart?"` - Agent calls Cart Manager (view)
   - `"I want to checkout"` - Agent calls Cart Manager (checkout), returns URL
   - `"Tell me more about the jacket"` - Agent uses memory for context

## How It Works

### The AI Agent replaces manual intent routing

In Integration1, intent was extracted by a Groq HTTP call, parsed by a Code node, and routed through a Switch node with 6 branches. Here, the AI Agent **decides what to do via LLM reasoning**:

1. User sends a message via Chat Trigger
2. AI Agent receives the message + conversation history (from Simple Memory)
3. Agent reads the system prompt to understand its capabilities and tools
4. Agent decides which tool(s) to call based on user intent
5. Tool results flow back to the agent
6. Agent generates a conversational response
7. Memory automatically stores the exchange

### Cart persistence

The Cart Manager code tool uses `$getWorkflowStaticData('global')` to persist the cart across messages. Cart data survives within a workflow run but resets when the workflow is restarted (same as Integration1).

### Shopify product search

The HTTP Request Tool fetches all 50 products from the Shopify Admin API. The AI Agent itself filters and ranks the results based on the user's query — no separate Code node needed.

## Store Details

- **Domain:** the-fashion-company-3.myshopify.com
- **API Version:** 2024-01
- **Cart Permalink Format:** `https://the-fashion-company-3.myshopify.com/cart/{variantId}:{qty},...`

## Files

| File | Description |
|------|-------------|
| `shopify-agent-workflow.json` | n8n workflow JSON — import into n8n |
| `README.md` | This file |
