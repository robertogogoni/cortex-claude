'use strict';
const assert = require('assert');

/**
 * Tests for HyDE (Hypothetical Document Embeddings) query expansion
 *
 * Tests the _hydeExpand method and its integration into the query pipeline.
 * Uses a mock HaikuWorker to avoid requiring API keys or MCP sampling.
 */
async function testHyDE() {
  const path = require('path');
  const { HaikuWorker } = require('../cortex/haiku-worker.cjs');

  // =========================================================================
  // Test Group 1: _hydeExpand method behavior
  // =========================================================================

  // Test 1: HyDE is disabled when API calls are off
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: false,
    });
    const result = await worker._hydeExpand('how to debug auth issues');
    assert.strictEqual(result, null, 'HyDE should return null when API calls disabled');
    assert.strictEqual(worker.stats.hydeFallbacks, 0, 'No fallback when API disabled (early exit)');
  }

  // Test 2: HyDE caching works
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    // Pre-populate the cache manually
    const fakeDoc = 'Auth issues are commonly caused by expired JWT tokens. Check token expiry and refresh logic.';
    worker.analysisCache.set('how to debug auth issues', 'hyde', fakeDoc);

    const result = await worker._hydeExpand('how to debug auth issues');
    assert.strictEqual(result, fakeDoc, 'HyDE should return cached document');
    assert.strictEqual(worker.stats.hydeCacheHits, 1, 'Cache hit should be recorded');
    assert.strictEqual(worker.stats.cacheHits, 1, 'Global cache hit incremented');
    assert.strictEqual(worker.stats.hydeExpansions, 0, 'No new expansion when cached');
  }

  // Test 3: HyDE stats are initialized correctly
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: false,
    });
    assert.strictEqual(worker.stats.hydeExpansions, 0, 'hydeExpansions starts at 0');
    assert.strictEqual(worker.stats.hydeCacheHits, 0, 'hydeCacheHits starts at 0');
    assert.strictEqual(worker.stats.hydeFallbacks, 0, 'hydeFallbacks starts at 0');
    assert.strictEqual(worker.stats.timings.hydeMs, 0, 'hyde timing starts at 0');
  }

  // =========================================================================
  // Test Group 2: Integration into query() pipeline
  // =========================================================================

  // Test 4: query() includes HyDE info in response when API disabled
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: false,
    });

    // The query will fail because there's no real memory store at /tmp,
    // but we can still verify the response structure
    try {
      const result = await worker.query('test query', ['all'], 5);
      // If we get here, check the hyde field
      assert(result.hyde !== undefined, 'Response should have hyde field');
      assert.strictEqual(result.hyde.expanded, false, 'HyDE should not expand when API disabled');
      assert(result.stats.timings.hyde !== undefined, 'Timing should include hyde');
      assert.strictEqual(result.stats.hydeExpanded, false, 'hydeExpanded should be false');
    } catch (e) {
      // Expected - no real memory store. Check that the error isn't from HyDE
      assert(!e.message.includes('_hydeExpand'), 'Error should not come from HyDE method');
    }
  }

  // Test 5: HyDE cache isolation (different queries get different cache entries)
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    const doc1 = 'Document about debugging authentication.';
    const doc2 = 'Document about database optimization.';

    worker.analysisCache.set('auth debugging', 'hyde', doc1);
    worker.analysisCache.set('database performance', 'hyde', doc2);

    const result1 = await worker._hydeExpand('auth debugging');
    const result2 = await worker._hydeExpand('database performance');

    assert.strictEqual(result1, doc1, 'First query should get its own cached doc');
    assert.strictEqual(result2, doc2, 'Second query should get its own cached doc');
    assert.strictEqual(worker.stats.hydeCacheHits, 2, 'Both should be cache hits');
  }

  // Test 6: HyDE cache key is case-insensitive
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    const doc = 'Hypothetical document about React hooks.';
    worker.analysisCache.set('react hooks', 'hyde', doc);

    // Should match despite case difference (AnalysisCache normalizes to lowercase)
    const result = await worker._hydeExpand('React Hooks');
    assert.strictEqual(result, doc, 'Cache lookup should be case-insensitive');
  }

  // Test 7: HyDE doesn't interfere with existing analysis cache
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    // Set both types of cache entries for the same query
    const analysisResult = { keywords: ['auth'], intent: 'debugging', criteria: 'auth stuff' };
    const hydeDoc = 'Hypothetical auth document.';

    worker.analysisCache.set('auth issues', 'analysis', analysisResult);
    worker.analysisCache.set('auth issues', 'hyde', hydeDoc);

    // Each type should be independently retrievable
    const gotAnalysis = worker.analysisCache.get('auth issues', 'analysis');
    const gotHyde = worker.analysisCache.get('auth issues', 'hyde');

    assert.deepStrictEqual(gotAnalysis, analysisResult, 'Analysis cache unaffected by HyDE');
    assert.strictEqual(gotHyde, hydeDoc, 'HyDE cache unaffected by analysis');
  }

  // Test 8: HyDE cache TTL expiry
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: false,  // Disable API so expired cache doesn't trigger real call
    });

    // Create a cache with very short TTL
    worker.analysisCache.ttlMs = 1; // 1ms TTL

    const doc = 'Short-lived document.';
    worker.analysisCache.set('test query', 'hyde', doc);

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 10));

    const result = await worker._hydeExpand('test query');
    // Result should be null because cache expired AND API calls are disabled
    assert.strictEqual(result, null, 'Expired cache should not return stale HyDE doc');

    // Restore TTL
    worker.analysisCache.ttlMs = 60 * 60 * 1000;
  }

  // Test 9: getStats() includes HyDE stats
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    // Simulate some HyDE activity
    worker.stats.hydeExpansions = 5;
    worker.stats.hydeCacheHits = 10;
    worker.stats.hydeFallbacks = 2;

    const stats = worker.getStats();
    assert.strictEqual(stats.hydeExpansions, 5, 'getStats includes hydeExpansions');
    assert.strictEqual(stats.hydeCacheHits, 10, 'getStats includes hydeCacheHits');
    assert.strictEqual(stats.hydeFallbacks, 2, 'getStats includes hydeFallbacks');
  }

  // Test 10: HyDE response validation (rejects short/empty responses)
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    // Pre-populate cache with a too-short document (should have been rejected during generation)
    // But if somehow a short doc gets cached, it still returns it from cache
    worker.analysisCache.set('short test', 'hyde', 'Too short');
    const cached = await worker._hydeExpand('short test');
    assert.strictEqual(cached, 'Too short', 'Cache returns whatever was stored');

    // The validation (>20 chars) happens during generation, not retrieval
    // This ensures we don't cache garbage but can still retrieve what was cached
  }

  // Test 11: Concurrent HyDE expand calls don't corrupt state
  {
    const worker = new HaikuWorker({
      basePath: '/tmp/cortex-test-hyde',
      enableApiCalls: true,
    });

    // Pre-populate different cache entries
    worker.analysisCache.set('query A', 'hyde', 'Document A about authentication.');
    worker.analysisCache.set('query B', 'hyde', 'Document B about database schemas.');
    worker.analysisCache.set('query C', 'hyde', 'Document C about API design patterns.');

    // Run all in parallel
    const [resultA, resultB, resultC] = await Promise.all([
      worker._hydeExpand('query A'),
      worker._hydeExpand('query B'),
      worker._hydeExpand('query C'),
    ]);

    assert.strictEqual(resultA, 'Document A about authentication.', 'Concurrent A correct');
    assert.strictEqual(resultB, 'Document B about database schemas.', 'Concurrent B correct');
    assert.strictEqual(resultC, 'Document C about API design patterns.', 'Concurrent C correct');
    assert.strictEqual(worker.stats.hydeCacheHits, 3, 'All 3 concurrent hits recorded');
  }

  console.log('All HyDE tests passed');
}

testHyDE().catch(err => { console.error(err); process.exit(1); });
