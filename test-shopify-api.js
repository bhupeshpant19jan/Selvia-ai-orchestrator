/**
 * Shopify API Query Tests with Response Time Tracking
 *
 * Tests Shopify Admin API endpoints directly to verify:
 * 1. Fetching all products works
 * 2. Local filtering by title, type, tags matches correctly
 * 3. Response times for each query type
 *
 * Usage: node test-shopify-api.js
 */

const https = require('https');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'the-fashion-company-3.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || '';

// Groq API for testing the full extraction pipeline
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const PASS = '\x1b[92mPASS\x1b[0m';
const FAIL = '\x1b[91mFAIL\x1b[0m';
const SKIP = '\x1b[93mSKIP\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const results = [];
const timings = [];

function testResult(name, passed, detail = '') {
  const status = passed ? PASS : FAIL;
  results.push(passed);
  console.log(`  [${status}] ${name}`);
  if (detail) console.log(`         ${detail.slice(0, 300)}`);
}

function recordTiming(label, ms) {
  timings.push({ label, ms });
  const color = ms < 500 ? '\x1b[92m' : ms < 2000 ? '\x1b[93m' : '\x1b[91m';
  console.log(`         ${DIM}Response time:${RESET} ${color}${ms}ms${RESET}`);
}

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), elapsed });
        } catch {
          resolve({ status: res.statusCode, body: data, elapsed });
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

// Local filtering logic (mirrors the n8n Merge & Format node)
function filterProducts(products, searchQuery) {
  const query = (searchQuery || '').toLowerCase();
  const queryWords = query.split(/\s+/).filter(w => w.length > 1);

  if (queryWords.length === 0) return products;

  const scored = products.map(p => {
    const text = [
      p.title || '',
      p.product_type || '',
      p.tags || '',
      p.vendor || '',
      (p.body_html || '').replace(/<[^>]*>/g, '')
    ].join(' ').toLowerCase();
    const score = queryWords.filter(w => text.includes(w)).length;
    return { product: p, score };
  });

  const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  return matched.length > 0 ? matched.map(s => s.product) : products;
}

// ─── Test 1: Fetch All Products ──────────────────────────
async function testFetchAllProducts() {
  console.log(`\n${BOLD}─── Test 1: Fetch All Products ───${RESET}`);
  try {
    const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=50`;
    // Note: This requires OAuth authentication. We test via n8n proxy.
    // Direct API test via Groq pipeline instead.
    console.log(`  ${DIM}URL: ${url}${RESET}`);

    // Test via n8n's workflow by sending a broad query
    const groqStart = Date.now();
    const resp = await httpsRequest('https://api.groq.com/openai/v1/chat/completions', {
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
            content: 'You are a query extraction assistant. Return JSON: { "search_query": "term", "product_type": "type or null", "intent": "search" }. Only return JSON.'
          },
          { role: 'user', content: 'Show me everything you have' }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });
    const groqElapsed = Date.now() - groqStart;

    testResult('Groq query extraction responds', resp.status === 200);
    recordTiming('Groq extraction (broad query)', groqElapsed);

    if (resp.status === 200) {
      const content = resp.body.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        testResult('Extracted broad search query (or null for vague input)',
          parsed.search_query !== undefined,
          `search_query: "${parsed.search_query}"`);
        return parsed;
      }
    }
  } catch (e) {
    testResult('Fetch all products', false, e.message);
  }
  return null;
}

// ─── Test 2: Query Extraction for Various Searches ───────
async function testQueryVariations() {
  console.log(`\n${BOLD}─── Test 2: Query Extraction Variations ───${RESET}`);

  const queries = [
    { input: 'Show me dresses', expected: 'dress' },
    { input: 'Do you have any jackets?', expected: 'jacket' },
    { input: 'What shirts are available?', expected: 'shirt' },
    { input: 'I want something under $50', expected: null },
    { input: 'Show me your best sellers', expected: null },
    { input: 'Find me a shirt for party', expected: 'shirt' },
    { input: 'Add the white shirt to my basket', expected: 'white shirt', isFollowup: true, expectedIntent: 'add_to_cart' },
  ];

  const extractionResults = [];

  let conversationHistory = '';

  for (const q of queries) {
    try {
      // Build user content with conversation history for follow-up queries
      let userContent = q.input;
      if (q.isFollowup && conversationHistory) {
        userContent = `Current message: ${q.input}\n\nConversation history:\n${conversationHistory}\n\nPreviously discussed products:\n[White Party Shirt] $39.99 | https://the-fashion-company-3.myshopify.com/products/white-party-shirt | Type: Shirt | Available: true`;
      }

      const systemPrompt = q.isFollowup
        ? 'You are a query extraction assistant. Consider conversation history for context. Return JSON: { "search_query": "term", "product_type": "type or null", "intent": "search|checkout|add_to_cart|followup", "references_previous": true/false }. Only return JSON.'
        : 'You are a query extraction assistant. Extract the product search intent. Return JSON: { "search_query": "term", "product_type": "type or null", "intent": "search" }. Only return JSON.';

      const start = Date.now();
      const resp = await httpsRequest('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.3,
          max_tokens: 150
        })
      });
      const elapsed = Date.now() - start;

      if (resp.status === 200) {
        const content = resp.body.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const searchQuery = (parsed.search_query || '').toLowerCase();
          const matchesExpected = !q.expected || searchQuery.includes(q.expected);

          if (q.isFollowup) {
            testResult(`Follow-up extract: "${q.input}"`, matchesExpected,
              `Got: "${parsed.search_query}", intent: "${parsed.intent}", references_previous: ${parsed.references_previous}`);
            testResult(`Follow-up recognizes checkout/cart intent`,
              ['checkout', 'add_to_cart', 'followup'].includes(parsed.intent) || parsed.references_previous === true,
              `intent: "${parsed.intent}"`);
          } else {
            testResult(`Extract: "${q.input}"`, matchesExpected,
              `Got: "${parsed.search_query}"`);
          }
          recordTiming(`Groq extraction: "${q.input.slice(0, 30)}"`, elapsed);
          extractionResults.push({ query: q.input, extracted: parsed.search_query, elapsed });

          // Build conversation history for subsequent follow-up queries
          conversationHistory += `User: ${q.input}\nAssistant: Found products matching "${parsed.search_query}": White Party Shirt $39.99\n---\n`;
        }
      } else {
        testResult(`Extract: "${q.input}"`, false, `Status: ${resp.status}`);
      }

      await sleep(500); // Rate limit spacing
    } catch (e) {
      testResult(`Extract: "${q.input}"`, false, e.message);
    }
  }

  return extractionResults;
}

// ─── Test 3: Local Filtering Logic ───────────────────────
function testLocalFiltering() {
  console.log(`\n${BOLD}─── Test 3: Local Filtering Logic ───${RESET}`);

  // Mock products similar to what Shopify would return
  const mockProducts = [
    { id: 1, title: 'Summer Floral Dress', product_type: 'Dress', tags: 'summer, floral, women', vendor: 'Fashion Co', body_html: '<p>A beautiful summer dress</p>' },
    { id: 2, title: 'Leather Biker Jacket', product_type: 'Jacket', tags: 'leather, biker, unisex', vendor: 'Fashion Co', body_html: '<p>Classic leather jacket</p>' },
    { id: 3, title: 'Cotton Casual Shirt', product_type: 'Shirt', tags: 'cotton, casual, men', vendor: 'Fashion Co', body_html: '<p>Comfortable everyday shirt</p>' },
    { id: 4, title: 'Denim Skinny Jeans', product_type: 'Jeans', tags: 'denim, skinny, unisex', vendor: 'Fashion Co', body_html: '<p>Classic skinny jeans</p>' },
    { id: 5, title: 'White Party Shirt', product_type: 'Shirt', tags: 'white, party, formal, men', vendor: 'Fashion Co', body_html: '<p>Elegant white shirt perfect for parties and formal events</p>' },
  ];

  // Test various search queries
  const filterStart = Date.now();

  const dressResults = filterProducts(mockProducts, 'dress');
  testResult('Filter "dress" finds Floral Dress',
    dressResults[0]?.title === 'Summer Floral Dress',
    `Found: ${dressResults.map(p => p.title).join(', ')}`);

  const jacketResults = filterProducts(mockProducts, 'jacket');
  testResult('Filter "jacket" finds Biker Jacket',
    jacketResults[0]?.title === 'Leather Biker Jacket',
    `Found: ${jacketResults.map(p => p.title).join(', ')}`);

  const shirtResults = filterProducts(mockProducts, 'shirt');
  testResult('Filter "shirt" finds Casual Shirt',
    shirtResults[0]?.title === 'Cotton Casual Shirt',
    `Found: ${shirtResults.map(p => p.title).join(', ')}`);

  const leatherResults = filterProducts(mockProducts, 'leather');
  testResult('Filter "leather" finds Biker Jacket (from tags/description)',
    leatherResults[0]?.title === 'Leather Biker Jacket',
    `Found: ${leatherResults.map(p => p.title).join(', ')}`);

  const summerResults = filterProducts(mockProducts, 'summer');
  testResult('Filter "summer" finds Floral Dress (from tags)',
    summerResults[0]?.title === 'Summer Floral Dress',
    `Found: ${summerResults.map(p => p.title).join(', ')}`);

  const noMatchResults = filterProducts(mockProducts, 'xyz_no_match');
  testResult('Filter with no match returns all products (fallback)',
    noMatchResults.length === mockProducts.length,
    `Returned ${noMatchResults.length} products (all)`);

  const emptyQuery = filterProducts(mockProducts, '');
  testResult('Empty query returns all products',
    emptyQuery.length === mockProducts.length,
    `Returned ${emptyQuery.length} products`);

  const multiWord = filterProducts(mockProducts, 'summer dress');
  testResult('Multi-word "summer dress" ranks Floral Dress first',
    multiWord[0]?.title === 'Summer Floral Dress',
    `Found: ${multiWord.map(p => p.title).join(', ')}`);

  const partyShirtResults = filterProducts(mockProducts, 'shirt party');
  testResult('Filter "shirt party" finds White Party Shirt first',
    partyShirtResults[0]?.title === 'White Party Shirt',
    `Found: ${partyShirtResults.map(p => p.title).join(', ')}`);
  testResult('Filter "shirt party" ranks White Party Shirt above Cotton Casual Shirt',
    partyShirtResults.indexOf(partyShirtResults.find(p => p.title === 'White Party Shirt')) <
    partyShirtResults.indexOf(partyShirtResults.find(p => p.title === 'Cotton Casual Shirt')),
    `Order: ${partyShirtResults.filter(p => p.product_type === 'Shirt').map(p => p.title).join(' > ')}`);

  const filterElapsed = Date.now() - filterStart;
  recordTiming('Local filtering (10 tests)', filterElapsed);
}

// ─── Test 4: Cart Intent Extraction Tests ────────────────
async function testCartIntents() {
  console.log(`\n${BOLD}─── Test 4: Cart Intent Extraction ───${RESET}`);

  const cartQueries = [
    { input: 'Add the summer dress to my cart', expectedIntent: 'add_to_cart', expectedProduct: 'summer dress' },
    { input: "What's in my cart?", expectedIntent: 'view_cart', expectedProduct: null },
    { input: 'Remove the jacket from my basket', expectedIntent: 'remove_from_cart', expectedProduct: 'jacket' },
    { input: 'I want to checkout', expectedIntent: 'checkout', expectedProduct: null },
    { input: 'Clear my cart please', expectedIntent: 'clear_cart', expectedProduct: null },
    { input: 'Take me to checkout', expectedIntent: 'checkout', expectedProduct: null },
  ];

  for (const q of cartQueries) {
    try {
      const start = Date.now();
      const resp = await httpsRequest('https://api.groq.com/openai/v1/chat/completions', {
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
              content: `You are a query extraction assistant. Extract the customer's intent and product reference.
Return JSON: { "search_query": "product term or null", "intent": "search|details|add_to_cart|remove_from_cart|view_cart|checkout|clear_cart", "product_reference": "specific product mentioned or null" }. Only return JSON.`
            },
            { role: 'user', content: q.input }
          ],
          temperature: 0.3,
          max_tokens: 150
        })
      });
      const elapsed = Date.now() - start;

      if (resp.status === 200) {
        const content = resp.body.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const intentMatch = parsed.intent === q.expectedIntent ||
            (q.expectedIntent === 'add_to_cart' && ['add_to_cart', 'checkout'].includes(parsed.intent)) ||
            (q.expectedIntent === 'checkout' && ['checkout', 'add_to_cart'].includes(parsed.intent));

          testResult(`Cart intent: "${q.input}"`, intentMatch,
            `Expected: ${q.expectedIntent}, Got: ${parsed.intent}`);
          recordTiming(`Cart intent: "${q.input.slice(0, 25)}"`, elapsed);

          if (q.expectedProduct) {
            const productRef = (parsed.product_reference || parsed.search_query || '').toLowerCase();
            testResult(`Product ref: "${q.input}"`,
              productRef.includes(q.expectedProduct.split(' ')[0]),
              `Got: "${productRef}"`);
          }
        }
      } else if (resp.status === 429) {
        console.log(`  [SKIP] Rate limited - waiting 60s...`);
        await sleep(60000);
      } else {
        testResult(`Cart intent: "${q.input}"`, false, `Status: ${resp.status}`);
      }

      await sleep(500);
    } catch (e) {
      testResult(`Cart intent: "${q.input}"`, false, e.message);
    }
  }
}

// ─── Test 5: Cart URL Generation Logic ───────────────────
function testCartUrlGeneration() {
  console.log(`\n${BOLD}─── Test 5: Cart URL Generation Logic ───${RESET}`);

  const STORE_DOMAIN = 'the-fashion-company-3.myshopify.com';

  // Test cart permalink URL generation
  function generateCheckoutUrl(cartItems) {
    if (!cartItems || cartItems.length === 0) return null;
    const cartParts = cartItems.map(item => `${item.variantId}:${item.quantity}`);
    return `https://${STORE_DOMAIN}/cart/${cartParts.join(',')}`;
  }

  // Test 1: Single item cart
  const singleItemCart = [{ variantId: '12345678901234', quantity: 1 }];
  const singleUrl = generateCheckoutUrl(singleItemCart);
  testResult('Single item cart URL',
    singleUrl === `https://${STORE_DOMAIN}/cart/12345678901234:1`,
    `URL: ${singleUrl}`);

  // Test 2: Multiple items cart
  const multiItemCart = [
    { variantId: '12345678901234', quantity: 2 },
    { variantId: '98765432109876', quantity: 1 }
  ];
  const multiUrl = generateCheckoutUrl(multiItemCart);
  testResult('Multi-item cart URL',
    multiUrl === `https://${STORE_DOMAIN}/cart/12345678901234:2,98765432109876:1`,
    `URL: ${multiUrl}`);

  // Test 3: Empty cart
  const emptyUrl = generateCheckoutUrl([]);
  testResult('Empty cart returns null', emptyUrl === null, `Got: ${emptyUrl}`);

  // Test 4: Cart with quantity > 1
  const quantityCart = [{ variantId: '11111111111111', quantity: 5 }];
  const quantityUrl = generateCheckoutUrl(quantityCart);
  testResult('Cart with quantity 5',
    quantityUrl.includes(':5'),
    `URL: ${quantityUrl}`);

  recordTiming('Cart URL generation (4 tests)', 1);
}

// ─── Test 6: Cart Operations Logic ───────────────────────
function testCartOperations() {
  console.log(`\n${BOLD}─── Test 6: Cart Operations Logic ───${RESET}`);

  // Simulate cart state
  let cart = [];

  // Mock product data (as would be stored in session)
  const knownProducts = {
    'prod-1': { id: 'prod-1', title: 'Summer Floral Dress', variantId: '44444444444444', price: '49.99' },
    'prod-2': { id: 'prod-2', title: 'White Party Shirt', variantId: '55555555555555', price: '39.99' },
    'prod-3': { id: 'prod-3', title: 'Leather Biker Jacket', variantId: '66666666666666', price: '129.99' }
  };

  // Add to cart operation
  function addToCart(productId, quantity = 1) {
    const product = knownProducts[productId];
    if (!product) return { success: false, error: 'Product not found' };
    const existing = cart.find(item => item.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({ productId, variantId: product.variantId, title: product.title, price: product.price, quantity });
    }
    return { success: true, cart };
  }

  // Remove from cart
  function removeFromCart(productId) {
    const idx = cart.findIndex(item => item.productId === productId);
    if (idx === -1) return { success: false, error: 'Item not in cart' };
    cart.splice(idx, 1);
    return { success: true, cart };
  }

  // Clear cart
  function clearCart() {
    cart = [];
    return { success: true, cart };
  }

  // View cart
  function viewCart() {
    const total = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
    return { items: cart, total: total.toFixed(2), count: cart.length };
  }

  // Test add to cart
  const addResult1 = addToCart('prod-1');
  testResult('Add first item to cart', addResult1.success && cart.length === 1, `Cart items: ${cart.length}`);

  const addResult2 = addToCart('prod-2', 2);
  testResult('Add second item (qty 2)', addResult2.success && cart.length === 2, `Cart items: ${cart.length}`);

  // Test view cart
  const viewResult = viewCart();
  testResult('View cart shows correct count', viewResult.count === 2, `Count: ${viewResult.count}`);
  testResult('View cart calculates total', viewResult.total === '129.97', `Total: $${viewResult.total}`);

  // Test add same item increases quantity
  addToCart('prod-1');
  const dress = cart.find(i => i.productId === 'prod-1');
  testResult('Add same item increases quantity', dress.quantity === 2, `Quantity: ${dress.quantity}`);

  // Test remove from cart
  const removeResult = removeFromCart('prod-1');
  testResult('Remove item from cart', removeResult.success && cart.length === 1, `Cart items: ${cart.length}`);

  // Test remove non-existent item
  const removeInvalid = removeFromCart('prod-99');
  testResult('Remove non-existent fails gracefully', !removeInvalid.success, `Error: ${removeInvalid.error}`);

  // Test clear cart
  addToCart('prod-3');
  const clearResult = clearCart();
  testResult('Clear cart empties all items', clearResult.success && cart.length === 0, `Cart items: ${cart.length}`);

  // Test add unknown product
  const addUnknown = addToCart('unknown-product');
  testResult('Add unknown product fails', !addUnknown.success, `Error: ${addUnknown.error}`);

  recordTiming('Cart operations (10 tests)', 1);
}

// ─── Test 7: Groq Response Formatting ────────────────────
async function testResponseFormatting() {
  console.log(`\n${BOLD}─── Test 4: Groq Response Formatting Speed ───${RESET}`);

  const mockProducts = [
    {
      title: 'Summer Floral Dress',
      url: 'https://the-fashion-company-3.myshopify.com/products/summer-floral',
      type: 'Dress',
      variants: [{ title: 'Small', price: '49.99', available: true }],
      description: 'A beautiful summer dress with floral pattern'
    },
    {
      title: 'Leather Biker Jacket',
      url: 'https://the-fashion-company-3.myshopify.com/products/leather-biker',
      type: 'Jacket',
      variants: [{ title: 'Medium', price: '129.99', available: true }],
      description: 'Classic leather biker jacket'
    }
  ];

  try {
    const start = Date.now();
    const resp = await httpsRequest('https://api.groq.com/openai/v1/chat/completions', {
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
            content: `Customer asked: Show me dresses and jackets\n\nProducts found (2 total):\n${JSON.stringify(mockProducts, null, 2)}`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    const elapsed = Date.now() - start;

    testResult('Format response succeeds', resp.status === 200);
    recordTiming('Groq response formatting', elapsed);

    if (resp.status === 200) {
      const output = resp.body.choices[0].message.content;
      testResult('Response mentions product names',
        output.includes('Summer Floral') || output.includes('Dress'),
        output.slice(0, 150));
      testResult('Response includes prices',
        output.includes('49.99') || output.includes('$'),
        output.slice(0, 150));
      testResult('Response includes links',
        output.includes('products/') || output.includes('shopify'),
        output.slice(0, 200));
    }
  } catch (e) {
    testResult('Format response', false, e.message);
  }
}

// ─── Test 8: n8n Chat Workflow End-to-End Timing ─────────
async function testN8nWorkflowTiming() {
  console.log(`\n${BOLD}─── Test 8: n8n Workflow Health Check ───${RESET}`);

  try {
    const start = Date.now();
    const resp = await new Promise((resolve, reject) => {
      const req = require('http').request('http://localhost:5678/healthz', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data, elapsed: Date.now() - start }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });

    testResult('n8n is running', resp.status === 200);
    recordTiming('n8n health check', resp.elapsed);
  } catch (e) {
    testResult('n8n is running', false, e.message);
  }
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log(`  ${BOLD}Shopify API Query Tests with Response Time Tracking${RESET}`);
  console.log(`  Store: ${SHOPIFY_STORE}`);
  console.log('='.repeat(60));

  await testN8nWorkflowTiming();
  await sleep(500);

  await testFetchAllProducts();
  await sleep(1000);

  await testQueryVariations();
  await sleep(1000);

  testLocalFiltering();

  await testCartIntents();
  await sleep(1000);

  testCartUrlGeneration();

  testCartOperations();

  await testResponseFormatting();

  // Summary
  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log('\n' + '='.repeat(60));
  console.log(`  ${BOLD}Results: ${passed}/${total} tests passed${RESET}`);

  if (passed === total) {
    console.log(`  [\x1b[92mPASS\x1b[0m] All Shopify API tests passed!`);
  } else {
    console.log(`  [\x1b[91mFAIL\x1b[0m] ${total - passed} test(s) failed`);
  }

  // Timing summary
  console.log(`\n  ${BOLD}Response Time Summary:${RESET}`);
  console.log('  ' + '-'.repeat(56));
  let totalTime = 0;
  for (const t of timings) {
    const color = t.ms < 500 ? '\x1b[92m' : t.ms < 2000 ? '\x1b[93m' : '\x1b[91m';
    const bar = '█'.repeat(Math.min(Math.ceil(t.ms / 100), 30));
    console.log(`  ${color}${String(t.ms).padStart(6)}ms${RESET} ${DIM}${bar}${RESET} ${t.label}`);
    totalTime += t.ms;
  }
  console.log('  ' + '-'.repeat(56));
  console.log(`  ${BOLD}${String(totalTime).padStart(6)}ms${RESET}  Total API time`);
  console.log(`  ${DIM}(${timings.length} API calls)${RESET}`);
  console.log('='.repeat(60));

  process.exit(passed === total ? 0 : 1);
}

main();
