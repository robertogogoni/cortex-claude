# Cortex Phase G: Memory Lifecycle Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement intelligent memory lifecycle operations (create, update, consolidate, prune) based on RL research insights.

**Architecture:** 5 modules: MemoryOperations (CRUD), WriteQualityScorer (gate), ConsolidationEngine (merge/dedup), UsageTracker (access patterns), PreferenceDecay (time+preference-aware). All CommonJS, standalone testable, no external deps.

**Tech Stack:** Node.js (CommonJS `.cjs`), better-sqlite3 (existing), custom test runner

**Depends on:** Phase E (working adapters), Phase F (typed, anchored memories)

**See also:**
- [Unified Roadmap (Phases H-K)](2026-03-02-cortex-unified-roadmap-phases-h-k.md) — high-level design, dependencies, cost analysis
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) — links to all phase plans

---

### Task G1: Structured Memory Operations (CRUD)

**Files:**
- Create: `core/memory-operations.cjs`
- Test: `tests/test-memory-operations.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-memory-ops-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRecord(overrides = {}) {
  return {
    id: 'mem_' + Math.random().toString(36).slice(2),
    version: 1,
    type: 'fact',
    content: 'The quick brown fox jumps over the lazy dog.',
    summary: 'Fox jumps over dog.',
    projectHash: 'proj_abc',
    tags: ['test'],
    intent: 'recall',
    sourceSessionId: 'sess_001',
    sourceTimestamp: Date.now(),
    extractionConfidence: 0.9,
    usageCount: 0,
    usageSuccessRate: 1.0,
    lastUsed: null,
    decayScore: 1.0,
    embedding: null,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\nTask G1: Memory Operations (CRUD)\n');

  const {
    MemoryOperations,
    ACTION_CREATE,
    ACTION_UPDATE,
    ACTION_DELETE,
    ACTION_NOOP,
  } = require('../core/memory-operations.cjs');

  let passed = 0;
  let failed = 0;

  function record(ok) { if (ok) passed++; else failed++; }

  // ── CREATE ────────────────────────────────────────────────────────────────

  record(test('ACTION constants are exported', () => {
    assert.strictEqual(ACTION_CREATE, 'CREATE');
    assert.strictEqual(ACTION_UPDATE, 'UPDATE');
    assert.strictEqual(ACTION_DELETE, 'DELETE');
    assert.strictEqual(ACTION_NOOP,   'NOOP');
  }));

  record(test('create() returns CREATE action for novel memory', () => {
    const ops = new MemoryOperations();
    const incoming = makeRecord({ content: 'Completely novel information about quantum computing.' });
    const existing = [
      makeRecord({ content: 'The weather today is sunny and warm.' }),
      makeRecord({ content: 'JavaScript closures capture lexical scope.' }),
    ];
    const result = ops.create(incoming, existing);
    assert.strictEqual(result.action, ACTION_CREATE);
    assert.ok(result.record, 'result should carry the record');
    assert.strictEqual(result.record.id, incoming.id);
  }));

  record(test('create() detects duplicate above 0.85 similarity threshold', () => {
    const ops = new MemoryOperations();
    const base = 'Node.js uses an event-driven non-blocking I/O model.';
    const incoming = makeRecord({ content: base });
    const existing = [
      makeRecord({ content: 'Node.js uses event-driven non-blocking I/O.' }),
    ];
    const result = ops.create(incoming, existing);
    assert.strictEqual(result.action, ACTION_NOOP,
      'Near-duplicate should return NOOP, not CREATE');
    assert.ok(result.reason, 'Should provide a reason');
    assert.ok(result.similarTo, 'Should identify similar record');
  }));

  record(test('create() passes when similarity is below threshold', () => {
    const ops = new MemoryOperations();
    const incoming = makeRecord({ content: 'Redis is an in-memory key-value store.' });
    const existing = [
      makeRecord({ content: 'PostgreSQL is a relational database system.' }),
    ];
    const result = ops.create(incoming, existing);
    assert.strictEqual(result.action, ACTION_CREATE);
  }));

  record(test('create() with empty existing list always returns CREATE', () => {
    const ops = new MemoryOperations();
    const incoming = makeRecord({ content: 'Any content at all.' });
    const result = ops.create(incoming, []);
    assert.strictEqual(result.action, ACTION_CREATE);
  }));

  // ── UPDATE ────────────────────────────────────────────────────────────────

  record(test('update() merges new information into existing record', () => {
    const ops = new MemoryOperations();
    const existing = makeRecord({
      content: 'Python supports list comprehensions.',
      tags: ['python'],
      usageCount: 5,
    });
    const patch = { content: 'Python supports list and dict comprehensions.', tags: ['python', 'syntax'] };
    const result = ops.update(existing, patch);
    assert.strictEqual(result.action, ACTION_UPDATE);
    assert.ok(result.record.content.includes('dict comprehensions'),
      'Merged content should include new information');
    assert.ok(result.record.tags.includes('syntax'), 'Tags should be merged');
    assert.ok(result.record.updatedAt >= existing.updatedAt, 'updatedAt should advance');
    assert.ok(result.record.version > existing.version, 'version should increment');
  }));

  record(test('update() preserves usageCount and usageSuccessRate', () => {
    const ops = new MemoryOperations();
    const existing = makeRecord({ usageCount: 10, usageSuccessRate: 0.8 });
    const patch = { content: 'Updated content.' };
    const result = ops.update(existing, patch);
    assert.strictEqual(result.record.usageCount, 10);
    assert.strictEqual(result.record.usageSuccessRate, 0.8);
  }));

  record(test('update() with empty patch returns NOOP', () => {
    const ops = new MemoryOperations();
    const existing = makeRecord();
    const result = ops.update(existing, {});
    assert.strictEqual(result.action, ACTION_NOOP);
  }));

  // ── DELETE ────────────────────────────────────────────────────────────────

  record(test('delete() triggers for stale and low-confidence memory', () => {
    const ops = new MemoryOperations();
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const staleRecord = makeRecord({
      extractionConfidence: 0.05,
      decayScore: 0.08,
      lastUsed: ninetyDaysAgo,
      usageCount: 0,
    });
    const result = ops.delete(staleRecord);
    assert.strictEqual(result.action, ACTION_DELETE);
    assert.ok(result.reason, 'Should provide deletion reason');
  }));

  record(test('delete() does NOT trigger for healthy record', () => {
    const ops = new MemoryOperations();
    const healthyRecord = makeRecord({
      extractionConfidence: 0.9,
      decayScore: 0.85,
      lastUsed: Date.now() - 1000,
      usageCount: 20,
    });
    const result = ops.delete(healthyRecord);
    assert.strictEqual(result.action, ACTION_NOOP);
  }));

  record(test('delete() triggers for very low decayScore alone', () => {
    const ops = new MemoryOperations();
    const decayed = makeRecord({ decayScore: 0.04, extractionConfidence: 0.5 });
    const result = ops.delete(decayed);
    assert.strictEqual(result.action, ACTION_DELETE);
  }));

  // ── EVALUATE ─────────────────────────────────────────────────────────────

  record(test('evaluate() picks CREATE for novel incoming memory', () => {
    const ops = new MemoryOperations();
    const incoming = makeRecord({ content: 'Rust ownership model prevents data races at compile time.' });
    const existing = [
      makeRecord({ content: 'Go uses goroutines for concurrency.' }),
    ];
    const result = ops.evaluate(incoming, existing);
    assert.strictEqual(result.action, ACTION_CREATE);
  }));

  record(test('evaluate() picks NOOP for high-quality duplicate', () => {
    const ops = new MemoryOperations();
    const content = 'The mitochondria is the powerhouse of the cell.';
    const incoming = makeRecord({ content, extractionConfidence: 0.9, decayScore: 0.95 });
    const existing = [
      makeRecord({ content: 'Mitochondria is the powerhouse of the cell.', extractionConfidence: 0.95, decayScore: 0.99, usageCount: 50 }),
    ];
    const result = ops.evaluate(incoming, existing);
    assert.strictEqual(result.action, ACTION_NOOP);
  }));

  record(test('evaluate() picks DELETE for stale, low-confidence, zero-usage record', () => {
    const ops = new MemoryOperations();
    const stale = makeRecord({
      content: 'Some outdated fact.',
      extractionConfidence: 0.04,
      decayScore: 0.03,
      usageCount: 0,
      lastUsed: Date.now() - 200 * 24 * 60 * 60 * 1000,
    });
    // evaluate with itself as existing to trigger delete path
    const result = ops.evaluate(stale, [stale]);
    assert.strictEqual(result.action, ACTION_DELETE);
  }));

  // ── EDGE CASES ────────────────────────────────────────────────────────────

  record(test('create() with empty content returns NOOP with error reason', () => {
    const ops = new MemoryOperations();
    const incoming = makeRecord({ content: '' });
    const result = ops.create(incoming, []);
    assert.strictEqual(result.action, ACTION_NOOP);
    assert.ok(result.reason);
  }));

  record(test('create() with whitespace-only content returns NOOP', () => {
    const ops = new MemoryOperations();
    const incoming = makeRecord({ content: '   \n\t  ' });
    const result = ops.create(incoming, []);
    assert.strictEqual(result.action, ACTION_NOOP);
  }));

  record(test('update() on missing required field throws TypeError', () => {
    const ops = new MemoryOperations();
    assert.throws(
      () => ops.update(null, { content: 'x' }),
      TypeError,
      'Should throw TypeError when existing record is null'
    );
  }));

  record(test('textSimilarity() is symmetric', () => {
    const ops = new MemoryOperations();
    const a = 'The cat sat on the mat.';
    const b = 'A cat sat upon a mat.';
    const ab = ops.textSimilarity(a, b);
    const ba = ops.textSimilarity(b, a);
    assert.ok(Math.abs(ab - ba) < 1e-9, 'similarity should be symmetric');
  }));

  record(test('textSimilarity() returns 1.0 for identical strings', () => {
    const ops = new MemoryOperations();
    const s = 'Identical string for testing similarity.';
    assert.strictEqual(ops.textSimilarity(s, s), 1.0);
  }));

  record(test('textSimilarity() returns 0 for completely different strings', () => {
    const ops = new MemoryOperations();
    const sim = ops.textSimilarity('aaaaa bbbbb', 'zzzzz qqqqq');
    assert.ok(sim < 0.15, `Expected near-0 similarity, got ${sim}`);
  }));

  // ── SUMMARY ───────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-memory-operations.cjs`
Expected: FAIL — `Cannot find module '../core/memory-operations.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/memory-operations.cjs
'use strict';

/** @enum {string} */
const ACTION_CREATE = 'CREATE';
const ACTION_UPDATE = 'UPDATE';
const ACTION_DELETE = 'DELETE';
const ACTION_NOOP   = 'NOOP';

// Thresholds
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;
const DELETE_DECAY_THRESHOLD         = 0.05;
const DELETE_CONFIDENCE_THRESHOLD    = 0.08;
const DELETE_COMBINED_THRESHOLD      = 0.15; // decayScore + confidence combined

/**
 * Tokenise text into a Set of lowercase words (stop-words stripped).
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenise(text) {
  const STOP = new Set([
    'a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could',
    'should','may','might','shall','can','need','dare','ought',
    'used','of','in','on','at','to','for','with','by','from',
    'up','about','into','through','over','and','or','but','if',
    'as','it','its','this','that','these','those',
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP.has(w))
  );
}

/**
 * Jaccard similarity between two strings based on token overlap.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function textSimilarity(a, b) {
  if (a === b) return 1.0;
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

class MemoryOperations {
  /**
   * Expose similarity for tests / external callers.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  textSimilarity(a, b) {
    return textSimilarity(a, b);
  }

  // ── CREATE ────────────────────────────────────────────────────────────────

  /**
   * Decide whether an incoming record should be created.
   * @param {object} incoming  - Candidate MemoryRecord
   * @param {object[]} existing - Current records in the store
   * @returns {{ action: string, record?: object, reason?: string, similarTo?: object }}
   */
  create(incoming, existing) {
    const content = (incoming && incoming.content) || '';
    if (!content.trim()) {
      return { action: ACTION_NOOP, reason: 'Empty or whitespace content rejected.' };
    }

    for (const record of existing) {
      const sim = textSimilarity(content, record.content || '');
      if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
        return {
          action: ACTION_NOOP,
          reason: `Near-duplicate detected (similarity=${sim.toFixed(3)}).`,
          similarTo: record,
          similarity: sim,
        };
      }
    }

    return { action: ACTION_CREATE, record: incoming };
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────

  /**
   * Merge a patch into an existing record.
   * @param {object} existing
   * @param {object} patch
   * @returns {{ action: string, record?: object, reason?: string }}
   */
  update(existing, patch) {
    if (existing === null || existing === undefined) {
      throw new TypeError('update() requires a non-null existing record.');
    }

    const keys = Object.keys(patch).filter(k => patch[k] !== undefined);
    if (keys.length === 0) {
      return { action: ACTION_NOOP, reason: 'Patch is empty — nothing to update.' };
    }

    const updated = { ...existing };

    for (const key of keys) {
      if (key === 'tags' && Array.isArray(existing.tags) && Array.isArray(patch.tags)) {
        // Merge tag arrays de-duplicated
        updated.tags = [...new Set([...existing.tags, ...patch.tags])];
      } else if (key === 'usageCount' || key === 'usageSuccessRate') {
        // Preserve existing usage metrics — not overwritten by patch
        // (do nothing; already copied from existing)
      } else {
        updated[key] = patch[key];
      }
    }

    updated.updatedAt = Date.now();
    updated.version   = (existing.version || 1) + 1;

    return { action: ACTION_UPDATE, record: updated };
  }

  // ── DELETE ────────────────────────────────────────────────────────────────

  /**
   * Decide whether a record should be deleted.
   * @param {object} record
   * @returns {{ action: string, reason?: string }}
   */
  delete(record) {
    const decay      = record.decayScore          || 0;
    const confidence = record.extractionConfidence || 0;

    // Hard delete: either score independently below floor
    if (decay < DELETE_DECAY_THRESHOLD) {
      return { action: ACTION_DELETE, reason: `decayScore=${decay} below floor ${DELETE_DECAY_THRESHOLD}.` };
    }
    if (decay < DELETE_COMBINED_THRESHOLD && confidence < DELETE_CONFIDENCE_THRESHOLD) {
      return {
        action: ACTION_DELETE,
        reason: `decayScore=${decay} + confidence=${confidence} both critically low.`,
      };
    }

    return { action: ACTION_NOOP };
  }

  // ── EVALUATE ─────────────────────────────────────────────────────────────

  /**
   * Top-level decision: given incoming and existing records, pick best action.
   * Priority: DELETE check on incoming → duplicate check → CREATE.
   * @param {object} incoming
   * @param {object[]} existing
   * @returns {{ action: string, record?: object, reason?: string, similarTo?: object }}
   */
  evaluate(incoming, existing) {
    // 1. Should the incoming record itself be deleted (already degraded)?
    const deleteCheck = this.delete(incoming);
    if (deleteCheck.action === ACTION_DELETE) {
      return deleteCheck;
    }

    // 2. Check for duplicates / decide create
    const createCheck = this.create(incoming, existing);
    return createCheck;
  }
}

module.exports = {
  MemoryOperations,
  ACTION_CREATE,
  ACTION_UPDATE,
  ACTION_DELETE,
  ACTION_NOOP,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-memory-operations.cjs`
Expected: All 19 tests PASS

**Step 5: Commit**

```bash
git add core/memory-operations.cjs tests/test-memory-operations.cjs
git commit -m "feat(G1): structured memory CRUD operations with deduplication via Jaccard similarity"
```

---

### Task G2: Write Quality Scoring with Confidence Gates

**Files:**
- Create: `core/write-quality-scorer.cjs`
- Test: `tests/test-write-quality.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-write-quality-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal candidate object for scoring.
 * @param {Partial<{content:string, extractionConfidence:number, tags:string[], projectHash:string}>} overrides
 */
function candidate(overrides = {}) {
  return {
    content: 'To configure WAL mode in SQLite call PRAGMA journal_mode=WAL before opening the database.',
    extractionConfidence: 0.85,
    tags: ['sqlite', 'performance', 'database'],
    projectHash: 'proj_abc',
    type: 'procedure',
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\nTask G2: Write Quality Scoring with Confidence Gates\n');

  const {
    WriteQualityScorer,
    GATE_THRESHOLD,
    DECISION_WRITE,
    DECISION_SKIP,
    WEIGHTS,
  } = require('../core/write-quality-scorer.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── CONSTANTS ─────────────────────────────────────────────────────────────

  record(test('GATE_THRESHOLD is 0.4', () => {
    assert.strictEqual(GATE_THRESHOLD, 0.4);
  }));

  record(test('DECISION_WRITE and DECISION_SKIP constants exported', () => {
    assert.strictEqual(DECISION_WRITE, 'WRITE');
    assert.strictEqual(DECISION_SKIP,  'SKIP');
  }));

  record(test('WEIGHTS sum to 1.0', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `Weights sum to ${sum}, expected 1.0`);
  }));

  record(test('WEIGHTS has correct keys and values', () => {
    assert.strictEqual(WEIGHTS.specificity,   0.25);
    assert.strictEqual(WEIGHTS.novelty,       0.30);
    assert.strictEqual(WEIGHTS.actionability, 0.20);
    assert.strictEqual(WEIGHTS.confidence,    0.15);
    assert.strictEqual(WEIGHTS.relevance,     0.10);
  }));

  // ── OVERALL SCORE ─────────────────────────────────────────────────────────

  record(test('high-quality technical memory scores above 0.7', () => {
    const scorer = new WriteQualityScorer();
    const mem = candidate({
      content: 'Run PRAGMA journal_mode=WAL; immediately after opening a SQLite connection to enable write-ahead logging, which improves concurrent read performance by 3-5x.',
      extractionConfidence: 0.95,
      tags: ['sqlite', 'wal', 'performance', 'database', 'concurrency'],
    });
    const result = scorer.score(mem);
    assert.ok(result.score > 0.7, `Expected score > 0.7, got ${result.score.toFixed(3)}`);
    assert.strictEqual(result.decision, DECISION_WRITE);
  }));

  record(test('low-quality trivial content scores below 0.4', () => {
    const scorer = new WriteQualityScorer();
    const mem = candidate({
      content: 'hello world',
      extractionConfidence: 0.1,
      tags: [],
    });
    const result = scorer.score(mem);
    assert.ok(result.score < 0.4, `Expected score < 0.4, got ${result.score.toFixed(3)}`);
    assert.strictEqual(result.decision, DECISION_SKIP);
  }));

  record(test('empty content scores 0 and is SKIPped', () => {
    const scorer = new WriteQualityScorer();
    const result = scorer.score(candidate({ content: '' }));
    assert.strictEqual(result.score, 0);
    assert.strictEqual(result.decision, DECISION_SKIP);
  }));

  record(test('score is clamped between 0 and 1', () => {
    const scorer = new WriteQualityScorer();
    // Artificially extreme input
    const mem = candidate({ content: 'x', extractionConfidence: 2.5 });
    const result = scorer.score(mem);
    assert.ok(result.score >= 0 && result.score <= 1,
      `Score ${result.score} out of [0,1] range`);
  }));

  // ── GATE DECISION ─────────────────────────────────────────────────────────

  record(test('gate() returns WRITE when score >= GATE_THRESHOLD', () => {
    const scorer = new WriteQualityScorer();
    assert.strictEqual(scorer.gate(0.4), DECISION_WRITE);
    assert.strictEqual(scorer.gate(0.8), DECISION_WRITE);
    assert.strictEqual(scorer.gate(1.0), DECISION_WRITE);
  }));

  record(test('gate() returns SKIP when score < GATE_THRESHOLD', () => {
    const scorer = new WriteQualityScorer();
    assert.strictEqual(scorer.gate(0.0),  DECISION_SKIP);
    assert.strictEqual(scorer.gate(0.39), DECISION_SKIP);
    assert.strictEqual(scorer.gate(0.399), DECISION_SKIP);
  }));

  // ── INDIVIDUAL FACTORS ───────────────────────────────────────────────────

  record(test('scoreSpecificity() is low for vague content', () => {
    const scorer = new WriteQualityScorer();
    const vague = scorer.scoreSpecificity('things are sometimes good or bad');
    assert.ok(vague < 0.4, `Vague content specificity should be < 0.4, got ${vague}`);
  }));

  record(test('scoreSpecificity() is high for content with numbers/identifiers', () => {
    const scorer = new WriteQualityScorer();
    const specific = scorer.scoreSpecificity(
      'SQLite WAL checkpoint runs every 1000 pages; configure via PRAGMA wal_autocheckpoint=1000'
    );
    assert.ok(specific > 0.5, `Specific content should score > 0.5, got ${specific}`);
  }));

  record(test('scoreActionability() is high for imperative/procedural content', () => {
    const scorer = new WriteQualityScorer();
    const imperative = scorer.scoreActionability(
      'Run npm install --save-dev jest then configure jest.config.js to set testEnvironment to node.'
    );
    assert.ok(imperative > 0.5, `Imperative content should score > 0.5, got ${imperative}`);
  }));

  record(test('scoreActionability() is low for purely descriptive content', () => {
    const scorer = new WriteQualityScorer();
    const descriptive = scorer.scoreActionability(
      'The sky is blue because of Rayleigh scattering of sunlight.'
    );
    assert.ok(descriptive < 0.5, `Descriptive content should score < 0.5, got ${descriptive}`);
  }));

  record(test('scoreConfidence() maps extractionConfidence linearly', () => {
    const scorer = new WriteQualityScorer();
    assert.strictEqual(scorer.scoreConfidence(0.0), 0.0);
    assert.strictEqual(scorer.scoreConfidence(1.0), 1.0);
    assert.ok(Math.abs(scorer.scoreConfidence(0.5) - 0.5) < 1e-9);
  }));

  record(test('scoreConfidence() clamps values outside [0,1]', () => {
    const scorer = new WriteQualityScorer();
    assert.strictEqual(scorer.scoreConfidence(-0.5), 0.0);
    assert.strictEqual(scorer.scoreConfidence(1.5),  1.0);
  }));

  record(test('scoreRelevance() is higher when tags are present', () => {
    const scorer = new WriteQualityScorer();
    const withTags    = scorer.scoreRelevance(candidate({ tags: ['node', 'performance', 'async'] }));
    const withoutTags = scorer.scoreRelevance(candidate({ tags: [] }));
    assert.ok(withTags > withoutTags,
      `Tagged memory (${withTags}) should score higher than untagged (${withoutTags})`);
  }));

  record(test('scoreNovelty() returns a number in [0,1]', () => {
    const scorer = new WriteQualityScorer();
    const n = scorer.scoreNovelty('Some brand new insight.', []);
    assert.ok(n >= 0 && n <= 1, `Novelty ${n} out of [0,1]`);
  }));

  record(test('scoreNovelty() is lower when content overlaps existing memories', () => {
    const scorer = new WriteQualityScorer();
    const content = 'Node.js is built on the V8 JavaScript engine.';
    const existing = ['Node.js is built on V8 engine from Google.', 'V8 powers Node.js.'];
    const novel    = scorer.scoreNovelty('Deno uses the V8 engine and Rust.', existing);
    const overlap  = scorer.scoreNovelty(content, existing);
    assert.ok(novel > overlap,
      `Novel content (${novel.toFixed(3)}) should score higher than overlapping (${overlap.toFixed(3)})`);
  }));

  // ── BREAKDOWN ─────────────────────────────────────────────────────────────

  record(test('score() result includes breakdown of all 5 factors', () => {
    const scorer = new WriteQualityScorer();
    const result = scorer.score(candidate());
    assert.ok(typeof result.breakdown === 'object', 'Expected breakdown object');
    for (const factor of ['specificity', 'novelty', 'actionability', 'confidence', 'relevance']) {
      assert.ok(factor in result.breakdown, `Missing factor: ${factor}`);
      const v = result.breakdown[factor];
      assert.ok(v >= 0 && v <= 1, `Factor ${factor} value ${v} out of [0,1]`);
    }
  }));

  record(test('score() uses weighted sum of breakdown factors', () => {
    const scorer = new WriteQualityScorer();
    const result = scorer.score(candidate());
    const expected =
      result.breakdown.specificity   * WEIGHTS.specificity   +
      result.breakdown.novelty       * WEIGHTS.novelty       +
      result.breakdown.actionability * WEIGHTS.actionability +
      result.breakdown.confidence    * WEIGHTS.confidence    +
      result.breakdown.relevance     * WEIGHTS.relevance;
    assert.ok(Math.abs(result.score - Math.min(1, Math.max(0, expected))) < 1e-9,
      `score (${result.score}) should equal weighted sum (${expected.toFixed(6)})`);
  }));

  // ── SUMMARY ───────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-write-quality.cjs`
Expected: FAIL — `Cannot find module '../core/write-quality-scorer.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/write-quality-scorer.cjs
'use strict';

/** Gate threshold — scores below this are SKIPped. */
const GATE_THRESHOLD = 0.4;

const DECISION_WRITE = 'WRITE';
const DECISION_SKIP  = 'SKIP';

/**
 * Scoring weights — must sum to 1.0.
 * @type {Record<string,number>}
 */
const WEIGHTS = {
  specificity:   0.25,
  novelty:       0.30,
  actionability: 0.20,
  confidence:    0.15,
  relevance:     0.10,
};

// ── Signals ──────────────────────────────────────────────────────────────────

/** Words and patterns that indicate specificity / concreteness. */
const SPECIFIC_PATTERNS = [
  /\d+/,                     // numbers
  /[A-Z_]{2,}/,              // constants / identifiers
  /`[^`]+`/,                 // code snippets
  /\b(PRAGMA|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i,
  /\b(npm|yarn|pnpm|pip|cargo|go get)\b/i,
  /\b(--[a-z][\w-]+)/i,      // CLI flags
  /\b\d+(\.\d+)+\b/,         // version numbers
  /https?:\/\//,             // URLs
  /\b[a-z]+\.[a-z]{2,4}\b/i, // filenames / domains
];

/** Words that indicate actionability (imperative verbs, procedural language). */
const ACTION_WORDS = [
  'run', 'execute', 'install', 'configure', 'set', 'add', 'remove', 'create',
  'delete', 'update', 'enable', 'disable', 'start', 'stop', 'restart',
  'open', 'close', 'export', 'import', 'call', 'invoke', 'pass', 'return',
  'use', 'apply', 'append', 'prepend', 'write', 'read', 'send', 'receive',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp v to [lo, hi]. */
function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

/** Jaccard token similarity between two strings. */
function jaccardSim(a, b) {
  if (!a || !b) return 0;
  const tokenise = s => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  );
  const sa = tokenise(a);
  const sb = tokenise(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ── Class ─────────────────────────────────────────────────────────────────────

class WriteQualityScorer {
  /**
   * Score specificity of content text.
   * Counts matched specificity signals; normalises against total patterns.
   * @param {string} content
   * @returns {number} 0–1
   */
  scoreSpecificity(content) {
    if (!content || !content.trim()) return 0;
    const words = content.split(/\s+/).length;
    // Length bonus: more words = more opportunity for specifics
    const lengthBonus = clamp(words / 40, 0, 0.3);
    const patternScore = SPECIFIC_PATTERNS.reduce((acc, re) =>
      acc + (re.test(content) ? 1 : 0), 0
    ) / SPECIFIC_PATTERNS.length;
    return clamp(patternScore * 0.7 + lengthBonus);
  }

  /**
   * Score actionability: imperative / procedural density.
   * @param {string} content
   * @returns {number} 0–1
   */
  scoreActionability(content) {
    if (!content || !content.trim()) return 0;
    const words = content.toLowerCase().split(/\W+/).filter(Boolean);
    if (words.length === 0) return 0;
    const hits = words.filter(w => ACTION_WORDS.includes(w)).length;
    // Ratio with a generous ceiling so even 2-3 action words score well
    return clamp(hits / Math.max(1, words.length) * 8);
  }

  /**
   * Score confidence directly from extractionConfidence field.
   * @param {number} conf
   * @returns {number} 0–1
   */
  scoreConfidence(conf) {
    return clamp(typeof conf === 'number' ? conf : 0);
  }

  /**
   * Score relevance based on presence and count of tags.
   * @param {{ tags?: string[], projectHash?: string }} mem
   * @returns {number} 0–1
   */
  scoreRelevance(mem) {
    const tags = Array.isArray(mem.tags) ? mem.tags : [];
    const tagScore = clamp(tags.length / 5); // saturates at 5+ tags
    const projectBonus = mem.projectHash ? 0.1 : 0;
    return clamp(tagScore * 0.9 + projectBonus);
  }

  /**
   * Score novelty by comparing content against existing strings.
   * High similarity to existing = low novelty.
   * @param {string} content
   * @param {string[]} existingContents
   * @returns {number} 0–1
   */
  scoreNovelty(content, existingContents) {
    if (!content || !content.trim()) return 0;
    if (!existingContents || existingContents.length === 0) return 0.8;
    const maxSim = existingContents.reduce((max, ex) =>
      Math.max(max, jaccardSim(content, ex)), 0
    );
    // Invert: 0 similarity → high novelty, 1 similarity → 0 novelty
    return clamp(1 - maxSim);
  }

  /**
   * Gate decision based on raw score.
   * @param {number} score
   * @returns {'WRITE'|'SKIP'}
   */
  gate(score) {
    return score >= GATE_THRESHOLD ? DECISION_WRITE : DECISION_SKIP;
  }

  /**
   * Full scoring pipeline.
   * @param {{ content:string, extractionConfidence:number, tags:string[], projectHash?:string }} mem
   * @param {string[]} [existingContents=[]]
   * @returns {{ score:number, decision:string, breakdown:object }}
   */
  score(mem, existingContents = []) {
    const content = (mem && mem.content) || '';

    if (!content.trim()) {
      return { score: 0, decision: DECISION_SKIP, breakdown: {
        specificity: 0, novelty: 0, actionability: 0, confidence: 0, relevance: 0,
      }};
    }

    const breakdown = {
      specificity:   this.scoreSpecificity(content),
      novelty:       this.scoreNovelty(content, existingContents),
      actionability: this.scoreActionability(content),
      confidence:    this.scoreConfidence(mem.extractionConfidence),
      relevance:     this.scoreRelevance(mem),
    };

    const raw = Object.entries(WEIGHTS).reduce(
      (sum, [k, w]) => sum + breakdown[k] * w, 0
    );
    const score = clamp(raw);

    return { score, decision: this.gate(score), breakdown };
  }
}

module.exports = {
  WriteQualityScorer,
  GATE_THRESHOLD,
  DECISION_WRITE,
  DECISION_SKIP,
  WEIGHTS,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-write-quality.cjs`
Expected: All 20 tests PASS

**Step 5: Commit**

```bash
git add core/write-quality-scorer.cjs tests/test-write-quality.cjs
git commit -m "feat(G2): write quality scorer with 5-dimension scoring and confidence gate at 0.4"
```

---

### Task G3: Background Consolidation with Merge/Dedup

**Files:**
- Create: `core/consolidation-engine.cjs`
- Test: `tests/test-consolidation.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-consolidation-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

let _id = 0;
function mem(overrides = {}) {
  return {
    id: `mem_${++_id}`,
    version: 1,
    type: 'fact',
    content: 'Default content for testing.',
    summary: 'Default summary.',
    projectHash: 'proj_test',
    tags: [],
    intent: 'recall',
    sourceSessionId: 'sess_001',
    sourceTimestamp: Date.now(),
    extractionConfidence: 0.8,
    usageCount: 5,
    usageSuccessRate: 0.9,
    lastUsed: Date.now() - 1000,
    decayScore: 0.9,
    embedding: null,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\nTask G3: Background Consolidation with Merge/Dedup\n');

  const {
    ConsolidationEngine,
    STRATEGY_DEDUP,
    STRATEGY_MERGE,
    STRATEGY_SUMMARIZE,
    STRATEGY_PRUNE,
    STRATEGY_DECAY,
  } = require('../core/consolidation-engine.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── CONSTANTS ─────────────────────────────────────────────────────────────

  record(test('strategy constants exported', () => {
    assert.strictEqual(STRATEGY_DEDUP,     'dedup');
    assert.strictEqual(STRATEGY_MERGE,     'merge');
    assert.strictEqual(STRATEGY_SUMMARIZE, 'summarize');
    assert.strictEqual(STRATEGY_PRUNE,     'prune');
    assert.strictEqual(STRATEGY_DECAY,     'decay');
  }));

  // ── EMPTY / TRIVIAL INPUT ─────────────────────────────────────────────────

  record(test('consolidate([]) returns empty array', () => {
    const engine = new ConsolidationEngine();
    const result = engine.consolidate([]);
    assert.ok(Array.isArray(result.memories));
    assert.strictEqual(result.memories.length, 0);
  }));

  record(test('consolidate([single]) passes single memory through unchanged', () => {
    const engine = new ConsolidationEngine();
    const single = mem({ content: 'Only one memory here.' });
    const result = engine.consolidate([single]);
    assert.strictEqual(result.memories.length, 1);
    assert.strictEqual(result.memories[0].id, single.id);
  }));

  // ── STRATEGY 1: EXACT DEDUP ───────────────────────────────────────────────

  record(test('dedup removes exact content duplicates', () => {
    const engine = new ConsolidationEngine();
    const content = 'Node.js uses libuv for its event loop implementation.';
    const records = [
      mem({ content }),
      mem({ content }),
      mem({ content }),
    ];
    const result = engine.consolidate(records);
    const remaining = result.memories.filter(m => m.content === content);
    assert.strictEqual(remaining.length, 1, 'Only one copy should survive');
    assert.ok(result.stats.deduplicated >= 2, `Expected >=2 deduped, got ${result.stats.deduplicated}`);
  }));

  record(test('dedup keeps the highest-confidence duplicate', () => {
    const engine = new ConsolidationEngine();
    const content = 'Exact duplicate content string for testing.';
    const low  = mem({ content, extractionConfidence: 0.3, id: 'low'  });
    const high = mem({ content, extractionConfidence: 0.9, id: 'high' });
    const med  = mem({ content, extractionConfidence: 0.6, id: 'med'  });
    const result = engine.consolidate([low, high, med]);
    assert.strictEqual(result.memories[0].id, 'high',
      'Highest confidence duplicate should be retained');
  }));

  record(test('dedup preserves distinct content', () => {
    const engine = new ConsolidationEngine();
    const records = [
      mem({ content: 'Python uses GIL for thread safety.' }),
      mem({ content: 'Go uses goroutines for concurrency.' }),
      mem({ content: 'Rust uses ownership to prevent data races.' }),
    ];
    const result = engine.consolidate(records);
    assert.strictEqual(result.memories.length, 3, 'All distinct records should survive');
  }));

  // ── STRATEGY 2: MERGE SIMILAR ─────────────────────────────────────────────

  record(test('similar memories are merged into one (>0.85 similarity)', () => {
    const engine = new ConsolidationEngine();
    const records = [
      mem({ id: 'a', content: 'WAL mode in SQLite improves concurrent read performance.' }),
      mem({ id: 'b', content: 'SQLite WAL mode helps improve performance for concurrent reads.' }),
    ];
    const result = engine.consolidate(records);
    assert.ok(result.memories.length < records.length,
      `Should have fewer than ${records.length} memories after merge`);
    assert.ok(result.stats.merged >= 1, `Expected >=1 merged, got ${result.stats.merged}`);
  }));

  record(test('merged memory tracks provenance via merged_from array', () => {
    const engine = new ConsolidationEngine();
    const records = [
      mem({ id: 'src_a', content: 'Redis is an in-memory data structure store used as a cache.' }),
      mem({ id: 'src_b', content: 'Redis is an in-memory store commonly used for caching data.' }),
    ];
    const result = engine.consolidate(records);
    const merged = result.memories.find(m => m.merged_from && m.merged_from.length > 0);
    assert.ok(merged, 'Merged record should exist');
    assert.ok(Array.isArray(merged.merged_from), 'merged_from should be an array');
    assert.ok(merged.merged_from.length >= 2, 'Should reference at least 2 source IDs');
    assert.ok(merged.merged_from.includes('src_a'), 'Should include src_a');
    assert.ok(merged.merged_from.includes('src_b'), 'Should include src_b');
  }));

  record(test('dissimilar memories are NOT merged', () => {
    const engine = new ConsolidationEngine();
    const records = [
      mem({ content: 'Docker containers share the host OS kernel.' }),
      mem({ content: 'TypeScript adds static typing to JavaScript.' }),
    ];
    const result = engine.consolidate(records);
    assert.strictEqual(result.memories.length, 2, 'Dissimilar memories should not be merged');
    assert.strictEqual(result.stats.merged, 0);
  }));

  // ── STRATEGY 3: SUMMARIZE CLUSTERS ────────────────────────────────────────

  record(test('large cluster (>5 members) gets summarized', () => {
    const engine = new ConsolidationEngine();
    // Create 7 memories on the same topic (high similarity)
    const base = 'JavaScript promises allow asynchronous code to run without blocking';
    const records = [
      mem({ content: base + ' the main thread.' }),
      mem({ content: base + ' the event loop.' }),
      mem({ content: base + ' the call stack in Node.' }),
      mem({ content: base + ' the UI thread in browsers.' }),
      mem({ content: base + ' the current execution context.' }),
      mem({ content: base + ' other synchronous operations.' }),
      mem({ content: base + ' the runtime environment.' }),
    ];
    const result = engine.consolidate(records);
    assert.ok(result.stats.summarized >= 1, `Expected >=1 cluster summarized, got ${result.stats.summarized}`);
    // Result should have fewer records than input
    assert.ok(result.memories.length < records.length,
      `Cluster of 7 should condense; got ${result.memories.length}`);
  }));

  record(test('small cluster (<= 5 members) is NOT summarized', () => {
    const engine = new ConsolidationEngine();
    // 3 moderately similar but distinct records
    const records = [
      mem({ content: 'async/await is syntactic sugar over promises in JavaScript.' }),
      mem({ content: 'await pauses execution inside an async function until promise resolves.' }),
      mem({ content: 'async functions always return a Promise.' }),
    ];
    const result = engine.consolidate(records);
    assert.strictEqual(result.stats.summarized, 0,
      'Cluster with <=5 members should not be summarized');
  }));

  // ── STRATEGY 4: PRUNE STALE ───────────────────────────────────────────────

  record(test('memories with confidence < 0.1 are pruned', () => {
    const engine = new ConsolidationEngine();
    const records = [
      mem({ id: 'keep_a', extractionConfidence: 0.8, decayScore: 0.7 }),
      mem({ id: 'prune_x', extractionConfidence: 0.05, decayScore: 0.04 }),
      mem({ id: 'keep_b', extractionConfidence: 0.6, decayScore: 0.5 }),
      mem({ id: 'prune_y', extractionConfidence: 0.02, decayScore: 0.02 }),
    ];
    const result = engine.consolidate(records);
    const ids = result.memories.map(m => m.id);
    assert.ok(ids.includes('keep_a'), 'keep_a should survive');
    assert.ok(ids.includes('keep_b'), 'keep_b should survive');
    assert.ok(!ids.includes('prune_x'), 'prune_x should be removed');
    assert.ok(!ids.includes('prune_y'), 'prune_y should be removed');
    assert.ok(result.stats.pruned >= 2, `Expected >=2 pruned, got ${result.stats.pruned}`);
  }));

  record(test('healthy memories survive pruning', () => {
    const engine = new ConsolidationEngine();
    const records = [
      mem({ extractionConfidence: 0.9, decayScore: 0.95 }),
      mem({ extractionConfidence: 0.7, decayScore: 0.80 }),
    ];
    const result = engine.consolidate(records);
    assert.strictEqual(result.stats.pruned, 0);
    assert.strictEqual(result.memories.length, 2);
  }));

  // ── STRATEGY 5: CONFIDENCE DECAY UPDATE ──────────────────────────────────

  record(test('decay updates decayScore on surviving records', () => {
    const engine = new ConsolidationEngine();
    const old = mem({
      decayScore: 1.0,
      lastUsed: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      usageCount: 2,
    });
    const result = engine.consolidate([old]);
    const updated = result.memories[0];
    assert.ok(updated.decayScore <= 1.0, 'decayScore should not exceed 1.0');
    assert.ok(typeof updated.decayScore === 'number', 'decayScore should be a number');
    assert.ok(result.stats.decayUpdated >= 1, 'At least one decay update expected');
  }));

  record(test('recently used memory has higher decay score than old memory', () => {
    const engine = new ConsolidationEngine();
    const fresh = mem({ id: 'fresh', decayScore: 0.9, lastUsed: Date.now() - 1000, usageCount: 10 });
    const stale = mem({ id: 'stale', decayScore: 0.9, lastUsed: Date.now() - 180 * 24 * 60 * 60 * 1000, usageCount: 1 });
    const result = engine.consolidate([fresh, stale]);
    const freshOut = result.memories.find(m => m.id === 'fresh');
    const staleOut = result.memories.find(m => m.id === 'stale');
    if (freshOut && staleOut) {
      assert.ok(freshOut.decayScore > staleOut.decayScore,
        `Fresh (${freshOut.decayScore.toFixed(3)}) should beat stale (${staleOut.decayScore.toFixed(3)})`);
    }
  }));

  // ── PIPELINE STATS ────────────────────────────────────────────────────────

  record(test('consolidate() result includes stats object with all strategy keys', () => {
    const engine = new ConsolidationEngine();
    const result = engine.consolidate([mem()]);
    assert.ok(typeof result.stats === 'object');
    for (const key of ['deduplicated', 'merged', 'summarized', 'pruned', 'decayUpdated']) {
      assert.ok(key in result.stats, `Missing stat: ${key}`);
    }
  }));

  record(test('consolidate() result includes strategies_run array', () => {
    const engine = new ConsolidationEngine();
    const result = engine.consolidate([mem()]);
    assert.ok(Array.isArray(result.strategies_run));
    assert.ok(result.strategies_run.length === 5,
      `Expected 5 strategies, got ${result.strategies_run.length}`);
  }));

  // ── SUMMARY ───────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-consolidation.cjs`
Expected: FAIL — `Cannot find module '../core/consolidation-engine.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/consolidation-engine.cjs
'use strict';

const STRATEGY_DEDUP     = 'dedup';
const STRATEGY_MERGE     = 'merge';
const STRATEGY_SUMMARIZE = 'summarize';
const STRATEGY_PRUNE     = 'prune';
const STRATEGY_DECAY     = 'decay';

const MERGE_SIMILARITY_THRESHOLD     = 0.85;
const SUMMARIZE_CLUSTER_MIN_SIZE     = 6;   // >5
const PRUNE_CONFIDENCE_THRESHOLD     = 0.1;
const DECAY_HALF_LIFE_DAYS           = 90;
const DECAY_BASE                     = Math.LN2 / DECAY_HALF_LIFE_DAYS;

// ── Text helpers ───────────────────────────────────────────────────────────

function tokenise(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
  );
}

function jaccardSim(a, b) {
  const sa = tokenise(a);
  const sb = tokenise(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ── Strategy implementations ───────────────────────────────────────────────

/**
 * Strategy 1: Remove exact content duplicates, keeping highest-confidence copy.
 */
function strategyDedup(memories) {
  const byContent = new Map(); // content → best record
  let deduplicated = 0;

  for (const m of memories) {
    const key = (m.content || '').trim();
    if (!byContent.has(key)) {
      byContent.set(key, m);
    } else {
      deduplicated++;
      const existing = byContent.get(key);
      if ((m.extractionConfidence || 0) > (existing.extractionConfidence || 0)) {
        byContent.set(key, m);
      }
    }
  }

  return { memories: [...byContent.values()], deduplicated };
}

/**
 * Strategy 2: Merge similar records (Jaccard > threshold).
 * Uses greedy clustering: first unassigned record seeds each cluster.
 */
function strategyMerge(memories) {
  const used   = new Set();
  const result = [];
  let merged   = 0;

  for (let i = 0; i < memories.length; i++) {
    if (used.has(i)) continue;

    const cluster = [memories[i]];
    used.add(i);

    for (let j = i + 1; j < memories.length; j++) {
      if (used.has(j)) continue;
      const sim = jaccardSim(memories[i].content, memories[j].content);
      if (sim >= MERGE_SIMILARITY_THRESHOLD) {
        cluster.push(memories[j]);
        used.add(j);
      }
    }

    if (cluster.length === 1) {
      result.push(cluster[0]);
    } else {
      merged += cluster.length - 1;
      // Pick highest confidence as base; annotate with provenance
      const base = cluster.slice().sort(
        (a, b) => (b.extractionConfidence || 0) - (a.extractionConfidence || 0)
      )[0];
      // Merge tags from all members
      const mergedTags = [...new Set(cluster.flatMap(m => m.tags || []))];
      result.push({
        ...base,
        tags: mergedTags,
        merged_from: cluster.map(m => m.id),
        updatedAt: Date.now(),
        version: (base.version || 1) + 1,
      });
    }
  }

  return { memories: result, merged };
}

/**
 * Strategy 3: Summarize large clusters of topically similar records.
 * Clusters by top-token overlap; clusters > SUMMARIZE_CLUSTER_MIN_SIZE are condensed.
 */
function strategySummarize(memories) {
  if (memories.length <= SUMMARIZE_CLUSTER_MIN_SIZE) {
    return { memories, summarized: 0 };
  }

  // Build similarity graph; greedy cluster with a representative
  const used       = new Set();
  const result     = [];
  let summarized   = 0;

  for (let i = 0; i < memories.length; i++) {
    if (used.has(i)) continue;

    const cluster = [memories[i]];
    used.add(i);

    for (let j = i + 1; j < memories.length; j++) {
      if (used.has(j)) continue;
      const sim = jaccardSim(memories[i].content, memories[j].content);
      if (sim >= 0.5) { // looser threshold for clustering than merge
        cluster.push(memories[j]);
        used.add(j);
      }
    }

    if (cluster.length > SUMMARIZE_CLUSTER_MIN_SIZE) {
      summarized++;
      // Representative = highest usageCount
      const rep = cluster.slice().sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))[0];
      // Build a summary content from cluster
      const summaryContent = `[Cluster of ${cluster.length}] ${rep.content}`;
      result.push({
        ...rep,
        content:      summaryContent,
        merged_from:  cluster.map(m => m.id),
        updatedAt:    Date.now(),
        version:      (rep.version || 1) + 1,
      });
    } else {
      result.push(...cluster);
    }
  }

  return { memories: result, summarized };
}

/**
 * Strategy 4: Prune records with confidence + decayScore critically low.
 */
function strategyPrune(memories) {
  const result = [];
  let pruned   = 0;

  for (const m of memories) {
    const conf  = m.extractionConfidence || 0;
    const decay = m.decayScore           || 0;
    if (conf < PRUNE_CONFIDENCE_THRESHOLD && decay < PRUNE_CONFIDENCE_THRESHOLD) {
      pruned++;
    } else {
      result.push(m);
    }
  }

  return { memories: result, pruned };
}

/**
 * Strategy 5: Update decayScore based on time-since-lastUsed and usageCount.
 * decay = exp(-λ * days). Access boost = min(0.3, count * 0.05).
 */
function strategyDecay(memories) {
  const now          = Date.now();
  const MS_PER_DAY   = 24 * 60 * 60 * 1000;
  let decayUpdated   = 0;

  const result = memories.map(m => {
    const lastUsed = m.lastUsed || m.createdAt || now;
    const days     = (now - lastUsed) / MS_PER_DAY;
    const base     = Math.exp(-DECAY_BASE * days);
    const boost    = Math.min(0.3, (m.usageCount || 0) * 0.05);
    const newScore = Math.min(1.0, base + boost);

    if (Math.abs(newScore - (m.decayScore || 0)) > 1e-6) {
      decayUpdated++;
    }

    return { ...m, decayScore: newScore, updatedAt: now };
  });

  return { memories: result, decayUpdated };
}

// ── Engine ─────────────────────────────────────────────────────────────────

class ConsolidationEngine {
  /**
   * Run the 5-strategy consolidation pipeline.
   * @param {object[]} memories
   * @returns {{ memories: object[], stats: object, strategies_run: string[] }}
   */
  consolidate(memories) {
    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        memories: [],
        stats: { deduplicated: 0, merged: 0, summarized: 0, pruned: 0, decayUpdated: 0 },
        strategies_run: [STRATEGY_DEDUP, STRATEGY_MERGE, STRATEGY_SUMMARIZE, STRATEGY_PRUNE, STRATEGY_DECAY],
      };
    }

    const stats = { deduplicated: 0, merged: 0, summarized: 0, pruned: 0, decayUpdated: 0 };
    let current = memories;

    // 1. Exact dedup
    const d1 = strategyDedup(current);
    current            = d1.memories;
    stats.deduplicated = d1.deduplicated;

    // 2. Merge similar
    const d2 = strategyMerge(current);
    current      = d2.memories;
    stats.merged = d2.merged;

    // 3. Summarize clusters
    const d3 = strategySummarize(current);
    current          = d3.memories;
    stats.summarized = d3.summarized;

    // 4. Prune stale
    const d4 = strategyPrune(current);
    current      = d4.memories;
    stats.pruned = d4.pruned;

    // 5. Decay update
    const d5 = strategyDecay(current);
    current             = d5.memories;
    stats.decayUpdated  = d5.decayUpdated;

    return {
      memories:       current,
      stats,
      strategies_run: [STRATEGY_DEDUP, STRATEGY_MERGE, STRATEGY_SUMMARIZE, STRATEGY_PRUNE, STRATEGY_DECAY],
    };
  }
}

module.exports = {
  ConsolidationEngine,
  STRATEGY_DEDUP,
  STRATEGY_MERGE,
  STRATEGY_SUMMARIZE,
  STRATEGY_PRUNE,
  STRATEGY_DECAY,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-consolidation.cjs`
Expected: All 19 tests PASS

**Step 5: Commit**

```bash
git add core/consolidation-engine.cjs tests/test-consolidation.cjs
git commit -m "feat(G3): 5-strategy consolidation pipeline with dedup, merge, summarize, prune, decay"
```

---

### Task G4: Usage Tracking and Access Patterns

**Files:**
- Create: `core/usage-tracker.cjs`
- Test: `tests/test-usage-tracking.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-usage-tracking-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function freshRecord(overrides = {}) {
  return {
    id: 'mem_' + Math.random().toString(36).slice(2),
    access_count: 0,
    last_accessed: null,
    access_pattern: [],
    ...overrides,
  };
}

const SECONDS = 1000;
const MINUTES = 60 * SECONDS;
const HOURS   = 60 * MINUTES;
const DAYS    = 24 * HOURS;

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\nTask G4: Usage Tracking and Access Patterns\n');

  const {
    UsageTracker,
    recencyBoost,
    frequencyBoost,
    combinedBoost,
    MAX_PATTERN_LENGTH,
  } = require('../core/usage-tracker.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── CONSTANTS ─────────────────────────────────────────────────────────────

  record(test('MAX_PATTERN_LENGTH is 20', () => {
    assert.strictEqual(MAX_PATTERN_LENGTH, 20);
  }));

  // ── recordAccess() ────────────────────────────────────────────────────────

  record(test('recordAccess() increments access_count from 0', () => {
    const tracker = new UsageTracker();
    const rec = freshRecord();
    const updated = tracker.recordAccess(rec);
    assert.strictEqual(updated.access_count, 1);
  }));

  record(test('recordAccess() increments access_count from existing value', () => {
    const tracker = new UsageTracker();
    const rec = freshRecord({ access_count: 7 });
    const updated = tracker.recordAccess(rec);
    assert.strictEqual(updated.access_count, 8);
  }));

  record(test('recordAccess() sets last_accessed to approximately now', () => {
    const tracker = new UsageTracker();
    const before = Date.now();
    const updated = tracker.recordAccess(freshRecord());
    const after = Date.now();
    assert.ok(
      updated.last_accessed >= before && updated.last_accessed <= after,
      `last_accessed ${updated.last_accessed} should be between ${before} and ${after}`
    );
  }));

  record(test('recordAccess() appends timestamp to access_pattern', () => {
    const tracker = new UsageTracker();
    const rec = freshRecord({ access_pattern: [100, 200, 300] });
    const updated = tracker.recordAccess(rec);
    assert.strictEqual(updated.access_pattern.length, 4);
    assert.ok(updated.access_pattern[3] > 300, 'New timestamp should be most recent');
  }));

  record(test('recordAccess() caps access_pattern at MAX_PATTERN_LENGTH (20)', () => {
    const tracker = new UsageTracker();
    const pattern = Array.from({ length: 20 }, (_, i) => Date.now() - (20 - i) * 1000);
    const rec = freshRecord({ access_count: 20, access_pattern: pattern });
    const updated = tracker.recordAccess(rec);
    assert.strictEqual(updated.access_pattern.length, 20,
      'access_pattern should not exceed 20 entries');
    // Most recent should be the newest
    const newest = updated.access_pattern[updated.access_pattern.length - 1];
    assert.ok(newest > pattern[pattern.length - 1], 'Newest timestamp should be appended');
  }));

  record(test('recordAccess() does not mutate the original record', () => {
    const tracker = new UsageTracker();
    const rec = freshRecord({ access_count: 3 });
    tracker.recordAccess(rec);
    assert.strictEqual(rec.access_count, 3, 'Original should be unchanged (immutable update)');
  }));

  // ── recencyBoost() ────────────────────────────────────────────────────────

  record(test('recencyBoost exports as pure function', () => {
    assert.strictEqual(typeof recencyBoost, 'function');
  }));

  record(test('recencyBoost(0 days) ≈ 1.0', () => {
    const boost = recencyBoost(Date.now());
    assert.ok(Math.abs(boost - 1.0) < 0.01, `Expected ~1.0, got ${boost}`);
  }));

  record(test('recencyBoost(7 days) ≈ exp(-1) ≈ 0.368', () => {
    const sevenDaysAgo = Date.now() - 7 * DAYS;
    const boost = recencyBoost(sevenDaysAgo);
    const expected = Math.exp(-1);
    assert.ok(Math.abs(boost - expected) < 0.01,
      `Expected ~${expected.toFixed(3)}, got ${boost.toFixed(3)}`);
  }));

  record(test('recencyBoost(14 days) ≈ exp(-2) ≈ 0.135', () => {
    const fourteenDaysAgo = Date.now() - 14 * DAYS;
    const boost = recencyBoost(fourteenDaysAgo);
    const expected = Math.exp(-2);
    assert.ok(Math.abs(boost - expected) < 0.01,
      `Expected ~${expected.toFixed(3)}, got ${boost.toFixed(3)}`);
  }));

  record(test('recencyBoost is monotonically decreasing over time', () => {
    const t0 = recencyBoost(Date.now());
    const t7 = recencyBoost(Date.now() - 7  * DAYS);
    const t30 = recencyBoost(Date.now() - 30 * DAYS);
    const t90 = recencyBoost(Date.now() - 90 * DAYS);
    assert.ok(t0 > t7, 'boost should decrease over time');
    assert.ok(t7 > t30);
    assert.ok(t30 > t90);
  }));

  record(test('recencyBoost(null) returns 0', () => {
    assert.strictEqual(recencyBoost(null), 0);
  }));

  // ── frequencyBoost() ──────────────────────────────────────────────────────

  record(test('frequencyBoost exports as pure function', () => {
    assert.strictEqual(typeof frequencyBoost, 'function');
  }));

  record(test('frequencyBoost(0) = 0', () => {
    assert.strictEqual(frequencyBoost(0), 0);
  }));

  record(test('frequencyBoost(1) = log(2)/5', () => {
    const expected = Math.log(2) / 5;
    const actual   = frequencyBoost(1);
    assert.ok(Math.abs(actual - expected) < 1e-9,
      `Expected ${expected.toFixed(6)}, got ${actual.toFixed(6)}`);
  }));

  record(test('frequencyBoost is logarithmic (grows slower as count increases)', () => {
    const b1   = frequencyBoost(1);
    const b10  = frequencyBoost(10);
    const b100 = frequencyBoost(100);
    // Each 10x increase should add less than the previous
    const delta1to10  = b10  - b1;
    const delta10to100 = b100 - b10;
    assert.ok(delta1to10 > delta10to100,
      'Logarithmic growth: increment should slow as count increases');
  }));

  record(test('frequencyBoost is in [0,1] range for any non-negative count', () => {
    for (const n of [0, 1, 5, 10, 50, 100, 1000, 1e6]) {
      const b = frequencyBoost(n);
      assert.ok(b >= 0 && b <= 1, `frequencyBoost(${n}) = ${b} out of [0,1]`);
    }
  }));

  // ── combinedBoost() ───────────────────────────────────────────────────────

  record(test('combinedBoost = 0.6*recency + 0.4*frequency', () => {
    const lastAccessed = Date.now() - 3 * DAYS;
    const count        = 5;
    const expected     = 0.6 * recencyBoost(lastAccessed) + 0.4 * frequencyBoost(count);
    const actual       = combinedBoost(lastAccessed, count);
    assert.ok(Math.abs(actual - expected) < 1e-9,
      `Expected ${expected.toFixed(6)}, got ${actual.toFixed(6)}`);
  }));

  record(test('combinedBoost is in [0,1] range', () => {
    const pairs = [
      [Date.now(), 0],
      [Date.now() - 7 * DAYS, 10],
      [Date.now() - 365 * DAYS, 1],
      [null, 0],
    ];
    for (const [lastAccessed, count] of pairs) {
      const b = combinedBoost(lastAccessed, count);
      assert.ok(b >= 0 && b <= 1, `combinedBoost(${lastAccessed},${count}) = ${b} out of [0,1]`);
    }
  }));

  record(test('new memory with 0 accesses gets baseline combinedBoost of 0', () => {
    const boost = combinedBoost(null, 0);
    assert.strictEqual(boost, 0);
  }));

  record(test('frequently accessed recent memory scores higher than rarely accessed old memory', () => {
    const frequent = combinedBoost(Date.now() - DAYS, 50);
    const rare     = combinedBoost(Date.now() - 90 * DAYS, 1);
    assert.ok(frequent > rare,
      `Frequent recent (${frequent.toFixed(3)}) should beat rare old (${rare.toFixed(3)})`);
  }));

  // ── UsageTracker.boostForRecord() ────────────────────────────────────────

  record(test('boostForRecord() uses last_accessed and access_count fields', () => {
    const tracker = new UsageTracker();
    const rec = freshRecord({ access_count: 10, last_accessed: Date.now() - 2 * DAYS });
    const boost = tracker.boostForRecord(rec);
    const expected = combinedBoost(rec.last_accessed, rec.access_count);
    assert.ok(Math.abs(boost - expected) < 1e-9);
  }));

  record(test('boostForRecord() returns 0 for brand-new unaccessed record', () => {
    const tracker = new UsageTracker();
    const rec = freshRecord({ access_count: 0, last_accessed: null });
    assert.strictEqual(tracker.boostForRecord(rec), 0);
  }));

  // ── SUMMARY ───────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-usage-tracking.cjs`
Expected: FAIL — `Cannot find module '../core/usage-tracker.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/usage-tracker.cjs
'use strict';

const MAX_PATTERN_LENGTH = 20;
const MS_PER_DAY         = 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE  = 7; // days; λ = ln2/7
const RECENCY_LAMBDA     = Math.LN2 / RECENCY_HALF_LIFE;

// ── Pure boost functions ───────────────────────────────────────────────────

/**
 * Recency boost: exp(-λ * days_since_access).
 * Returns 0 if last_accessed is null/undefined.
 * @param {number|null} lastAccessedMs
 * @returns {number} 0–1
 */
function recencyBoost(lastAccessedMs) {
  if (!lastAccessedMs) return 0;
  const days = (Date.now() - lastAccessedMs) / MS_PER_DAY;
  return Math.exp(-RECENCY_LAMBDA * days);
}

/**
 * Frequency boost: log(1+count)/5.
 * Logarithmic, clamped to [0,1].
 * @param {number} count
 * @returns {number} 0–1
 */
function frequencyBoost(count) {
  if (!count || count <= 0) return 0;
  return Math.min(1, Math.log(1 + count) / 5);
}

/**
 * Combined boost: 0.6 * recency + 0.4 * frequency.
 * @param {number|null} lastAccessedMs
 * @param {number} count
 * @returns {number} 0–1
 */
function combinedBoost(lastAccessedMs, count) {
  return 0.6 * recencyBoost(lastAccessedMs) + 0.4 * frequencyBoost(count);
}

// ── Class ─────────────────────────────────────────────────────────────────

class UsageTracker {
  /**
   * Record a single access event on a memory record.
   * Returns a new record object (immutable update).
   * @param {{ access_count:number, last_accessed:number|null, access_pattern:number[] }} record
   * @returns {object}
   */
  recordAccess(record) {
    const now = Date.now();
    const prevCount   = record.access_count   || 0;
    const prevPattern = Array.isArray(record.access_pattern) ? record.access_pattern : [];

    // Append new timestamp and trim to MAX_PATTERN_LENGTH (keep newest)
    const newPattern = [...prevPattern, now].slice(-MAX_PATTERN_LENGTH);

    return {
      ...record,
      access_count:   prevCount + 1,
      last_accessed:  now,
      access_pattern: newPattern,
    };
  }

  /**
   * Calculate the combined recency-frequency boost for a record.
   * @param {{ last_accessed:number|null, access_count:number }} record
   * @returns {number} 0–1
   */
  boostForRecord(record) {
    return combinedBoost(
      record.last_accessed || null,
      record.access_count  || 0
    );
  }
}

module.exports = {
  UsageTracker,
  recencyBoost,
  frequencyBoost,
  combinedBoost,
  MAX_PATTERN_LENGTH,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-usage-tracking.cjs`
Expected: All 24 tests PASS

**Step 5: Commit**

```bash
git add core/usage-tracker.cjs tests/test-usage-tracking.cjs
git commit -m "feat(G4): usage tracking with recency/frequency boost (exp decay + log frequency)"
```

---

### Task G5: Confidence Decay with Preference-Aware Updates

**Files:**
- Create: `core/preference-decay.cjs`
- Test: `tests/test-preference-decay.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-preference-decay-' + Date.now());

function setup() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

const DAYS = 24 * 60 * 60 * 1000;

function mem(overrides = {}) {
  return {
    id: 'mem_' + Math.random().toString(36).slice(2),
    type: 'preference',
    topic: 'coding-style',
    extractionConfidence: 0.8,
    usageCount: 5,
    lastUsed: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\nTask G5: Confidence Decay with Preference-Aware Updates\n');

  const {
    PreferenceDecay,
    computeDecay,
    HALF_LIFE_DAYS,
    CONFIDENCE_FLOOR,
    NEW_PREFERENCE_CONFIDENCE,
  } = require('../core/preference-decay.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── CONSTANTS ─────────────────────────────────────────────────────────────

  record(test('HALF_LIFE_DAYS is 90', () => {
    assert.strictEqual(HALF_LIFE_DAYS, 90);
  }));

  record(test('CONFIDENCE_FLOOR is 0.05', () => {
    assert.strictEqual(CONFIDENCE_FLOOR, 0.05);
  }));

  record(test('NEW_PREFERENCE_CONFIDENCE is 0.9', () => {
    assert.strictEqual(NEW_PREFERENCE_CONFIDENCE, 0.9);
  }));

  // ── computeDecay() — base formula ─────────────────────────────────────────

  record(test('computeDecay() exports as pure function', () => {
    assert.strictEqual(typeof computeDecay, 'function');
  }));

  record(test('decay at 0 days = 1.0 (no boost, new memory)', () => {
    const result = computeDecay({ days: 0, usageCount: 0 });
    assert.ok(Math.abs(result - 1.0) < 0.001, `Expected ~1.0, got ${result}`);
  }));

  record(test('decay at 90 days (half-life) ≈ 0.5 with 0 usageCount', () => {
    const result = computeDecay({ days: 90, usageCount: 0 });
    assert.ok(Math.abs(result - 0.5) < 0.01,
      `Expected ~0.5 at half-life, got ${result.toFixed(4)}`);
  }));

  record(test('decay at 180 days ≈ 0.25 with 0 usageCount', () => {
    const result = computeDecay({ days: 180, usageCount: 0 });
    assert.ok(Math.abs(result - 0.25) < 0.01,
      `Expected ~0.25 at double half-life, got ${result.toFixed(4)}`);
  }));

  record(test('decay at 30 days is between 0.5 and 1.0', () => {
    const result = computeDecay({ days: 30, usageCount: 0 });
    assert.ok(result > 0.5 && result < 1.0,
      `Expected (0.5, 1.0), got ${result.toFixed(4)}`);
  }));

  // ── Access boost ─────────────────────────────────────────────────────────

  record(test('access boost caps at 0.3 (6+ accesses × 0.05)', () => {
    const withoutBoost = computeDecay({ days: 30, usageCount: 0  });
    const withBoost    = computeDecay({ days: 30, usageCount: 6  });
    const maxBoost     = computeDecay({ days: 30, usageCount: 100 });
    assert.ok(withBoost > withoutBoost, 'Access should improve score');
    assert.ok(Math.abs(maxBoost - withBoost) < 0.001 || maxBoost === withBoost,
      'Boost should saturate at 6 accesses (0.3 cap)');
  }));

  record(test('access boost at count=1 is 0.05', () => {
    const base  = computeDecay({ days: 0, usageCount: 0 });
    const boosted = computeDecay({ days: 0, usageCount: 1 });
    // base = 1.0; with boost = min(1.0, 1.0 + 0.05) = 1.0 (capped)
    // Test at 60 days where base < 0.95 so boost is visible
    const b0 = computeDecay({ days: 60, usageCount: 0 });
    const b1 = computeDecay({ days: 60, usageCount: 1 });
    assert.ok(Math.abs((b1 - b0) - 0.05) < 0.001,
      `Expected boost of 0.05, got ${(b1 - b0).toFixed(4)}`);
  }));

  record(test('decay result is never below CONFIDENCE_FLOOR', () => {
    const veryOld = computeDecay({ days: 10000, usageCount: 0 });
    assert.ok(veryOld >= CONFIDENCE_FLOOR,
      `Expected >= ${CONFIDENCE_FLOOR}, got ${veryOld}`);
  }));

  // ── Recency factor tiers ──────────────────────────────────────────────────

  record(test('recency factor is 1.0 for age < 7 days', () => {
    const pd = new PreferenceDecay();
    assert.strictEqual(pd.recencyFactor(3), 1.0);
    assert.strictEqual(pd.recencyFactor(6), 1.0);
    assert.strictEqual(pd.recencyFactor(0), 1.0);
  }));

  record(test('recency factor is 0.9 for 7 <= age < 30 days', () => {
    const pd = new PreferenceDecay();
    assert.strictEqual(pd.recencyFactor(7),  0.9);
    assert.strictEqual(pd.recencyFactor(15), 0.9);
    assert.strictEqual(pd.recencyFactor(29), 0.9);
  }));

  record(test('recency factor is 0.7 for age >= 30 days', () => {
    const pd = new PreferenceDecay();
    assert.strictEqual(pd.recencyFactor(30),  0.7);
    assert.strictEqual(pd.recencyFactor(90),  0.7);
    assert.strictEqual(pd.recencyFactor(365), 0.7);
  }));

  // ── applyDecay() on a record ──────────────────────────────────────────────

  record(test('applyDecay() returns updated record with new extractionConfidence', () => {
    const pd = new PreferenceDecay();
    const record = mem({ lastUsed: Date.now() - 45 * DAYS, usageCount: 2 });
    const updated = pd.applyDecay(record);
    assert.ok('extractionConfidence' in updated, 'Should have extractionConfidence');
    assert.ok(updated.extractionConfidence >= CONFIDENCE_FLOOR);
    assert.ok(updated.extractionConfidence <= 1.0);
  }));

  record(test('applyDecay() does not mutate the original record', () => {
    const pd = new PreferenceDecay();
    const original = mem({ extractionConfidence: 0.9, lastUsed: Date.now() - 50 * DAYS });
    pd.applyDecay(original);
    assert.strictEqual(original.extractionConfidence, 0.9, 'Original should be unchanged');
  }));

  record(test('applyDecay() at 0 days keeps near-original confidence', () => {
    const pd = new PreferenceDecay();
    const record = mem({ extractionConfidence: 0.8, lastUsed: Date.now(), usageCount: 0 });
    const updated = pd.applyDecay(record);
    // At 0 days, recency=1.0, decay=1.0, floor enforced: result should be high
    assert.ok(updated.extractionConfidence > 0.7,
      `Expected high confidence at day 0, got ${updated.extractionConfidence}`);
  }));

  // ── Preference conflict detection ─────────────────────────────────────────

  record(test('detectConflicts() finds records with matching topic+type', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'editor', type: 'preference', content: 'I prefer vim.' });
    const existing = [
      mem({ topic: 'editor', type: 'preference', content: 'I prefer emacs.' }),
      mem({ topic: 'language', type: 'preference', content: 'I prefer Python.' }),
    ];
    const conflicts = pd.detectConflicts(incoming, existing);
    assert.strictEqual(conflicts.length, 1, 'Only one record conflicts (same topic+type)');
    assert.ok(conflicts[0].content.includes('emacs'));
  }));

  record(test('detectConflicts() returns empty array when no topic matches', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'editor', type: 'preference' });
    const existing = [
      mem({ topic: 'language', type: 'preference' }),
      mem({ topic: 'framework', type: 'preference' }),
    ];
    const conflicts = pd.detectConflicts(incoming, existing);
    assert.strictEqual(conflicts.length, 0);
  }));

  record(test('detectConflicts() returns empty array when type differs', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'editor', type: 'preference' });
    const existing = [
      mem({ topic: 'editor', type: 'fact' }), // same topic, different type
    ];
    const conflicts = pd.detectConflicts(incoming, existing);
    assert.strictEqual(conflicts.length, 0);
  }));

  // ── updatePreference() ────────────────────────────────────────────────────

  record(test('updatePreference() new preference starts at NEW_PREFERENCE_CONFIDENCE', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'editor', type: 'preference' });
    const result = pd.updatePreference(incoming, []);
    assert.ok(Math.abs(result.newRecord.extractionConfidence - NEW_PREFERENCE_CONFIDENCE) < 1e-9,
      `Expected ${NEW_PREFERENCE_CONFIDENCE}, got ${result.newRecord.extractionConfidence}`);
  }));

  record(test('updatePreference() halves extractionConfidence of conflicting records', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'editor', type: 'preference', content: 'I prefer vim.' });
    const conflict = mem({
      topic: 'editor', type: 'preference',
      content: 'I prefer emacs.',
      extractionConfidence: 0.8,
    });
    const result = pd.updatePreference(incoming, [conflict]);
    assert.ok(result.updatedConflicts.length === 1);
    const updated = result.updatedConflicts[0];
    assert.ok(Math.abs(updated.extractionConfidence - 0.4) < 1e-9,
      `Expected 0.4 (halved from 0.8), got ${updated.extractionConfidence}`);
  }));

  record(test('updatePreference() conflict confidence never goes below CONFIDENCE_FLOOR after halving', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'theme', type: 'preference' });
    const veryLowConflict = mem({
      topic: 'theme', type: 'preference',
      extractionConfidence: 0.06, // halving → 0.03, below floor
    });
    const result = pd.updatePreference(incoming, [veryLowConflict]);
    assert.ok(result.updatedConflicts[0].extractionConfidence >= CONFIDENCE_FLOOR,
      `Should enforce floor at ${CONFIDENCE_FLOOR}`);
  }));

  record(test('updatePreference() returns both newRecord and updatedConflicts', () => {
    const pd = new PreferenceDecay();
    const incoming = mem({ topic: 'font', type: 'preference' });
    const result = pd.updatePreference(incoming, []);
    assert.ok('newRecord' in result, 'Should have newRecord');
    assert.ok('updatedConflicts' in result, 'Should have updatedConflicts');
    assert.ok(Array.isArray(result.updatedConflicts));
  }));

  // ── SUMMARY ───────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-preference-decay.cjs`
Expected: FAIL — `Cannot find module '../core/preference-decay.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/preference-decay.cjs
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

/** 90-day half-life: at day 90, un-boosted memory retains 50% confidence. */
const HALF_LIFE_DAYS = 90;

/** Minimum confidence floor — nothing decays to zero. */
const CONFIDENCE_FLOOR = 0.05;

/** Starting confidence for a newly registered preference. */
const NEW_PREFERENCE_CONFIDENCE = 0.9;

/** λ = ln2 / half-life */
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Pure decay function ────────────────────────────────────────────────────

/**
 * Compute a decayed confidence value.
 *
 * Formula:
 *   base     = exp(-λ * days)
 *   boost    = min(0.3, usageCount * 0.05)
 *   raw      = base + boost
 *   result   = clamp(raw, CONFIDENCE_FLOOR, 1.0)
 *
 * @param {{ days: number, usageCount: number }} params
 * @returns {number} decayed confidence in [CONFIDENCE_FLOOR, 1.0]
 */
function computeDecay({ days, usageCount }) {
  const base  = Math.exp(-LAMBDA * Math.max(0, days));
  const boost = Math.min(0.3, (usageCount || 0) * 0.05);
  const raw   = base + boost;
  return Math.min(1.0, Math.max(CONFIDENCE_FLOOR, raw));
}

// ── Class ─────────────────────────────────────────────────────────────────

class PreferenceDecay {
  /**
   * Recency factor tiered by age.
   * <7d  → 1.0
   * <30d → 0.9
   * else → 0.7
   * @param {number} days
   * @returns {number}
   */
  recencyFactor(days) {
    if (days < 7)  return 1.0;
    if (days < 30) return 0.9;
    return 0.7;
  }

  /**
   * Apply time-based decay to a memory record.
   * Uses lastUsed (or createdAt) and usageCount.
   * Multiplies computeDecay result by recencyFactor for an additional dampening tier.
   * @param {object} record
   * @returns {object} new record with updated extractionConfidence
   */
  applyDecay(record) {
    const now     = Date.now();
    const anchor  = record.lastUsed || record.createdAt || now;
    const days    = (now - anchor) / MS_PER_DAY;

    const base      = computeDecay({ days, usageCount: record.usageCount || 0 });
    const factor    = this.recencyFactor(days);
    const newConf   = Math.min(1.0, Math.max(CONFIDENCE_FLOOR, base * factor));

    return {
      ...record,
      extractionConfidence: newConf,
      updatedAt: now,
    };
  }

  /**
   * Find records that conflict with the incoming preference.
   * Conflict = same topic AND same type.
   * @param {object} incoming
   * @param {object[]} existing
   * @returns {object[]}
   */
  detectConflicts(incoming, existing) {
    const topic = incoming.topic;
    const type  = incoming.type;
    return existing.filter(
      r => r.topic === topic && r.type === type && r.id !== incoming.id
    );
  }

  /**
   * Register a new preference, halving confidence of conflicting records.
   * @param {object} incoming
   * @param {object[]} existingRecords
   * @returns {{ newRecord: object, updatedConflicts: object[] }}
   */
  updatePreference(incoming, existingRecords) {
    // New preference always starts at fixed confidence
    const newRecord = {
      ...incoming,
      extractionConfidence: NEW_PREFERENCE_CONFIDENCE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const conflicts        = this.detectConflicts(incoming, existingRecords);
    const updatedConflicts = conflicts.map(conflict => {
      const halved = (conflict.extractionConfidence || 0) / 2;
      return {
        ...conflict,
        extractionConfidence: Math.max(CONFIDENCE_FLOOR, halved),
        updatedAt: Date.now(),
      };
    });

    return { newRecord, updatedConflicts };
  }
}

module.exports = {
  PreferenceDecay,
  computeDecay,
  HALF_LIFE_DAYS,
  CONFIDENCE_FLOOR,
  NEW_PREFERENCE_CONFIDENCE,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-preference-decay.cjs`
Expected: All 22 tests PASS

**Step 5: Commit**

```bash
git add core/preference-decay.cjs tests/test-preference-decay.cjs
git commit -m "feat(G5): preference-aware confidence decay with 90-day half-life and conflict detection"
```