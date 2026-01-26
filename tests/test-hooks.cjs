#!/usr/bin/env node
/**
 * Claude Memory Orchestrator - Hooks Tests
 *
 * Tests for hook components:
 * - Context Analyzer
 * - Query Orchestrator
 * - Extraction Engine
 * - Session Hooks
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'cmo-hooks-test-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'data/memories'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'data/skills'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'data/patterns'), { recursive: true });
}

function cleanup() {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

// =============================================================================
// IMPORT MODULES
// =============================================================================

let hooks;

try {
  hooks = require('../hooks/index.cjs');
} catch (error) {
  console.error('Failed to import hooks modules:', error.message);
  process.exit(1);
}

// =============================================================================
// CONTEXT ANALYZER TESTS
// =============================================================================

function testContextAnalyzer() {
  console.log('\n🔍 Testing: Context Analyzer');
  let passed = 0;
  let total = 0;

  const analyzer = new hooks.ContextAnalyzer({
    workingDir: TEST_DIR,
  });

  total++;
  passed += test('analyze returns context object', () => {
    const ctx = analyzer.analyze({});
    assert(ctx.projectHash, 'Should have projectHash');
    assert(ctx.timestamp, 'Should have timestamp');
    assert(Array.isArray(ctx.domains), 'Should have domains array');
    assert(Array.isArray(ctx.tags), 'Should have tags array');
  });

  total++;
  passed += test('classifyIntent identifies debugging', () => {
    const result = analyzer.classifyIntent('Help me debug this error');
    assert(result.primary === 'debugging', 'Should identify debugging');
    assert(result.confidence > 0.5, 'Should have reasonable confidence');
  });

  total++;
  passed += test('classifyIntent identifies implementation', () => {
    const result = analyzer.classifyIntent('Implement a new feature');
    assert(result.primary === 'implementation', 'Should identify implementation');
  });

  total++;
  passed += test('classifyIntent identifies testing', () => {
    const result = analyzer.classifyIntent('Write tests for this function');
    assert(result.primary === 'testing', 'Should identify testing');
  });

  total++;
  passed += test('detectDomains identifies file types', () => {
    const domains = analyzer.detectDomains([
      'app.tsx',
      'server.py',
      'config.json',
    ]);
    assert(domains.includes('frontend'), 'Should identify frontend');
    assert(domains.includes('backend'), 'Should identify backend');
    assert(domains.includes('data'), 'Should identify data');
  });

  total++;
  passed += test('extractTags finds technology mentions', () => {
    const tags = analyzer.extractTags({
      prompt: 'Using React and Node.js with PostgreSQL',
    });
    assert(tags.includes('react'), 'Should find React');
    assert(tags.includes('node'), 'Should find Node');
    assert(tags.includes('postgres'), 'Should find PostgreSQL');
  });

  total++;
  passed += test('scoreMemory calculates relevance', () => {
    const memory = {
      projectHash: 'test123',
      intent: 'debugging',
      tags: ['react', 'error'],
      timestamp: new Date().toISOString(),
    };
    const context = {
      projectHash: 'test123',
      intent: 'debugging',
      tags: ['react', 'testing'],
    };
    const score = analyzer.scoreMemory(memory, context);
    assert(score > 0, 'Should have positive score');
    assert(score <= 1, 'Should be <= 1');
  });

  total++;
  passed += test('rankMemories sorts by relevance', () => {
    const memories = [
      { projectHash: 'other', intent: 'other', tags: [] },
      { projectHash: 'test123', intent: 'debugging', tags: ['react'] },
    ];
    const context = {
      projectHash: 'test123',
      intent: 'debugging',
      tags: ['react'],
    };
    const ranked = analyzer.rankMemories(memories, context);
    assert(ranked[0].projectHash === 'test123', 'Best match should be first');
  });

  total++;
  passed += test('INTENT_PATTERNS has expected intents', () => {
    assert(hooks.INTENT_PATTERNS.debugging, 'Should have debugging');
    assert(hooks.INTENT_PATTERNS.implementation, 'Should have implementation');
    assert(hooks.INTENT_PATTERNS.testing, 'Should have testing');
  });

  total++;
  passed += test('FILE_DOMAINS maps extensions', () => {
    assert(hooks.FILE_DOMAINS['.jsx'] === 'frontend', '.jsx should be frontend');
    assert(hooks.FILE_DOMAINS['.py'] === 'backend', '.py should be backend');
    assert(hooks.FILE_DOMAINS['.md'] === 'documentation', '.md should be documentation');
  });

  return { passed, total };
}

// =============================================================================
// QUERY ORCHESTRATOR TESTS
// =============================================================================

async function testQueryOrchestrator() {
  console.log('\n🔎 Testing: Query Orchestrator');
  let passed = 0;
  let total = 0;

  const orchestrator = new hooks.QueryOrchestrator({
    basePath: TEST_DIR,
    tokenBudget: { total: 1000, perSource: 300, perMemory: 100 },
    workingDir: TEST_DIR,
  });

  total++;
  passed += await testAsync('query returns result structure', async () => {
    const result = await orchestrator.query({});
    assert(result.context, 'Should have context');
    assert(Array.isArray(result.memories), 'Should have memories array');
    assert(result.stats, 'Should have stats');
  });

  total++;
  passed += await testAsync('query filters by types', async () => {
    const result = await orchestrator.query({
      types: ['skill'],
    });
    assert(Array.isArray(result.memories), 'Should return memories');
  });

  total++;
  passed += test('formatForInjection formats as XML', () => {
    const memories = [
      { type: 'skill', summary: 'Test skill', relevanceScore: 0.8, tags: ['test'] },
      { type: 'insight', summary: 'Test insight', relevanceScore: 0.7 },
    ];
    const xml = orchestrator.formatForInjection(memories, { format: 'xml' });
    assert(xml.includes('<relevant-memories>'), 'Should have XML root');
    assert(xml.includes('<skill-memories>'), 'Should group by type');
  });

  total++;
  passed += test('formatForInjection formats as Markdown', () => {
    const memories = [
      { type: 'pattern', summary: 'Test pattern', relevanceScore: 0.9 },
    ];
    const md = orchestrator.formatForInjection(memories, { format: 'markdown' });
    assert(md.includes('## Relevant Memories'), 'Should have Markdown header');
    assert(md.includes('### Pattern'), 'Should have type section');
  });

  total++;
  passed += test('formatForInjection handles empty', () => {
    const result = orchestrator.formatForInjection([]);
    assert(result === '', 'Empty input should return empty string');
  });

  total++;
  passed += test('MEMORY_SOURCES has expected sources', () => {
    assert(hooks.MEMORY_SOURCES.working, 'Should have working');
    assert(hooks.MEMORY_SOURCES.shortTerm, 'Should have shortTerm');
    assert(hooks.MEMORY_SOURCES.longTerm, 'Should have longTerm');
    assert(hooks.MEMORY_SOURCES.skills, 'Should have skills');
    assert(hooks.MEMORY_SOURCES.project, 'Should have project');
  });

  return { passed, total };
}

// =============================================================================
// EXTRACTION ENGINE TESTS
// =============================================================================

async function testExtractionEngine() {
  console.log('\n⚗️  Testing: Extraction Engine');
  let passed = 0;
  let total = 0;

  const engine = new hooks.ExtractionEngine({
    basePath: TEST_DIR,
    confidenceThreshold: 0.6,
    minSessionLength: 2,
  });

  total++;
  passed += await testAsync('extract processes messages', async () => {
    const result = await engine.extract({
      messages: [
        { role: 'user', content: 'How do I fix this error?' },
        { role: 'assistant', content: 'Here\'s how to fix the error:\n\n```bash\nnpm install --force\n```\n\nThis command will fix the dependency issue.' },
        { role: 'user', content: 'Thanks, that worked!' },
      ],
      sessionId: 'test-session',
      context: { projectHash: 'test123', intent: 'debugging' },
    });
    assert(result.success, 'Should succeed');
    assert(Array.isArray(result.extracted), 'Should have extracted array');
    assert(result.stats, 'Should have stats');
  });

  total++;
  passed += await testAsync('extract handles short sessions', async () => {
    const result = await engine.extract({
      messages: [
        { role: 'user', content: 'Hi' },
      ],
      sessionId: 'short-session',
      context: {},
    });
    assert(result.success, 'Should succeed');
    assert(result.stats.reason.includes('too short'), 'Should note session too short');
  });

  total++;
  passed += test('EXTRACTION_PATTERNS has expected types', () => {
    assert(hooks.EXTRACTION_PATTERNS.skill, 'Should have skill');
    assert(hooks.EXTRACTION_PATTERNS.insight, 'Should have insight');
    assert(hooks.EXTRACTION_PATTERNS.pattern, 'Should have pattern');
    assert(hooks.EXTRACTION_PATTERNS.decision, 'Should have decision');
  });

  total++;
  passed += test('QUALITY_SIGNALS has positive and negative', () => {
    assert(Array.isArray(hooks.QUALITY_SIGNALS.positive), 'Should have positive signals');
    assert(Array.isArray(hooks.QUALITY_SIGNALS.negative), 'Should have negative signals');
    assert(hooks.QUALITY_SIGNALS.positive.length > 0, 'Should have positive patterns');
  });

  return { passed, total };
}

// =============================================================================
// SESSION HOOKS TESTS
// =============================================================================

async function testSessionHooks() {
  console.log('\n🔗 Testing: Session Hooks');
  let passed = 0;
  let total = 0;

  // Set environment for testing
  const origDir = process.env.CMO_WORKING_DIR;
  const origSession = process.env.CMO_SESSION_ID;
  process.env.CMO_WORKING_DIR = TEST_DIR;
  process.env.CMO_SESSION_ID = 'test-hook-session';

  try {
    // Test SessionStartHook
    total++;
    passed += await testAsync('SessionStartHook executes', async () => {
      const hook = new hooks.SessionStartHook({
        basePath: TEST_DIR,
      });
      const result = await hook.execute();
      assert('success' in result, 'Should have success field');
      assert('injection' in result, 'Should have injection field');
      assert('stats' in result, 'Should have stats field');
    });

    // Test SessionEndHook
    total++;
    passed += await testAsync('SessionEndHook executes', async () => {
      const hook = new hooks.SessionEndHook({
        basePath: TEST_DIR,
      });
      const result = await hook.execute({
        messages: [
          { role: 'user', content: 'Test message' },
          { role: 'assistant', content: 'Test response with important note: always check the logs.' },
          { role: 'user', content: 'Thanks!' },
        ],
      });
      assert('success' in result, 'Should have success field');
      assert('extracted' in result, 'Should have extracted field');
      assert('stats' in result, 'Should have stats field');
    });

    // Test runHook
    total++;
    passed += await testAsync('runHook runs sessionStart', async () => {
      const result = await hooks.runHook('sessionStart', { basePath: TEST_DIR });
      assert('success' in result, 'Should return result');
    });

    total++;
    passed += await testAsync('runHook runs sessionEnd', async () => {
      const result = await hooks.runHook('sessionEnd', {
        basePath: TEST_DIR,
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      });
      assert('success' in result, 'Should return result');
    });

    total++;
    passed += await testAsync('runHook handles unknown hook', async () => {
      const result = await hooks.runHook('unknownHook');
      assert(result.success === false, 'Should fail');
      assert(result.error.includes('Unknown'), 'Should mention unknown');
    });

  } finally {
    // Restore environment
    if (origDir !== undefined) {
      process.env.CMO_WORKING_DIR = origDir;
    } else {
      delete process.env.CMO_WORKING_DIR;
    }
    if (origSession !== undefined) {
      process.env.CMO_SESSION_ID = origSession;
    } else {
      delete process.env.CMO_SESSION_ID;
    }
  }

  return { passed, total };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   CMO Hooks Tests                      ║');
  console.log('╚════════════════════════════════════════╝');

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    const results = [
      testContextAnalyzer(),
      await testQueryOrchestrator(),
      await testExtractionEngine(),
      await testSessionHooks(),
    ];

    for (const r of results) {
      totalPassed += r.passed;
      totalTests += r.total;
    }
  } finally {
    cleanup();
  }

  console.log('\n' + '═'.repeat(42));
  console.log(`Results: ${totalPassed}/${totalTests} tests passed`);

  if (totalPassed === totalTests) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log(`❌ ${totalTests - totalPassed} test(s) failed`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Test runner failed:', error);
  cleanup();
  process.exit(1);
});
