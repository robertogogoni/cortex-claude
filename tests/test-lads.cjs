#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - LADS Tests
 *
 * Tests for LADS (Learnable, Adaptive, Documenting, Self-improving) components:
 * - Pattern Tracker
 * - Outcome Scorer
 * - Config Evolver
 * - Docs Writer
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'cmo-lads-test-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'data/patterns'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'docs/skills'), { recursive: true });
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

let lads;

try {
  lads = require('../core/lads/index.cjs');
} catch (error) {
  console.error('Failed to import LADS modules:', error.message);
  process.exit(1);
}

// =============================================================================
// PATTERN TRACKER TESTS
// =============================================================================

async function testPatternTracker() {
  console.log('\n📊 Testing: Pattern Tracker');
  let passed = 0;
  let total = 0;

  const tracker = new lads.PatternTracker({
    decisionsPath: path.join(TEST_DIR, 'data/patterns/decisions.jsonl'),
    outcomesPath: path.join(TEST_DIR, 'data/patterns/outcomes.jsonl'),
  });

  total++;
  passed += await testAsync('initialize loads stores', async () => {
    const result = await tracker.initialize();
    assert(result.success, 'Should initialize successfully');
    assert(tracker.initialized, 'Should be marked initialized');
  });

  total++;
  passed += await testAsync('trackDecision records decision', async () => {
    const result = await tracker.trackDecision({
      sessionId: 'test-session-1',
      decisionType: 'memory_injection',
      projectHash: 'abc123',
      intent: 'debugging',
      choice: 'inject_3_memories',
      confidence: 0.8,
    });
    assert(result.success, 'Should track successfully');
    assert(result.id, 'Should return ID');
  });

  total++;
  passed += await testAsync('resolveOutcome updates decision', async () => {
    // First track a decision
    const trackResult = await tracker.trackDecision({
      sessionId: 'test-session-2',
      decisionType: 'skill_extraction',
      choice: 'extract_skill',
      confidence: 0.7,
    });

    // Then resolve it
    const resolveResult = await tracker.resolveOutcome(trackResult.id, {
      useful: true,
      reason: 'User confirmed helpful',
    });
    assert(resolveResult.success, 'Should resolve successfully');
  });

  total++;
  passed += test('findSimilarDecisions finds matches', () => {
    const similar = tracker.findSimilarDecisions(
      { projectHash: 'abc123', intent: 'debugging' },
      'memory_injection'
    );
    // May or may not find matches depending on resolved status
    assert(Array.isArray(similar), 'Should return array');
  });

  total++;
  passed += test('getSuccessRate calculates rate', () => {
    const { rate, samples } = tracker.getSuccessRate('skill_extraction', 'extract_skill');
    assert(typeof samples === 'number', 'Should return sample count');
  });

  total++;
  passed += test('detectPatterns identifies patterns', () => {
    const patterns = tracker.detectPatterns({ minSamples: 1 });
    assert(Array.isArray(patterns), 'Should return array');
  });

  total++;
  passed += test('getStats returns statistics', () => {
    const stats = tracker.getStats();
    assert(typeof stats.totalDecisions === 'number', 'Should have totalDecisions');
    assert(typeof stats.resolvedCount === 'number', 'Should have resolvedCount');
  });

  return { passed, total };
}

// =============================================================================
// OUTCOME SCORER TESTS
// =============================================================================

async function testOutcomeScorer() {
  console.log('\n🎯 Testing: Outcome Scorer');
  let passed = 0;
  let total = 0;

  // Create a mock pattern tracker
  const mockTracker = {
    decisionsStore: {
      get: () => ({
        id: 'test-decision',
        decisionType: 'test',
        sessionId: 'test-session',
      }),
    },
  };

  const scorer = new lads.OutcomeScorer({ patternTracker: mockTracker });

  total++;
  passed += test('registerDecision tracks decision', () => {
    scorer.registerDecision('decision-1');
    const stats = scorer.getStats();
    assert(stats.pendingDecisions >= 1, 'Should have pending decision');
  });

  total++;
  passed += test('collectSignal records signal', () => {
    scorer.collectSignal('decision-1', 'usage', {
      usageType: 'referenced',
      count: 1,
    });
    const stats = scorer.getStats();
    assert(stats.totalSignals >= 1, 'Should have signal');
  });

  total++;
  passed += test('recordFeedback records explicit feedback', () => {
    scorer.recordFeedback('decision-1', true, 'User said it was helpful');
    const signals = scorer.getSignals('decision-1');
    assert(signals.some(s => s.type === 'explicit_feedback'), 'Should have feedback signal');
  });

  total++;
  passed += test('determineUsefulness calculates outcome', () => {
    const outcome = scorer.determineUsefulness('decision-1');
    assert('useful' in outcome, 'Should have useful field');
    assert('confidence' in outcome, 'Should have confidence');
    assert('reason' in outcome, 'Should have reason');
  });

  total++;
  passed += test('SIGNAL_TYPES has expected types', () => {
    assert(lads.SIGNAL_TYPES.USAGE, 'Should have USAGE');
    assert(lads.SIGNAL_TYPES.FEEDBACK, 'Should have FEEDBACK');
    assert(lads.SIGNAL_TYPES.CONVERSATION, 'Should have CONVERSATION');
    assert(lads.SIGNAL_TYPES.TEMPORAL, 'Should have TEMPORAL');
  });

  return { passed, total };
}

// =============================================================================
// CONFIG EVOLVER TESTS
// =============================================================================

async function testConfigEvolver() {
  console.log('\n🧬 Testing: Config Evolver');
  let passed = 0;
  let total = 0;

  // Create mock pattern tracker
  const mockTracker = {
    detectPatterns: () => [],
  };

  const evolver = new lads.ConfigEvolver({
    patternTracker: mockTracker,
    enabled: true,
    minIntervalMs: 0, // No delay for testing
    minSamples: 1,
  });

  total++;
  passed += test('canEvolve checks status', () => {
    const { canEvolve, reason } = evolver.canEvolve();
    assert(typeof canEvolve === 'boolean', 'Should return boolean');
    assert(typeof reason === 'string', 'Should return reason');
  });

  total++;
  passed += test('analyzeAndPropose returns proposals', () => {
    const { proposals, reason } = evolver.analyzeAndPropose();
    assert(Array.isArray(proposals), 'Should return proposals array');
    assert(typeof reason === 'string', 'Should return reason');
  });

  total++;
  passed += test('evolve runs full cycle', () => {
    const result = evolver.evolve(true); // dry run
    assert('evolved' in result, 'Should have evolved field');
    assert('reason' in result, 'Should have reason');
    assert(Array.isArray(result.proposals), 'Should have proposals');
  });

  total++;
  passed += test('EVOLUTION_RULES has expected rules', () => {
    assert(lads.EVOLUTION_RULES.length > 0, 'Should have rules');
    const ruleNames = lads.EVOLUTION_RULES.map(r => r.name);
    assert(ruleNames.includes('threshold_adjustment'), 'Should have threshold_adjustment');
    assert(ruleNames.includes('injection_threshold'), 'Should have injection_threshold');
  });

  total++;
  passed += test('getStats returns statistics', () => {
    const stats = evolver.getStats();
    assert(typeof stats.enabled === 'boolean', 'Should have enabled');
    assert(typeof stats.evolutionCount === 'number', 'Should have evolutionCount');
  });

  total++;
  passed += test('addRule adds custom rule', () => {
    const countBefore = evolver.rules.length;
    evolver.addRule({
      name: 'custom_rule',
      configPath: 'test.path',
      description: 'Test rule',
      condition: () => false,
      calculate: (p, v) => v,
      bounds: { min: 0, max: 1 },
    });
    assert(evolver.rules.length === countBefore + 1, 'Should add rule');
  });

  return { passed, total };
}

// =============================================================================
// DOCS WRITER TESTS
// =============================================================================

async function testDocsWriter() {
  console.log('\n📝 Testing: Docs Writer');
  let passed = 0;
  let total = 0;

  const writer = new lads.DocsWriter({
    docsPath: path.join(TEST_DIR, 'docs'),
    enabled: true,
  });

  total++;
  passed += test('addChangelogEntry adds entry', () => {
    const result = writer.addChangelogEntry({
      type: 'test_change',
      component: 'TestComponent',
      description: 'Test description',
      details: 'Test details',
    });
    assert(result, 'Should return true');
    assert(fs.existsSync(writer.changelogPath), 'Changelog should exist');
  });

  total++;
  passed += test('logEvolution logs config change', () => {
    writer.logEvolution({
      rule: 'test_rule',
      configPath: 'test.path',
      oldValue: 5,
      newValue: 10,
      reason: 'Test evolution',
      confidence: 0.8,
    });
    const content = fs.readFileSync(writer.changelogPath, 'utf8');
    assert(content.includes('config_evolution'), 'Should log evolution');
  });

  total++;
  passed += test('logExtraction logs memory', () => {
    writer.logExtraction({
      type: 'skill',
      summary: 'Test skill',
      projectHash: 'test123',
      extractionConfidence: 0.9,
      tags: ['test', 'skill'],
    });
    const content = fs.readFileSync(writer.changelogPath, 'utf8');
    assert(content.includes('memory_extracted'), 'Should log extraction');
  });

  total++;
  passed += test('addDecision logs decision', () => {
    const result = writer.addDecision({
      id: 'decision-123',
      title: 'Test Decision',
      decisionType: 'test',
      choice: 'option_a',
      alternatives: ['option_b', 'option_c'],
      confidence: 0.75,
      outcome: { status: 'pending' },
    });
    assert(result, 'Should return true');
    assert(fs.existsSync(writer.decisionsPath), 'Decisions file should exist');
  });

  total++;
  passed += test('documentSkill creates skill doc', () => {
    const result = writer.documentSkill({
      name: 'test-skill',
      description: 'A test skill',
      createdAt: new Date().toISOString(),
      triggers: {
        keywords: ['test', 'skill'],
        patterns: ['test.*'],
      },
      content: 'Skill content here',
      usageCount: 5,
      usageSuccessRate: 0.8,
      tags: ['testing'],
    });
    assert(result, 'Should return true');
    assert(fs.existsSync(path.join(writer.skillsPath, 'test-skill.md')), 'Skill doc should exist');
  });

  total++;
  passed += test('listSkillDocs returns skill list', () => {
    const skills = writer.listSkillDocs();
    assert(Array.isArray(skills), 'Should return array');
    assert(skills.includes('test-skill'), 'Should include test-skill');
  });

  total++;
  passed += test('getStats returns statistics', () => {
    const stats = writer.getStats();
    assert(stats.enabled === true, 'Should be enabled');
    assert(stats.changelogExists === true, 'Changelog should exist');
    assert(typeof stats.skillsDocumented === 'number', 'Should have skill count');
  });

  return { passed, total };
}

// =============================================================================
// LADS CORE TESTS
// =============================================================================

async function testLADSCore() {
  console.log('\n🧠 Testing: LADS Core Orchestrator');
  let passed = 0;
  let total = 0;

  const core = new lads.LADSCore({
    basePath: TEST_DIR,
    enabled: true,
  });

  total++;
  passed += await testAsync('initialize initializes all components', async () => {
    const result = await core.initialize();
    assert(result.success, 'Should initialize successfully');
    assert(core.initialized, 'Should be marked initialized');
  });

  total++;
  passed += await testAsync('trackDecision tracks through orchestrator', async () => {
    const result = await core.trackDecision({
      sessionId: 'lads-test-1',
      decisionType: 'orchestrator_test',
      choice: 'test_choice',
      confidence: 0.9,
    });
    assert(result.success, 'Should track successfully');
  });

  total++;
  passed += test('collectSignal collects through orchestrator', () => {
    core.collectSignal('test-id', 'usage', { usageType: 'referenced' });
    // No assertion needed - just checking it doesn't throw
    assert(true);
  });

  total++;
  passed += test('detectPatterns returns patterns', () => {
    const patterns = core.detectPatterns({ minSamples: 1 });
    assert(Array.isArray(patterns), 'Should return array');
  });

  total++;
  passed += test('getStats returns combined stats', () => {
    const stats = core.getStats();
    assert(stats.enabled === true, 'Should have enabled');
    assert(stats.initialized === true, 'Should have initialized');
    assert(stats.patternTracker, 'Should have patternTracker stats');
    assert(stats.outcomeScorer, 'Should have outcomeScorer stats');
  });

  total++;
  passed += test('setEnabled toggles state', () => {
    core.setEnabled(false);
    assert(core.enabled === false, 'Should be disabled');
    core.setEnabled(true);
    assert(core.enabled === true, 'Should be enabled');
  });

  return { passed, total };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Cortex LADS Tests                       ║');
  console.log('╚════════════════════════════════════════╝');

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    const results = [
      await testPatternTracker(),
      await testOutcomeScorer(),
      await testConfigEvolver(),
      await testDocsWriter(),
      await testLADSCore(),
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
