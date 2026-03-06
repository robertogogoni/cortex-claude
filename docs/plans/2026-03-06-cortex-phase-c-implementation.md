# Cortex Phase C: Quality Engine -- Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement intelligent memory quality controls: enhanced write gating with LLM scoring, bi-temporal pipeline integration, confidence reinforcement, tool-based curation, and Auto-Memory deconfliction.

**Architecture:** 5 modules: WriteQualityGate (LLM-enhanced scoring), BitemporalPipeline (temporal field management), ConfidenceReinforcer (decay + reinforcement), ToolCurator (tool-response curation), AutoMemoryDeconflict (MEMORY.md dedup). All CommonJS, standalone testable, no external deps beyond existing Cortex modules.

**Tech Stack:** Node.js (CommonJS `.cjs`), existing Cortex modules (write-gate, confidence-decay, types), custom test runner

**Depends on:** Phase B (LlmProvider interface for C1 LLM scoring -- stub/mock for now)

**See also:**
- [Design Decisions](2026-03-06-cortex-phases-b-cr-d-design-decisions.md) -- revised task list, MCP protocol status
- [Original Spec](2026-02-25-cortex-v3-full-transformation.md) -- Phase C section (lines 1064-1291)
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) -- links to all phase plans

---

### Task C1: Write Quality Gate (LLM-Enhanced Scoring)

**Files:**
- Create: `core/write-quality-gate.cjs`
- Test: `tests/test-write-quality-gate.cjs`
- Modify: `hooks/extraction-engine.cjs` (integrate enhanced gate)
- Modify: `cortex/sonnet-thinker.cjs` (integrate into learn())

**Overview:** The existing `WriteGate` (core/write-gate.cjs) uses pure heuristics. This task creates `WriteQualityGate` which layers 4-dimension scoring (novelty, specificity, actionability, relevance) on top of the existing gate, with an optional LLM assessment path from Phase B's LlmProvider. When LlmProvider is unavailable, it falls back to heuristic-only scoring. Threshold: memories must score >= 0.6 to be stored.

**Acceptance Criteria:**
- Scores memories across 4 dimensions: novelty, specificity, actionability, relevance
- Threshold of 0.6 for storage (configurable)
- Explicit "remember" requests bypass scoring
- LLM provider path (mocked for now, wired when Phase B delivers)
- Heuristic fallback always works without API
- Integrated into both extraction engine and learn tool

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeCandidate(overrides = {}) {
  return {
    content: 'Always run PRAGMA journal_mode=WAL before opening SQLite in concurrent workloads to improve read throughput by 3-5x.',
    type: 'insight',
    confidence: 0.85,
    tags: ['sqlite', 'performance', 'wal'],
    projectHash: 'proj_abc',
    explicitRemember: false,
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nTask C1: Write Quality Gate (LLM-Enhanced Scoring)\n');

  const {
    WriteQualityGate,
    QUALITY_THRESHOLD,
    SCORING_DIMENSIONS,
  } = require('../core/write-quality-gate.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── EXPORTS ──────────────────────────────────────────────────────────────

  record(test('QUALITY_THRESHOLD is 0.6', () => {
    assert.strictEqual(QUALITY_THRESHOLD, 0.6);
  }));

  record(test('SCORING_DIMENSIONS has 4 entries', () => {
    assert.deepStrictEqual(
      Object.keys(SCORING_DIMENSIONS).sort(),
      ['actionability', 'novelty', 'relevance', 'specificity']
    );
  }));

  record(test('SCORING_DIMENSIONS weights sum to 1.0', () => {
    const sum = Object.values(SCORING_DIMENSIONS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `Weights sum to ${sum}, expected 1.0`);
  }));

  // ── CONSTRUCTOR ──────────────────────────────────────────────────────────

  record(test('constructor accepts custom threshold', () => {
    const gate = new WriteQualityGate({ threshold: 0.8 });
    assert.strictEqual(gate.threshold, 0.8);
  }));

  record(test('constructor defaults threshold to QUALITY_THRESHOLD', () => {
    const gate = new WriteQualityGate();
    assert.strictEqual(gate.threshold, QUALITY_THRESHOLD);
  }));

  record(test('constructor accepts optional llmProvider', () => {
    const mockProvider = { assess: async () => ({ score: 0.9 }) };
    const gate = new WriteQualityGate({ llmProvider: mockProvider });
    assert.ok(gate.llmProvider);
  }));

  // ── HEURISTIC SCORING (no LLM) ──────────────────────────────────────────

  record(test('high-quality technical content scores >= 0.6', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate());
    assert.ok(result.totalScore >= 0.6,
      `Expected >= 0.6, got ${result.totalScore.toFixed(3)}`);
    assert.strictEqual(result.decision, 'STORE');
  }));

  record(test('trivial content scores < 0.6', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'ok',
      confidence: 0.2,
      tags: [],
    }));
    assert.ok(result.totalScore < 0.6,
      `Expected < 0.6, got ${result.totalScore.toFixed(3)}`);
    assert.strictEqual(result.decision, 'REJECT');
  }));

  record(test('explicit remember bypasses scoring', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'whatever trivial thing',
      confidence: 0.1,
      tags: [],
      explicitRemember: true,
    }));
    assert.strictEqual(result.decision, 'STORE');
    assert.ok(result.bypassed, 'Should flag as bypassed');
  }));

  record(test('content with "Remember:" prefix bypasses scoring', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'Remember: always use UTC timestamps',
      confidence: 0.3,
      tags: [],
      explicitRemember: false,
    }));
    assert.strictEqual(result.decision, 'STORE');
  }));

  record(test('empty content gets REJECT with score 0', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({ content: '' }));
    assert.strictEqual(result.totalScore, 0);
    assert.strictEqual(result.decision, 'REJECT');
  }));

  record(test('whitespace-only content gets REJECT', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({ content: '   \n\t  ' }));
    assert.strictEqual(result.totalScore, 0);
    assert.strictEqual(result.decision, 'REJECT');
  }));

  // ── DIMENSION SCORING ────────────────────────────────────────────────────

  record(test('score() returns breakdown with all 4 dimensions', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate());
    assert.ok(result.breakdown, 'Should have breakdown');
    for (const dim of ['novelty', 'specificity', 'actionability', 'relevance']) {
      assert.ok(dim in result.breakdown, `Missing dimension: ${dim}`);
      const v = result.breakdown[dim];
      assert.ok(v >= 0 && v <= 1, `${dim} value ${v} out of [0,1]`);
    }
  }));

  record(test('specificity is high for content with code, numbers, identifiers', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'Run `PRAGMA wal_autocheckpoint=1000` to set checkpoint at 1000 pages. Use --journal-mode=WAL flag.',
    }));
    assert.ok(result.breakdown.specificity > 0.5,
      `Expected specificity > 0.5, got ${result.breakdown.specificity.toFixed(3)}`);
  }));

  record(test('specificity is low for vague content', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'things work differently sometimes',
    }));
    assert.ok(result.breakdown.specificity < 0.4,
      `Expected specificity < 0.4, got ${result.breakdown.specificity.toFixed(3)}`);
  }));

  record(test('actionability is high for imperative content', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'Run npm install, then configure jest.config.js to set testEnvironment to node, and execute npm test.',
    }));
    assert.ok(result.breakdown.actionability > 0.5,
      `Expected actionability > 0.5, got ${result.breakdown.actionability.toFixed(3)}`);
  }));

  record(test('actionability is low for descriptive content', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate({
      content: 'The sky is blue because of Rayleigh scattering of sunlight in the atmosphere.',
    }));
    assert.ok(result.breakdown.actionability < 0.4,
      `Expected actionability < 0.4, got ${result.breakdown.actionability.toFixed(3)}`);
  }));

  record(test('relevance is higher when tags are present', () => {
    const gate = new WriteQualityGate();
    const withTags = gate.score(makeCandidate({ tags: ['node', 'perf', 'async'] }));
    const noTags = gate.score(makeCandidate({ tags: [] }));
    assert.ok(withTags.breakdown.relevance > noTags.breakdown.relevance,
      `Tagged (${withTags.breakdown.relevance}) should exceed untagged (${noTags.breakdown.relevance})`);
  }));

  record(test('novelty defaults to 0.8 when no existing memories provided', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate());
    assert.ok(Math.abs(result.breakdown.novelty - 0.8) < 0.01,
      `Expected novelty ~0.8 with no existing, got ${result.breakdown.novelty}`);
  }));

  record(test('novelty is low when content overlaps existing memories', () => {
    const gate = new WriteQualityGate();
    const existing = [
      'SQLite WAL mode improves concurrent read performance significantly.',
      'Use PRAGMA journal_mode=WAL for better SQLite throughput.',
    ];
    const result = gate.score(makeCandidate(), existing);
    assert.ok(result.breakdown.novelty < 0.5,
      `Expected novelty < 0.5 with overlapping existing, got ${result.breakdown.novelty}`);
  }));

  // ── WEIGHTED SUM ─────────────────────────────────────────────────────────

  record(test('totalScore equals weighted sum of breakdown', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate());
    const expected =
      result.breakdown.novelty       * SCORING_DIMENSIONS.novelty +
      result.breakdown.specificity   * SCORING_DIMENSIONS.specificity +
      result.breakdown.actionability * SCORING_DIMENSIONS.actionability +
      result.breakdown.relevance     * SCORING_DIMENSIONS.relevance;
    const clamped = Math.max(0, Math.min(1, expected));
    assert.ok(Math.abs(result.totalScore - clamped) < 1e-9,
      `totalScore ${result.totalScore} != weighted sum ${clamped}`);
  }));

  record(test('totalScore is clamped to [0, 1]', () => {
    const gate = new WriteQualityGate();
    const result = gate.score(makeCandidate());
    assert.ok(result.totalScore >= 0 && result.totalScore <= 1);
  }));

  // ── LLM-ENHANCED PATH ───────────────────────────────────────────────────

  record(await testAsync('LLM provider enhances score when available', async () => {
    const mockLlm = {
      assess: async (content) => ({
        score: 0.95,
        reasoning: 'Highly specific and actionable SQLite optimization advice.',
      }),
    };
    const gate = new WriteQualityGate({ llmProvider: mockLlm });
    const result = await gate.scoreWithLlm(makeCandidate());
    assert.ok(result.llmScore === 0.95, `Expected LLM score 0.95, got ${result.llmScore}`);
    assert.ok(result.totalScore > 0, 'Should have blended total score');
    assert.ok(result.llmReasoning, 'Should include LLM reasoning');
  }));

  record(await testAsync('LLM failure falls back to heuristic-only', async () => {
    const failingLlm = {
      assess: async () => { throw new Error('API unavailable'); },
    };
    const gate = new WriteQualityGate({ llmProvider: failingLlm });
    const result = await gate.scoreWithLlm(makeCandidate());
    assert.ok(result.totalScore > 0, 'Should still produce a score');
    assert.strictEqual(result.llmScore, null, 'LLM score should be null on failure');
    assert.ok(result.fallback === true, 'Should flag as fallback');
  }));

  record(await testAsync('scoreWithLlm blends heuristic and LLM scores', async () => {
    const mockLlm = {
      assess: async () => ({ score: 0.4, reasoning: 'Mediocre.' }),
    };
    const gate = new WriteQualityGate({ llmProvider: mockLlm });
    const result = await gate.scoreWithLlm(makeCandidate());
    // Blended: 0.6 * heuristic + 0.4 * llm
    const heuristicResult = gate.score(makeCandidate());
    const expected = 0.6 * heuristicResult.totalScore + 0.4 * 0.4;
    assert.ok(Math.abs(result.totalScore - Math.max(0, Math.min(1, expected))) < 0.01,
      `Expected blended ~${expected.toFixed(3)}, got ${result.totalScore.toFixed(3)}`);
  }));

  // ── SHOULDPERSIST INTEGRATION ────────────────────────────────────────────

  record(test('shouldPersist() wraps score() with boolean result', () => {
    const gate = new WriteQualityGate();
    assert.strictEqual(typeof gate.shouldPersist(makeCandidate()), 'boolean');
    assert.strictEqual(gate.shouldPersist(makeCandidate()), true);
    assert.strictEqual(gate.shouldPersist(makeCandidate({
      content: 'ok',
      confidence: 0.1,
      tags: [],
    })), false);
  }));

  // ── SUMMARY ──────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-write-quality-gate.cjs`
Expected: FAIL -- `Cannot find module '../core/write-quality-gate.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/write-quality-gate.cjs
'use strict';

/**
 * Cortex Write Quality Gate -- LLM-Enhanced Scoring
 *
 * Layers 4-dimension quality scoring on top of the existing WriteGate.
 * Dimensions: novelty, specificity, actionability, relevance.
 * Optional LLM provider for deeper assessment (Phase B dependency).
 *
 * Threshold: 0.6 (configurable). Memories below this are rejected.
 * Explicit "remember" requests bypass scoring entirely.
 */

const QUALITY_THRESHOLD = 0.6;

/** Scoring dimension weights -- must sum to 1.0 */
const SCORING_DIMENSIONS = {
  novelty:       0.30,
  specificity:   0.25,
  actionability: 0.25,
  relevance:     0.20,
};

/** LLM blend weight: 0.6 heuristic + 0.4 LLM when LLM is available */
const HEURISTIC_WEIGHT = 0.6;
const LLM_WEIGHT = 0.4;

// ── Signals ──────────────────────────────────────────────────────────────────

const SPECIFIC_PATTERNS = [
  /\d+/,                       // numbers
  /[A-Z_]{2,}/,                // constants / identifiers
  /`[^`]+`/,                   // code snippets
  /\b(PRAGMA|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i,
  /\b(npm|yarn|pnpm|pip|cargo|go get|apt|pacman)\b/i,
  /\b(--[a-z][\w-]+)/i,       // CLI flags
  /\b\d+(\.\d+)+\b/,          // version numbers
  /https?:\/\//,               // URLs
  /\b[a-z]+\.[a-z]{2,4}\b/i,  // filenames / domains
];

const ACTION_WORDS = [
  'run', 'execute', 'install', 'configure', 'set', 'add', 'remove', 'create',
  'delete', 'update', 'enable', 'disable', 'start', 'stop', 'restart',
  'open', 'close', 'export', 'import', 'call', 'invoke', 'pass', 'return',
  'use', 'apply', 'append', 'prepend', 'write', 'read', 'send', 'check',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  );
}

function jaccardSim(a, b) {
  if (!a || !b) return 0;
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function isExplicitRemember(item) {
  if (item.explicitRemember) return true;
  const content = item.content || '';
  if (/\bremember\b[:\s]/i.test(content)) return true;
  if (/\bdon'?t forget\b/i.test(content)) return true;
  return false;
}

// ── Class ─────────────────────────────────────────────────────────────────────

class WriteQualityGate {
  /**
   * @param {Object} [options]
   * @param {number} [options.threshold] - Minimum score to store (default: 0.6)
   * @param {Object} [options.llmProvider] - Optional LlmProvider with assess() method
   */
  constructor(options = {}) {
    this.threshold = options.threshold ?? QUALITY_THRESHOLD;
    this.llmProvider = options.llmProvider || null;
  }

  // ── Dimension scorers ───────────────────────────────────────────────────

  _scoreSpecificity(content) {
    if (!content || !content.trim()) return 0;
    const words = content.split(/\s+/).length;
    const lengthBonus = clamp(words / 40, 0, 0.3);
    const patternScore = SPECIFIC_PATTERNS.reduce((acc, re) =>
      acc + (re.test(content) ? 1 : 0), 0
    ) / SPECIFIC_PATTERNS.length;
    return clamp(patternScore * 0.7 + lengthBonus);
  }

  _scoreActionability(content) {
    if (!content || !content.trim()) return 0;
    const words = content.toLowerCase().split(/\W+/).filter(Boolean);
    if (words.length === 0) return 0;
    const hits = words.filter(w => ACTION_WORDS.includes(w)).length;
    return clamp(hits / Math.max(1, words.length) * 8);
  }

  _scoreRelevance(item) {
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const tagScore = clamp(tags.length / 5);
    const projectBonus = item.projectHash ? 0.1 : 0;
    const confidenceBonus = clamp((item.confidence || 0) * 0.3);
    return clamp(tagScore * 0.6 + projectBonus + confidenceBonus);
  }

  _scoreNovelty(content, existingContents) {
    if (!content || !content.trim()) return 0;
    if (!existingContents || existingContents.length === 0) return 0.8;
    const maxSim = existingContents.reduce((max, ex) =>
      Math.max(max, jaccardSim(content, ex)), 0
    );
    return clamp(1 - maxSim);
  }

  // ── Main scoring ────────────────────────────────────────────────────────

  /**
   * Score a memory candidate using heuristics only.
   * @param {Object} item - Memory candidate
   * @param {string[]} [existingContents=[]] - Existing memory contents for novelty
   * @returns {{ totalScore: number, decision: string, breakdown: Object, bypassed: boolean }}
   */
  score(item, existingContents = []) {
    const content = (item && item.content) || '';

    // Explicit remember bypass
    if (isExplicitRemember(item)) {
      return {
        totalScore: 1.0,
        decision: 'STORE',
        breakdown: { novelty: 1, specificity: 1, actionability: 1, relevance: 1 },
        bypassed: true,
      };
    }

    if (!content.trim()) {
      return {
        totalScore: 0,
        decision: 'REJECT',
        breakdown: { novelty: 0, specificity: 0, actionability: 0, relevance: 0 },
        bypassed: false,
      };
    }

    const breakdown = {
      novelty:       this._scoreNovelty(content, existingContents),
      specificity:   this._scoreSpecificity(content),
      actionability: this._scoreActionability(content),
      relevance:     this._scoreRelevance(item),
    };

    const raw = Object.entries(SCORING_DIMENSIONS).reduce(
      (sum, [k, w]) => sum + breakdown[k] * w, 0
    );
    const totalScore = clamp(raw);

    return {
      totalScore,
      decision: totalScore >= this.threshold ? 'STORE' : 'REJECT',
      breakdown,
      bypassed: false,
    };
  }

  /**
   * Score with optional LLM enhancement. Falls back to heuristic-only on failure.
   * @param {Object} item
   * @param {string[]} [existingContents=[]]
   * @returns {Promise<Object>}
   */
  async scoreWithLlm(item, existingContents = []) {
    const heuristicResult = this.score(item, existingContents);

    if (heuristicResult.bypassed || !this.llmProvider) {
      return { ...heuristicResult, llmScore: null, llmReasoning: null, fallback: false };
    }

    try {
      const llmResult = await this.llmProvider.assess(item.content);
      const llmScore = clamp(llmResult.score);
      const blended = clamp(
        HEURISTIC_WEIGHT * heuristicResult.totalScore + LLM_WEIGHT * llmScore
      );

      return {
        totalScore: blended,
        decision: blended >= this.threshold ? 'STORE' : 'REJECT',
        breakdown: heuristicResult.breakdown,
        llmScore,
        llmReasoning: llmResult.reasoning || null,
        bypassed: false,
        fallback: false,
      };
    } catch (error) {
      // LLM unavailable -- use heuristic only
      return {
        ...heuristicResult,
        llmScore: null,
        llmReasoning: null,
        fallback: true,
      };
    }
  }

  /**
   * Boolean wrapper for backward compatibility with WriteGate.shouldPersist() interface.
   * @param {Object} item
   * @param {string[]} [existingContents=[]]
   * @returns {boolean}
   */
  shouldPersist(item, existingContents = []) {
    const result = this.score(item, existingContents);
    return result.decision === 'STORE';
  }
}

module.exports = {
  WriteQualityGate,
  QUALITY_THRESHOLD,
  SCORING_DIMENSIONS,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-write-quality-gate.cjs`
Expected: All 27 tests PASS

**Step 5: Integration -- Modify extraction-engine.cjs**

In `hooks/extraction-engine.cjs`, replace the WriteGate import and usage:

```javascript
// Change line 19 from:
// const { WriteGate } = require('../core/write-gate.cjs');
// To:
const { WriteQualityGate } = require('../core/write-quality-gate.cjs');

// Change line 125 from:
// this.writeGate = new WriteGate();
// To:
this.writeGate = new WriteQualityGate({ threshold: 0.6 });

// Change lines 501-505 in _persistExtractions from:
// if (!this.writeGate.shouldPersist({
//   content: extraction.content,
//   type: extraction.type,
//   confidence: extraction.extractionConfidence,
// })) {
// To:
if (!this.writeGate.shouldPersist({
  content: extraction.content,
  type: extraction.type,
  confidence: extraction.extractionConfidence,
  tags: extraction.tags || [],
  projectHash: extraction.projectHash,
})) {
```

**Step 6: Commit**

```bash
git add core/write-quality-gate.cjs tests/test-write-quality-gate.cjs hooks/extraction-engine.cjs
git commit -m "feat(C1): LLM-enhanced write quality gate with 4-dimension scoring

Replaces heuristic-only WriteGate with WriteQualityGate: novelty (0.30),
specificity (0.25), actionability (0.25), relevance (0.20). Threshold 0.6.
Optional LLM scoring blended 60/40 with heuristics. Falls back gracefully.
Explicit 'remember' requests bypass scoring."
```

---

### Task C2: Bi-Temporal Memory Pipeline Integration

**Files:**
- Create: `core/bitemporal-pipeline.cjs`
- Test: `tests/test-bitemporal-pipeline.cjs`
- Modify: `cortex/sonnet-thinker.cjs` (add temporal fields to learn())

**Overview:** The bi-temporal type helpers already exist in `core/types.cjs` (createBitemporalFields, invalidateMemory, isMemoryValid). This task creates a pipeline module that:
1. Enriches incoming memories with temporal fields before storage
2. Filters queries by temporal validity (only return currently-valid memories)
3. Provides temporal supersession (when learning replaces an old fact, invalidate the old one)
4. Migrates existing records that lack temporal fields (backward compatibility)

**Acceptance Criteria:**
- All memories stored via learn() get validFrom, validTo, ingestedAt
- Existing memories without temporal fields get defaults on read (recordedAt = createdAt)
- Temporal query filter: only return memories where validTo is null or in the future
- Supersession: when a new memory contradicts an old one, old one gets validTo set
- Backward compatible: existing memories continue to work

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRecord(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'mem_' + Math.random().toString(36).slice(2),
    content: 'The project uses React 18 with TypeScript.',
    type: 'learning',
    tags: ['react', 'typescript'],
    createdAt: now,
    updatedAt: now,
    extractionConfidence: 0.85,
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nTask C2: Bi-Temporal Memory Pipeline Integration\n');

  const {
    BitemporalPipeline,
  } = require('../core/bitemporal-pipeline.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── ENRICHMENT ───────────────────────────────────────────────────────────

  record(test('enrich() adds validFrom, validTo, ingestedAt to record', () => {
    const pipeline = new BitemporalPipeline();
    const raw = makeRecord();
    const enriched = pipeline.enrich(raw);
    assert.ok(enriched.validFrom, 'validFrom should be set');
    assert.strictEqual(enriched.validTo, null, 'validTo should be null (still valid)');
    assert.ok(enriched.ingestedAt, 'ingestedAt should be set');
  }));

  record(test('enrich() preserves existing validFrom if provided', () => {
    const pipeline = new BitemporalPipeline();
    const customDate = '2024-06-15T00:00:00.000Z';
    const raw = makeRecord({ validFrom: customDate });
    const enriched = pipeline.enrich(raw);
    assert.strictEqual(enriched.validFrom, customDate, 'Should preserve provided validFrom');
  }));

  record(test('enrich() sets ingestedAt to now, ignoring any provided value', () => {
    const pipeline = new BitemporalPipeline();
    const before = new Date();
    const raw = makeRecord({ ingestedAt: '2020-01-01T00:00:00.000Z' });
    const enriched = pipeline.enrich(raw);
    const after = new Date();
    const ingestedDate = new Date(enriched.ingestedAt);
    assert.ok(ingestedDate >= before && ingestedDate <= after,
      'ingestedAt should be set to current time, not preserved');
  }));

  record(test('enrich() defaults validFrom to createdAt if no validFrom given', () => {
    const pipeline = new BitemporalPipeline();
    const created = '2025-03-01T12:00:00.000Z';
    const raw = makeRecord({ createdAt: created });
    delete raw.validFrom;
    const enriched = pipeline.enrich(raw);
    assert.strictEqual(enriched.validFrom, created, 'validFrom should default to createdAt');
  }));

  record(test('enrich() preserves all original fields', () => {
    const pipeline = new BitemporalPipeline();
    const raw = makeRecord({ content: 'Custom content', tags: ['a', 'b'] });
    const enriched = pipeline.enrich(raw);
    assert.strictEqual(enriched.content, 'Custom content');
    assert.deepStrictEqual(enriched.tags, ['a', 'b']);
    assert.strictEqual(enriched.id, raw.id);
  }));

  // ── MIGRATION ────────────────────────────────────────────────────────────

  record(test('migrate() adds temporal fields to legacy record', () => {
    const pipeline = new BitemporalPipeline();
    const legacy = {
      id: 'old_1',
      content: 'Old memory without temporal fields',
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-02-01T10:00:00.000Z',
    };
    const migrated = pipeline.migrate(legacy);
    assert.strictEqual(migrated.validFrom, legacy.createdAt, 'validFrom = createdAt for legacy');
    assert.strictEqual(migrated.validTo, null, 'validTo null for legacy');
    assert.strictEqual(migrated.ingestedAt, legacy.createdAt, 'ingestedAt = createdAt for legacy');
  }));

  record(test('migrate() is idempotent on already-enriched records', () => {
    const pipeline = new BitemporalPipeline();
    const enriched = pipeline.enrich(makeRecord());
    const migrated = pipeline.migrate(enriched);
    assert.strictEqual(migrated.validFrom, enriched.validFrom);
    assert.strictEqual(migrated.validTo, enriched.validTo);
    assert.strictEqual(migrated.ingestedAt, enriched.ingestedAt);
  }));

  // ── TEMPORAL FILTER ──────────────────────────────────────────────────────

  record(test('filterValid() keeps records with validTo=null', () => {
    const pipeline = new BitemporalPipeline();
    const records = [
      makeRecord({ id: 'a', validTo: null }),
      makeRecord({ id: 'b', validTo: null }),
    ];
    const filtered = pipeline.filterValid(records);
    assert.strictEqual(filtered.length, 2);
  }));

  record(test('filterValid() removes records with validTo in the past', () => {
    const pipeline = new BitemporalPipeline();
    const past = new Date(Date.now() - 86400000).toISOString(); // yesterday
    const records = [
      makeRecord({ id: 'current', validTo: null }),
      makeRecord({ id: 'expired', validTo: past }),
    ];
    const filtered = pipeline.filterValid(records);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, 'current');
  }));

  record(test('filterValid() keeps records with validTo in the future', () => {
    const pipeline = new BitemporalPipeline();
    const future = new Date(Date.now() + 86400000).toISOString(); // tomorrow
    const records = [
      makeRecord({ id: 'temp', validTo: future }),
    ];
    const filtered = pipeline.filterValid(records);
    assert.strictEqual(filtered.length, 1);
  }));

  record(test('filterValid() handles records missing validTo (treats as valid)', () => {
    const pipeline = new BitemporalPipeline();
    const records = [makeRecord({ id: 'legacy' })]; // no validTo field
    const filtered = pipeline.filterValid(records);
    assert.strictEqual(filtered.length, 1);
  }));

  // ── SUPERSESSION ─────────────────────────────────────────────────────────

  record(test('supersede() sets validTo on old record and returns both', () => {
    const pipeline = new BitemporalPipeline();
    const oldRecord = makeRecord({
      id: 'old',
      content: 'Project uses React 17',
      validTo: null,
    });
    const newRecord = makeRecord({
      id: 'new',
      content: 'Project uses React 18',
    });
    const result = pipeline.supersede(oldRecord, newRecord);
    assert.ok(result.invalidated.validTo, 'Old record should have validTo set');
    assert.ok(result.replacement.validFrom, 'New record should have validFrom');
    assert.strictEqual(result.replacement.validTo, null, 'New record validTo should be null');
  }));

  record(test('supersede() sets old validTo to same time as new validFrom', () => {
    const pipeline = new BitemporalPipeline();
    const oldRecord = makeRecord({ id: 'old', validTo: null });
    const newRecord = makeRecord({ id: 'new' });
    const result = pipeline.supersede(oldRecord, newRecord);
    // Old validTo should be <= new validFrom (same timestamp transaction)
    const oldEnd = new Date(result.invalidated.validTo);
    const newStart = new Date(result.replacement.validFrom);
    assert.ok(oldEnd <= newStart, 'Old validTo should be <= new validFrom');
  }));

  // ── POINT-IN-TIME QUERY ──────────────────────────────────────────────────

  record(test('filterAtTime() returns memories valid at a specific point in time', () => {
    const pipeline = new BitemporalPipeline();
    const jan1 = '2025-01-01T00:00:00.000Z';
    const mar1 = '2025-03-01T00:00:00.000Z';
    const jun1 = '2025-06-01T00:00:00.000Z';

    const records = [
      makeRecord({ id: 'early', validFrom: jan1, validTo: mar1 }),  // valid Jan-Mar
      makeRecord({ id: 'mid',   validFrom: mar1, validTo: jun1 }),  // valid Mar-Jun
      makeRecord({ id: 'late',  validFrom: jun1, validTo: null }),   // valid Jun-now
    ];

    const atFeb = pipeline.filterAtTime(records, '2025-02-15T00:00:00.000Z');
    assert.strictEqual(atFeb.length, 1);
    assert.strictEqual(atFeb[0].id, 'early');

    const atApr = pipeline.filterAtTime(records, '2025-04-01T00:00:00.000Z');
    assert.strictEqual(atApr.length, 1);
    assert.strictEqual(atApr[0].id, 'mid');
  }));

  record(test('filterAtTime() returns empty array for time before all records', () => {
    const pipeline = new BitemporalPipeline();
    const records = [
      makeRecord({ validFrom: '2025-06-01T00:00:00.000Z', validTo: null }),
    ];
    const result = pipeline.filterAtTime(records, '2025-01-01T00:00:00.000Z');
    assert.strictEqual(result.length, 0);
  }));

  // ── SUMMARY ──────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-bitemporal-pipeline.cjs`
Expected: FAIL -- `Cannot find module '../core/bitemporal-pipeline.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/bitemporal-pipeline.cjs
'use strict';

/**
 * Cortex Bi-Temporal Memory Pipeline
 *
 * Manages two time dimensions for memory records:
 * - validFrom/validTo: when a fact is true in the real world
 * - ingestedAt: when it was stored in the system (immutable)
 *
 * Provides enrichment, migration, temporal filtering, and supersession.
 * Uses helpers from core/types.cjs but adds pipeline-level operations.
 */

const { createBitemporalFields, invalidateMemory, isMemoryValid, getTimestamp } = require('./types.cjs');

class BitemporalPipeline {
  /**
   * Enrich a record with bi-temporal fields before storage.
   * - validFrom: defaults to createdAt or now
   * - validTo: null (still valid)
   * - ingestedAt: always set to now (immutable -- overrides any provided value)
   *
   * @param {Object} record - Raw memory record
   * @returns {Object} Record with temporal fields set
   */
  enrich(record) {
    const now = getTimestamp();
    return {
      ...record,
      validFrom: record.validFrom || record.createdAt || now,
      validTo: record.validTo !== undefined ? record.validTo : null,
      ingestedAt: now, // Always current time, never preserved
    };
  }

  /**
   * Migrate a legacy record that lacks temporal fields.
   * Uses createdAt as both validFrom and ingestedAt.
   * Idempotent: if fields already exist, they are preserved.
   *
   * @param {Object} record - Legacy record
   * @returns {Object} Record with temporal fields
   */
  migrate(record) {
    if (record.validFrom && record.ingestedAt) {
      return record; // Already has temporal fields
    }
    const fallback = record.createdAt || record.timestamp || getTimestamp();
    return {
      ...record,
      validFrom: record.validFrom || fallback,
      validTo: record.validTo !== undefined ? record.validTo : null,
      ingestedAt: record.ingestedAt || fallback,
    };
  }

  /**
   * Filter records to only those currently valid.
   * A record is valid if validTo is null, undefined, or in the future.
   *
   * @param {Object[]} records
   * @returns {Object[]} Currently valid records
   */
  filterValid(records) {
    const now = new Date();
    return records.filter(r => {
      if (r.validTo === undefined || r.validTo === null) return true;
      return new Date(r.validTo) > now;
    });
  }

  /**
   * Filter records to those valid at a specific point in time.
   *
   * @param {Object[]} records
   * @param {string} timestamp - ISO 8601 timestamp
   * @returns {Object[]} Records valid at the given time
   */
  filterAtTime(records, timestamp) {
    const queryTime = new Date(timestamp);
    return records.filter(r => {
      const from = r.validFrom ? new Date(r.validFrom) : new Date(0);
      const to = r.validTo ? new Date(r.validTo) : new Date('9999-12-31');
      return from <= queryTime && queryTime < to;
    });
  }

  /**
   * Supersede an old record with a new one.
   * Sets validTo on the old record and validFrom on the new one.
   *
   * @param {Object} oldRecord - Record being replaced
   * @param {Object} newRecord - Replacement record
   * @returns {{ invalidated: Object, replacement: Object }}
   */
  supersede(oldRecord, newRecord) {
    const now = getTimestamp();
    const invalidated = {
      ...oldRecord,
      validTo: now,
    };
    const replacement = this.enrich({
      ...newRecord,
      validFrom: now,
    });
    return { invalidated, replacement };
  }
}

module.exports = {
  BitemporalPipeline,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-bitemporal-pipeline.cjs`
Expected: All 18 tests PASS

**Step 5: Integration -- Modify sonnet-thinker.cjs learn()**

In `cortex/sonnet-thinker.cjs`, add temporal enrichment to the learn() method:

```javascript
// Add import near top of main() (after other requires):
const { BitemporalPipeline } = require('../core/bitemporal-pipeline.cjs');
const bitemporalPipeline = new BitemporalPipeline();

// In the learn() method, after building the record object (around line 540),
// enrich it before storing:
const enrichedRecord = bitemporalPipeline.enrich(record);

// Then use enrichedRecord instead of record for both JSONL and vector writes:
// Line ~543: await this.insightsStore.append(enrichedRecord);
```

**Step 6: Commit**

```bash
git add core/bitemporal-pipeline.cjs tests/test-bitemporal-pipeline.cjs cortex/sonnet-thinker.cjs
git commit -m "feat(C2): bi-temporal pipeline with enrichment, migration, temporal filter, supersession

All memories now get validFrom/validTo/ingestedAt on storage. Supports
point-in-time queries, temporal supersession for contradicting facts,
and backward-compatible migration of legacy records."
```

---

### Task C3: Confidence Reinforcement and Review Flagging

**Files:**
- Create: `core/confidence-reinforcer.cjs`
- Test: `tests/test-confidence-reinforcer.cjs`

**Overview:** The existing `confidence-decay.cjs` handles decay calculation but lacks reinforcement (resetting confidence when a memory is accessed/confirmed) and review flagging (marking low-confidence memories for human review). This task adds:
1. Reinforcement: when a memory is accessed successfully, boost its confidence
2. Review threshold: memories below 0.2 confidence get flagged for review
3. Batch processing: run reinforcement/flagging across all memories
4. Integration with the existing calculateDecay function

**Acceptance Criteria:**
- reinforce() boosts confidence based on access type (read, confirm, cite)
- Flag memories below review threshold (0.2)
- Reinforcement has diminishing returns (each successive boost is smaller)
- Batch process all memories for decay + reinforcement
- Produces actionable review list

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeMemory(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'mem_' + Math.random().toString(36).slice(2),
    type: 'learning',
    content: 'Test memory content.',
    extractionConfidence: 0.8,
    decayScore: 0.8,
    usageCount: 0,
    lastUsed: null,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nTask C3: Confidence Reinforcement and Review Flagging\n');

  const {
    ConfidenceReinforcer,
    REVIEW_THRESHOLD,
    REINFORCEMENT_TYPES,
  } = require('../core/confidence-reinforcer.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── EXPORTS ──────────────────────────────────────────────────────────────

  record(test('REVIEW_THRESHOLD is 0.2', () => {
    assert.strictEqual(REVIEW_THRESHOLD, 0.2);
  }));

  record(test('REINFORCEMENT_TYPES has read, confirm, cite', () => {
    assert.ok(REINFORCEMENT_TYPES.read !== undefined);
    assert.ok(REINFORCEMENT_TYPES.confirm !== undefined);
    assert.ok(REINFORCEMENT_TYPES.cite !== undefined);
  }));

  record(test('cite boost is stronger than read boost', () => {
    assert.ok(REINFORCEMENT_TYPES.cite > REINFORCEMENT_TYPES.read,
      'cite should have higher reinforcement than read');
  }));

  record(test('confirm boost is stronger than read boost', () => {
    assert.ok(REINFORCEMENT_TYPES.confirm > REINFORCEMENT_TYPES.read);
  }));

  // ── REINFORCE ────────────────────────────────────────────────────────────

  record(test('reinforce() increases decayScore for read access', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.5 });
    const result = reinforcer.reinforce(memory, 'read');
    assert.ok(result.decayScore > 0.5,
      `Expected decayScore > 0.5, got ${result.decayScore}`);
  }));

  record(test('reinforce() increases decayScore more for confirm', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memRead = makeMemory({ decayScore: 0.5 });
    const memConfirm = makeMemory({ decayScore: 0.5 });
    const readResult = reinforcer.reinforce(memRead, 'read');
    const confirmResult = reinforcer.reinforce(memConfirm, 'confirm');
    assert.ok(confirmResult.decayScore > readResult.decayScore,
      `confirm (${confirmResult.decayScore}) should boost more than read (${readResult.decayScore})`);
  }));

  record(test('reinforce() increases decayScore most for cite', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.4 });
    const result = reinforcer.reinforce(memory, 'cite');
    assert.ok(result.decayScore > 0.4 + REINFORCEMENT_TYPES.read,
      `cite should boost more than read amount`);
  }));

  record(test('reinforce() clamps decayScore to 1.0 maximum', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.95 });
    const result = reinforcer.reinforce(memory, 'cite');
    assert.ok(result.decayScore <= 1.0, `decayScore should not exceed 1.0, got ${result.decayScore}`);
  }));

  record(test('reinforce() increments usageCount', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ usageCount: 5 });
    const result = reinforcer.reinforce(memory, 'read');
    assert.strictEqual(result.usageCount, 6);
  }));

  record(test('reinforce() updates lastUsed to now', () => {
    const reinforcer = new ConfidenceReinforcer();
    const before = new Date();
    const memory = makeMemory({ lastUsed: null });
    const result = reinforcer.reinforce(memory, 'read');
    const after = new Date();
    assert.ok(result.lastUsed, 'lastUsed should be set');
    const lastUsedDate = new Date(result.lastUsed);
    assert.ok(lastUsedDate >= before && lastUsedDate <= after);
  }));

  record(test('reinforce() has diminishing returns based on usageCount', () => {
    const reinforcer = new ConfidenceReinforcer();
    const lowUsage = makeMemory({ decayScore: 0.5, usageCount: 1 });
    const highUsage = makeMemory({ decayScore: 0.5, usageCount: 50 });
    const lowResult = reinforcer.reinforce(lowUsage, 'read');
    const highResult = reinforcer.reinforce(highUsage, 'read');
    const lowBoost = lowResult.decayScore - 0.5;
    const highBoost = highResult.decayScore - 0.5;
    assert.ok(lowBoost > highBoost,
      `Low usage boost (${lowBoost.toFixed(4)}) should exceed high usage boost (${highBoost.toFixed(4)})`);
  }));

  record(test('reinforce() returns a new object (does not mutate)', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.5, usageCount: 0 });
    const result = reinforcer.reinforce(memory, 'read');
    assert.notStrictEqual(result, memory, 'Should return new object');
    assert.strictEqual(memory.decayScore, 0.5, 'Original should be unchanged');
    assert.strictEqual(memory.usageCount, 0, 'Original usageCount should be unchanged');
  }));

  record(test('reinforce() with unknown type defaults to read', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.5 });
    const result = reinforcer.reinforce(memory, 'unknown_type');
    assert.ok(result.decayScore > 0.5, 'Should still boost');
  }));

  // ── REVIEW FLAGGING ──────────────────────────────────────────────────────

  record(test('needsReview() returns true when decayScore below threshold', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.15 });
    assert.strictEqual(reinforcer.needsReview(memory), true);
  }));

  record(test('needsReview() returns false when decayScore above threshold', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: 0.5 });
    assert.strictEqual(reinforcer.needsReview(memory), false);
  }));

  record(test('needsReview() returns true at exactly threshold', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memory = makeMemory({ decayScore: REVIEW_THRESHOLD });
    // At threshold, still needs review (boundary is <, not <=)
    // Actually: decayScore <= threshold means needs review
    assert.strictEqual(reinforcer.needsReview(memory), true);
  }));

  // ── BATCH PROCESSING ─────────────────────────────────────────────────────

  record(test('flagForReview() returns only memories below threshold', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memories = [
      makeMemory({ id: 'healthy', decayScore: 0.8 }),
      makeMemory({ id: 'weak', decayScore: 0.15 }),
      makeMemory({ id: 'critical', decayScore: 0.05 }),
      makeMemory({ id: 'ok', decayScore: 0.3 }),
    ];
    const flagged = reinforcer.flagForReview(memories);
    assert.strictEqual(flagged.length, 2);
    const ids = flagged.map(m => m.id);
    assert.ok(ids.includes('weak'));
    assert.ok(ids.includes('critical'));
  }));

  record(test('flagForReview() sorts by decayScore ascending (most critical first)', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memories = [
      makeMemory({ id: 'a', decayScore: 0.18 }),
      makeMemory({ id: 'b', decayScore: 0.05 }),
      makeMemory({ id: 'c', decayScore: 0.10 }),
    ];
    const flagged = reinforcer.flagForReview(memories);
    assert.strictEqual(flagged[0].id, 'b');
    assert.strictEqual(flagged[1].id, 'c');
    assert.strictEqual(flagged[2].id, 'a');
  }));

  record(test('flagForReview() returns empty array when no memories below threshold', () => {
    const reinforcer = new ConfidenceReinforcer();
    const memories = [
      makeMemory({ decayScore: 0.5 }),
      makeMemory({ decayScore: 0.9 }),
    ];
    const flagged = reinforcer.flagForReview(memories);
    assert.strictEqual(flagged.length, 0);
  }));

  record(test('applyDecayAndFlag() integrates with calculateDecay', () => {
    const reinforcer = new ConfidenceReinforcer();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const memories = [
      makeMemory({ id: 'fresh', lastUsed: new Date().toISOString(), type: 'learning' }),
      makeMemory({ id: 'old', lastUsed: thirtyDaysAgo, createdAt: thirtyDaysAgo, type: 'learning', extractionConfidence: 0.3 }),
    ];
    const result = reinforcer.applyDecayAndFlag(memories);
    assert.ok(Array.isArray(result.updated), 'Should return updated array');
    assert.ok(Array.isArray(result.flagged), 'Should return flagged array');
    assert.strictEqual(result.updated.length, 2, 'All memories should be updated');
    // The old low-confidence memory might be flagged
    assert.ok(result.updated[0].decayScore > 0, 'Fresh memory should have positive decay');
  }));

  // ── SUMMARY ──────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-confidence-reinforcer.cjs`
Expected: FAIL -- `Cannot find module '../core/confidence-reinforcer.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/confidence-reinforcer.cjs
'use strict';

/**
 * Cortex Confidence Reinforcer
 *
 * Extends confidence-decay.cjs with reinforcement (boosting on access)
 * and review flagging (marking low-confidence memories for curation).
 *
 * Access types:
 * - read:    memory was returned in a query (small boost)
 * - confirm: user explicitly confirmed memory is correct (medium boost)
 * - cite:    memory was cited/used in a response (large boost)
 *
 * Diminishing returns: boost = base_boost / (1 + usageCount * 0.05)
 * This prevents infinite reinforcement from repeated access.
 */

const { calculateDecay } = require('./confidence-decay.cjs');
const { getTimestamp } = require('./types.cjs');

const REVIEW_THRESHOLD = 0.2;

const REINFORCEMENT_TYPES = {
  read:    0.05,
  confirm: 0.15,
  cite:    0.20,
};

/**
 * Clamp value to [lo, hi].
 */
function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

class ConfidenceReinforcer {
  /**
   * @param {Object} [options]
   * @param {number} [options.reviewThreshold] - Below this, flag for review
   */
  constructor(options = {}) {
    this.reviewThreshold = options.reviewThreshold ?? REVIEW_THRESHOLD;
  }

  /**
   * Reinforce a memory's confidence based on access type.
   * Returns a new object (does not mutate the original).
   *
   * @param {Object} memory - Memory record
   * @param {string} accessType - 'read', 'confirm', or 'cite'
   * @returns {Object} Updated memory with boosted confidence
   */
  reinforce(memory, accessType) {
    const baseBoost = REINFORCEMENT_TYPES[accessType] ?? REINFORCEMENT_TYPES.read;
    const usageCount = memory.usageCount || 0;

    // Diminishing returns: each successive access gives less boost
    const diminishingFactor = 1 / (1 + usageCount * 0.05);
    const actualBoost = baseBoost * diminishingFactor;

    const currentDecay = memory.decayScore || 0;
    const newDecay = clamp(currentDecay + actualBoost);

    return {
      ...memory,
      decayScore: newDecay,
      usageCount: usageCount + 1,
      lastUsed: getTimestamp(),
      updatedAt: getTimestamp(),
    };
  }

  /**
   * Check if a memory needs review based on its decay score.
   *
   * @param {Object} memory
   * @returns {boolean}
   */
  needsReview(memory) {
    return (memory.decayScore || 0) <= this.reviewThreshold;
  }

  /**
   * Filter an array of memories to those needing review.
   * Returns sorted by decayScore ascending (most critical first).
   *
   * @param {Object[]} memories
   * @returns {Object[]} Memories below review threshold, sorted
   */
  flagForReview(memories) {
    return memories
      .filter(m => this.needsReview(m))
      .sort((a, b) => (a.decayScore || 0) - (b.decayScore || 0));
  }

  /**
   * Apply decay calculation and flag low-confidence memories.
   * Uses calculateDecay from confidence-decay.cjs to update decayScore,
   * then flags any that fall below the review threshold.
   *
   * @param {Object[]} memories - Array of memory records
   * @returns {{ updated: Object[], flagged: Object[] }}
   */
  applyDecayAndFlag(memories) {
    const updated = memories.map(m => ({
      ...m,
      decayScore: calculateDecay(m),
    }));

    const flagged = this.flagForReview(updated);

    return { updated, flagged };
  }
}

module.exports = {
  ConfidenceReinforcer,
  REVIEW_THRESHOLD,
  REINFORCEMENT_TYPES,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-confidence-reinforcer.cjs`
Expected: All 21 tests PASS

**Step 5: Commit**

```bash
git add core/confidence-reinforcer.cjs tests/test-confidence-reinforcer.cjs
git commit -m "feat(C3): confidence reinforcement with diminishing returns and review flagging

Adds ConfidenceReinforcer: boost on access (read/confirm/cite),
diminishing returns via 1/(1+usageCount*0.05), and batch decay+flag.
Memories below 0.2 decayScore get flagged for review."
```

---

### Task C4: Tool-Based Memory Curation (Revised from MCP Elicitation)

**Files:**
- Create: `core/tool-curator.cjs`
- Test: `tests/test-tool-curator.cjs`
- Modify: `cortex/server.cjs` (replace elicitation with tool-based curation in learn handler)

**Overview:** MCP Elicitation (`elicitation/create`) is NOT supported in Claude Code (issues #2799, #7108). Instead of blocking on user input, Cortex includes curation prompts in tool responses. When a memory is ambiguous or borderline quality, the tool response includes a structured question. The user (or Claude) can address it in the next message, and Cortex processes the clarification on the next `cortex__learn` call.

**Pattern:**
1. `cortex__learn` receives an insight
2. Quality gate scores it
3. If score is borderline (0.4-0.6) or ambiguous, include a curation question in the response
4. The question is informational -- the memory is still stored but flagged as `needsCuration: true`
5. If the user subsequently calls `cortex__learn` with a clarification, the flag is cleared

**Acceptance Criteria:**
- Generates curation questions for borderline memories
- Questions are included in MCP tool response text (not elicitation)
- Memories are stored but flagged when curation is needed
- Clarifications clear the flag
- No dependency on MCP Elicitation

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeScoreResult(overrides = {}) {
  return {
    totalScore: 0.5,
    decision: 'REJECT',
    breakdown: {
      novelty: 0.6,
      specificity: 0.4,
      actionability: 0.3,
      relevance: 0.5,
    },
    bypassed: false,
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nTask C4: Tool-Based Memory Curation\n');

  const {
    ToolCurator,
    CURATION_BAND,
  } = require('../core/tool-curator.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── EXPORTS ──────────────────────────────────────────────────────────────

  record(test('CURATION_BAND has lower and upper bounds', () => {
    assert.strictEqual(typeof CURATION_BAND.lower, 'number');
    assert.strictEqual(typeof CURATION_BAND.upper, 'number');
    assert.ok(CURATION_BAND.lower < CURATION_BAND.upper,
      'lower should be less than upper');
  }));

  record(test('CURATION_BAND is 0.4 to 0.6', () => {
    assert.strictEqual(CURATION_BAND.lower, 0.4);
    assert.strictEqual(CURATION_BAND.upper, 0.6);
  }));

  // ── NEEDS CURATION ───────────────────────────────────────────────────────

  record(test('needsCuration() returns true for borderline score (0.5)', () => {
    const curator = new ToolCurator();
    assert.strictEqual(curator.needsCuration(0.5), true);
  }));

  record(test('needsCuration() returns true at lower bound (0.4)', () => {
    const curator = new ToolCurator();
    assert.strictEqual(curator.needsCuration(0.4), true);
  }));

  record(test('needsCuration() returns true at upper bound (0.6)', () => {
    const curator = new ToolCurator();
    assert.strictEqual(curator.needsCuration(0.6), true);
  }));

  record(test('needsCuration() returns false for high score (0.8)', () => {
    const curator = new ToolCurator();
    assert.strictEqual(curator.needsCuration(0.8), false);
  }));

  record(test('needsCuration() returns false for low score (0.2)', () => {
    const curator = new ToolCurator();
    assert.strictEqual(curator.needsCuration(0.2), false);
  }));

  // ── GENERATE QUESTION ────────────────────────────────────────────────────

  record(test('generateQuestion() returns a question string', () => {
    const curator = new ToolCurator();
    const question = curator.generateQuestion(
      'Project uses MongoDB for user data.',
      makeScoreResult({ totalScore: 0.5 })
    );
    assert.ok(typeof question === 'string');
    assert.ok(question.length > 10, 'Question should be substantive');
  }));

  record(test('generateQuestion() mentions low specificity when that score is weak', () => {
    const curator = new ToolCurator();
    const question = curator.generateQuestion(
      'We use some database for stuff.',
      makeScoreResult({
        totalScore: 0.45,
        breakdown: { novelty: 0.7, specificity: 0.15, actionability: 0.3, relevance: 0.4 },
      })
    );
    assert.ok(question.toLowerCase().includes('specific') || question.toLowerCase().includes('detail'),
      `Question should ask for more specifics: "${question}"`);
  }));

  record(test('generateQuestion() mentions low actionability when that score is weak', () => {
    const curator = new ToolCurator();
    const question = curator.generateQuestion(
      'React is a frontend framework.',
      makeScoreResult({
        totalScore: 0.45,
        breakdown: { novelty: 0.5, specificity: 0.6, actionability: 0.1, relevance: 0.4 },
      })
    );
    assert.ok(question.toLowerCase().includes('action') || question.toLowerCase().includes('how') || question.toLowerCase().includes('apply'),
      `Question should ask how to apply/action: "${question}"`);
  }));

  record(test('generateQuestion() mentions low novelty when that score is weak', () => {
    const curator = new ToolCurator();
    const question = curator.generateQuestion(
      'JavaScript is single-threaded.',
      makeScoreResult({
        totalScore: 0.45,
        breakdown: { novelty: 0.1, specificity: 0.6, actionability: 0.5, relevance: 0.5 },
      })
    );
    assert.ok(question.toLowerCase().includes('already') || question.toLowerCase().includes('differ') || question.toLowerCase().includes('new'),
      `Question should address novelty: "${question}"`);
  }));

  // ── BUILD RESPONSE ───────────────────────────────────────────────────────

  record(test('buildCuratedResponse() includes memory stored confirmation', () => {
    const curator = new ToolCurator();
    const response = curator.buildCuratedResponse(
      'MongoDB is used for user profiles.',
      makeScoreResult({ totalScore: 0.5 }),
      true // stored
    );
    assert.ok(response.text.includes('stored') || response.text.includes('saved'),
      'Response should confirm storage');
  }));

  record(test('buildCuratedResponse() includes curation question', () => {
    const curator = new ToolCurator();
    const response = curator.buildCuratedResponse(
      'We use some tech for something.',
      makeScoreResult({ totalScore: 0.45 }),
      true
    );
    assert.ok(response.needsCuration, 'Should flag needsCuration');
    assert.ok(response.question, 'Should include question');
  }));

  record(test('buildCuratedResponse() does NOT flag high-quality memories', () => {
    const curator = new ToolCurator();
    const response = curator.buildCuratedResponse(
      'High quality specific insight.',
      makeScoreResult({ totalScore: 0.85 }),
      true
    );
    assert.strictEqual(response.needsCuration, false, 'Should not need curation');
  }));

  record(test('buildCuratedResponse() does NOT flag very low quality (rejected)', () => {
    const curator = new ToolCurator();
    const response = curator.buildCuratedResponse(
      'ok',
      makeScoreResult({ totalScore: 0.1 }),
      false // not stored
    );
    assert.strictEqual(response.needsCuration, false, 'Rejected memories do not need curation');
  }));

  record(test('buildCuratedResponse() includes quality score in text', () => {
    const curator = new ToolCurator();
    const response = curator.buildCuratedResponse(
      'Some insight.',
      makeScoreResult({ totalScore: 0.52 }),
      true
    );
    assert.ok(response.text.includes('52') || response.text.includes('0.52'),
      'Should display quality score');
  }));

  // ── CLARIFICATION PROCESSING ─────────────────────────────────────────────

  record(test('processClarification() returns updated insight', () => {
    const curator = new ToolCurator();
    const result = curator.processClarification(
      'We use MongoDB',
      'Specifically MongoDB 7.0 Atlas for user profiles and session data',
    );
    assert.ok(result.updatedInsight, 'Should return updated insight');
    assert.ok(result.updatedInsight.includes('MongoDB'), 'Should contain original topic');
    assert.ok(result.resolved, 'Should flag as resolved');
  }));

  record(test('processClarification() merges original and clarification', () => {
    const curator = new ToolCurator();
    const result = curator.processClarification(
      'The API has a rate limit',
      'Rate limit is 1000 requests per minute per API key',
    );
    assert.ok(result.updatedInsight.length > 'The API has a rate limit'.length,
      'Updated insight should be longer than original');
  }));

  // ── SUMMARY ──────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-tool-curator.cjs`
Expected: FAIL -- `Cannot find module '../core/tool-curator.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/tool-curator.cjs
'use strict';

/**
 * Cortex Tool-Based Memory Curation
 *
 * Replaces MCP Elicitation (not supported in Claude Code) with
 * tool-response-based curation. When a memory is borderline quality,
 * the tool response includes a structured question for the user/Claude.
 *
 * Pattern:
 * 1. cortex__learn receives insight
 * 2. Quality gate scores it
 * 3. If borderline (0.4-0.6): store but flag, include question in response
 * 4. User provides clarification in next interaction
 * 5. cortex__learn with clarification resolves the flag
 */

/** Score band where curation questions are generated */
const CURATION_BAND = {
  lower: 0.4,
  upper: 0.6,
};

/** Dimension-specific question templates */
const DIMENSION_QUESTIONS = {
  specificity: {
    threshold: 0.3,
    questions: [
      'Could you add more specific details (versions, exact commands, file paths)?',
      'Can you include concrete examples or identifiers to make this more precise?',
    ],
  },
  actionability: {
    threshold: 0.3,
    questions: [
      'How should this knowledge be applied in practice?',
      'What specific action or command does this translate to?',
    ],
  },
  novelty: {
    threshold: 0.3,
    questions: [
      'This seems similar to something already stored. What makes this different from existing knowledge?',
      'Is this an update to existing information, or a new fact entirely?',
    ],
  },
  relevance: {
    threshold: 0.3,
    questions: [
      'Which project or domain does this apply to?',
      'Could you add tags or context to help retrieve this later?',
    ],
  },
};

class ToolCurator {
  /**
   * Check if a score falls in the curation band.
   * @param {number} score
   * @returns {boolean}
   */
  needsCuration(score) {
    return score >= CURATION_BAND.lower && score <= CURATION_BAND.upper;
  }

  /**
   * Generate a targeted curation question based on weak dimensions.
   * @param {string} content - The memory content
   * @param {Object} scoreResult - Result from WriteQualityGate.score()
   * @returns {string} Question to ask
   */
  generateQuestion(content, scoreResult) {
    const breakdown = scoreResult.breakdown || {};
    const weakDimensions = [];

    for (const [dim, config] of Object.entries(DIMENSION_QUESTIONS)) {
      if ((breakdown[dim] || 0) < config.threshold) {
        weakDimensions.push(dim);
      }
    }

    // Pick question from the weakest dimension
    if (weakDimensions.length > 0) {
      const weakest = weakDimensions.reduce((w, dim) =>
        (breakdown[dim] || 0) < (breakdown[w] || 0) ? dim : w
      );
      const questions = DIMENSION_QUESTIONS[weakest].questions;
      return questions[Math.floor(Math.random() * questions.length)];
    }

    // Generic question if no specific weakness
    return 'Could you provide more context or detail to strengthen this memory?';
  }

  /**
   * Build a curated tool response that includes curation question if needed.
   *
   * @param {string} insight - The original insight text
   * @param {Object} scoreResult - Quality gate score result
   * @param {boolean} stored - Whether the memory was stored
   * @returns {{ text: string, needsCuration: boolean, question: string|null }}
   */
  buildCuratedResponse(insight, scoreResult, stored) {
    const score = scoreResult.totalScore;
    const pct = (score * 100).toFixed(0);

    if (!stored) {
      return {
        text: `Memory not stored (quality score: ${pct}%). The insight did not meet the quality threshold.`,
        needsCuration: false,
        question: null,
      };
    }

    if (!this.needsCuration(score)) {
      // High quality -- just confirm
      return {
        text: `Memory stored successfully (quality score: ${pct}%).`,
        needsCuration: false,
        question: null,
      };
    }

    // Borderline -- store but ask for improvement
    const question = this.generateQuestion(insight, scoreResult);
    return {
      text: `Memory stored with quality score: ${pct}% (borderline).\n\nTo improve this memory: ${question}`,
      needsCuration: true,
      question,
    };
  }

  /**
   * Process a clarification that resolves a curation flag.
   * Merges original insight with clarification.
   *
   * @param {string} originalInsight - The original borderline insight
   * @param {string} clarification - The user's clarification
   * @returns {{ updatedInsight: string, resolved: boolean }}
   */
  processClarification(originalInsight, clarification) {
    // Merge: use clarification as the enriched version, but preserve original context
    const updatedInsight = `${originalInsight}. ${clarification}`;
    return {
      updatedInsight,
      resolved: true,
    };
  }
}

module.exports = {
  ToolCurator,
  CURATION_BAND,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-tool-curator.cjs`
Expected: All 20 tests PASS

**Step 5: Integration -- Modify server.cjs learn handler**

In `cortex/server.cjs`, replace the elicitation code in the `cortex__learn` case (lines 973-998):

```javascript
// Replace the entire cortex__learn case block with:
case 'cortex__learn': {
  const { WriteQualityGate } = require('../core/write-quality-gate.cjs');
  const { ToolCurator } = require('../core/tool-curator.cjs');
  const { BitemporalPipeline } = require('../core/bitemporal-pipeline.cjs');

  const qualityGate = new WriteQualityGate();
  const curator = new ToolCurator();
  const bitemporalPipeline = new BitemporalPipeline();

  // Score the insight
  const scoreResult = qualityGate.score({
    content: validatedArgs.insight,
    type: validatedArgs.type,
    confidence: 0.75,
    tags: validatedArgs.tags || [],
    explicitRemember: false,
  });

  let stored = false;
  let learnResult = null;

  if (scoreResult.decision === 'STORE') {
    // Proceed with storage via Sonnet
    learnResult = await sonnet.learn(
      validatedArgs.insight,
      validatedArgs.context,
      validatedArgs.type,
      validatedArgs.tags
    );
    stored = learnResult.stored || false;
  }

  // Build curated response
  const curationResponse = curator.buildCuratedResponse(
    validatedArgs.insight,
    scoreResult,
    stored
  );

  result = {
    ...learnResult,
    qualityScore: scoreResult.totalScore,
    qualityBreakdown: scoreResult.breakdown,
    curation: curationResponse,
  };
  break;
}
```

**Step 6: Commit**

```bash
git add core/tool-curator.cjs tests/test-tool-curator.cjs cortex/server.cjs
git commit -m "feat(C4): tool-based memory curation replacing MCP Elicitation

MCP Elicitation is not supported in Claude Code. Tool-based curation
uses quality gate scoring to detect borderline memories (0.4-0.6) and
includes targeted questions in tool responses. Questions address the
weakest quality dimension (specificity, actionability, novelty, relevance)."
```

---

### Task C5: Auto-Memory Deconfliction

**Files:**
- Create: `core/auto-memory-deconflict.cjs`
- Test: `tests/test-auto-memory-deconflict.cjs`
- Modify: `cortex/sonnet-thinker.cjs` (check before storing)

**Overview:** Claude Code v2.1.69+ has built-in Auto-Memory (`/memory`) that stores project-level knowledge in `~/.claude/projects/*/memory/MEMORY.md`. Cortex must not duplicate what Auto-Memory already stores. This task:
1. Reads MEMORY.md files from known locations
2. Extracts content sections for comparison
3. Before storing a new memory, checks similarity against Auto-Memory content
4. Skips storage if a sufficiently similar entry exists in MEMORY.md

**Auto-Memory Format (from observation):**
```markdown
# Auto Memory

## Topic Files (detailed references)
| File | Topic |
|------|-------|
| [file.md](file.md) | Description |

## Session Patterns & Gotchas
### Pattern Title
Description text...

## Active Projects
### Project Name
> Full reference: [file.md](file.md)
- Bullet points with details
```

**Acceptance Criteria:**
- Reads MEMORY.md from `~/.claude/projects/*/memory/MEMORY.md`
- Extracts text sections for similarity comparison
- Jaccard similarity threshold of 0.7 for deconfliction
- Skips memories that duplicate Auto-Memory content
- Handles missing/unreadable MEMORY.md gracefully
- Caches parsed content to avoid repeated filesystem reads

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-auto-memory-' + Date.now());

function setup() {
  // Create a mock MEMORY.md structure
  const memoryDir = path.join(TEST_DIR, '.claude', 'projects', '-test-project', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), `# Auto Memory

## Session Patterns & Gotchas

### Bash Tool: Never Pipe Daemon Output
When starting daemons from the Bash tool, NEVER pipe their output. This creates pipe deadlocks because the daemon stays alive indefinitely. Always redirect to /dev/null.

### pacman -Rdd Removes Files Too
pacman -Rdd is NOT database-only removal. It deletes package files AND the DB entry.

## Active Projects

### Cortex v3.0
- GitHub: robertogogoni/cortex-claude
- Local: ~/repos/cortex-claude/
- 7 MCP tools, 22 test files, 447+ tests passing

### wayland-cedilla-fix (v1.0.0 released)
- AUR: wayland-cedilla-fix
- 3-layer fix: compositor + fcitx5/XCompose + browser IME flags
`);

  // Create a second project MEMORY.md
  const memoryDir2 = path.join(TEST_DIR, '.claude', 'projects', '-other-project', 'memory');
  fs.mkdirSync(memoryDir2, { recursive: true });
  fs.writeFileSync(path.join(memoryDir2, 'MEMORY.md'), `# Auto Memory

## Session Patterns & Gotchas

### VHS stdout Gotcha
Never redirect stdout to /dev/null in VHS tape commands. VHS captures terminal visual output.
`);
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

// ─── tests ───────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\nTask C5: Auto-Memory Deconfliction\n');

  const {
    AutoMemoryDeconflict,
    DECONFLICT_THRESHOLD,
  } = require('../core/auto-memory-deconflict.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // ── EXPORTS ──────────────────────────────────────────────────────────────

  record(test('DECONFLICT_THRESHOLD is 0.7', () => {
    assert.strictEqual(DECONFLICT_THRESHOLD, 0.7);
  }));

  // ── LOADING ──────────────────────────────────────────────────────────────

  record(await testAsync('loadAutoMemory() reads MEMORY.md files', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const sections = await deconflict.loadAutoMemory();
    assert.ok(Array.isArray(sections), 'Should return array of sections');
    assert.ok(sections.length > 0, 'Should find sections from test MEMORY.md');
  }));

  record(await testAsync('loadAutoMemory() extracts meaningful text sections', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const sections = await deconflict.loadAutoMemory();
    // Should have extracted the bash tool, pacman, cortex, wayland, VHS sections
    const allText = sections.join(' ');
    assert.ok(allText.includes('daemon'), 'Should contain daemon text');
    assert.ok(allText.includes('pacman'), 'Should contain pacman text');
    assert.ok(allText.includes('Cortex'), 'Should contain Cortex text');
  }));

  record(await testAsync('loadAutoMemory() handles missing directory gracefully', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: '/nonexistent/path/.claude',
    });
    const sections = await deconflict.loadAutoMemory();
    assert.ok(Array.isArray(sections));
    assert.strictEqual(sections.length, 0, 'Should return empty array for missing dir');
  }));

  record(await testAsync('loadAutoMemory() caches results', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const first = await deconflict.loadAutoMemory();
    const second = await deconflict.loadAutoMemory();
    assert.deepStrictEqual(first, second, 'Cached results should match');
    assert.ok(deconflict._cache, 'Cache should be set');
  }));

  record(test('clearCache() invalidates cached sections', () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    deconflict._cache = ['cached'];
    deconflict._cacheTime = Date.now();
    deconflict.clearCache();
    assert.strictEqual(deconflict._cache, null);
  }));

  // ── DECONFLICTION ────────────────────────────────────────────────────────

  record(await testAsync('isDuplicate() returns true for content matching Auto-Memory', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    // This is nearly identical to the MEMORY.md content
    const result = await deconflict.isDuplicate(
      'When starting daemons from the Bash tool, never pipe their output because it creates pipe deadlocks since the daemon stays alive indefinitely.'
    );
    assert.strictEqual(result.duplicate, true,
      `Expected duplicate=true, got false. Similarity: ${result.similarity?.toFixed(3)}`);
    assert.ok(result.similarity >= DECONFLICT_THRESHOLD,
      `Similarity ${result.similarity} should be >= ${DECONFLICT_THRESHOLD}`);
    assert.ok(result.matchedSection, 'Should identify matched section');
  }));

  record(await testAsync('isDuplicate() returns false for novel content', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const result = await deconflict.isDuplicate(
      'Redis cluster uses hash slots to distribute keys across 16384 slots on multiple nodes.'
    );
    assert.strictEqual(result.duplicate, false,
      `Expected duplicate=false for novel content`);
  }));

  record(await testAsync('isDuplicate() returns false for partially similar content', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    // Mentions daemons but is about a different topic
    const result = await deconflict.isDuplicate(
      'When deploying daemons to production, use systemd service files with proper restart policies and watchdog timers.'
    );
    assert.strictEqual(result.duplicate, false,
      `Partially similar content should not be flagged as duplicate`);
  }));

  record(await testAsync('isDuplicate() handles empty content', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const result = await deconflict.isDuplicate('');
    assert.strictEqual(result.duplicate, false);
  }));

  // ── SECTION PARSING ──────────────────────────────────────────────────────

  record(test('parseSections() splits MEMORY.md into meaningful chunks', () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const content = `# Auto Memory

## Session Patterns

### First Pattern
Description of first pattern with details.

### Second Pattern
Description of second pattern with more details.

## Active Projects

### Project A
- Detail about project A
- More details
`;
    const sections = deconflict.parseSections(content);
    assert.ok(sections.length >= 3, `Expected >= 3 sections, got ${sections.length}`);
    // Each section should have meaningful content
    for (const section of sections) {
      assert.ok(section.length > 5, `Section too short: "${section}"`);
    }
  }));

  record(test('parseSections() skips table-of-contents and link-only sections', () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const content = `# Auto Memory

## Topic Files
| File | Topic |
|------|-------|
| [file.md](file.md) | Description |

## Actual Content
### Real Pattern
This is an actual pattern with real content that should be extracted.
`;
    const sections = deconflict.parseSections(content);
    // Table-only sections should be skipped
    const hasTable = sections.some(s => s.includes('|------|'));
    assert.ok(!hasTable, 'Table-only sections should be skipped');
    // Real content should be present
    const hasReal = sections.some(s => s.includes('actual pattern'));
    assert.ok(hasReal, 'Real content sections should be present');
  }));

  // ── INTEGRATION CHECK ────────────────────────────────────────────────────

  record(await testAsync('checkBeforeStore() returns { store: true } for novel content', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const result = await deconflict.checkBeforeStore(
      'PostgreSQL supports JSONB columns for semi-structured data with GIN indexes.'
    );
    assert.strictEqual(result.store, true);
  }));

  record(await testAsync('checkBeforeStore() returns { store: false } for duplicate content', async () => {
    const deconflict = new AutoMemoryDeconflict({
      claudeDir: path.join(TEST_DIR, '.claude'),
    });
    const result = await deconflict.checkBeforeStore(
      'pacman -Rdd is NOT database-only removal. It deletes package files AND the DB entry.'
    );
    assert.strictEqual(result.store, false);
    assert.ok(result.reason, 'Should provide reason');
    assert.ok(result.reason.includes('Auto-Memory') || result.reason.includes('MEMORY.md'),
      `Reason should reference Auto-Memory: "${result.reason}"`);
  }));

  // ── SUMMARY ──────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); cleanup(); process.exit(1); });
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-auto-memory-deconflict.cjs`
Expected: FAIL -- `Cannot find module '../core/auto-memory-deconflict.cjs'`

**Step 3: Write minimal implementation**

```javascript
// core/auto-memory-deconflict.cjs
'use strict';

/**
 * Cortex Auto-Memory Deconfliction
 *
 * Claude Code v2.1.69+ has built-in Auto-Memory (/memory) that stores
 * project knowledge in ~/.claude/projects/*/memory/MEMORY.md.
 *
 * This module prevents Cortex from duplicating what Auto-Memory already
 * stores by reading MEMORY.md files and comparing content similarity.
 *
 * Strategy:
 * 1. Parse MEMORY.md into text sections (skip tables, links, headers-only)
 * 2. Cache parsed sections (5-minute TTL)
 * 3. Before storing, check Jaccard similarity against all sections
 * 4. If similarity >= 0.7, skip storage (it already exists in Auto-Memory)
 */

const fs = require('fs');
const path = require('path');

/** Similarity threshold above which content is considered duplicate */
const DECONFLICT_THRESHOLD = 0.7;

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL = 5 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2) // Skip very short words
  );
}

function jaccardSim(a, b) {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ── Class ─────────────────────────────────────────────────────────────────────

class AutoMemoryDeconflict {
  /**
   * @param {Object} [options]
   * @param {string} [options.claudeDir] - Path to ~/.claude
   * @param {number} [options.threshold] - Similarity threshold (default: 0.7)
   * @param {number} [options.cacheTtl] - Cache TTL in ms (default: 5 min)
   */
  constructor(options = {}) {
    this.claudeDir = options.claudeDir || path.join(
      process.env.HOME || process.env.USERPROFILE || '', '.claude'
    );
    this.threshold = options.threshold ?? DECONFLICT_THRESHOLD;
    this.cacheTtl = options.cacheTtl ?? CACHE_TTL;
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Load and parse all MEMORY.md files from Auto-Memory locations.
   * Results are cached for cacheTtl milliseconds.
   *
   * @returns {Promise<string[]>} Array of text sections
   */
  async loadAutoMemory() {
    // Return cached if still valid
    if (this._cache && (Date.now() - this._cacheTime) < this.cacheTtl) {
      return this._cache;
    }

    const sections = [];
    const projectsDir = path.join(this.claudeDir, 'projects');

    try {
      if (!fs.existsSync(projectsDir)) {
        this._cache = [];
        this._cacheTime = Date.now();
        return [];
      }

      const projects = fs.readdirSync(projectsDir);

      for (const project of projects) {
        const memoryFile = path.join(projectsDir, project, 'memory', 'MEMORY.md');
        try {
          if (fs.existsSync(memoryFile)) {
            const content = fs.readFileSync(memoryFile, 'utf-8');
            const parsed = this.parseSections(content);
            sections.push(...parsed);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Handle missing/inaccessible directories
    }

    this._cache = sections;
    this._cacheTime = Date.now();
    return sections;
  }

  /**
   * Parse a MEMORY.md file into meaningful text sections.
   * Splits on ### headers, filters out table-only and link-only sections.
   *
   * @param {string} content - Raw MEMORY.md content
   * @returns {string[]} Array of text sections
   */
  parseSections(content) {
    if (!content) return [];

    const sections = [];

    // Split by ### (h3) headers -- these are the individual knowledge entries
    const parts = content.split(/^###\s+/m);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.length < 10) continue;

      // Skip if it's mostly a markdown table (links, index)
      const lines = trimmed.split('\n').filter(l => l.trim());
      const tableLines = lines.filter(l => l.includes('|'));
      if (tableLines.length > lines.length * 0.5) continue;

      // Skip if it's a top-level header only
      if (lines.length <= 1 && /^#\s/.test(trimmed)) continue;

      // Extract the text content (skip the first line if it's a header)
      const textLines = lines.filter(l => !l.startsWith('#') && !l.match(/^\|[-\s|]+\|$/));
      const text = textLines.join(' ').trim();

      if (text.length > 20) {
        sections.push(text);
      }
    }

    return sections;
  }

  /**
   * Check if content is a duplicate of Auto-Memory entries.
   *
   * @param {string} content - Content to check
   * @returns {Promise<{ duplicate: boolean, similarity: number, matchedSection: string|null }>}
   */
  async isDuplicate(content) {
    if (!content || !content.trim()) {
      return { duplicate: false, similarity: 0, matchedSection: null };
    }

    const sections = await this.loadAutoMemory();

    let maxSim = 0;
    let matchedSection = null;

    for (const section of sections) {
      const sim = jaccardSim(content, section);
      if (sim > maxSim) {
        maxSim = sim;
        matchedSection = section;
      }
    }

    return {
      duplicate: maxSim >= this.threshold,
      similarity: maxSim,
      matchedSection: maxSim >= this.threshold ? matchedSection : null,
    };
  }

  /**
   * High-level check before storing a memory.
   * Returns { store: true/false, reason } for integration into learn pipeline.
   *
   * @param {string} content - Memory content to store
   * @returns {Promise<{ store: boolean, reason?: string }>}
   */
  async checkBeforeStore(content) {
    const result = await this.isDuplicate(content);

    if (result.duplicate) {
      return {
        store: false,
        reason: `Skipped: similar content already exists in Auto-Memory (MEMORY.md). Similarity: ${(result.similarity * 100).toFixed(0)}%.`,
      };
    }

    return { store: true };
  }

  /**
   * Clear the cached Auto-Memory sections.
   */
  clearCache() {
    this._cache = null;
    this._cacheTime = 0;
  }
}

module.exports = {
  AutoMemoryDeconflict,
  DECONFLICT_THRESHOLD,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-auto-memory-deconflict.cjs`
Expected: All 17 tests PASS

**Step 5: Integration -- Modify sonnet-thinker.cjs learn()**

In `cortex/sonnet-thinker.cjs`, add deconfliction check before storing:

```javascript
// Add import near top (after other requires):
const { AutoMemoryDeconflict } = require('../core/auto-memory-deconflict.cjs');
const autoMemoryCheck = new AutoMemoryDeconflict();

// In the learn() method, before the storage block (around line 515):
// After the quality check (analysis.quality >= 4 && !analysis.isDuplicate),
// add Auto-Memory deconfliction:

if (analysis.quality >= 4 && !analysis.isDuplicate) {
  // Check against Auto-Memory before storing
  const deconflictResult = await autoMemoryCheck.checkBeforeStore(
    analysis.enhancedInsight || insight
  );

  if (!deconflictResult.store) {
    return {
      insight,
      analysis,
      stored: false,
      skippedReason: deconflictResult.reason,
      duration: Date.now() - startTime,
    };
  }

  // ... existing storage code continues here
}
```

**Step 6: Commit**

```bash
git add core/auto-memory-deconflict.cjs tests/test-auto-memory-deconflict.cjs cortex/sonnet-thinker.cjs
git commit -m "feat(C5): Auto-Memory deconfliction with MEMORY.md similarity check

Reads ~/.claude/projects/*/memory/MEMORY.md files, parses into sections,
and checks Jaccard similarity (threshold 0.7) before storing new memories.
Prevents Cortex from duplicating Claude Code's built-in Auto-Memory.
5-minute cache TTL for parsed sections."
```
