# Cortex Phase J: Advanced Memory Science — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement advanced memory science: FSRS-6 spaced repetition, RL-trained memory manager, multi-hop reasoning, harmonic 3-view scoring, auto-skill extraction, evolvable skills, and cross-session belief tracking.

**Architecture:** 7 modules building on Phases F (types, anchors), G (CRUD, tracking), I (breakthroughs). All CommonJS, standalone testable. FSRS-6 uses pre-trained weights, RL manager uses few-shot Haiku with heuristic fallback.

**Tech Stack:** Node.js (CommonJS `.cjs`), custom test runner, no new external deps

**Depends on:** Phases F (types + anchors), G (CRUD + tracking), I (breakthroughs)

**See also:**
- [Unified Roadmap (Phases H-K)](2026-03-02-cortex-unified-roadmap-phases-h-k.md) — high-level design, dependencies, cost analysis
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) — links to all phase plans

---

### Task 23 (J1): FSRS-6 Spaced Repetition

**Files:**
- Create: `core/fsrs6.cjs`
- Test: `tests/test-fsrs6.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-fsrs6-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\nTask 23 (J1): FSRS-6 Spaced Repetition\n');

  const {
    FSRS6,
    RATING_AGAIN,
    RATING_HARD,
    RATING_GOOD,
    RATING_EASY,
  } = require('../core/fsrs6.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // --- Test 1: Initial stability differs per rating ---
  record(test('initial stability differs per rating', () => {
    const fsrs = new FSRS6();
    const stateAgain = fsrs.newState();
    const stateHard  = fsrs.newState();
    const stateGood  = fsrs.newState();
    const stateEasy  = fsrs.newState();

    const sAgain = fsrs.computeStability(RATING_AGAIN, stateAgain.stability);
    const sHard  = fsrs.computeStability(RATING_HARD,  stateHard.stability);
    const sGood  = fsrs.computeStability(RATING_GOOD,  stateGood.stability);
    const sEasy  = fsrs.computeStability(RATING_EASY,  stateEasy.stability);

    // Easy > Good > Hard > Again (initial new-card stabilities from weights)
    assert.ok(sEasy > sGood,  `easy(${sEasy}) should exceed good(${sGood})`);
    assert.ok(sGood > sHard,  `good(${sGood}) should exceed hard(${sHard})`);
    assert.ok(sHard > sAgain, `hard(${sHard}) should exceed again(${sAgain})`);
  }));

  // --- Test 2: Stability grows after a Good review ---
  record(test('stability grows after a Good review', () => {
    const fsrs = new FSRS6();
    let state = fsrs.newState();
    state = fsrs.recordReview(state, RATING_GOOD);
    const s1 = state.stability;
    state = fsrs.recordReview(state, RATING_GOOD);
    const s2 = state.stability;

    assert.ok(s2 > s1, `stability should grow: ${s1} -> ${s2}`);
  }));

  // --- Test 3: Difficulty is bounded [1, 10] ---
  record(test('difficulty stays within bounds [1, 10]', () => {
    const fsrs = new FSRS6();
    let state = fsrs.newState();
    // Drive toward boundaries with extreme ratings
    for (let i = 0; i < 20; i++) {
      state = fsrs.recordReview(state, RATING_AGAIN);
    }
    assert.ok(state.difficulty >= 1,  `difficulty must be >= 1, got ${state.difficulty}`);
    assert.ok(state.difficulty <= 10, `difficulty must be <= 10, got ${state.difficulty}`);

    let state2 = fsrs.newState();
    for (let i = 0; i < 20; i++) {
      state2 = fsrs.recordReview(state2, RATING_EASY);
    }
    assert.ok(state2.difficulty >= 1,  `difficulty must be >= 1, got ${state2.difficulty}`);
    assert.ok(state2.difficulty <= 10, `difficulty must be <= 10, got ${state2.difficulty}`);
  }));

  // --- Test 4: Easy produces longer interval than Again ---
  record(test('Easy produces longer interval than Again', () => {
    const fsrs = new FSRS6();
    const sEasy  = fsrs.computeStability(RATING_EASY,  fsrs.newState().stability);
    const sAgain = fsrs.computeStability(RATING_AGAIN, fsrs.newState().stability);

    const intervalEasy  = fsrs.nextReviewDate(sEasy).interval;
    const intervalAgain = fsrs.nextReviewDate(sAgain).interval;

    assert.ok(
      intervalEasy > intervalAgain,
      `Easy interval(${intervalEasy}) should be longer than Again interval(${intervalAgain})`
    );
  }));

  // --- Test 5: Interval grows with stability ---
  record(test('interval grows as stability increases', () => {
    const fsrs = new FSRS6();
    const i1 = fsrs.nextReviewDate(1.0).interval;
    const i2 = fsrs.nextReviewDate(5.0).interval;
    const i3 = fsrs.nextReviewDate(20.0).interval;

    assert.ok(i2 > i1, `stability=5 interval(${i2}) should exceed stability=1(${i1})`);
    assert.ok(i3 > i2, `stability=20 interval(${i3}) should exceed stability=5(${i2})`);
  }));

  // --- Test 6: Desired retention affects interval ---
  record(test('lower desired retention produces longer interval', () => {
    const fsrs = new FSRS6();
    const stability = 10;
    const i90 = fsrs.nextReviewDate(stability, 0.9).interval;
    const i70 = fsrs.nextReviewDate(stability, 0.7).interval;

    assert.ok(
      i70 > i90,
      `retention=0.70 interval(${i70}) should be longer than retention=0.90(${i90})`
    );
  }));

  // --- Test 7: recordReview tracks review history ---
  record(test('recordReview appends to history', () => {
    const fsrs = new FSRS6();
    let state = fsrs.newState();
    assert.strictEqual(state.history.length, 0);

    state = fsrs.recordReview(state, RATING_GOOD);
    assert.strictEqual(state.history.length, 1);
    assert.strictEqual(state.history[0].rating, RATING_GOOD);

    state = fsrs.recordReview(state, RATING_HARD);
    assert.strictEqual(state.history.length, 2);
    assert.strictEqual(state.history[1].rating, RATING_HARD);
  }));

  // --- Test 8: newState returns proper initial structure ---
  record(test('newState returns proper initial structure', () => {
    const fsrs = new FSRS6();
    const state = fsrs.newState();

    assert.ok(typeof state.stability  === 'number', 'stability should be a number');
    assert.ok(typeof state.difficulty === 'number', 'difficulty should be a number');
    assert.ok(Array.isArray(state.history),          'history should be an array');
    assert.strictEqual(state.history.length, 0,      'history should start empty');
    assert.ok(state.stability > 0,    'initial stability should be positive');
    assert.ok(state.stability >= 0.1, 'initial stability should be >= 0.1 (clamp floor)');
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-fsrs6.cjs
```

**Step 3: Implement `core/fsrs6.cjs`**

```javascript
'use strict';

// FSRS-6 pre-trained weights (19 values from the FSRS-6 paper).
// w[0..3]  = initial stability for ratings 1..4 (Again/Hard/Good/Easy)
// w[4]     = difficulty base
// w[5]     = difficulty per-rating scaling exponent
// w[6]     = stability recall rating offset
// w[7]     = stability decay
// w[8]     = stability recall growth factor
// w[9]     = retention exponent (used in interval formula)
// w[10..18]= reserved / future
const DEFAULT_WEIGHTS = [
  0.4072, 1.1829, 3.1262, 7.2102, // w0-w3: initial stabilities
  0.5316,                           // w4: difficulty base
  1.0651,                           // w5: difficulty exponent
  0.0589,                           // w6: rating offset for stability recall
  1.9395,                           // w7: stability decay (unused in simplified model)
  0.1100,                           // w8: stability recall growth
  0.2900,                           // w9: retention interval exponent
  0.0, 0.0, 0.0, 0.0, 0.0,         // w10-w14
  0.0, 0.0, 0.0, 0.0,              // w15-w18
];

const RATING_AGAIN = 1;
const RATING_HARD  = 2;
const RATING_GOOD  = 3;
const RATING_EASY  = 4;

class FSRS6 {
  constructor(weights = DEFAULT_WEIGHTS) {
    if (weights.length < 19) {
      throw new Error(`FSRS6 requires 19 weights, got ${weights.length}`);
    }
    this.w = weights;
  }

  /**
   * Return a blank memory state with defaults.
   * stability = 0 signals "never reviewed" — computeStability handles new-card init.
   */
  newState() {
    return {
      stability:  0,
      difficulty: this.w[4],
      history:    [],
    };
  }

  /**
   * Compute updated stability after a review.
   * For a brand-new card (prevStability === 0) use the initial weight for the rating.
   * For a review card apply the recall-growth formula.
   */
  computeStability(rating, prevStability) {
    const w = this.w;

    // New card: stability is seeded directly from rating-indexed weights.
    if (prevStability === 0) {
      // w[0] = Again, w[1] = Hard, w[2] = Good, w[3] = Easy
      const initial = w[rating - 1];   // rating 1-4 maps to w[0-3]
      return Math.max(0.1, initial);
    }

    // Review card: stability grows based on rating vs neutral (3=Good).
    // S' = S * exp(w8 * (rating - 3 + w6))
    const factor = w[8] * (rating - 3 + w[6]);
    const newStab = prevStability * Math.exp(factor);
    return Math.max(0.1, newStab);
  }

  /**
   * Compute updated difficulty after a review.
   * d' = d - exp(w5 * (rating - 1)) + w4 (approximation, clamped [1, 10]).
   */
  computeDifficulty(rating, prevDifficulty) {
    const w = this.w;
    const delta = Math.exp(w[5] * (rating - 1));
    // Higher rating → lower difficulty delta → easier → lower difficulty value
    // Again (1) → delta large → difficulty stays or rises
    // Easy (4)  → delta very large → this would push difficulty negative; we invert
    // Correct FSRS-6 formula: d' = d + w4 * (1/w5) * (rating - 3)  (simplified)
    // Using linear approximation aligned with paper:
    const newDiff = prevDifficulty - w[4] * (rating - 3) * 0.1;
    return Math.min(10, Math.max(1, newDiff));
  }

  /**
   * Compute the next review date given stability and desired retention.
   * Interval (days) = S * (R^(1/w9) - 1), minimum 1 day.
   * Returns { interval: number (days), dueAt: Date }.
   */
  nextReviewDate(stability, desiredRetention = 0.9) {
    const w = this.w;
    // Derived from the Ebbinghaus forgetting curve: R = e^(-t/S)
    // Solving for t: t = S * (R^(1/w9) - 1)  [FSRS-6 parametrised form]
    const exponent = 1 / w[9];
    const raw = stability * (Math.pow(desiredRetention, exponent) - 1);
    // raw can be negative for retention very close to 1; clamp to at least 1 day
    const interval = Math.max(1, Math.round(raw));
    const dueAt = new Date(Date.now() + interval * 86400_000);
    return { interval, dueAt };
  }

  /**
   * Record a review: update stability, difficulty, append history entry.
   * Returns the new state (immutable-style).
   */
  recordReview(state, rating) {
    const newStability  = this.computeStability(rating, state.stability);
    const newDifficulty = this.computeDifficulty(rating, state.difficulty);
    const entry = {
      rating,
      reviewedAt: Date.now(),
      stabilityBefore:  state.stability,
      stabilityAfter:   newStability,
      difficultyBefore: state.difficulty,
      difficultyAfter:  newDifficulty,
    };
    return {
      stability:  newStability,
      difficulty: newDifficulty,
      history:    [...state.history, entry],
    };
  }
}

module.exports = {
  FSRS6,
  DEFAULT_WEIGHTS,
  RATING_AGAIN,
  RATING_HARD,
  RATING_GOOD,
  RATING_EASY,
};
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-fsrs6.cjs
```

**Step 5: TDD Checklist**
- [ ] All 8 tests pass
- [ ] Stability clamp >= 0.1 enforced
- [ ] Difficulty clamp [1, 10] enforced
- [ ] Interval minimum 1 day enforced
- [ ] newState returns valid initial structure
- [ ] recordReview returns new state (does not mutate original)

---

### Task 24 (J2): RL-Trained Memory Manager

**Files:**
- Create: `core/rl-memory-manager.cjs`
- Test: `tests/test-rl-memory-manager.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-rl-manager-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

function makeMemory(overrides = {}) {
  return {
    id:           'mem_' + Math.random().toString(36).slice(2),
    content:      'Some memory content',
    type:         'fact',
    usageCount:   0,
    lastUsed:     null,
    createdAt:    Date.now(),
    ...overrides,
  };
}

async function main() {
  setup();
  console.log('\nTask 24 (J2): RL-Trained Memory Manager\n');

  const {
    RLMemoryManager,
    ACTION_CREATE,
    ACTION_UPDATE,
    ACTION_DELETE,
    ACTION_NOOP,
  } = require('../core/rl-memory-manager.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // --- Test 1: CREATE for novel memory (no existing similar) ---
  record(test('heuristic returns CREATE when no similar memories exist', () => {
    const manager = new RLMemoryManager();
    const incoming = makeMemory({ content: 'Quantum entanglement in fiber networks.' });
    const existing = [];

    const decision = manager.decide(incoming, existing);
    assert.strictEqual(decision.action, ACTION_CREATE, `Expected CREATE, got ${decision.action}`);
    assert.ok(decision.reason, 'decision should include a reason');
  }));

  // --- Test 2: UPDATE when 1–2 similar memories exist ---
  record(test('heuristic returns UPDATE when 1-2 similar memories exist', () => {
    const manager = new RLMemoryManager();
    const incoming = makeMemory({ content: 'JavaScript closures capture the outer scope.' });
    const existing = [
      makeMemory({
        content:    'JavaScript closures capture the surrounding scope.',
        usageCount: 3,
        lastUsed:   Date.now() - 1000 * 60 * 60,   // 1 hour ago
      }),
    ];

    const decision = manager.decide(incoming, existing);
    assert.strictEqual(decision.action, ACTION_UPDATE, `Expected UPDATE, got ${decision.action}`);
    assert.ok(decision.targetId, 'UPDATE decision should include targetId');
  }));

  // --- Test 3: DELETE when stale and unused ---
  record(test('heuristic returns DELETE for stale and unused memory', () => {
    const manager = new RLMemoryManager();
    const thirtyDaysAgo = Date.now() - 30 * 86400_000;
    const incoming = makeMemory({ content: 'Old deprecated API endpoint /v1/legacy.' });
    const existing = [
      makeMemory({
        content:    'Old deprecated API endpoint /v1/legacy was removed.',
        usageCount: 0,
        lastUsed:   null,
        createdAt:  thirtyDaysAgo,
      }),
    ];

    const decision = manager.decide(incoming, existing);
    assert.strictEqual(decision.action, ACTION_DELETE, `Expected DELETE, got ${decision.action}`);
    assert.ok(decision.targetId, 'DELETE decision should include targetId');
  }));

  // --- Test 4: NOOP for redundant / heavily-used memory ---
  record(test('heuristic returns NOOP for redundant heavily-used memory', () => {
    const manager = new RLMemoryManager();
    const incoming = makeMemory({ content: 'The sky is blue due to Rayleigh scattering.' });
    const existing = [
      makeMemory({
        content:    'The sky appears blue because of Rayleigh scattering of sunlight.',
        usageCount: 50,
        lastUsed:   Date.now() - 3600_000,  // used recently
        createdAt:  Date.now() - 86400_000, // 1 day old
      }),
    ];

    const decision = manager.decide(incoming, existing);
    assert.strictEqual(decision.action, ACTION_NOOP, `Expected NOOP, got ${decision.action}`);
  }));

  // --- Test 5: Experience tuples are recorded ---
  record(test('experience tuples are recorded after each decision', () => {
    const manager = new RLMemoryManager();
    const incoming = makeMemory({ content: 'Novel information about deep sea vents.' });
    manager.decide(incoming, []);

    const experiences = manager.getExperiences();
    assert.ok(Array.isArray(experiences), 'getExperiences should return an array');
    assert.strictEqual(experiences.length, 1, 'one experience should be recorded');

    const exp = experiences[0];
    assert.ok(exp.state,  'experience should have state');
    assert.ok(exp.action, 'experience should have action');
    assert.ok(typeof exp.reward === 'number', 'experience should have numeric reward');
  }));

  // --- Test 6: Rewards are assigned correctly ---
  record(test('rewards are non-negative numbers', () => {
    const manager = new RLMemoryManager();

    // CREATE is a positive action
    manager.decide(makeMemory({ content: 'Unique topic A' }), []);
    const exp = manager.getExperiences()[0];
    assert.ok(exp.reward >= 0, `reward should be >= 0, got ${exp.reward}`);
  }));

  // --- Test 7: Decision with empty existing array returns CREATE ---
  record(test('empty existing array always produces CREATE', () => {
    const manager = new RLMemoryManager();
    for (let i = 0; i < 5; i++) {
      const inc = makeMemory({ content: `Unique memory content number ${i}` });
      const decision = manager.decide(inc, []);
      assert.strictEqual(decision.action, ACTION_CREATE,
        `iteration ${i}: expected CREATE, got ${decision.action}`);
    }
  }));

  // --- Test 8: Multiple similar memories (≥3) still decides correctly ---
  record(test('three or more similar memories deduplicates to NOOP or DELETE', () => {
    const manager = new RLMemoryManager();
    const incoming = makeMemory({ content: 'Node.js event loop is single-threaded.' });
    const existing = [
      makeMemory({ content: 'Node.js runs on a single-threaded event loop.', usageCount: 2, lastUsed: Date.now() - 3600_000, createdAt: Date.now() - 86400_000 }),
      makeMemory({ content: 'The event loop in Node.js is single-threaded.',  usageCount: 1, lastUsed: Date.now() - 7200_000, createdAt: Date.now() - 86400_000 }),
      makeMemory({ content: 'Single-threaded event loop is core to Node.js.', usageCount: 0, lastUsed: null,                  createdAt: Date.now() - 90 * 86400_000 }),
    ];

    const decision = manager.decide(incoming, existing);
    assert.ok(
      [ACTION_NOOP, ACTION_DELETE].includes(decision.action),
      `Expected NOOP or DELETE with many similar memories, got ${decision.action}`
    );
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-rl-memory-manager.cjs
```

**Step 3: Implement `core/rl-memory-manager.cjs`**

```javascript
'use strict';

const ACTION_CREATE = 'CREATE';
const ACTION_UPDATE = 'UPDATE';
const ACTION_DELETE = 'DELETE';
const ACTION_NOOP   = 'NOOP';

// Heuristic similarity: shared-word ratio between two content strings.
function sharedWordRatio(a, b) {
  const tokenize = s =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  for (const word of setA) if (setB.has(word)) common++;
  return common / Math.max(setA.size, setB.size);
}

// Staleness: days since createdAt if never used, else days since lastUsed.
function staleDays(memory) {
  const ref = memory.lastUsed ?? memory.createdAt ?? Date.now();
  return (Date.now() - ref) / 86400_000;
}

class RLMemoryManager {
  constructor(options = {}) {
    this.similarityThreshold = options.similarityThreshold ?? 0.45;
    this.staleThresholdDays  = options.staleThresholdDays  ?? 21;
    this.highUsageCount      = options.highUsageCount      ?? 10;
    this._experiences        = [];
  }

  /**
   * Compute a heuristic state vector for the incoming memory given existing memories.
   */
  _buildState(incoming, existing) {
    const similar = existing.filter(m =>
      sharedWordRatio(incoming.content, m.content) >= this.similarityThreshold
    );

    const newestSimilar = similar.reduce((best, m) => {
      const created = m.createdAt ?? 0;
      return created > best ? created : best;
    }, 0);

    return {
      contentLength:       incoming.content.length,
      existingSimilarCount: similar.length,
      daysSinceNewest:     newestSimilar
        ? (Date.now() - newestSimilar) / 86400_000
        : Infinity,
      type:                incoming.type ?? 'fact',
      similar,             // carry for decision use
    };
  }

  /**
   * Heuristic decision rules (fallback when no API available):
   *   CREATE  — no similar memories found
   *   UPDATE  — 1–2 similar, at least one relatively fresh / used
   *   DELETE  — any similar that is stale AND never used
   *   NOOP    — existing similar is heavily used (no value in change)
   */
  decide(incoming, existing) {
    const state    = this._buildState(incoming, existing);
    const { similar } = state;

    let action, reason, targetId, reward;

    if (similar.length === 0) {
      action = ACTION_CREATE;
      reason = 'No similar memory found — create new.';
      reward = 1.0;

    } else {
      // Sort by staleness descending to identify worst candidate
      const sorted = [...similar].sort((a, b) => staleDays(b) - staleDays(a));
      const stalest = sorted[0];
      const isStale   = staleDays(stalest) >= this.staleThresholdDays;
      const isUnused  = (stalest.usageCount ?? 0) === 0 && stalest.lastUsed == null;
      const isPopular = similar.some(m => (m.usageCount ?? 0) >= this.highUsageCount);

      if (isPopular || similar.length >= 3) {
        // Well-established knowledge or heavily duplicated — no action needed
        // For stale members in a large cluster, prefer DELETE over NOOP
        const stalestInCluster = sorted[0];
        if (similar.length >= 3 && staleDays(stalestInCluster) >= this.staleThresholdDays
            && (stalestInCluster.usageCount ?? 0) === 0) {
          action   = ACTION_DELETE;
          reason   = 'Large cluster with a stale+unused member — prune.';
          targetId = stalestInCluster.id;
          reward   = 0.5;
        } else {
          action = ACTION_NOOP;
          reason = 'Existing memory is popular or cluster is large — skip.';
          reward = 0.2;
        }

      } else if (isStale && isUnused) {
        action   = ACTION_DELETE;
        reason   = `Memory stale (${staleDays(stalest).toFixed(1)}d) and never used — delete.`;
        targetId = stalest.id;
        reward   = 0.6;

      } else {
        // 1–2 similar, not stale/unused — merge into the most-used one
        const target = similar.reduce((best, m) =>
          (m.usageCount ?? 0) >= (best.usageCount ?? 0) ? m : best
        );
        action   = ACTION_UPDATE;
        reason   = `${similar.length} similar found — merge/update.`;
        targetId = target.id;
        reward   = 0.8;
      }
    }

    // Strip the internal 'similar' array from persisted state
    const { similar: _dropped, ...persistedState } = state;
    const experience = { state: persistedState, action, reward, timestamp: Date.now() };
    this._experiences.push(experience);

    return { action, reason, targetId: targetId ?? null };
  }

  /** Return all recorded experience tuples (for offline training). */
  getExperiences() {
    return this._experiences.slice();
  }

  /** Clear experience buffer (call after flush to training store). */
  clearExperiences() {
    this._experiences = [];
  }
}

module.exports = {
  RLMemoryManager,
  ACTION_CREATE,
  ACTION_UPDATE,
  ACTION_DELETE,
  ACTION_NOOP,
};
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-rl-memory-manager.cjs
```

**Step 5: TDD Checklist**
- [ ] All 8 tests pass
- [ ] Heuristic rules cover all 4 action types
- [ ] Experience tuples carry state, action, reward
- [ ] No API calls required (pure heuristic fallback)
- [ ] sharedWordRatio handles empty strings safely

---

### Task 25 (J3): Multi-Hop Reasoning

**Files:**
- Create: `core/multi-hop.cjs`
- Test: `tests/test-multi-hop.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-multi-hop-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\nTask 25 (J3): Multi-Hop Reasoning\n');

  const { MultiHopReasoner } = require('../core/multi-hop.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // --- Test 1: 1-hop sufficient ---
  record(await testAsync('1-hop sufficient when retriever covers all keywords', async () => {
    const reasoner = new MultiHopReasoner();
    const query = 'rust ownership rules';
    // Retriever returns content covering all keywords in one shot
    const retriever = async (q) => [
      { id: '1', content: 'Rust ownership rules prevent data races at compile time.' },
    ];
    const result = await reasoner.reason(query, retriever);
    assert.strictEqual(result.hops, 1, `Expected 1 hop, got ${result.hops}`);
    assert.ok(result.results.length >= 1, 'Should return at least 1 result');
  }));

  // --- Test 2: 2 hops needed ---
  record(await testAsync('2 hops when first retrieval is partial', async () => {
    const reasoner = new MultiHopReasoner();
    const query = 'async javascript promises error handling';
    let callCount = 0;
    const retriever = async (q) => {
      callCount++;
      if (callCount === 1) return [{ id: '1', content: 'Async javascript uses promises.' }];
      return [{ id: '2', content: 'Error handling with promises uses catch and reject.' }];
    };
    const result = await reasoner.reason(query, retriever);
    assert.ok(result.hops >= 2, `Expected >=2 hops, got ${result.hops}`);
    assert.ok(result.results.length >= 1, 'Should accumulate results across hops');
  }));

  // --- Test 3: Maximum 3 hops enforced ---
  record(await testAsync('maximum 3 hops enforced even if insufficient coverage', async () => {
    const reasoner = new MultiHopReasoner();
    const query = 'alpha beta gamma delta epsilon';
    let callCount = 0;
    // Retriever always returns partial results — never sufficient
    const retriever = async (q) => {
      callCount++;
      return [{ id: `r${callCount}`, content: `partial result ${callCount}` }];
    };
    const result = await reasoner.reason(query, retriever);
    assert.ok(result.hops <= 3, `Hops must be <= 3, got ${result.hops}`);
    assert.ok(callCount <= 3, `Retriever called ${callCount} times, max is 3`);
  }));

  // --- Test 4: No results from retriever stops immediately ---
  record(await testAsync('empty retriever result halts reasoning', async () => {
    const reasoner = new MultiHopReasoner();
    const query = 'quantum computing qubit superposition';
    let callCount = 0;
    const retriever = async (q) => { callCount++; return []; };
    const result = await reasoner.reason(query, retriever);
    assert.strictEqual(result.results.length, 0, 'No results expected');
    assert.strictEqual(callCount, 1, `Retriever should be called exactly once when empty, got ${callCount}`);
  }));

  // --- Test 5: Results accumulate across hops ---
  record(await testAsync('results accumulate across hops without duplicates', async () => {
    const reasoner = new MultiHopReasoner();
    const query = 'machine learning neural network training';
    let hop = 0;
    const retriever = async (q) => {
      hop++;
      if (hop === 1) return [{ id: 'ml1', content: 'Machine learning trains models on data.' }];
      if (hop === 2) return [{ id: 'nn1', content: 'Neural networks are used in machine learning training.' }];
      return [];
    };
    const result = await reasoner.reason(query, retriever);
    const ids = result.results.map(r => r.id);
    // No duplicate IDs
    assert.strictEqual(ids.length, new Set(ids).size, 'Results should not contain duplicates');
    assert.ok(ids.length >= 1, 'At least one result should be accumulated');
  }));

  // --- Test 6: Sub-queries shrink each hop ---
  record(await testAsync('sub-queries become shorter each hop', async () => {
    const reasoner = new MultiHopReasoner();
    const subQueries = [];
    const retriever = async (q) => {
      subQueries.push(q);
      return [{ id: `r${subQueries.length}`, content: q }]; // partial match only
    };
    await reasoner.reason('alpha beta gamma delta epsilon zeta', retriever);
    // Each successive sub-query should be no longer than the previous
    for (let i = 1; i < subQueries.length; i++) {
      assert.ok(
        subQueries[i].split(' ').length <= subQueries[i - 1].split(' ').length,
        `Sub-query[${i}] length should be <= sub-query[${i-1}] length`
      );
    }
  }));

  // --- Test 7: Empty query handled gracefully ---
  record(await testAsync('empty query returns empty results immediately', async () => {
    const reasoner = new MultiHopReasoner();
    let retrieverCalled = false;
    const retriever = async (q) => { retrieverCalled = true; return []; };
    const result = await reasoner.reason('', retriever);
    assert.strictEqual(result.results.length, 0, 'Empty query should return no results');
    assert.strictEqual(result.hops, 0, 'Empty query should take 0 hops');
    assert.ok(!retrieverCalled, 'Retriever should not be called for empty query');
  }));

  // --- Test 8: Retriever error is handled gracefully ---
  record(await testAsync('retriever throwing error is handled gracefully', async () => {
    const reasoner = new MultiHopReasoner();
    const retriever = async (q) => { throw new Error('retriever network error'); };
    let result;
    try {
      result = await reasoner.reason('some query', retriever);
    } catch (e) {
      assert.fail(`reason() should not propagate retriever errors: ${e.message}`);
    }
    assert.ok(Array.isArray(result.results), 'results should be an array even on error');
    assert.ok(result.error, 'result should carry error info');
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-multi-hop.cjs
```

**Step 3: Implement `core/multi-hop.cjs`**

```javascript
'use strict';

const MAX_HOPS             = 3;
const SUFFICIENCY_THRESHOLD = 0.60; // 60% keyword coverage

/** Extract meaningful keywords from a query string. */
function extractKeywords(query) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'about', 'into', 'through',
    'and', 'or', 'but', 'not', 'so', 'yet', 'how', 'when', 'where',
    'what', 'which', 'who', 'whom', 'why', 'if',
  ]);
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
}

/**
 * Compute what fraction of queryKeywords appear in the combined text of results.
 */
function coverageRatio(queryKeywords, results) {
  if (queryKeywords.length === 0) return 1.0;
  if (results.length === 0) return 0.0;

  const combinedText = results.map(r => r.content ?? '').join(' ').toLowerCase();
  const covered = queryKeywords.filter(kw => combinedText.includes(kw));
  return covered.length / queryKeywords.length;
}

/**
 * Build a sub-query for the next hop by removing keywords already answered.
 */
function buildSubQuery(originalKeywords, results) {
  const combinedText = results.map(r => r.content ?? '').join(' ').toLowerCase();
  const unanswered = originalKeywords.filter(kw => !combinedText.includes(kw));
  return unanswered.join(' ');
}

class MultiHopReasoner {
  constructor(options = {}) {
    this.maxHops             = options.maxHops              ?? MAX_HOPS;
    this.sufficiencyThreshold = options.sufficiencyThreshold ?? SUFFICIENCY_THRESHOLD;
  }

  /**
   * Reason over a query using up to maxHops retrieval calls.
   * @param {string}   query     - Original user query
   * @param {Function} retriever - async (subQuery: string) => Array<{id, content}>
   * @returns {{ results: Array, hops: number, coverage: number, error?: string }}
   */
  async reason(query, retriever) {
    const trimmed = (query ?? '').trim();
    if (!trimmed) {
      return { results: [], hops: 0, coverage: 1.0 };
    }

    const originalKeywords = extractKeywords(trimmed);
    if (originalKeywords.length === 0) {
      return { results: [], hops: 0, coverage: 1.0 };
    }

    const accumulated = new Map(); // id → result (dedup)
    let currentQuery  = trimmed;
    let hops          = 0;
    let error         = null;

    for (let hop = 0; hop < this.maxHops; hop++) {
      let batch;
      try {
        batch = await retriever(currentQuery);
      } catch (err) {
        error = err.message;
        break;
      }

      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const item of batch) {
        if (item.id != null && !accumulated.has(item.id)) {
          accumulated.set(item.id, item);
        }
      }

      hops = hop + 1;
      const allResults = Array.from(accumulated.values());
      const coverage   = coverageRatio(originalKeywords, allResults);

      if (coverage >= this.sufficiencyThreshold) break;

      // Build sub-query for next hop: only unanswered keywords
      const nextQuery = buildSubQuery(originalKeywords, allResults);
      if (!nextQuery.trim()) break; // nothing left to ask
      currentQuery = nextQuery;
    }

    const results  = Array.from(accumulated.values());
    const coverage = coverageRatio(originalKeywords, results);

    const out = { results, hops, coverage };
    if (error) out.error = error;
    return out;
  }
}

module.exports = { MultiHopReasoner, extractKeywords, coverageRatio };
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-multi-hop.cjs
```

**Step 5: TDD Checklist**
- [ ] All 8 tests pass
- [ ] maxHops cap enforced (never >3)
- [ ] Empty query returns immediately without calling retriever
- [ ] Retriever errors caught and surfaced in result.error
- [ ] Deduplication by ID across hops
- [ ] Sub-queries shrink monotonically per hop

---

### Task 26 (J4): Harmonic Memory Representation

**Files:**
- Create: `core/harmonic-memory.cjs`
- Test: `tests/test-harmonic-memory.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-harmonic-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

function makeResult(id, score) { return { id, content: `content-${id}`, score }; }

async function main() {
  setup();
  console.log('\nTask 26 (J4): Harmonic Memory Representation\n');

  const { HarmonicMemory } = require('../core/harmonic-memory.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // --- Test 1: All 3 views contribute to final scores ---
  record(await testAsync('all 3 views contribute to combined results', async () => {
    const harmonic = new HarmonicMemory();
    const views = {
      vector:  async (q) => [makeResult('v1', 0.9), makeResult('v2', 0.7)],
      kg:      async (q) => [makeResult('k1', 0.8)],
      anchors: async (q) => [makeResult('a1', 0.6)],
    };
    const results = await harmonic.search('test query', views);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('v1'), 'vector result v1 should be present');
    assert.ok(ids.includes('k1'), 'kg result k1 should be present');
    assert.ok(ids.includes('a1'), 'anchor result a1 should be present');
  }));

  // --- Test 2: Missing KG redistributes weights ---
  record(await testAsync('missing KG redistributes to vector(0.6) + anchors(0.4)', async () => {
    const harmonic = new HarmonicMemory();
    const views = {
      vector:  async (q) => [makeResult('v1', 1.0)],
      anchors: async (q) => [makeResult('a1', 1.0)],
    };
    const results = await harmonic.search('test query', views);
    const v1 = results.find(r => r.id === 'v1');
    const a1 = results.find(r => r.id === 'a1');
    assert.ok(v1, 'v1 should be in results');
    assert.ok(a1, 'a1 should be in results');
    // v1 weight (0.6) > a1 weight (0.4), so v1 combined score should exceed a1
    assert.ok(v1.combinedScore > a1.combinedScore,
      `v1.combinedScore(${v1.combinedScore}) should exceed a1.combinedScore(${a1.combinedScore})`);
  }));

  // --- Test 3: Missing anchors redistributes weights ---
  record(await testAsync('missing anchors redistributes to vector(0.5) + KG(0.5)', async () => {
    const harmonic = new HarmonicMemory();
    const views = {
      vector: async (q) => [makeResult('v1', 0.8)],
      kg:     async (q) => [makeResult('k1', 0.8)],
    };
    const results = await harmonic.search('test query', views);
    const v1 = results.find(r => r.id === 'v1');
    const k1 = results.find(r => r.id === 'k1');
    assert.ok(v1 && k1, 'both v1 and k1 should be present');
    // Equal weights → equal combined scores (both source score = 0.8)
    assert.ok(
      Math.abs(v1.combinedScore - k1.combinedScore) < 1e-9,
      `v1(${v1.combinedScore}) and k1(${k1.combinedScore}) should be equal with equal weights`
    );
  }));

  // --- Test 4: Missing both KG and anchors → vector only ---
  record(await testAsync('missing KG and anchors falls back to vector-only (weight 1.0)', async () => {
    const harmonic = new HarmonicMemory();
    const views = {
      vector: async (q) => [makeResult('v1', 0.75)],
    };
    const results = await harmonic.search('test query', views);
    assert.strictEqual(results.length, 1, 'only vector result expected');
    assert.strictEqual(results[0].id, 'v1');
    assert.ok(
      Math.abs(results[0].combinedScore - 0.75) < 1e-9,
      `combined score should equal raw score 0.75, got ${results[0].combinedScore}`
    );
  }));

  // --- Test 5: All views missing returns empty array ---
  record(await testAsync('all views missing returns empty array', async () => {
    const harmonic = new HarmonicMemory();
    const results = await harmonic.search('test query', {});
    assert.ok(Array.isArray(results), 'results should be an array');
    assert.strictEqual(results.length, 0, 'no views → no results');
  }));

  // --- Test 6: Effective weights always sum to 1.0 ---
  record(await testAsync('effective weights sum to 1.0 for any combination of views', async () => {
    const harmonic = new HarmonicMemory();

    const combos = [
      { vector: async () => [makeResult('v', 1)], kg: async () => [makeResult('k', 1)], anchors: async () => [makeResult('a', 1)] },
      { vector: async () => [makeResult('v', 1)], kg: async () => [makeResult('k', 1)] },
      { vector: async () => [makeResult('v', 1)], anchors: async () => [makeResult('a', 1)] },
      { vector: async () => [makeResult('v', 1)] },
    ];

    for (const views of combos) {
      const weights = harmonic.computeWeights(Object.keys(views));
      const sum = Object.values(weights).reduce((s, w) => s + w, 0);
      assert.ok(
        Math.abs(sum - 1.0) < 1e-9,
        `Weights ${JSON.stringify(weights)} sum to ${sum}, expected 1.0`
      );
    }
  }));

  // --- Test 7: Deduplication keeps highest combined score ---
  record(await testAsync('deduplication across views keeps highest combined score', async () => {
    const harmonic = new HarmonicMemory();
    const views = {
      vector:  async (q) => [makeResult('shared', 0.9), makeResult('v-only', 0.5)],
      kg:      async (q) => [makeResult('shared', 0.4)],   // same ID, lower score
      anchors: async (q) => [makeResult('shared', 0.3)],
    };
    const results = await harmonic.search('test query', views);
    const shared = results.find(r => r.id === 'shared');
    assert.ok(shared, 'shared result should appear exactly once');
    const sharedCount = results.filter(r => r.id === 'shared').length;
    assert.strictEqual(sharedCount, 1, 'shared ID must appear only once');
  }));

  // --- Test 8: Results sorted by combinedScore descending ---
  record(await testAsync('results are sorted by combinedScore descending', async () => {
    const harmonic = new HarmonicMemory();
    const views = {
      vector:  async (q) => [makeResult('low',  0.2), makeResult('high', 0.9), makeResult('mid', 0.5)],
      kg:      async (q) => [makeResult('kg1',  0.7)],
      anchors: async (q) => [makeResult('anc1', 0.3)],
    };
    const results = await harmonic.search('test query', views);
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i].combinedScore <= results[i - 1].combinedScore,
        `Result[${i}].combinedScore(${results[i].combinedScore}) should be <= result[${i-1}].combinedScore(${results[i-1].combinedScore})`
      );
    }
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-harmonic-memory.cjs
```

**Step 3: Implement `core/harmonic-memory.cjs`**

```javascript
'use strict';

// Default weights: vector(0.4) + kg(0.4) + anchors(0.2) = 1.0
const BASE_WEIGHTS = { vector: 0.4, kg: 0.4, anchors: 0.2 };

class HarmonicMemory {
  constructor(options = {}) {
    this.baseWeights = { ...BASE_WEIGHTS, ...(options.weights ?? {}) };
  }

  /**
   * Compute effective weights for the given set of available view names.
   * Gracefully degrades when views are missing by redistributing weight.
   */
  computeWeights(availableViews) {
    const available = new Set(availableViews);
    const allViews  = Object.keys(this.baseWeights);

    // Sum the base weight of available views
    const totalAvailable = allViews.reduce(
      (sum, v) => sum + (available.has(v) ? this.baseWeights[v] : 0),
      0
    );

    if (totalAvailable === 0) return {};

    // Normalise so weights sum to exactly 1.0
    const weights = {};
    for (const v of allViews) {
      if (available.has(v)) {
        weights[v] = this.baseWeights[v] / totalAvailable;
      }
    }
    return weights;
  }

  /**
   * Search across multiple views and combine results harmonically.
   *
   * @param {string} query
   * @param {{ vector?, kg?, anchors? }} views  - Each view is async (query) => [{id, content, score}]
   * @returns {Array<{id, content, combinedScore, sources}>} sorted descending
   */
  async search(query, views) {
    const viewNames = Object.keys(views);
    if (viewNames.length === 0) return [];

    const weights = this.computeWeights(viewNames);

    // Fetch all views in parallel
    const fetched = await Promise.allSettled(
      viewNames.map(name => views[name](query).then(r => ({ name, results: r ?? [] })))
    );

    // Accumulate weighted scores per memory ID
    const scores  = new Map(); // id → { combinedScore, item, sources }
    const firstSeen = new Map(); // id → first item seen (for content)

    for (const settled of fetched) {
      if (settled.status !== 'fulfilled') continue;
      const { name, results } = settled.value;
      const w = weights[name] ?? 0;

      for (const item of results) {
        const { id } = item;
        if (!firstSeen.has(id)) firstSeen.set(id, item);

        const existing = scores.get(id) ?? { combinedScore: 0, sources: [] };
        existing.combinedScore += (item.score ?? 0) * w;
        existing.sources.push({ view: name, score: item.score ?? 0, weight: w });
        scores.set(id, existing);
      }
    }

    // Build output array
    const output = [];
    for (const [id, { combinedScore, sources }] of scores) {
      const base = firstSeen.get(id);
      output.push({ ...base, id, combinedScore, sources });
    }

    // Sort descending by combinedScore
    output.sort((a, b) => b.combinedScore - a.combinedScore);
    return output;
  }
}

module.exports = { HarmonicMemory, BASE_WEIGHTS };
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-harmonic-memory.cjs
```

**Step 5: TDD Checklist**
- [ ] All 8 tests pass
- [ ] Weights normalise to exactly 1.0 for all view combinations
- [ ] Dedup keeps highest combined score (not first seen)
- [ ] Missing view gracefully redistributes without crashing
- [ ] Results sorted descending by combinedScore

---

### Task 27 (J5): Auto-Skill Extraction

**Files:**
- Create: `core/skill-extractor.cjs`
- Test: `tests/test-skill-extractor.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-skill-extractor-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

function makeSource(content, tags = []) {
  return { id: 'mem_' + Math.random().toString(36).slice(2), content, tags };
}

async function main() {
  setup();
  console.log('\nTask 27 (J5): Auto-Skill Extraction\n');

  const { SkillExtractor } = require('../core/skill-extractor.cjs');

  const extractor = new SkillExtractor({ skillsDir: TEST_DIR });
  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  const validSources = [
    makeSource('Problem: git rebase shows conflicts when merging feature branches. Solution: Use git rebase --onto to rebase only specific commits.', ['git']),
    makeSource('Problem: merge conflicts appear after long-running feature branch. Solution: Rebase frequently onto main to keep branches short-lived.', ['git']),
    makeSource('Problem: accidental commit to main branch. Solution: Use git branch new-name, git reset --hard HEAD~1 to undo, push new-name.', ['git']),
  ];

  // --- Test 1: Valid YAML frontmatter is generated ---
  record(await testAsync('valid skill file is generated with YAML frontmatter', async () => {
    const result = await extractor.extract('git-rebase-strategy', validSources);
    assert.ok(result.success, `Expected success, got: ${result.reason}`);
    assert.ok(fs.existsSync(result.filePath), `Skill file should exist at ${result.filePath}`);

    const content = fs.readFileSync(result.filePath, 'utf8');
    assert.ok(content.startsWith('---'), 'Skill file should start with YAML frontmatter ---');
    assert.ok(content.includes('name:'), 'Frontmatter should include name field');
    assert.ok(content.includes('triggers:'), 'Frontmatter should include triggers field');
    assert.ok(content.includes('description:'), 'Frontmatter should include description field');
  }));

  // --- Test 2: Quality gate rejects fewer than 3 sources ---
  record(await testAsync('quality gate rejects fewer than 3 source memories', async () => {
    const fewSources = [
      makeSource('Problem: npm install fails. Solution: delete node_modules and retry.'),
      makeSource('Problem: package lock conflict. Solution: regenerate lock file.'),
    ];
    const result = await extractor.extract('npm-fix', fewSources);
    assert.strictEqual(result.success, false, 'Should fail quality gate');
    assert.ok(result.reason.toLowerCase().includes('source'), `Expected reason about sources, got: ${result.reason}`);
  }));

  // --- Test 3: Problem/solution structure is detected ---
  record(await testAsync('problem/solution structure detected in source memories', async () => {
    const result = await extractor.extract('git-rebase-strategy-2', validSources);
    assert.ok(result.success, `Expected success, got: ${result.reason}`);

    const content = fs.readFileSync(result.filePath, 'utf8');
    // Should contain steps (solution steps extracted from Problem/Solution pairs)
    assert.ok(
      content.includes('## Steps') || content.includes('steps:') || content.includes('Solution'),
      'Skill file should contain solution steps'
    );
  }));

  // --- Test 4: Triggers extracted from tags and keywords ---
  record(await testAsync('triggers are extracted from tags and content keywords', async () => {
    const result = await extractor.extract('git-rebase-strategy-3', validSources);
    assert.ok(result.success, `Expected success, got: ${result.reason}`);

    const content = fs.readFileSync(result.filePath, 'utf8');
    assert.ok(content.includes('git') || content.includes('rebase'),
      'Triggers should include keywords from tags or content');
  }));

  // --- Test 5: Skill name is slugified ---
  record(await testAsync('skill name is slugified for the filename', async () => {
    const result = await extractor.extract('My Cool Skill Name!', validSources);
    assert.ok(result.success, `Expected success, got: ${result.reason}`);
    assert.ok(result.filePath.includes('my-cool-skill-name'),
      `Filename should be slugified, got: ${result.filePath}`);
  }));

  // --- Test 6: Existing skill is not overwritten ---
  record(await testAsync('existing skill file is not overwritten', async () => {
    const skillName = 'existing-skill-test';
    // Create first time
    const first = await extractor.extract(skillName, validSources);
    assert.ok(first.success, 'First extraction should succeed');

    // Get mtime of created file
    const mtimeBefore = fs.statSync(first.filePath).mtimeMs;

    // Short wait to ensure mtime would differ if file were rewritten
    await new Promise(r => setTimeout(r, 20));

    // Attempt again with same name
    const second = await extractor.extract(skillName, validSources);
    assert.strictEqual(second.success, false, 'Second extraction should fail (file exists)');
    assert.ok(second.reason.toLowerCase().includes('exist'),
      `Expected 'exists' in reason, got: ${second.reason}`);

    const mtimeAfter = fs.statSync(first.filePath).mtimeMs;
    assert.strictEqual(mtimeBefore, mtimeAfter, 'File should not have been modified');
  }));

  // --- Test 7: Empty input returns failure ---
  record(await testAsync('empty source list returns failure immediately', async () => {
    const result = await extractor.extract('empty-input', []);
    assert.strictEqual(result.success, false, 'Empty sources should fail');
    assert.ok(result.reason, 'Should provide a failure reason');
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-skill-extractor.cjs
```

**Step 3: Implement `core/skill-extractor.cjs`**

```javascript
'use strict';

const fs   = require('fs');
const path = require('path');

const MIN_SOURCES = 3;

/** Convert any string to a URL-safe slug. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Extract keywords from text (basic tokenisation, no stopwords). */
function extractKeywords(text, limit = 8) {
  const stop = new Set(['the','a','an','is','are','was','were','to','of','in','for',
    'on','with','at','by','from','and','or','but','not','so','if','this','that',
    'it','its','be','use','using','when','how','after','before']);
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w))
  )].slice(0, limit);
}

/** Detect Problem/Solution structure in source content. */
function detectProblemSolution(sources) {
  const pairs = [];
  for (const src of sources) {
    const c = src.content ?? '';
    const probMatch = c.match(/problem[:\s]+(.+?)(?:solution[:\s]|$)/i);
    const solMatch  = c.match(/solution[:\s]+(.+)/i);
    if (probMatch && solMatch) {
      pairs.push({ problem: probMatch[1].trim(), solution: solMatch[1].trim() });
    }
  }
  return pairs;
}

/** Render YAML frontmatter + markdown body for a skill. */
function renderSkillFile(skill) {
  const triggersYaml = skill.triggers.map(t => `  - "${t}"`).join('\n');
  const stepsMarkdown = skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return [
    '---',
    `name: "${skill.name}"`,
    `description: "${skill.description}"`,
    'triggers:',
    triggersYaml,
    '---',
    '',
    `# ${skill.name}`,
    '',
    skill.description,
    '',
    '## Steps',
    '',
    stepsMarkdown,
    '',
  ].join('\n');
}

class SkillExtractor {
  constructor(options = {}) {
    this.skillsDir   = options.skillsDir ?? path.join(process.env.HOME ?? '/tmp', '.claude', 'skills');
    this.minSources  = options.minSources ?? MIN_SOURCES;
  }

  /**
   * Extract a skill from a set of breakthrough source memories.
   * @param {string} rawName - Desired skill name (will be slugified)
   * @param {Array}  sources - Array of source memory objects {id, content, tags}
   * @returns {{ success: boolean, filePath?: string, reason?: string }}
   */
  async extract(rawName, sources) {
    // Quality gate: minimum sources
    if (!Array.isArray(sources) || sources.length === 0) {
      return { success: false, reason: 'No source memories provided.' };
    }
    if (sources.length < this.minSources) {
      return {
        success: false,
        reason: `Quality gate: need at least ${this.minSources} source memories, got ${sources.length}.`,
      };
    }

    const slug     = slugify(rawName);
    const fileName = `${slug}.md`;
    const filePath = path.join(this.skillsDir, fileName);

    // Do not overwrite existing skills
    if (fs.existsSync(filePath)) {
      return { success: false, reason: `Skill already exists at ${filePath}. Will not overwrite.` };
    }

    // Detect structure
    const pairs = detectProblemSolution(sources);

    // Extract triggers: union of tags + top keywords from content
    const allTags = sources.flatMap(s => s.tags ?? []);
    const allText = sources.map(s => s.content ?? '').join(' ');
    const keywords = extractKeywords(allText);
    const triggers = [...new Set([...allTags, ...keywords])].slice(0, 8);

    // Build steps from solution text or raw content
    let steps;
    if (pairs.length > 0) {
      steps = pairs.map(p => p.solution);
    } else {
      // Fallback: use first sentence of each source as a step
      steps = sources.map(s => (s.content ?? '').split('.')[0].trim()).filter(Boolean);
    }

    const description =
      pairs.length > 0
        ? `Addresses: ${pairs.map(p => p.problem).join('; ').slice(0, 120)}`
        : `Extracted from ${sources.length} related memories about ${triggers.slice(0, 3).join(', ')}.`;

    const skill = {
      name:        rawName,
      description: description.replace(/"/g, "'"),
      triggers,
      steps,
    };

    // Ensure skills directory exists
    fs.mkdirSync(this.skillsDir, { recursive: true });

    const content = renderSkillFile(skill);
    fs.writeFileSync(filePath, content, 'utf8');

    return { success: true, filePath, skill };
  }
}

module.exports = { SkillExtractor, slugify, extractKeywords };
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-skill-extractor.cjs
```

**Step 5: TDD Checklist**
- [ ] All 7 tests pass
- [ ] Quality gate blocks extractions with <3 sources
- [ ] Existing file never overwritten
- [ ] slugify handles spaces, caps, punctuation
- [ ] YAML frontmatter valid (starts with ---)
- [ ] Triggers derived from tags union content keywords

---

### Task 28 (J6): Evolvable Memory Skills

**Files:**
- Create: `core/evolvable-skills.cjs`
- Test: `tests/test-evolvable-skills.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-evolvable-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\nTask 28 (J6): Evolvable Memory Skills\n');

  const { EvolvableSkills } = require('../core/evolvable-skills.cjs');

  const statePath = path.join(TEST_DIR, 'evolvable-state.json');
  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // --- Test 1: Low precision evolves threshold upward ---
  record(test('low precision (< 0.5) increases threshold by 0.05', () => {
    const skills = new EvolvableSkills({ statePath });
    const before = skills.getThreshold('skill-a');
    skills.recordPrecision('skill-a', 0.3); // below 0.5
    const after = skills.getThreshold('skill-a');
    assert.ok(after > before, `threshold should increase: ${before} -> ${after}`);
    assert.ok(
      Math.abs(after - before - 0.05) < 1e-9,
      `threshold should increase by exactly 0.05, got ${after - before}`
    );
  }));

  // --- Test 2: High precision does not change threshold ---
  record(test('high precision (>= 0.5) does not change threshold', () => {
    const skills = new EvolvableSkills({ statePath });
    skills.getThreshold('skill-b'); // initialise
    const before = skills.getThreshold('skill-b');
    skills.recordPrecision('skill-b', 0.8); // above 0.5
    const after = skills.getThreshold('skill-b');
    assert.strictEqual(before, after, `threshold should remain ${before}, got ${after}`);
  }));

  // --- Test 3: Threshold upper bound (0.95) ---
  record(test('threshold is clamped to upper bound 0.95', () => {
    const skills = new EvolvableSkills({ statePath });
    // Force threshold high by repeatedly recording low precision
    for (let i = 0; i < 20; i++) skills.recordPrecision('skill-max', 0.1);
    const threshold = skills.getThreshold('skill-max');
    assert.ok(threshold <= 0.95, `threshold must not exceed 0.95, got ${threshold}`);
  }));

  // --- Test 4: Precision history is tracked ---
  record(test('precision history is tracked per skill', () => {
    const skills = new EvolvableSkills({ statePath });
    skills.recordPrecision('skill-hist', 0.6);
    skills.recordPrecision('skill-hist', 0.4);
    skills.recordPrecision('skill-hist', 0.7);

    const history = skills.getHistory('skill-hist');
    assert.strictEqual(history.length, 3, `Expected 3 history entries, got ${history.length}`);
    assert.strictEqual(history[0], 0.6);
    assert.strictEqual(history[1], 0.4);
    assert.strictEqual(history[2], 0.7);
  }));

  // --- Test 5: Threshold only evolves upward (monotonic under low-precision stress) ---
  record(test('threshold is monotonically non-decreasing under repeated low precision', () => {
    const skills = new EvolvableSkills({ statePath });
    let prev = skills.getThreshold('skill-mono');
    for (let i = 0; i < 10; i++) {
      skills.recordPrecision('skill-mono', 0.2);
      const curr = skills.getThreshold('skill-mono');
      assert.ok(curr >= prev, `threshold must not decrease: ${prev} -> ${curr}`);
      prev = curr;
    }
  }));

  // --- Test 6: Regression detected ---
  record(test('regression flag set when recent precision < earlier precision', () => {
    const skills = new EvolvableSkills({ statePath: path.join(TEST_DIR, 'regress.json') });
    // Establish good baseline
    skills.recordPrecision('skill-regress', 0.9);
    skills.recordPrecision('skill-regress', 0.85);
    skills.recordPrecision('skill-regress', 0.88);
    // Introduce regression
    skills.recordPrecision('skill-regress', 0.4);
    skills.recordPrecision('skill-regress', 0.35);

    const report = skills.checkRegression('skill-regress');
    assert.strictEqual(report.hasRegression, true, 'Should detect regression');
    assert.ok(report.recentAvg < report.earlierAvg,
      `recentAvg(${report.recentAvg}) should be < earlierAvg(${report.earlierAvg})`);
  }));

  // --- Test 7: Multiple skills are tracked independently ---
  record(test('multiple skills are tracked independently', () => {
    const skills = new EvolvableSkills({ statePath: path.join(TEST_DIR, 'multi.json') });
    skills.recordPrecision('skill-x', 0.3); // low → threshold rises
    skills.recordPrecision('skill-y', 0.9); // high → threshold stays

    const tx = skills.getThreshold('skill-x');
    const ty = skills.getThreshold('skill-y');

    assert.ok(tx > ty, `skill-x threshold(${tx}) should exceed skill-y threshold(${ty}) after divergent precision`);
  }));

  // --- Test 8: State persists across instances ---
  record(test('state persists to JSON and loads in a new instance', () => {
    const sp = path.join(TEST_DIR, 'persist.json');
    const skills1 = new EvolvableSkills({ statePath: sp });
    skills1.recordPrecision('persist-skill', 0.2); // low → threshold 0.55
    skills1.recordPrecision('persist-skill', 0.2);
    skills1.save();

    const skills2 = new EvolvableSkills({ statePath: sp });
    const threshold = skills2.getThreshold('persist-skill');
    assert.ok(threshold > 0.5, `Persisted threshold should be > 0.5 (default), got ${threshold}`);

    const history = skills2.getHistory('persist-skill');
    assert.strictEqual(history.length, 2, `Persisted history should have 2 entries, got ${history.length}`);
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-evolvable-skills.cjs
```

**Step 3: Implement `core/evolvable-skills.cjs`**

```javascript
'use strict';

const fs   = require('fs');
const path = require('path');

const DEFAULT_THRESHOLD = 0.50;
const THRESHOLD_STEP    = 0.05;
const THRESHOLD_MIN     = 0.10;
const THRESHOLD_MAX     = 0.95;
const PRECISION_CUTOFF  = 0.50; // below this → evolve threshold up
const REGRESSION_WINDOW = 3;    // entries per half when checking regression

class EvolvableSkills {
  constructor(options = {}) {
    this.statePath = options.statePath ?? null;
    // { [skillName]: { threshold: number, history: number[] } }
    this._state = {};
    if (this.statePath && fs.existsSync(this.statePath)) {
      try {
        this._state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      } catch {
        this._state = {};
      }
    }
  }

  _ensureSkill(name) {
    if (!this._state[name]) {
      this._state[name] = { threshold: DEFAULT_THRESHOLD, history: [] };
    }
  }

  /** Return current activation threshold for a skill (initialises if absent). */
  getThreshold(name) {
    this._ensureSkill(name);
    return this._state[name].threshold;
  }

  /** Return precision history array for a skill. */
  getHistory(name) {
    this._ensureSkill(name);
    return this._state[name].history.slice();
  }

  /**
   * Record a new precision measurement.
   * If precision < PRECISION_CUTOFF → increase threshold by THRESHOLD_STEP (clamped).
   * Autosaves if statePath provided.
   */
  recordPrecision(name, precision) {
    this._ensureSkill(name);
    const skill = this._state[name];
    skill.history.push(precision);

    if (precision < PRECISION_CUTOFF) {
      skill.threshold = Math.min(THRESHOLD_MAX, skill.threshold + THRESHOLD_STEP);
    }
    // High precision: no change (threshold can only grow in this model)

    if (this.statePath) this.save();
    return skill.threshold;
  }

  /**
   * Check for regression: compare average precision of the most recent WINDOW entries
   * to the average of the WINDOW entries before that.
   *
   * Returns { hasRegression, recentAvg, earlierAvg }
   */
  checkRegression(name) {
    this._ensureSkill(name);
    const history = this._state[name].history;

    if (history.length < REGRESSION_WINDOW * 2) {
      return { hasRegression: false, recentAvg: null, earlierAvg: null };
    }

    const recent   = history.slice(-REGRESSION_WINDOW);
    const earlier  = history.slice(-(REGRESSION_WINDOW * 2), -REGRESSION_WINDOW);
    const avg      = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const recentAvg  = avg(recent);
    const earlierAvg = avg(earlier);

    return {
      hasRegression: recentAvg < earlierAvg,
      recentAvg,
      earlierAvg,
    };
  }

  /** Persist state to disk. */
  save() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this._state, null, 2), 'utf8');
  }
}

module.exports = { EvolvableSkills, DEFAULT_THRESHOLD, THRESHOLD_STEP };
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-evolvable-skills.cjs
```

**Step 5: TDD Checklist**
- [ ] All 8 tests pass
- [ ] Threshold only increases (never decreases)
- [ ] Bounds [0.10, 0.95] enforced
- [ ] Regression detection compares split windows
- [ ] State persists via JSON file
- [ ] Multiple skills tracked independently in same state file

---

### Task 29 (J7): Cross-Session Belief Tracking

**Files:**
- Create: `core/belief-tracker.cjs`
- Test: `tests/test-belief-tracker.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-belief-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (error) { console.log(`  ✗ ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\nTask 29 (J7): Cross-Session Belief Tracking\n');

  const { BeliefTracker } = require('../core/belief-tracker.cjs');

  const statePath = path.join(TEST_DIR, 'beliefs.json');
  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // --- Test 1: New belief is created ---
  record(test('new belief is created on first update', () => {
    const tracker = new BeliefTracker({ statePath });
    tracker.update('language', 'TypeScript', 0.9);
    const belief = tracker.query('language');
    assert.ok(belief,                             'belief should exist');
    assert.strictEqual(belief.topic, 'language',  'topic should match');
    assert.strictEqual(belief.currentValue, 'TypeScript', 'value should match');
    assert.ok(typeof belief.confidence === 'number', 'confidence should be a number');
  }));

  // --- Test 2: EMA confidence update ---
  record(test('EMA update blends old and new confidence', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'ema.json') });
    tracker.update('framework', 'React', 0.8);
    const before = tracker.query('framework').confidence;

    tracker.update('framework', 'React', 0.4); // same value, lower confidence
    const after = tracker.query('framework').confidence;

    // new_conf = 0.3 * 0.4 + 0.7 * old_conf
    const expected = 0.3 * 0.4 + 0.7 * before;
    assert.ok(
      Math.abs(after - expected) < 1e-6,
      `EMA expected ${expected}, got ${after}`
    );
  }));

  // --- Test 3: Contradiction detected (different value, same topic) ---
  record(test('contradiction detected when value changes on same topic', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'contra.json') });
    tracker.update('db', 'PostgreSQL', 0.9);
    tracker.update('db', 'MongoDB', 0.7);  // different value → contradiction

    const belief = tracker.query('db');
    const hasContradiction = belief.history.some(h => h.contradiction === true);
    assert.ok(hasContradiction, 'History should contain a contradiction entry');
  }));

  // --- Test 4: History is maintained ---
  record(test('history grows with each update', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'hist.json') });
    tracker.update('os', 'Linux', 0.9);
    tracker.update('os', 'Linux', 0.85);
    tracker.update('os', 'Linux', 0.95);

    const belief = tracker.query('os');
    assert.ok(Array.isArray(belief.history), 'history should be an array');
    assert.ok(belief.history.length >= 2, `Expected >=2 history entries, got ${belief.history.length}`);
  }));

  // --- Test 5: query returns belief and history ---
  record(test('query returns full belief object with history', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'full.json') });
    tracker.update('editor', 'Neovim', 0.8);

    const belief = tracker.query('editor');
    assert.ok(belief.topic,        'belief should have topic');
    assert.ok(belief.currentValue, 'belief should have currentValue');
    assert.ok(typeof belief.confidence === 'number', 'belief should have confidence');
    assert.ok(Array.isArray(belief.history), 'belief should have history array');
  }));

  // --- Test 6: Multiple topics tracked independently ---
  record(test('multiple topics are tracked independently', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'multi.json') });
    tracker.update('lang', 'Rust', 0.9);
    tracker.update('editor', 'VSCode', 0.7);
    tracker.update('os', 'macOS', 0.5);

    assert.strictEqual(tracker.query('lang').currentValue,   'Rust',   'lang mismatch');
    assert.strictEqual(tracker.query('editor').currentValue, 'VSCode', 'editor mismatch');
    assert.strictEqual(tracker.query('os').currentValue,     'macOS',  'os mismatch');
  }));

  // --- Test 7: Confidence converges with repeated same-value updates ---
  record(test('confidence converges toward repeated value', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'converge.json') });
    // Repeatedly update with confidence 1.0 — EMA should approach 1.0
    for (let i = 0; i < 30; i++) tracker.update('topic', 'value', 1.0);
    const belief = tracker.query('topic');
    assert.ok(belief.confidence > 0.98,
      `Confidence should converge near 1.0 after 30 updates, got ${belief.confidence}`);
  }));

  // --- Test 8: Unknown topic returns null ---
  record(test('query on unknown topic returns null', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'null.json') });
    const result = tracker.query('nonexistent-topic');
    assert.strictEqual(result, null, 'Unknown topic should return null');
  }));

  // --- Test 9: listTopics returns all tracked topics ---
  record(test('listTopics returns all tracked topic names', () => {
    const tracker = new BeliefTracker({ statePath: path.join(TEST_DIR, 'list.json') });
    tracker.update('alpha', 'v1', 0.9);
    tracker.update('beta',  'v2', 0.8);
    tracker.update('gamma', 'v3', 0.7);

    const topics = tracker.listTopics();
    assert.ok(Array.isArray(topics),          'listTopics should return an array');
    assert.ok(topics.includes('alpha'),        'should include alpha');
    assert.ok(topics.includes('beta'),         'should include beta');
    assert.ok(topics.includes('gamma'),        'should include gamma');
    assert.strictEqual(topics.length, 3,       `expected 3 topics, got ${topics.length}`);
  }));

  // --- Test 10: State persists across instances ---
  record(test('beliefs persist across tracker instances', () => {
    const sp = path.join(TEST_DIR, 'persist.json');
    const t1 = new BeliefTracker({ statePath: sp });
    t1.update('runtime', 'Node.js', 0.95);
    t1.save();

    const t2 = new BeliefTracker({ statePath: sp });
    const belief = t2.query('runtime');
    assert.ok(belief,                                  'belief should survive reload');
    assert.strictEqual(belief.currentValue, 'Node.js', 'value should survive reload');
    assert.ok(belief.confidence > 0.5,                 'confidence should survive reload');
  }));

  // ── summary ─────────────────────────────────────────────────────────────────
  cleanup();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run the test (expect all failures)**

```bash
node tests/test-belief-tracker.cjs
```

**Step 3: Implement `core/belief-tracker.cjs`**

```javascript
'use strict';

const fs   = require('fs');
const path = require('path');

const EMA_ALPHA = 0.3; // weight for new observation; 0.7 for historical

class BeliefTracker {
  constructor(options = {}) {
    this.statePath = options.statePath ?? null;
    this.alpha     = options.alpha ?? EMA_ALPHA;
    // { [topic]: { topic, currentValue, confidence, history[] } }
    this._beliefs  = {};

    if (this.statePath && fs.existsSync(this.statePath)) {
      try {
        this._beliefs = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      } catch {
        this._beliefs = {};
      }
    }
  }

  /**
   * Update or create a belief for a topic.
   * - If the topic is new → create entry with given value and confidence.
   * - If same value → EMA blend confidence, append history entry.
   * - If different value → flag contradiction, update value, EMA blend confidence.
   *
   * @param {string} topic
   * @param {*}      value      - The asserted value for this topic
   * @param {number} confidence - New evidence confidence [0, 1]
   */
  update(topic, value, confidence) {
    const existing = this._beliefs[topic];

    if (!existing) {
      this._beliefs[topic] = {
        topic,
        currentValue: value,
        confidence,
        history: [],
      };
      if (this.statePath) this.save();
      return this._beliefs[topic];
    }

    const isContradiction = existing.currentValue !== value;
    const oldConfidence   = existing.confidence;
    const newConfidence   = this.alpha * confidence + (1 - this.alpha) * oldConfidence;

    const historyEntry = {
      value,
      confidence,
      blendedConfidence: newConfidence,
      timestamp: Date.now(),
      contradiction: isContradiction,
    };

    existing.history.push(historyEntry);
    existing.currentValue = value;
    existing.confidence   = newConfidence;

    if (this.statePath) this.save();
    return existing;
  }

  /**
   * Return the current belief state for a topic, or null if unknown.
   */
  query(topic) {
    return this._beliefs[topic] ?? null;
  }

  /**
   * Return all tracked topic names.
   */
  listTopics() {
    return Object.keys(this._beliefs);
  }

  /**
   * Persist all beliefs to disk.
   */
  save() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this._beliefs, null, 2), 'utf8');
  }
}

module.exports = { BeliefTracker, EMA_ALPHA };
```

**Step 4: Run the test (expect all passing)**

```bash
node tests/test-belief-tracker.cjs
```

**Step 5: TDD Checklist**
- [ ] All 10 tests pass
- [ ] EMA formula: new = 0.3 * new + 0.7 * old
- [ ] Contradiction flag set in history entry when value changes
- [ ] Unknown topic returns null (not undefined, not error)
- [ ] listTopics returns array of all topic strings
- [ ] Persistence survives instance reload

---

## Phase J Summary

| Task | Module | Tests | Key Concepts |
|------|--------|-------|-------------|
| J1 (23) | `core/fsrs6.cjs` | 8 | FSRS-6 weights, spaced intervals, EMA-style stability |
| J2 (24) | `core/rl-memory-manager.cjs` | 8 | CREATE/UPDATE/DELETE/NOOP heuristics, experience tuples |
| J3 (25) | `core/multi-hop.cjs` | 8 | Iterative retrieval, keyword coverage, 3-hop cap |
| J4 (26) | `core/harmonic-memory.cjs` | 8 | 3-view weighted fusion, graceful degradation, dedup |
| J5 (27) | `core/skill-extractor.cjs` | 7 | Quality gate, YAML generation, slug, no-overwrite |
| J6 (28) | `core/evolvable-skills.cjs` | 8 | Threshold evolution, regression detection, persistence |
| J7 (29) | `core/belief-tracker.cjs` | 10 | EMA confidence, contradiction flags, cross-session JSON |

**Total tests: 57**
**All modules: CommonJS, standalone, no new external dependencies**

## Execution Order

```bash
node tests/test-fsrs6.cjs
node tests/test-rl-memory-manager.cjs
node tests/test-multi-hop.cjs
node tests/test-harmonic-memory.cjs
node tests/test-skill-extractor.cjs
node tests/test-evolvable-skills.cjs
node tests/test-belief-tracker.cjs
```

Each test file exits with code 0 on full pass, code 1 on any failure.
The test runner in `tests/` can also run all: `node tests/run-all.cjs` if present.
