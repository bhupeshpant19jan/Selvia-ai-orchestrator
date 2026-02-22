/**
 * Cart & Checkout Latency Test
 *
 * Tests the latency of cart-related operations:
 * 1. Groq intent extraction for cart operations
 * 2. Cart permalink URL generation (local, instant)
 * 3. Shopify cart permalink validation (HTTP HEAD to check URL accessibility)
 *
 * Similar to test-shopify-stress.js but focused on cart/checkout flow.
 *
 * Usage: node test-cart-latency.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'the-fashion-company-3.myshopify.com';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const RESULTS_FILE = path.join(__dirname, 'cart-latency-results.json');

const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[92m';
const YELLOW = '\x1b[93m';
const RED = '\x1b[91m';
const CYAN = '\x1b[96m';

// ─── Test queries for cart intents ───────────────────────
const CART_QUERIES = [
  // Add to cart variations (10)
  { input: 'Add the dress to my cart', intent: 'add_to_cart', group: 'add' },
  { input: 'Put the jacket in my basket', intent: 'add_to_cart', group: 'add' },
  { input: 'I want to buy the shirt', intent: 'add_to_cart', group: 'add' },
  { input: 'Add 2 of those jeans please', intent: 'add_to_cart', group: 'add' },
  { input: 'Can you add the summer dress?', intent: 'add_to_cart', group: 'add' },
  { input: 'I\'ll take the leather jacket', intent: 'add_to_cart', group: 'add' },
  { input: 'Add it to cart', intent: 'add_to_cart', group: 'add' },
  { input: 'Put that one in my bag', intent: 'add_to_cart', group: 'add' },
  { input: 'Add the first one to my cart', intent: 'add_to_cart', group: 'add' },
  { input: 'I want the white party shirt', intent: 'add_to_cart', group: 'add' },

  // View cart variations (5)
  { input: 'What\'s in my cart?', intent: 'view_cart', group: 'view' },
  { input: 'Show me my basket', intent: 'view_cart', group: 'view' },
  { input: 'What have I added?', intent: 'view_cart', group: 'view' },
  { input: 'View my cart please', intent: 'view_cart', group: 'view' },
  { input: 'How many items in my bag?', intent: 'view_cart', group: 'view' },

  // Checkout variations (10)
  { input: 'I want to checkout', intent: 'checkout', group: 'checkout' },
  { input: 'Take me to checkout', intent: 'checkout', group: 'checkout' },
  { input: 'Ready to pay', intent: 'checkout', group: 'checkout' },
  { input: 'Let me buy these items', intent: 'checkout', group: 'checkout' },
  { input: 'Proceed to payment', intent: 'checkout', group: 'checkout' },
  { input: 'I\'m done shopping, checkout please', intent: 'checkout', group: 'checkout' },
  { input: 'Complete my order', intent: 'checkout', group: 'checkout' },
  { input: 'Time to pay', intent: 'checkout', group: 'checkout' },
  { input: 'Buy now', intent: 'checkout', group: 'checkout' },
  { input: 'Finish my purchase', intent: 'checkout', group: 'checkout' },

  // Remove from cart variations (5)
  { input: 'Remove the dress from my cart', intent: 'remove_from_cart', group: 'remove' },
  { input: 'Take out the jacket', intent: 'remove_from_cart', group: 'remove' },
  { input: 'Delete the shirt from my basket', intent: 'remove_from_cart', group: 'remove' },
  { input: 'I don\'t want the jeans anymore', intent: 'remove_from_cart', group: 'remove' },
  { input: 'Remove that item', intent: 'remove_from_cart', group: 'remove' },

  // Clear cart variations (5)
  { input: 'Clear my cart', intent: 'clear_cart', group: 'clear' },
  { input: 'Empty my basket', intent: 'clear_cart', group: 'clear' },
  { input: 'Remove everything', intent: 'clear_cart', group: 'clear' },
  { input: 'Start over', intent: 'clear_cart', group: 'clear' },
  { input: 'Delete all items from cart', intent: 'clear_cart', group: 'clear' },
];

// ─── HTTPS request with timing ───────────────────────────
function timedHttpsRequest(url, options = {}) {
  return new Promise((resolve) => {
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
          resolve({ status: res.statusCode, body: JSON.parse(data), elapsed, error: null });
        } catch {
          resolve({ status: res.statusCode, body: data, elapsed, error: null });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ status: 0, body: null, elapsed: Date.now() - startTime, error: e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: null, elapsed: Date.now() - startTime, error: 'Timeout' });
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Progress bar ────────────────────────────────────────
function progressBar(current, total, width = 30) {
  const pct = current / total;
  const filled = Math.round(width * pct);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

// ─── Percentile helper ───────────────────────────────────
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Sleep helper ────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main test runner ────────────────────────────────────
async function main() {
  console.log('='.repeat(64));
  console.log(`  ${BOLD}Cart & Checkout Latency Test${RESET}`);
  console.log(`  Store: ${SHOPIFY_STORE}`);
  console.log(`  Queries: ${CART_QUERIES.length}`);
  console.log(`  Output: ${RESULTS_FILE}`);
  console.log('='.repeat(64));
  console.log();

  const results = [];
  let rateLimitWaits = 0;

  // ─── Part 1: Groq Intent Extraction Latency ────────────
  console.log(`  ${BOLD}Part 1: Groq Intent Extraction (${CART_QUERIES.length} queries)${RESET}\n`);

  for (let i = 0; i < CART_QUERIES.length; i++) {
    const q = CART_QUERIES[i];
    process.stdout.write(`\r  ${DIM}${progressBar(i + 1, CART_QUERIES.length)}${RESET}  ${q.input.slice(0, 40).padEnd(40)}`);

    const resp = await timedHttpsRequest('https://api.groq.com/openai/v1/chat/completions', {
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
            content: `Extract customer intent for an e-commerce cart. Return JSON only: { "intent": "add_to_cart|remove_from_cart|view_cart|checkout|clear_cart|search", "product_reference": "product name or null" }`
          },
          { role: 'user', content: q.input }
        ],
        temperature: 0.3,
        max_tokens: 100
      })
    });

    let extractedIntent = null;
    let intentCorrect = false;

    if (resp.status === 200 && resp.body?.choices?.[0]?.message?.content) {
      const content = resp.body.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          extractedIntent = parsed.intent;
          intentCorrect = extractedIntent === q.intent;
        } catch {}
      }
    } else if (resp.status === 429) {
      // Rate limited - wait and retry
      rateLimitWaits++;
      console.log(`\n  ${YELLOW}Rate limited - waiting 60s...${RESET}`);
      await sleep(60000);
      i--; // Retry this query
      continue;
    }

    results.push({
      index: i + 1,
      group: q.group,
      input: q.input,
      expectedIntent: q.intent,
      extractedIntent,
      intentCorrect,
      latencyMs: resp.elapsed,
      status: resp.status,
      error: resp.error
    });

    // Rate limit spacing
    await sleep(300);
  }

  process.stdout.write('\r' + ' '.repeat(100) + '\r');

  // ─── Part 2: Cart URL Generation (Local) ───────────────
  console.log(`\n  ${BOLD}Part 2: Cart URL Generation (local, 20 tests)${RESET}\n`);

  const urlGenResults = [];
  for (let i = 0; i < 20; i++) {
    const cart = [];
    const numItems = Math.floor(Math.random() * 5) + 1;
    for (let j = 0; j < numItems; j++) {
      cart.push({
        variantId: String(Math.floor(Math.random() * 99999999999999)),
        quantity: Math.floor(Math.random() * 3) + 1
      });
    }

    const start = Date.now();
    const parts = cart.map(item => `${item.variantId}:${item.quantity}`);
    const url = `https://${SHOPIFY_STORE}/cart/${parts.join(',')}`;
    const elapsed = Date.now() - start;

    urlGenResults.push({
      items: numItems,
      latencyMs: elapsed,
      urlLength: url.length
    });
  }

  // ─── Part 3: Cart Permalink Accessibility ──────────────
  console.log(`  ${BOLD}Part 3: Cart Permalink HTTP Check (5 tests)${RESET}\n`);

  const permalinkResults = [];
  const testVariantIds = ['44444444444444', '55555555555555', '66666666666666'];

  for (let i = 0; i < 5; i++) {
    const variant = testVariantIds[i % testVariantIds.length];
    const url = `https://${SHOPIFY_STORE}/cart/${variant}:1`;

    process.stdout.write(`\r  ${DIM}Testing: ${url.slice(0, 60)}...${RESET}`);

    const resp = await timedHttpsRequest(url, { method: 'HEAD' });

    permalinkResults.push({
      url,
      status: resp.status,
      latencyMs: resp.elapsed,
      // 302 redirect to checkout is expected behavior
      success: resp.status === 200 || resp.status === 302 || resp.status === 301
    });

    await sleep(200);
  }

  process.stdout.write('\r' + ' '.repeat(100) + '\r');

  // ─── Compute Statistics ────────────────────────────────
  const groqLatencies = results.map(r => r.latencyMs);
  const successResults = results.filter(r => r.status === 200);
  const correctIntents = results.filter(r => r.intentCorrect);

  const stats = {
    groq: {
      totalQueries: results.length,
      successCount: successResults.length,
      correctIntents: correctIntents.length,
      accuracyPct: ((correctIntents.length / results.length) * 100).toFixed(1),
      latency: {
        min: Math.min(...groqLatencies),
        max: Math.max(...groqLatencies),
        avg: Math.round(groqLatencies.reduce((a, b) => a + b, 0) / groqLatencies.length),
        median: percentile(groqLatencies, 50),
        p90: percentile(groqLatencies, 90),
        p95: percentile(groqLatencies, 95),
        p99: percentile(groqLatencies, 99)
      },
      byGroup: {}
    },
    urlGeneration: {
      count: urlGenResults.length,
      avgLatencyMs: urlGenResults.reduce((a, b) => a + b.latencyMs, 0) / urlGenResults.length,
      avgUrlLength: Math.round(urlGenResults.reduce((a, b) => a + b.urlLength, 0) / urlGenResults.length)
    },
    permalink: {
      count: permalinkResults.length,
      successCount: permalinkResults.filter(r => r.success).length,
      avgLatencyMs: Math.round(permalinkResults.reduce((a, b) => a + b.latencyMs, 0) / permalinkResults.length)
    },
    rateLimitWaits
  };

  // Group statistics
  const groups = ['add', 'view', 'checkout', 'remove', 'clear'];
  for (const group of groups) {
    const groupResults = results.filter(r => r.group === group);
    const groupLatencies = groupResults.map(r => r.latencyMs);
    stats.groq.byGroup[group] = {
      count: groupResults.length,
      correct: groupResults.filter(r => r.intentCorrect).length,
      avgLatencyMs: Math.round(groupLatencies.reduce((a, b) => a + b, 0) / groupLatencies.length)
    };
  }

  // ─── Print Results ─────────────────────────────────────
  console.log('\n' + '='.repeat(64));
  console.log(`  ${BOLD}Results Summary${RESET}`);
  console.log('='.repeat(64));

  console.log(`\n  ${BOLD}Groq Intent Extraction:${RESET}`);
  console.log(`  Total queries:     ${stats.groq.totalQueries}`);
  console.log(`  Successful:        ${GREEN}${stats.groq.successCount}${RESET}`);
  console.log(`  Correct intents:   ${GREEN}${stats.groq.correctIntents}${RESET} (${stats.groq.accuracyPct}%)`);
  if (rateLimitWaits > 0) {
    console.log(`  Rate limit waits:  ${YELLOW}${rateLimitWaits}${RESET}`);
  }

  console.log(`\n  ${BOLD}Latency Statistics:${RESET}`);
  console.log(`  Min:      ${GREEN}${stats.groq.latency.min}ms${RESET}`);
  console.log(`  Max:      ${RED}${stats.groq.latency.max}ms${RESET}`);
  console.log(`  Average:  ${CYAN}${stats.groq.latency.avg}ms${RESET}`);
  console.log(`  Median:   ${CYAN}${stats.groq.latency.median}ms${RESET}`);
  console.log(`  P90:      ${YELLOW}${stats.groq.latency.p90}ms${RESET}`);
  console.log(`  P95:      ${YELLOW}${stats.groq.latency.p95}ms${RESET}`);
  console.log(`  P99:      ${RED}${stats.groq.latency.p99}ms${RESET}`);

  console.log(`\n  ${BOLD}By Intent Group:${RESET}`);
  for (const group of groups) {
    const g = stats.groq.byGroup[group];
    const color = g.correct === g.count ? GREEN : YELLOW;
    console.log(`  ${group.padEnd(10)} ${color}${g.correct}/${g.count} correct${RESET}  avg: ${g.avgLatencyMs}ms`);
  }

  console.log(`\n  ${BOLD}Cart URL Generation:${RESET}`);
  console.log(`  Tests:             ${urlGenResults.length}`);
  console.log(`  Avg latency:       ${GREEN}${stats.urlGeneration.avgLatencyMs.toFixed(2)}ms${RESET} (local computation)`);
  console.log(`  Avg URL length:    ${stats.urlGeneration.avgUrlLength} chars`);

  console.log(`\n  ${BOLD}Permalink Accessibility:${RESET}`);
  console.log(`  Tests:             ${stats.permalink.count}`);
  console.log(`  Successful:        ${stats.permalink.successCount === stats.permalink.count ? GREEN : RED}${stats.permalink.successCount}${RESET}`);
  console.log(`  Avg latency:       ${stats.permalink.avgLatencyMs}ms`);

  // ─── Print per-query results table ─────────────────────
  console.log(`\n  ${BOLD}Per-Query Results:${RESET}`);
  console.log(`  ${'#'.padStart(3)}  ${'Latency'.padStart(8)}  ${'Intent'.padEnd(15)}  ${'✓'.padStart(3)}  Input`);
  console.log('  ' + '-'.repeat(75));

  for (const r of results) {
    const color = r.latencyMs < 500 ? GREEN : r.latencyMs < 1000 ? YELLOW : RED;
    const checkMark = r.intentCorrect ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(
      `  ${String(r.index).padStart(3)}  ${color}${String(r.latencyMs + 'ms').padStart(8)}${RESET}` +
      `  ${(r.extractedIntent || 'null').padEnd(15)}` +
      `  ${checkMark}  ${DIM}${r.input.slice(0, 40)}${RESET}`
    );
  }

  console.log('\n' + '='.repeat(64));

  // ─── Write results to file ─────────────────────────────
  const output = {
    timestamp: new Date().toISOString(),
    store: SHOPIFY_STORE,
    statistics: stats,
    groqResults: results,
    urlGenerationResults: urlGenResults,
    permalinkResults
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  console.log(`  ${GREEN}Results written to:${RESET} ${RESULTS_FILE}`);
  console.log('='.repeat(64));
}

main().catch(e => {
  console.error('Cart latency test failed:', e);
  process.exit(1);
});
