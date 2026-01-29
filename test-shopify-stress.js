/**
 * Shopify API Stress / Latency Test
 *
 * Makes 50 GET requests to Shopify storefront APIs with varied query
 * parameters (same data scope) and records per-call latency.
 * Results are written to shopify-stress-results.json.
 *
 * Uses the public storefront JSON endpoints (no admin OAuth needed).
 *
 * Usage: node test-shopify-stress.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SHOPIFY_STORE = 'the-fashion-company-3.myshopify.com';
const TOTAL_CALLS = 50;
const RESULTS_FILE = path.join(__dirname, 'shopify-stress-results.json');

const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[92m';
const YELLOW = '\x1b[93m';
const RED = '\x1b[91m';
const CYAN = '\x1b[96m';

// ─── Build 50 varied query URLs (same data scope) ───────
// Uses /search/suggest.json (publicly accessible, no auth needed)
// and /search?q=... for product search queries.
function buildQueryUrls() {
  const urls = [];

  // Group 1: Search suggest with single product keywords (10 calls)
  const singleTerms = [
    'shirt', 'dress', 'jacket', 'jeans', 'pants',
    'shoes', 'hat', 'belt', 'scarf', 'bag'
  ];
  for (const term of singleTerms) {
    urls.push({
      label: `search/suggest?q=${term} [product]`,
      path: `/search/suggest.json?q=${term}&resources[type]=product`
    });
  }

  // Group 2: Search suggest with style/occasion keywords (10 calls)
  const styleTerms = [
    'party', 'formal', 'casual', 'summer', 'winter',
    'elegant', 'sporty', 'classic', 'modern', 'vintage'
  ];
  for (const term of styleTerms) {
    urls.push({
      label: `search/suggest?q=${term} [product]`,
      path: `/search/suggest.json?q=${term}&resources[type]=product`
    });
  }

  // Group 3: Search suggest with color keywords (10 calls)
  const colors = [
    'white', 'black', 'red', 'blue', 'green',
    'pink', 'brown', 'grey', 'navy', 'beige'
  ];
  for (const c of colors) {
    urls.push({
      label: `search/suggest?q=${c} [product]`,
      path: `/search/suggest.json?q=${c}&resources[type]=product`
    });
  }

  // Group 4: Search suggest with material keywords (10 calls)
  const materials = [
    'cotton', 'leather', 'silk', 'denim', 'wool',
    'linen', 'polyester', 'suede', 'velvet', 'satin'
  ];
  for (const m of materials) {
    urls.push({
      label: `search/suggest?q=${m} [product]`,
      path: `/search/suggest.json?q=${m}&resources[type]=product`
    });
  }

  // Group 5: Multi-word search queries (10 calls)
  const multiWord = [
    'white shirt', 'summer dress', 'leather jacket',
    'party wear', 'cotton shirt', 'formal pants',
    'blue jeans', 'black shoes', 'red dress', 'silk scarf'
  ];
  for (const mw of multiWord) {
    urls.push({
      label: `search/suggest?q=${mw} [product]`,
      path: `/search/suggest.json?q=${encodeURIComponent(mw)}&resources[type]=product`
    });
  }

  return urls.slice(0, TOTAL_CALLS);
}

// ─── HTTPS GET with timing ──────────────────────────────
function timedGet(urlPath) {
  return new Promise((resolve) => {
    const url = `https://${SHOPIFY_STORE}${urlPath}`;
    const startTime = Date.now();

    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        let bodySize = Buffer.byteLength(data);
        let productCount = 0;
        try {
          const parsed = JSON.parse(data);
          if (parsed.products) productCount = parsed.products.length;
          else if (parsed.resources && parsed.resources.results && parsed.resources.results.products)
            productCount = parsed.resources.results.products.length;
        } catch {}
        resolve({
          status: res.statusCode,
          elapsed,
          bodySize,
          productCount,
          error: null
        });
      });
    });

    req.on('error', (e) => {
      resolve({ status: 0, elapsed: Date.now() - startTime, bodySize: 0, productCount: 0, error: e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, elapsed: Date.now() - startTime, bodySize: 0, productCount: 0, error: 'Timeout' });
    });
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
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  const queries = buildQueryUrls();

  console.log('='.repeat(64));
  console.log(`  ${BOLD}Shopify API Stress Test — Latency Evaluation${RESET}`);
  console.log(`  Store: ${SHOPIFY_STORE}`);
  console.log(`  Calls: ${TOTAL_CALLS}`);
  console.log(`  Output: ${RESULTS_FILE}`);
  console.log('='.repeat(64));
  console.log();

  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    process.stdout.write(`\r  ${DIM}${progressBar(i + 1, queries.length)}${RESET}  ${q.label.slice(0, 45).padEnd(45)}`);

    const res = await timedGet(q.path);
    results.push({
      index: i + 1,
      label: q.label,
      path: q.path,
      status: res.status,
      latencyMs: res.elapsed,
      bodySizeBytes: res.bodySize,
      productCount: res.productCount,
      error: res.error
    });

    // Small delay to avoid hammering the server
    await new Promise(r => setTimeout(r, 100));
  }

  process.stdout.write('\r' + ' '.repeat(100) + '\r');

  // ─── Compute statistics ──────────────────────────────
  const latencies = results.map(r => r.latencyMs);
  const successResults = results.filter(r => r.status >= 200 && r.status < 400);
  const failedResults = results.filter(r => r.status === 0 || r.status >= 400);
  const successLatencies = successResults.map(r => r.latencyMs);

  const stats = {
    totalCalls: results.length,
    successCount: successResults.length,
    failedCount: failedResults.length,
    latency: {
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      median: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      totalMs: latencies.reduce((a, b) => a + b, 0)
    },
    buckets: {
      under100ms: latencies.filter(l => l < 100).length,
      '100_300ms': latencies.filter(l => l >= 100 && l < 300).length,
      '300_500ms': latencies.filter(l => l >= 300 && l < 500).length,
      '500_1000ms': latencies.filter(l => l >= 500 && l < 1000).length,
      '1000_2000ms': latencies.filter(l => l >= 1000 && l < 2000).length,
      over2000ms: latencies.filter(l => l >= 2000).length,
    }
  };

  // ─── Print per-call results ──────────────────────────
  console.log(`\n  ${BOLD}Per-Call Results:${RESET}`);
  console.log(`  ${'#'.padStart(3)}  ${'Latency'.padStart(8)}  ${'Status'.padStart(6)}  ${'Size'.padStart(8)}  ${'Products'.padStart(8)}  Endpoint`);
  console.log('  ' + '-'.repeat(80));

  for (const r of results) {
    const color = r.latencyMs < 300 ? GREEN : r.latencyMs < 1000 ? YELLOW : RED;
    const statusColor = (r.status >= 200 && r.status < 400) ? GREEN : RED;
    const sizeKb = (r.bodySizeBytes / 1024).toFixed(1) + 'KB';
    console.log(
      `  ${String(r.index).padStart(3)}  ${color}${String(r.latencyMs + 'ms').padStart(8)}${RESET}` +
      `  ${statusColor}${String(r.status).padStart(6)}${RESET}` +
      `  ${String(sizeKb).padStart(8)}` +
      `  ${String(r.productCount).padStart(8)}` +
      `  ${DIM}${r.label.slice(0, 50)}${RESET}`
    );
  }

  // ─── Print statistics ────────────────────────────────
  console.log('\n' + '='.repeat(64));
  console.log(`  ${BOLD}Latency Statistics${RESET}`);
  console.log('  ' + '-'.repeat(60));
  console.log(`  Total calls:   ${stats.totalCalls}`);
  console.log(`  Successful:    ${GREEN}${stats.successCount}${RESET}`);
  if (stats.failedCount > 0) {
    console.log(`  Failed:        ${RED}${stats.failedCount}${RESET}`);
  }
  console.log();
  console.log(`  ${BOLD}Min:${RESET}       ${GREEN}${stats.latency.min}ms${RESET}`);
  console.log(`  ${BOLD}Max:${RESET}       ${RED}${stats.latency.max}ms${RESET}`);
  console.log(`  ${BOLD}Average:${RESET}   ${CYAN}${stats.latency.avg}ms${RESET}`);
  console.log(`  ${BOLD}Median:${RESET}    ${CYAN}${stats.latency.median}ms${RESET}`);
  console.log(`  ${BOLD}P90:${RESET}       ${YELLOW}${stats.latency.p90}ms${RESET}`);
  console.log(`  ${BOLD}P95:${RESET}       ${YELLOW}${stats.latency.p95}ms${RESET}`);
  console.log(`  ${BOLD}P99:${RESET}       ${RED}${stats.latency.p99}ms${RESET}`);
  console.log(`  ${BOLD}Total:${RESET}     ${stats.latency.totalMs}ms`);

  // ─── Latency distribution histogram ──────────────────
  console.log(`\n  ${BOLD}Latency Distribution:${RESET}`);
  const bucketLabels = [
    ['< 100ms', stats.buckets.under100ms],
    ['100-300ms', stats.buckets['100_300ms']],
    ['300-500ms', stats.buckets['300_500ms']],
    ['500ms-1s', stats.buckets['500_1000ms']],
    ['1s-2s', stats.buckets['1000_2000ms']],
    ['> 2s', stats.buckets.over2000ms],
  ];
  const maxBucket = Math.max(...bucketLabels.map(b => b[1]));
  for (const [label, count] of bucketLabels) {
    const barLen = maxBucket > 0 ? Math.round((count / maxBucket) * 30) : 0;
    const color = label.includes('< 100') || label.includes('100-300') ? GREEN
      : label.includes('300-500') || label.includes('500') ? YELLOW : RED;
    console.log(`  ${label.padStart(10)}  ${color}${'█'.repeat(barLen)}${RESET} ${count}`);
  }

  // ─── Slowest 5 calls ────────────────────────────────
  const sorted = [...results].sort((a, b) => b.latencyMs - a.latencyMs);
  console.log(`\n  ${BOLD}Slowest 5 Calls:${RESET}`);
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const r = sorted[i];
    console.log(`  ${RED}${r.latencyMs}ms${RESET}  ${DIM}${r.label}${RESET}`);
  }

  // ─── Fastest 5 calls ────────────────────────────────
  console.log(`\n  ${BOLD}Fastest 5 Calls:${RESET}`);
  for (let i = sorted.length - 1; i >= Math.max(0, sorted.length - 5); i--) {
    const r = sorted[i];
    console.log(`  ${GREEN}${r.latencyMs}ms${RESET}  ${DIM}${r.label}${RESET}`);
  }

  console.log('\n' + '='.repeat(64));

  // ─── Write results to file ───────────────────────────
  const output = {
    timestamp: new Date().toISOString(),
    store: SHOPIFY_STORE,
    totalCalls: TOTAL_CALLS,
    statistics: stats,
    calls: results
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));
  console.log(`  ${GREEN}Results written to:${RESET} ${RESULTS_FILE}`);
  console.log('='.repeat(64));
}

main().catch(e => {
  console.error('Stress test failed:', e);
  process.exit(1);
});
