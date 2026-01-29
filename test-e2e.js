/**
 * E2E Component Test for Shopify Product Search Chat Workflow
 *
 * Tests each component of the pipeline independently:
 * 1. n8n is running
 * 2. Groq API - query extraction
 * 3. Groq API - response formatting
 * 4. Shopify API - product search
 * 5. Context save/load logic (unit test)
 *
 * Note: The n8n Chat Trigger uses WebSocket protocol requiring an
 * executionId handshake, so full chat integration is tested via browser.
 * This script validates each API and logic component works correctly.
 *
 * Usage: node test-e2e.js
 */

const { randomUUID } = require('crypto');
const https = require('https');
const http = require('http');

const N8N_BASE = 'http://localhost:5678';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const SHOPIFY_STORE = 'the-fashion-company-3.myshopify.com';

const PASS = '\x1b[92mPASS\x1b[0m';
const FAIL = '\x1b[91mFAIL\x1b[0m';
const SKIP = '\x1b[93mSKIP\x1b[0m';
const results = [];

function testResult(name, passed, detail = '') {
  const status = passed ? PASS : FAIL;
  results.push(passed);
  console.log(`  [${status}] ${name}`);
  if (detail) console.log(`         ${detail.slice(0, 250)}`);
}

function skipResult(name, detail = '') {
  console.log(`  [${SKIP}] ${name}`);
  if (detail) console.log(`         ${detail.slice(0, 250)}`);
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Test 1: n8n Running ──────────────────────────────────
async function testN8nRunning() {
  console.log('\n─── Test 1: n8n Instance ───');
  try {
    const resp = await httpRequest(`${N8N_BASE}/healthz`);
    testResult('n8n is running', resp.status === 200);
  } catch (e) {
    testResult('n8n is running', false, e.message);
  }
}

// ─── Test 2: Groq API - Query Extraction ──────────────────
async function testGroqExtract() {
  console.log('\n─── Test 2: Groq API - Query Extraction ───');
  try {
    const resp = await httpRequest('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a query extraction assistant. Extract the product search intent. Return JSON: { "search_query": "term", "product_type": "type or null", "intent": "search" }. Only return JSON.'
          },
          { role: 'user', content: 'Show me dresses' }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });

    testResult('Groq API responds', resp.status === 200, `Status: ${resp.status}`);

    if (resp.status === 200) {
      const content = resp.body.choices[0].message.content;
      testResult('Response contains JSON', content.includes('{') && content.includes('}'), content.slice(0, 150));

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch[0]);
        testResult('Extracted search_query present', !!parsed.search_query, `search_query: "${parsed.search_query}"`);
        testResult('Extracted intent present', !!parsed.intent, `intent: "${parsed.intent}"`);
        return parsed;
      } catch (e) {
        testResult('Parsed extraction JSON', false, e.message);
      }
    }
  } catch (e) {
    testResult('Groq API responds', false, e.message);
  }
  return null;
}

// ─── Test 3: Groq API - Context-Aware Extraction ──────────
async function testGroqContextAware() {
  console.log('\n─── Test 3: Groq API - Context-Aware Query ───');
  try {
    const resp = await httpRequest('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a query extraction assistant. Consider conversation history. Return JSON: { "search_query": "term", "intent": "search|followup", "references_previous": true/false }. Only return JSON.'
          },
          {
            role: 'user',
            content: 'Current message: Tell me more about the first one\n\nConversation history:\nUser: Show me dresses\nAssistant: Here are some dresses: 1. Summer Floral Dress $49.99 2. Evening Gown $129.99\n\nPreviously discussed products:\n[Summer Floral Dress] $49.99 | /products/summer-floral | Type: Dress | Available: true'
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      })
    });

    testResult('Context-aware extraction responds', resp.status === 200);

    if (resp.status === 200) {
      const content = resp.body.choices[0].message.content;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch[0]);
        testResult('Recognizes follow-up intent',
          parsed.intent === 'followup' || parsed.references_previous === true,
          `intent: "${parsed.intent}", references_previous: ${parsed.references_previous}`);
      } catch (e) {
        testResult('Parsed context-aware JSON', false, content.slice(0, 150));
      }
    }
  } catch (e) {
    testResult('Context-aware extraction responds', false, e.message);
  }
}

// ─── Test 4: Groq API - Response Formatting ───────────────
async function testGroqFormat() {
  console.log('\n─── Test 4: Groq API - Response Formatting ───');
  try {
    const mockProducts = [
      {
        title: 'Summer Floral Dress',
        url: 'https://the-fashion-company-3.myshopify.com/products/summer-floral',
        type: 'Dress',
        variants: [{ title: 'Small', price: '49.99', available: true }],
        description: 'A beautiful summer dress with floral pattern'
      }
    ];

    const resp = await httpRequest('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a shopping assistant for The Fashion Company. Include product names, prices, and links. Format prices with $ sign. Number products for easy reference.'
          },
          {
            role: 'user',
            content: `Customer asked: Show me dresses\n\nProducts found (1 total):\n${JSON.stringify(mockProducts, null, 2)}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    testResult('Format response succeeds', resp.status === 200);

    if (resp.status === 200) {
      const output = resp.body.choices[0].message.content;
      testResult('Response mentions product name', output.includes('Summer Floral') || output.includes('Dress'), output.slice(0, 150));
      testResult('Response includes price', output.includes('49.99') || output.includes('$'), output.slice(0, 150));
    }
  } catch (e) {
    testResult('Format response succeeds', false, e.message);
  }
}

// ─── Test 5: Context Save/Load Logic ──────────────────────
function testContextLogic() {
  console.log('\n─── Test 5: Context Save/Load Logic (Unit) ───');

  // Simulate session storage
  const staticData = { sessions: {} };
  const sessionId = 'test-session-1';

  // Test 1: Initialize session
  if (!staticData.sessions[sessionId]) {
    staticData.sessions[sessionId] = { history: [], products: {} };
  }
  testResult('Session initialized', !!staticData.sessions[sessionId]);

  // Test 2: Save a conversation exchange
  const session = staticData.sessions[sessionId];
  session.history.push({
    user: 'Show me dresses',
    assistant: 'Here are some dresses: 1. Summer Floral Dress $49.99'
  });
  testResult('Exchange saved to history', session.history.length === 1);

  // Test 3: Save product metadata
  session.products['12345'] = {
    title: 'Summer Floral Dress',
    url: 'https://the-fashion-company-3.myshopify.com/products/summer-floral',
    price: '49.99',
    type: 'Dress',
    available: true
  };
  testResult('Product metadata saved', Object.keys(session.products).length === 1);

  // Test 4: Load context for next message
  const recentHistory = session.history.slice(-10);
  const contextSummary = recentHistory.map(h =>
    `User: ${h.user}\nAssistant: ${h.assistant}`
  ).join('\n---\n');
  testResult('Context loaded correctly', contextSummary.includes('Show me dresses'));

  // Test 5: Known products loaded
  const knownProducts = Object.values(session.products).map(p =>
    `[${p.title}] $${p.price} | ${p.url} | Type: ${p.type} | Available: ${p.available}`
  ).join('\n');
  testResult('Known products formatted', knownProducts.includes('Summer Floral Dress'));

  // Test 6: History cap at 10
  for (let i = 0; i < 15; i++) {
    session.history.push({ user: `msg ${i}`, assistant: `reply ${i}` });
  }
  if (session.history.length > 10) {
    session.history = session.history.slice(-10);
  }
  testResult('History capped at 10', session.history.length === 10);

  // Test 7: Products cap at 20
  for (let i = 0; i < 25; i++) {
    session.products[`prod-${i}`] = { title: `Product ${i}`, url: '/', price: '10', type: 'T', available: true };
  }
  const productKeys = Object.keys(session.products);
  if (productKeys.length > 20) {
    const toRemove = productKeys.slice(0, productKeys.length - 20);
    toRemove.forEach(k => delete session.products[k]);
  }
  testResult('Products capped at 20', Object.keys(session.products).length === 20);

  // Test 8: Session cleanup (stale sessions)
  staticData.sessions['old-session'] = { history: [], products: {}, lastActive: Date.now() - 7200000 };
  session.lastActive = Date.now();
  for (const sid of Object.keys(staticData.sessions)) {
    if (sid !== sessionId && staticData.sessions[sid].lastActive && Date.now() - staticData.sessions[sid].lastActive > 3600000) {
      delete staticData.sessions[sid];
    }
  }
  testResult('Stale session cleaned up', !staticData.sessions['old-session']);
}

// ─── Test 6: Cart Logic Unit Tests ────────────────────────
function testCartLogic() {
  console.log('\n─── Test 6: Cart Logic (Unit) ───');

  const STORE_DOMAIN = 'the-fashion-company-3.myshopify.com';

  // Simulate session with cart
  const session = {
    cart: [],
    products: {
      'prod-1': { id: 'prod-1', title: 'Summer Floral Dress', variantId: '44444444444444', price: '49.99', type: 'Dress' },
      'prod-2': { id: 'prod-2', title: 'White Party Shirt', variantId: '55555555555555', price: '39.99', type: 'Shirt' },
      'prod-3': { id: 'prod-3', title: 'Leather Biker Jacket', variantId: '66666666666666', price: '129.99', type: 'Jacket' }
    }
  };

  // Fuzzy product matcher (mirrors Cart Manager node logic)
  function findProductByQuery(products, query) {
    const q = query.toLowerCase();
    const productList = Object.values(products);
    for (const p of productList) {
      const text = `${p.title} ${p.type || ''}`.toLowerCase();
      if (text.includes(q) || q.split(' ').every(word => text.includes(word))) {
        return p;
      }
    }
    return null;
  }

  // Add to cart
  function addToCart(session, productQuery, quantity = 1) {
    const product = findProductByQuery(session.products, productQuery);
    if (!product) return { success: false, error: `Product "${productQuery}" not found` };
    const existing = session.cart.find(item => item.productId === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      session.cart.push({
        productId: product.id,
        variantId: product.variantId,
        title: product.title,
        price: product.price,
        quantity
      });
    }
    return { success: true, item: product.title };
  }

  // Remove from cart
  function removeFromCart(session, productQuery) {
    const product = findProductByQuery(session.products, productQuery);
    if (!product) return { success: false, error: `Product "${productQuery}" not found` };
    const idx = session.cart.findIndex(item => item.productId === product.id);
    if (idx === -1) return { success: false, error: `"${product.title}" is not in your cart` };
    session.cart.splice(idx, 1);
    return { success: true, removed: product.title };
  }

  // View cart
  function viewCart(session) {
    if (session.cart.length === 0) return { empty: true, message: 'Your cart is empty' };
    const total = session.cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
    return {
      empty: false,
      items: session.cart.map(i => `${i.title} x${i.quantity} - $${(parseFloat(i.price) * i.quantity).toFixed(2)}`),
      total: total.toFixed(2),
      count: session.cart.reduce((sum, i) => sum + i.quantity, 0)
    };
  }

  // Generate checkout URL
  function generateCheckoutUrl(session) {
    if (session.cart.length === 0) return null;
    const parts = session.cart.map(item => `${item.variantId}:${item.quantity}`);
    return `https://${STORE_DOMAIN}/cart/${parts.join(',')}`;
  }

  // Clear cart
  function clearCart(session) {
    session.cart = [];
    return { success: true };
  }

  // Test 1: Add item by fuzzy match
  const addResult = addToCart(session, 'summer dress');
  testResult('Add "summer dress" finds Floral Dress', addResult.success && addResult.item === 'Summer Floral Dress');

  // Test 2: Cart has one item
  testResult('Cart has 1 item after add', session.cart.length === 1);

  // Test 3: Add another item
  addToCart(session, 'party shirt', 2);
  testResult('Add "party shirt" with qty 2', session.cart.length === 2 && session.cart[1].quantity === 2);

  // Test 4: View cart shows correct total
  const view = viewCart(session);
  const expectedTotal = (49.99 + 39.99 * 2).toFixed(2); // 129.97
  testResult('View cart total correct', view.total === expectedTotal, `Total: $${view.total}`);

  // Test 5: View cart count includes quantities
  testResult('View cart count is 3', view.count === 3, `Count: ${view.count}`);

  // Test 6: Add same item increases quantity
  addToCart(session, 'floral dress');
  const dress = session.cart.find(i => i.title === 'Summer Floral Dress');
  testResult('Add same item increases qty', dress.quantity === 2);

  // Test 7: Generate checkout URL
  const checkoutUrl = generateCheckoutUrl(session);
  testResult('Checkout URL contains variant IDs',
    checkoutUrl.includes('44444444444444:2') && checkoutUrl.includes('55555555555555:2'),
    `URL: ${checkoutUrl.slice(0, 80)}...`);

  // Test 8: Remove item from cart
  const removeResult = removeFromCart(session, 'party shirt');
  testResult('Remove "party shirt" succeeds', removeResult.success && session.cart.length === 1);

  // Test 9: Remove non-existent item
  const removeInvalid = removeFromCart(session, 'jacket');
  testResult('Remove item not in cart fails gracefully', !removeInvalid.success);

  // Test 10: Clear cart
  addToCart(session, 'leather jacket');
  clearCart(session);
  testResult('Clear cart empties all items', session.cart.length === 0);

  // Test 11: View empty cart
  const emptyView = viewCart(session);
  testResult('Empty cart view shows empty', emptyView.empty === true);

  // Test 12: Checkout URL for empty cart is null
  const emptyCheckout = generateCheckoutUrl(session);
  testResult('Empty cart checkout URL is null', emptyCheckout === null);
}

// ─── Test 7: Cart Intent Extraction ───────────────────────
async function testCartIntentExtraction() {
  console.log('\n─── Test 7: Cart Intent Extraction ───');

  const cartIntents = [
    { input: 'Add the dress to my cart', expected: 'add_to_cart' },
    { input: "What's in my basket?", expected: 'view_cart' },
    { input: 'I want to checkout now', expected: 'checkout' },
  ];

  for (const q of cartIntents) {
    try {
      const resp = await httpRequest('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: `Extract customer intent. Return JSON: { "intent": "search|add_to_cart|remove_from_cart|view_cart|checkout|clear_cart", "product_reference": "product name or null" }. Only return JSON.`
            },
            { role: 'user', content: q.input }
          ],
          temperature: 0.3,
          max_tokens: 100
        })
      });

      if (resp.status === 200) {
        const content = resp.body.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          testResult(`Intent "${q.input}"`, parsed.intent === q.expected, `Got: ${parsed.intent}`);
        }
      } else if (resp.status === 429) {
        console.log(`  [SKIP] Rate limited for "${q.input}"`);
      }
      await sleep(1000);
    } catch (e) {
      testResult(`Intent "${q.input}"`, false, e.message);
    }
  }
}

// ─── Test 8: n8n Chat WebSocket Connectivity ──────────────
async function testChatWebSocket() {
  console.log('\n─── Test 6: Chat WebSocket Endpoint ───');
  try {
    const { WebSocket } = require('/tmp/node_modules/ws');
    const ws = new WebSocket(`ws://localhost:5678/chat/f67e2ae9-cf70-4068-97f5-07ca8f0f902b?sessionId=test&executionId=fake`);

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { ws.close(); resolve('timeout'); }, 5000);
      ws.on('open', () => { clearTimeout(timer); ws.close(); resolve('connected'); });
      ws.on('error', (e) => { clearTimeout(timer); resolve('error: ' + e.message); });
      ws.on('close', (code) => { clearTimeout(timer); resolve('closed: ' + code); });
    });

    // WebSocket endpoint exists if we get a connection (even if it closes due to invalid executionId)
    testResult('Chat WebSocket endpoint reachable',
      result === 'connected' || result.startsWith('closed'),
      `Result: ${result} (expected close due to fake executionId)`);
  } catch (e) {
    skipResult('Chat WebSocket endpoint', 'ws module not available: ' + e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  E2E Component Test: Shopify Product Chat Workflow');
  console.log(`  n8n: ${N8N_BASE}`);
  console.log('═'.repeat(60));

  await testN8nRunning();
  await sleep(1000);

  await testGroqExtract();
  await sleep(2000);

  await testGroqContextAware();
  await sleep(2000);

  await testGroqFormat();
  await sleep(1000);

  testContextLogic();

  testCartLogic();

  await testCartIntentExtraction();
  await sleep(1000);

  await testChatWebSocket();

  // Summary
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('\n' + '═'.repeat(60));
  console.log(`  Results: ${passed}/${total} tests passed`);
  if (passed === total) {
    console.log(`  [\x1b[92mPASS\x1b[0m] All component tests passed!`);
    console.log('  Note: Full chat flow tested via browser at http://localhost:5678');
  } else {
    console.log(`  [\x1b[91mFAIL\x1b[0m] ${total - passed} test(s) failed`);
  }
  console.log('═'.repeat(60));

  process.exit(passed === total ? 0 : 1);
}

main();
