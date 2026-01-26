/**
 * Tests for Semantic Intent Analyzer
 *
 * Tests cover:
 * - Basic keyword analysis (fallback mode)
 * - Complexity assessment
 * - Match type detection
 * - Cache system
 * - Score adaptation (auto-learning)
 * - Integration with ContextAnalyzer
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Module under test
const {
  SemanticIntentAnalyzer,
  MATCH_TYPES,
  CONFIG,
  hashQuery,
  analyzeWithKeywords,
} = require('../hooks/semantic-intent-analyzer.cjs');

const { ContextAnalyzer } = require('../hooks/context-analyzer.cjs');

// Test counter
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    failed++;
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runTests() {
  // ==========================================================================
  // UNIT TESTS: hashQuery
  // ==========================================================================

  console.log('\n=== hashQuery Tests ===\n');

  test('Creates consistent hash for same query', () => {
    const hash1 = hashQuery('FileSystemWatcher PowerShell');
    const hash2 = hashQuery('FileSystemWatcher PowerShell');
    assert.strictEqual(hash1, hash2);
  });

  test('Hash is case-insensitive', () => {
    const hash1 = hashQuery('Debug Error');
    const hash2 = hashQuery('debug error');
    assert.strictEqual(hash1, hash2);
  });

  test('Hash is trim-insensitive', () => {
    const hash1 = hashQuery('  query  ');
    const hash2 = hashQuery('query');
    assert.strictEqual(hash1, hash2);
  });

  test('Different queries produce different hashes', () => {
    const hash1 = hashQuery('query one');
    const hash2 = hashQuery('query two');
    assert.notStrictEqual(hash1, hash2);
  });

  // ==========================================================================
  // UNIT TESTS: analyzeWithKeywords (fallback)
  // ==========================================================================

  console.log('\n=== analyzeWithKeywords Tests ===\n');

  test('Detects simple complexity for short queries', () => {
    const result = analyzeWithKeywords('debug error');
    assert.strictEqual(result.complexity, 'simple');
  });

  test('Detects moderate complexity for medium queries', () => {
    const result = analyzeWithKeywords('help me debug this authentication error');
    assert.strictEqual(result.complexity, 'moderate');
  });

  test('Detects complex queries with how/why keywords', () => {
    const result = analyzeWithKeywords('how should I structure my microservices');
    assert.strictEqual(result.complexity, 'complex');
  });

  test('Extracts debugging intent', () => {
    const result = analyzeWithKeywords('debug error bug fix');
    assert.strictEqual(result.intent.primary, 'debugging');
    assert(result.intent.confidence > 0.5);
  });

  test('Extracts implementation intent', () => {
    const result = analyzeWithKeywords('create new feature build component');
    assert.strictEqual(result.intent.primary, 'implementation');
  });

  test('Extracts exploration intent', () => {
    const result = analyzeWithKeywords('what is this how does it work');
    assert.strictEqual(result.intent.primary, 'exploration');
  });

  test('Extracts required keywords (filters stopwords)', () => {
    const result = analyzeWithKeywords('help me with the FileSystemWatcher in PowerShell');
    assert(result.keywords.required.includes('filesystemwatcher'));
    assert(result.keywords.required.includes('powershell'));
    // Stopwords should be filtered
    assert(!result.keywords.required.includes('the'));
    assert(!result.keywords.required.includes('help'));
  });

  test('Sets keyword match strategy for fallback', () => {
    const result = analyzeWithKeywords('some query');
    assert.strictEqual(result.matchStrategy.primary, 'keyword');
    assert.strictEqual(result.source, 'fallback');
  });

  // ==========================================================================
  // UNIT TESTS: MATCH_TYPES
  // ==========================================================================

  console.log('\n=== MATCH_TYPES Tests ===\n');

  test('Semantic match has highest multiplier', () => {
    assert.strictEqual(MATCH_TYPES.semantic.multiplier, 1.0);
  });

  test('Keyword match has good multiplier', () => {
    assert(MATCH_TYPES.keyword.multiplier >= 0.8);
  });

  test('All match types have required properties', () => {
    for (const [name, config] of Object.entries(MATCH_TYPES)) {
      assert(config.name, `${name} should have name`);
      assert(config.description, `${name} should have description`);
      assert(typeof config.multiplier === 'number', `${name} should have multiplier`);
      assert(typeof config.fallbackOrder === 'number', `${name} should have fallbackOrder`);
    }
  });

  // ==========================================================================
  // UNIT TESTS: SemanticIntentAnalyzer class
  // ==========================================================================

  console.log('\n=== SemanticIntentAnalyzer Class Tests ===\n');

  test('Constructor creates instance with default options', () => {
    const analyzer = new SemanticIntentAnalyzer();
    assert(analyzer.useHaiku === true);
    assert(analyzer.useCache === true);
    assert(analyzer.useAdaptation === true);
  });

  test('Constructor respects option overrides', () => {
    const analyzer = new SemanticIntentAnalyzer({
      useHaiku: false,
      useCache: false,
      useAdaptation: false,
    });
    assert(analyzer.useHaiku === false);
    assert(analyzer.useCache === false);
    assert(analyzer.useAdaptation === false);
  });

  await asyncTest('analyze returns empty result for empty query', async () => {
    const analyzer = new SemanticIntentAnalyzer({ useHaiku: false });
    const result = await analyzer.analyze('');
    assert.strictEqual(result.complexity, 'simple');
    assert.strictEqual(result.intent.primary, 'general');
    assert.strictEqual(result.source, 'empty');
  });

  await asyncTest('analyze returns valid result for normal query', async () => {
    const analyzer = new SemanticIntentAnalyzer({ useHaiku: false });
    const result = await analyzer.analyze('debug authentication error');
    assert(result.complexity);
    assert(result.intent.primary);
    assert(Array.isArray(result.keywords.required));
    assert(result.memoryLimit > 0);
  });

  test('getMatchType returns correct config', () => {
    const analyzer = new SemanticIntentAnalyzer({ useHaiku: false });

    const semantic = analyzer.getMatchType('semantic');
    assert.strictEqual(semantic.multiplier, 1.0);

    const keyword = analyzer.getMatchType('keyword');
    assert.strictEqual(keyword.multiplier, 0.85);

    // Unknown type defaults to keyword
    const unknown = analyzer.getMatchType('unknown');
    assert.strictEqual(unknown, MATCH_TYPES.keyword);
  });

  test('adjustScore applies match type multiplier', () => {
    const analyzer = new SemanticIntentAnalyzer({ useHaiku: false });

    const score1 = analyzer.adjustScore(0.8, 'semantic');
    assert.strictEqual(score1, 0.8); // 1.0 multiplier

    const score2 = analyzer.adjustScore(0.8, 'keyword');
    assert.strictEqual(score2, 0.8 * 0.85); // 0.85 multiplier
  });

  // ==========================================================================
  // INTEGRATION TESTS: Caching
  // ==========================================================================

  console.log('\n=== Caching Integration Tests ===\n');

  await asyncTest('Results are cached', async () => {
    const analyzer = new SemanticIntentAnalyzer({
      useHaiku: false,
      useCache: true,
    });

    const result1 = await analyzer.analyze('test caching query');
    assert.strictEqual(result1.cached, false);

    const result2 = await analyzer.analyze('test caching query');
    assert.strictEqual(result2.cached, true);
    assert(result2.cacheAge >= 0);

    analyzer.clearCache();
  });

  await asyncTest('forceApi bypasses cache', async () => {
    const analyzer = new SemanticIntentAnalyzer({
      useHaiku: false,
      useCache: true,
    });

    await analyzer.analyze('bypass cache test');
    const result = await analyzer.analyze('bypass cache test', { forceApi: true });
    assert.strictEqual(result.cached, false);

    analyzer.clearCache();
  });

  await asyncTest('Cache stats are tracked', async () => {
    const analyzer = new SemanticIntentAnalyzer({
      useHaiku: false,
      useCache: true,
    });

    await analyzer.analyze('cache entry 1');
    await analyzer.analyze('cache entry 2');

    const stats = analyzer.getStats();
    assert(stats.cacheEntries >= 2);

    analyzer.clearCache();
  });

  // ==========================================================================
  // INTEGRATION TESTS: Score Adaptation (Auto-Learning)
  // ==========================================================================

  console.log('\n=== Score Adaptation Tests ===\n');

  await asyncTest('recordFeedback creates adaptation pattern', async () => {
    const analyzer = new SemanticIntentAnalyzer({
      useHaiku: false,
      useAdaptation: true,
    });

    const query = 'powershell filesystem watch';
    await analyzer.analyze(query);

    analyzer.recordFeedback(
      query,
      {
        tags: ['powershell', 'windows', 'filesystem'],
        intent: 'configuration',
      },
      { intent: { primary: 'debugging' } }
    );

    const stats = analyzer.getStats();
    assert(stats.adaptationPatterns >= 1);

    analyzer.clearAdaptations();
  });

  await asyncTest('Adaptations influence subsequent analysis', async () => {
    const analyzer = new SemanticIntentAnalyzer({
      useHaiku: false,
      useAdaptation: true,
    });

    const query = 'powershell filesystem watch';

    // Record feedback that associates this pattern with specific tags
    analyzer.recordFeedback(
      query,
      {
        tags: ['powershell', 'windows', 'watcher'],
        intent: 'configuration',
      },
      {}
    );

    // Now analyze - should pick up boosted keywords
    const result = await analyzer.analyze(query, { forceApi: true });
    // Boosted keywords should be in required list
    const allKeywords = result.keywords.required;
    assert(allKeywords.includes('powershell') || allKeywords.includes('windows'));

    analyzer.clearAdaptations();
    analyzer.clearCache();
  });

  // ==========================================================================
  // INTEGRATION TESTS: ContextAnalyzer with Semantic
  // ==========================================================================

  console.log('\n=== ContextAnalyzer + Semantic Integration Tests ===\n');

  test('ContextAnalyzer works without semantic enabled', () => {
    const analyzer = new ContextAnalyzer({
      workingDir: '/tmp',
    });

    const context = analyzer.analyze({
      prompt: 'debug error in authentication',
      recentFiles: [],
    });

    assert(context.intent);
    assert(context._promptKeywords);
  });

  await asyncTest('ContextAnalyzer with semantic enabled returns enhanced context', async () => {
    const analyzer = new ContextAnalyzer({
      workingDir: '/tmp',
      semantic: {
        enabled: true,
        useHaiku: false, // Use fallback for consistent testing
      },
    });

    const context = await analyzer.analyzeWithSemantic({
      prompt: 'debug error in authentication',
      recentFiles: [],
    });

    assert(context.intent);
    assert(context._promptKeywords);
    assert(context._complexity);
    assert(context._matchStrategy);
    assert(context._memoryLimit);
  });

  await asyncTest('scoreMemory uses content keywords', async () => {
    const analyzer = new ContextAnalyzer({
      workingDir: '/tmp',
      semantic: { enabled: true, useHaiku: false },
    });

    const context = await analyzer.analyzeWithSemantic({
      prompt: 'FileSystemWatcher PowerShell configuration',
    });

    const memory1 = {
      content: 'FileSystemWatcher is used in PowerShell to monitor file changes',
      tags: ['powershell', 'windows'],
      type: 'lesson',
    };

    const memory2 = {
      content: 'Python asyncio for async programming',
      tags: ['python', 'async'],
      type: 'lesson',
    };

    const score1 = analyzer.scoreMemory(memory1, context);
    const score2 = analyzer.scoreMemory(memory2, context);

    assert(score1 > score2, `Memory with matching content should score higher (${score1} vs ${score2})`);
  });

  await asyncTest('scoreMemoryDetailed returns match type information', async () => {
    const analyzer = new ContextAnalyzer({
      workingDir: '/tmp',
      semantic: { enabled: true, useHaiku: false },
    });

    const context = await analyzer.analyzeWithSemantic({
      prompt: 'FileSystemWatcher PowerShell',
    });

    const memory = {
      content: 'FileSystemWatcher in PowerShell monitors file changes',
      tags: ['powershell'],
    };

    const detailed = analyzer.scoreMemoryDetailed(memory, context);
    assert(detailed.score > 0);
    assert(['keyword', 'semantic', 'pattern', 'none'].includes(detailed.matchType));
    assert(Array.isArray(detailed.matchedKeywords));
    assert(detailed.breakdown);
  });

  // ==========================================================================
  // INTEGRATION TESTS: QueryOrchestrator with Semantic
  // ==========================================================================

  console.log('\n=== QueryOrchestrator + Semantic Integration Tests ===\n');

  test('QueryOrchestrator respects semantic.enabled option', () => {
    const { QueryOrchestrator } = require('../hooks/query-orchestrator.cjs');

    const orchestrator1 = new QueryOrchestrator({
      basePath: '/home/rob/.claude/memory',
      workingDir: '/tmp',
      semantic: { enabled: false },
    });
    assert.strictEqual(orchestrator1.isSemanticEnabled(), false);

    const orchestrator2 = new QueryOrchestrator({
      basePath: '/home/rob/.claude/memory',
      workingDir: '/tmp',
      semantic: { enabled: true, useHaiku: false },
    });
    assert.strictEqual(orchestrator2.isSemanticEnabled(), true);
  });

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  console.log('\n' + '='.repeat(50));
  console.log(`\nTests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
