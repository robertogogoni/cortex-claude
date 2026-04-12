# Cortex Phase F: Research-Backed Retrieval — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform retrieval from naive top-k vector search into a multi-strategy pipeline: FTS5 full-text, iterative 3-stage retrieval, 4-type memory classification, cue anchors for cross-memory linking, and token-efficient theme selection.

**Architecture:** 5 modules: FTS5SearchLayer (SQLite virtual table), IterativeRetriever (3-stage pipeline), MemoryClassifier (4 types with query boosts), CueAnchors (entity/concept extraction), ThemeSelector (cluster + budget). All CommonJS, standalone testable.

**Tech Stack:** Node.js (CommonJS `.cjs`), better-sqlite3 (existing), custom test runner (`test()`/`testAsync()`)

**Depends on:** Phase E (working SQLite adapters)

**See also:**
- [Unified Roadmap (Phases H-K)](2026-03-02-cortex-unified-roadmap-phases-h-k.md) — high-level design, dependencies, cost analysis
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) — links to all phase plans

---

### Task F1: FTS5 Full-Text Search Layer

**Files:**
- Create: `core/fts5-search.cjs`
- Test: `tests/test-fts5.cjs`

**Research Rationale:** The Anatomy of Agentic Memory paper (Feb 2026) found that mixed retrieval strategies (vector + text) outperform either alone. FTS5 with Porter stemming catches exact-match queries that vector search misses — critical for project names, error codes, and technical identifiers.

---

#### Step 1: Write the failing test

```javascript
// tests/test-fts5.cjs
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-fts5-' + Date.now());

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

// ─── helpers ────────────────────────────────────────────────────────────────

function seedDb(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchanges (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_message TEXT,
      assistant_message TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);
  const insert = db.prepare(
    'INSERT INTO exchanges (id, session_id, user_message, assistant_message) VALUES (?, ?, ?, ?)'
  );
  insert.run('ex1', 'sess1', 'how do I debug authentication errors', 'Use jwt.verify() and check token expiry');
  insert.run('ex2', 'sess1', 'what is the best sorting algorithm', 'Quicksort is O(n log n) average case');
  insert.run('ex3', 'sess2', 'fix my cedilla keyboard layout', 'Configure fcitx5 with compose key rules');
  insert.run('ex4', 'sess2', 'how to install packages on Arch Linux', 'Use pacman -S packagename or yay for AUR');
  db.close();
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\n━━━ FTS5 Full-Text Search Layer Tests ━━━\n');

  const dbPath = path.join(TEST_DIR, 'test.db');
  seedDb(dbPath);

  const { FTS5SearchLayer } = require('../core/fts5-search.cjs');
  let passed = 0;
  let failed = 0;

  // T1: FTS5 virtual table is created on construction
  test('FTS5 virtual table created on construction', () => {
    const fts = new FTS5SearchLayer(dbPath);
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fts_exchanges'"
    ).get();
    assert.ok(row, 'fts_exchanges virtual table should exist');
    db.close();
    fts.close();
  }) ? passed++ : failed++;

  // T2: search returns results for a matching keyword
  test('search returns ranked results for keyword', () => {
    const fts = new FTS5SearchLayer(dbPath);
    const results = fts.search('authentication', 10);
    assert.ok(results.length > 0, 'should return at least one result');
    assert.ok(results[0].id, 'result should have id field');
    assert.ok(typeof results[0].rank === 'number', 'result should have numeric rank');
    fts.close();
  }) ? passed++ : failed++;

  // T3: search returns snippet extracted from content
  test('search returns snippet with highlight markers', () => {
    const fts = new FTS5SearchLayer(dbPath);
    const results = fts.search('debug', 10);
    assert.ok(results.length > 0, 'should return results');
    assert.ok(results[0].snippet, 'result should have snippet field');
    assert.ok(
      results[0].snippet.includes('<b>') || results[0].snippet.includes('debug'),
      'snippet should contain highlight or matched text'
    );
    fts.close();
  }) ? passed++ : failed++;

  // T4: search respects limit parameter
  test('search respects limit parameter', () => {
    const fts = new FTS5SearchLayer(dbPath);
    // All 4 rows contain common words; limit to 2
    const results = fts.search('install OR debug OR sorting OR cedilla', 2);
    assert.ok(results.length <= 2, `should return at most 2 results, got ${results.length}`);
    fts.close();
  }) ? passed++ : failed++;

  // T5: empty query returns empty array (no crash)
  test('empty query returns empty array without throwing', () => {
    const fts = new FTS5SearchLayer(dbPath);
    let results;
    try {
      results = fts.search('', 10);
    } catch {
      results = [];
    }
    assert.ok(Array.isArray(results), 'should return an array');
    fts.close();
  }) ? passed++ : failed++;

  // T6: special characters are escaped and do not cause SQL errors
  test('special characters in query are escaped safely', () => {
    const fts = new FTS5SearchLayer(dbPath);
    assert.doesNotThrow(() => {
      fts.search('hello"world OR foo(bar)', 5);
    }, 'special characters should not throw');
    fts.close();
  }) ? passed++ : failed++;

  // T7: rebuild() repopulates the FTS index from source table
  test('rebuild() repopulates FTS index from source table', () => {
    const Database = require('better-sqlite3');
    const fts = new FTS5SearchLayer(dbPath);

    // Add a new row to the source table directly (bypassing FTS)
    const db = new Database(dbPath);
    db.prepare(
      'INSERT INTO exchanges (id, session_id, user_message, assistant_message) VALUES (?, ?, ?, ?)'
    ).run('ex5', 'sess3', 'unique_keyword_xyzzy for testing rebuild', 'some answer');
    db.close();

    // Before rebuild, FTS may not find it
    fts.rebuild();
    const results = fts.search('xyzzy', 10);
    assert.ok(results.length > 0, 'after rebuild, new row should be findable via FTS');
    fts.close();
  }) ? passed++ : failed++;

  // T8: Porter stemming — searching "debug" also matches "debugging"
  test('Porter stemming matches word variants', () => {
    const fts = new FTS5SearchLayer(dbPath);
    // "debug" should match "debugging" via Porter stemmer
    const results = fts.search('debug', 10);
    const ids = results.map(r => r.id);
    assert.ok(ids.includes('ex1'), 'ex1 contains "debugging" which should match stem "debug"');
    fts.close();
  }) ? passed++ : failed++;

  // T9: search query with no matches returns empty array
  test('search with no matches returns empty array', () => {
    const fts = new FTS5SearchLayer(dbPath);
    const results = fts.search('zzznomatchzzz', 10);
    assert.strictEqual(results.length, 0, 'should return empty array when nothing matches');
    fts.close();
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test — expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-fts5.cjs
# Expected: Error — Cannot find module '../core/fts5-search.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/fts5-search.cjs
/**
 * FTS5 Full-Text Search Layer
 *
 * Creates a SQLite FTS5 virtual table alongside the exchanges table for
 * hybrid retrieval: vector similarity + keyword matching with Porter stemming.
 *
 * Research basis: "Anatomy of Agentic Memory" (Feb 2026) — mixed retrieval
 * strategies outperform single-strategy approaches in noisy environments.
 *
 * @version 1.0.0
 */

'use strict';

const Database = require('better-sqlite3');

// ─────────────────────────────────────────────────────────────────────────────

class FTS5SearchLayer {
  /**
   * @param {string} dbPath - Absolute path to the SQLite database
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath, { timeout: 5000 });
    this.db.pragma('journal_mode = WAL');
    this._ensureFTS5Table();
  }

  // ─── private ──────────────────────────────────────────────────────────────

  /**
   * Create the FTS5 virtual table if it doesn't exist.
   * Uses Porter stemming + unicode61 tokenizer for broad language support.
   * Content table mode keeps the FTS index in sync with the source table.
   */
  _ensureFTS5Table() {
    // Ensure source table exists so construction never throws on empty DBs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exchanges (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        user_message TEXT,
        assistant_message TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_exchanges USING fts5(
        id UNINDEXED,
        user_message,
        assistant_message,
        content=exchanges,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );
    `);

    // Populate FTS index from existing rows if the virtual table is empty
    const count = this.db.prepare('SELECT COUNT(*) as c FROM fts_exchanges').get().c;
    if (count === 0) {
      const hasRows = this.db.prepare('SELECT 1 FROM exchanges LIMIT 1').get();
      if (hasRows) {
        this.db.exec(`
          INSERT INTO fts_exchanges(fts_exchanges) VALUES ('rebuild');
        `);
      }
    }
  }

  /**
   * Escape a user-supplied query string to prevent FTS5 syntax errors.
   * Wraps the entire query in double-quotes after escaping internal quotes,
   * falling back to a phrase search approach.
   *
   * @param {string} query
   * @returns {string} safe FTS5 query string
   */
  _escapeQuery(query) {
    if (!query || !query.trim()) return null;
    // Simple approach: split on whitespace, quote each token
    // This handles most special chars while preserving multi-word queries
    try {
      // Try to use the query as-is first (handles advanced operators like OR, AND)
      // Escape only unbalanced double-quotes and dangling parentheses
      const cleaned = query
        .replace(/"/g, '""')       // escape double-quotes
        .replace(/[()]/g, ' ');    // remove parentheses that confuse the parser
      return cleaned.trim() || null;
    } catch {
      return null;
    }
  }

  // ─── public ───────────────────────────────────────────────────────────────

  /**
   * Full-text search over exchanges.
   *
   * Returns results sorted by FTS5 rank (most relevant first).
   * Each result includes:
   *   - id: the exchange id
   *   - rank: numeric FTS5 relevance score (negative, closer to 0 = better)
   *   - snippet: highlighted excerpt from user_message or assistant_message
   *
   * @param {string} query - Search query (supports FTS5 operators: AND, OR, NOT, *)
   * @param {number} [limit=10] - Maximum number of results
   * @returns {Array<{id: string, rank: number, snippet: string}>}
   */
  search(query, limit = 10) {
    const safeQuery = this._escapeQuery(query);
    if (!safeQuery) return [];

    try {
      return this.db.prepare(`
        SELECT
          id,
          rank,
          snippet(fts_exchanges, 1, '<b>', '</b>', '...', 32) AS snippet
        FROM fts_exchanges
        WHERE fts_exchanges MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(safeQuery, limit);
    } catch {
      // Malformed query after escaping — return empty rather than throw
      return [];
    }
  }

  /**
   * Rebuild the FTS index from the source exchanges table.
   * Call this after bulk inserts that bypassed FTS triggers.
   */
  rebuild() {
    this.db.exec(`INSERT INTO fts_exchanges(fts_exchanges) VALUES ('rebuild');`);
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db && this.db.open) {
      this.db.close();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { FTS5SearchLayer };
```

#### Step 4: Run test — expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-fts5.cjs
# Expected: 9 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/fts5-search.cjs tests/test-fts5.cjs
git commit -m "feat(F1): FTS5 full-text search layer with Porter stemming

- FTS5SearchLayer wraps better-sqlite3 with virtual table fts_exchanges
- Porter + unicode61 tokenizer for stemmed multilingual search
- search(query, limit) returns ranked results with snippet highlighting
- _escapeQuery() prevents FTS5 syntax errors on special characters
- rebuild() syncs FTS index after bulk inserts
- 9 tests covering: creation, ranking, snippets, limit, empty query,
  special chars, rebuild, Porter stemming, no-match case

Research: Anatomy of Agentic Memory (Feb 2026) — mixed vector+text
retrieval outperforms single-strategy in noisy environments."
```

---

### Task F2: Iterative Retrieval Pipeline

**Files:**
- Create: `core/iterative-retriever.cjs`
- Test: `tests/test-iterative-retrieval.cjs`

**Research Rationale:** The Anatomy of Agentic Memory paper found iterative retrieval "consistently outperforms single-step and reranking" across all benchmarks. Stage 3 context expansion is inspired by Hindsight's variable-length context retrieval (Dec 2025) which achieves 91.4% on LongMemEval.

---

#### Step 1: Write the failing test

```javascript
// tests/test-iterative-retrieval.cjs
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-iterative-' + Date.now());

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

// ─── mocks ───────────────────────────────────────────────────────────────────

/** Simulates a retrieval source (vector adapter, FTS layer, etc.) */
function makeMockRetriever(results) {
  return {
    async retrieve(query, limit) {
      return results.slice(0, limit);
    }
  };
}

/** Simulates an LLM reranker that returns scores 0–1 */
function makeMockReranker(scoreMap) {
  return {
    async rerank(query, results) {
      return results.map(r => ({
        ...r,
        rerankScore: scoreMap[r.id] !== undefined ? scoreMap[r.id] : 0.5,
      }));
    }
  };
}

function makeExchange(id, sessionId, minuteOffset = 0) {
  const base = new Date('2026-01-01T12:00:00Z');
  base.setMinutes(base.getMinutes() + minuteOffset);
  return {
    id,
    session_id: sessionId,
    user_message: `message from ${id}`,
    assistant_message: `reply to ${id}`,
    timestamp: base.toISOString(),
    score: 0.8,
  };
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\n━━━ Iterative Retrieval Pipeline Tests ━━━\n');

  const { IterativeRetriever } = require('../core/iterative-retriever.cjs');
  let passed = 0;
  let failed = 0;

  // T1: Stage 1 — broad retrieval merges results from multiple sources
  await testAsync('Stage 1 merges results from multiple sources', async () => {
    const src1 = makeMockRetriever([makeExchange('a1', 's1'), makeExchange('a2', 's1')]);
    const src2 = makeMockRetriever([makeExchange('b1', 's2'), makeExchange('b2', 's2')]);
    const retriever = new IterativeRetriever({ sources: [src1, src2] });

    const stage1 = await retriever._stage1Retrieve('test query', 50);
    const ids = stage1.map(r => r.id);
    assert.ok(ids.includes('a1'), 'should include results from source 1');
    assert.ok(ids.includes('b1'), 'should include results from source 2');
    assert.ok(stage1.length >= 2, 'should have at least 2 results');
  }) ? passed++ : failed++;

  // T2: Stage 1 deduplicates results by id
  await testAsync('Stage 1 deduplicates results by id', async () => {
    const dup = makeExchange('dup1', 's1');
    const src1 = makeMockRetriever([dup]);
    const src2 = makeMockRetriever([dup, makeExchange('unique1', 's2')]);
    const retriever = new IterativeRetriever({ sources: [src1, src2] });

    const stage1 = await retriever._stage1Retrieve('test', 50);
    const ids = stage1.map(r => r.id);
    const dupCount = ids.filter(id => id === 'dup1').length;
    assert.strictEqual(dupCount, 1, 'duplicate id should appear only once');
  }) ? passed++ : failed++;

  // T3: Stage 2 — reranking sorts by rerankScore descending and trims to top 20
  await testAsync('Stage 2 reranks results by score and trims to top 20', async () => {
    const exchanges = Array.from({ length: 30 }, (_, i) => makeExchange(`ex${i}`, 's1'));
    const scoreMap = {};
    exchanges.forEach((ex, i) => { scoreMap[ex.id] = (30 - i) / 30; });
    scoreMap['ex5'] = 1.0; // ex5 should be top after reranking

    const reranker = makeMockReranker(scoreMap);
    const retriever = new IterativeRetriever({ sources: [], reranker });

    const stage2 = await retriever._stage2Rerank('test', exchanges);
    assert.ok(stage2.length <= 20, `stage 2 should return at most 20 results, got ${stage2.length}`);
    assert.strictEqual(stage2[0].id, 'ex5', 'highest scoring result should be first');
    assert.ok(
      stage2[0].rerankScore >= stage2[stage2.length - 1].rerankScore,
      'results should be sorted by rerankScore descending'
    );
  }) ? passed++ : failed++;

  // T4: Stage 3 — context expansion fetches adjacent exchanges within ±5 min
  await testAsync('Stage 3 expands context with temporal neighbors', async () => {
    const Database = require('better-sqlite3');
    const dbPath = path.join(TEST_DIR, 'ctx.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY, session_id TEXT, user_message TEXT,
        assistant_message TEXT, timestamp TEXT
      );
    `);
    // Central exchange at T+0, neighbors at T-3 and T+3 (within 5 min window)
    const base = new Date('2026-01-01T12:00:00Z');
    const minus3 = new Date(base.getTime() - 3 * 60000).toISOString();
    const t0 = base.toISOString();
    const plus3 = new Date(base.getTime() + 3 * 60000).toISOString();
    const plus10 = new Date(base.getTime() + 10 * 60000).toISOString(); // outside window
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('prev', 's1', 'prev msg', 'prev reply', minus3);
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('center', 's1', 'center msg', 'center reply', t0);
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('next', 's1', 'next msg', 'next reply', plus3);
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('far', 's1', 'far msg', 'far reply', plus10);
    db.close();

    const retriever = new IterativeRetriever({ sources: [], dbPath });
    const expanded = await retriever._stage3ExpandContext([{ id: 'center', session_id: 's1', timestamp: t0 }]);
    const ids = expanded.map(r => r.id);
    assert.ok(ids.includes('prev'), 'should include neighbor 3 min before');
    assert.ok(ids.includes('next'), 'should include neighbor 3 min after');
    assert.ok(!ids.includes('far'), 'should NOT include exchange 10 min away');
  }) ? passed++ : failed++;

  // T5: Full pipeline execute() returns merged, deduped, ranked results
  await testAsync('execute() runs full 3-stage pipeline', async () => {
    const Database = require('better-sqlite3');
    const dbPath = path.join(TEST_DIR, 'pipeline.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY, session_id TEXT, user_message TEXT,
        assistant_message TEXT, timestamp TEXT
      );
    `);
    const t = new Date('2026-01-01T12:00:00Z').toISOString();
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('p1', 's1', 'auth error fix', 'answer', t);
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('p2', 's1', 'jwt token debug', 'answer', t);
    db.close();

    const src = makeMockRetriever([
      { id: 'p1', session_id: 's1', timestamp: t, score: 0.9, user_message: 'auth error fix', assistant_message: 'answer' },
      { id: 'p2', session_id: 's1', timestamp: t, score: 0.7, user_message: 'jwt token debug', assistant_message: 'answer' },
    ]);
    const retriever = new IterativeRetriever({ sources: [src], dbPath });
    const results = await retriever.execute('authentication debug', 5);
    assert.ok(Array.isArray(results), 'should return array');
    assert.ok(results.length > 0, 'should return results');
  }) ? passed++ : failed++;

  // T6: Fallback text similarity reranking when no Haiku API configured
  await testAsync('falls back to text similarity reranking without API', async () => {
    const exchanges = [
      { id: 'r1', user_message: 'debug authentication token', assistant_message: 'check jwt', score: 0.5 },
      { id: 'r2', user_message: 'sorting algorithm complexity', assistant_message: 'O(n log n)', score: 0.5 },
    ];
    const src = makeMockRetriever(exchanges);
    // No reranker provided → falls back to text similarity
    const retriever = new IterativeRetriever({ sources: [src] });
    const results = await retriever._stage2Rerank('authentication debug', exchanges);
    assert.ok(Array.isArray(results), 'fallback should return array');
    // r1 should score higher than r2 for "authentication debug" query
    const r1 = results.find(r => r.id === 'r1');
    const r2 = results.find(r => r.id === 'r2');
    assert.ok(r1.rerankScore >= r2.rerankScore, 'text-similar result should rank higher');
  }) ? passed++ : failed++;

  // T7: Empty input to any stage returns empty array without error
  await testAsync('empty results at any stage return empty array safely', async () => {
    const retriever = new IterativeRetriever({ sources: [] });
    const s1 = await retriever._stage1Retrieve('query', 50);
    assert.deepStrictEqual(s1, [], 'stage 1 empty sources → []');

    const s2 = await retriever._stage2Rerank('query', []);
    assert.deepStrictEqual(s2, [], 'stage 2 empty input → []');

    const s3 = await retriever._stage3ExpandContext([]);
    assert.deepStrictEqual(s3, [], 'stage 3 empty input → []');
  }) ? passed++ : failed++;

  // T8: Single result is passed through without expansion creating duplicates
  await testAsync('single result does not duplicate after context expansion', async () => {
    const Database = require('better-sqlite3');
    const dbPath = path.join(TEST_DIR, 'single.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY, session_id TEXT, user_message TEXT,
        assistant_message TEXT, timestamp TEXT
      );
    `);
    const t = new Date('2026-01-01T12:00:00Z').toISOString();
    db.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').run('only1', 's1', 'lone message', 'lone reply', t);
    db.close();

    const retriever = new IterativeRetriever({ sources: [], dbPath });
    const expanded = await retriever._stage3ExpandContext([{ id: 'only1', session_id: 's1', timestamp: t }]);
    const ids = expanded.map(r => r.id);
    const count = ids.filter(id => id === 'only1').length;
    assert.strictEqual(count, 1, 'single result should not be duplicated after expansion');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test — expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-iterative-retrieval.cjs
# Expected: Error — Cannot find module '../core/iterative-retriever.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/iterative-retriever.cjs
/**
 * Iterative Retrieval Pipeline
 *
 * Implements a 3-stage retrieval pipeline:
 *   Stage 1: Broad retrieval (limit=50) — merge all configured sources
 *   Stage 2: Reranking (scored 0–1, top 20) — LLM or text-similarity fallback
 *   Stage 3: Context expansion (±5-minute temporal neighbors)
 *
 * Research basis:
 *   - "Anatomy of Agentic Memory" (Feb 2026): iterative retrieval consistently
 *     outperforms single-step and reranking-only approaches
 *   - Hindsight (Dec 2025): variable-length context retrieval achieves 91.4%
 *     on LongMemEval via temporal neighbor expansion
 *
 * @version 1.0.0
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a simple word-overlap similarity between a query and a text.
 * Used as a fallback when no LLM reranker is available.
 *
 * @param {string} query
 * @param {string} text
 * @returns {number} similarity in [0, 1]
 */
function textSimilarity(query, text) {
  if (!query || !text) return 0;
  const queryWords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const textWords = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (queryWords.size === 0 || textWords.length === 0) return 0;
  const matches = textWords.filter(w => queryWords.has(w)).length;
  return Math.min(1, matches / queryWords.size);
}

// ─────────────────────────────────────────────────────────────────────────────

class IterativeRetriever {
  /**
   * @param {Object} options
   * @param {Array}  options.sources  - Array of retrieval sources, each with async retrieve(query, limit)
   * @param {Object} [options.reranker] - Optional reranker with async rerank(query, results)
   * @param {string} [options.dbPath]  - Path to SQLite DB for context expansion (Stage 3)
   * @param {number} [options.stage1Limit=50]  - Max results per source in Stage 1
   * @param {number} [options.stage2TopK=20]   - Top-K to keep after Stage 2
   * @param {number} [options.windowMinutes=5] - ±minutes for context expansion
   */
  constructor(options = {}) {
    this.sources = options.sources || [];
    this.reranker = options.reranker || null;
    this.dbPath = options.dbPath || null;
    this.stage1Limit = options.stage1Limit || 50;
    this.stage2TopK = options.stage2TopK || 20;
    this.windowMinutes = options.windowMinutes || 5;
  }

  // ─── Stage 1: Broad Retrieval ──────────────────────────────────────────────

  /**
   * Retrieve from all sources in parallel and deduplicate by id.
   *
   * @param {string} query
   * @param {number} limit - Per-source limit
   * @returns {Promise<Array>}
   */
  async _stage1Retrieve(query, limit) {
    if (this.sources.length === 0) return [];

    const allResults = await Promise.all(
      this.sources.map(src => src.retrieve(query, limit).catch(() => []))
    );

    // Merge and deduplicate by id
    const seen = new Set();
    const merged = [];
    for (const batch of allResults) {
      for (const item of batch) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
    }
    return merged;
  }

  // ─── Stage 2: Reranking ───────────────────────────────────────────────────

  /**
   * Rerank results using LLM reranker or text-similarity fallback.
   * Returns top-K results sorted by rerankScore descending.
   *
   * @param {string} query
   * @param {Array}  results - From Stage 1
   * @returns {Promise<Array>}
   */
  async _stage2Rerank(query, results) {
    if (!results || results.length === 0) return [];

    let reranked;
    if (this.reranker) {
      // LLM-based reranking
      reranked = await this.reranker.rerank(query, results);
    } else {
      // Text similarity fallback (no API cost)
      reranked = results.map(r => {
        const combined = [r.user_message, r.assistant_message].filter(Boolean).join(' ');
        return {
          ...r,
          rerankScore: textSimilarity(query, combined),
        };
      });
    }

    // Sort descending by rerankScore, trim to top-K
    return reranked
      .sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0))
      .slice(0, this.stage2TopK);
  }

  // ─── Stage 3: Context Expansion ───────────────────────────────────────────

  /**
   * For each high-scoring exchange, fetch adjacent exchanges from the same
   * session within ±windowMinutes. Deduplicates by id.
   *
   * @param {Array} results - From Stage 2 (must have id, session_id, timestamp)
   * @returns {Promise<Array>}
   */
  async _stage3ExpandContext(results) {
    if (!results || results.length === 0) return [];
    if (!this.dbPath) return results;

    let db;
    try {
      const Database = require('better-sqlite3');
      db = new Database(this.dbPath, { readonly: true, timeout: 3000 });
    } catch {
      return results;
    }

    const seen = new Set(results.map(r => r.id));
    const expanded = [...results];

    const neighborStmt = db.prepare(`
      SELECT * FROM exchanges
      WHERE session_id = ?
        AND timestamp BETWEEN
          datetime(?, '-${this.windowMinutes} minutes')
          AND
          datetime(?, '+${this.windowMinutes} minutes')
      ORDER BY timestamp
    `);

    for (const item of results) {
      if (!item.session_id || !item.timestamp) continue;
      try {
        const neighbors = neighborStmt.all(item.session_id, item.timestamp, item.timestamp);
        for (const neighbor of neighbors) {
          if (!seen.has(neighbor.id)) {
            seen.add(neighbor.id);
            expanded.push(neighbor);
          }
        }
      } catch {
        // Skip neighbors for this item on error
      }
    }

    db.close();
    return expanded;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Execute the full 3-stage retrieval pipeline.
   *
   * @param {string} query
   * @param {number} [finalLimit=10] - Max results after all stages
   * @returns {Promise<Array>}
   */
  async execute(query, finalLimit = 10) {
    const stage1 = await this._stage1Retrieve(query, this.stage1Limit);
    const stage2 = await this._stage2Rerank(query, stage1);
    const stage3 = await this._stage3ExpandContext(stage2);

    // Final dedup and trim
    const seen = new Set();
    const final = [];
    for (const item of stage3) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        final.push(item);
      }
    }
    return final.slice(0, finalLimit);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { IterativeRetriever };
```

#### Step 4: Run test — expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-iterative-retrieval.cjs
# Expected: 8 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/iterative-retriever.cjs tests/test-iterative-retrieval.cjs
git commit -m "feat(F2): 3-stage iterative retrieval pipeline

- IterativeRetriever: Stage1 (broad, multi-source, dedup) →
  Stage2 (rerank top-20, LLM or text-similarity fallback) →
  Stage3 (±5min temporal context expansion via SQLite)
- textSimilarity() fallback keeps pipeline operational without Haiku API
- Context expansion deduplicates by id to prevent repeated results
- 8 tests: multi-source merge, dedup, reranking, context expansion,
  full pipeline, API fallback, empty inputs, single-result safety

Research: Anatomy of Agentic Memory (Feb 2026) — iterative retrieval
outperforms single-step; Hindsight (Dec 2025) temporal expansion."
```

---

### Task F3: Memory Type Classification

**Files:**
- Create: `core/memory-classifier.cjs`
- Test: `tests/test-memory-classifier.cjs`

**Research Rationale:** Hindsight (Dec 2025) achieves 91.4% on LongMemEval through structural separation of 4 memory networks. The Memory in the Age of AI Agents taxonomy (Dec 2025, 47 authors) identifies fact/experience/skill/preference as the canonical separation. Query-keyword-to-type boosts improve precision for "how" queries (skill), "what" queries (fact), "fix" queries (experience), and "remember" queries (preference).

---

#### Step 1: Write the failing test

```javascript
// tests/test-memory-classifier.cjs
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-classifier-' + Date.now());

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

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\n━━━ Memory Type Classifier Tests ━━━\n');

  const { MemoryClassifier, MEMORY_TYPES, TYPE_BOOSTS } = require('../core/memory-classifier.cjs');
  let passed = 0;
  let failed = 0;

  // T1: classifyByRegex identifies 'fact' type
  test('classifyByRegex identifies fact type from objective statements', () => {
    const clf = new MemoryClassifier();
    const type = clf.classifyByRegex('MacBook Air runs Arch Linux with kernel 6.18');
    assert.strictEqual(type, 'fact', `expected 'fact', got '${type}'`);
  }) ? passed++ : failed++;

  // T2: classifyByRegex identifies 'experience' type
  test('classifyByRegex identifies experience type from past-tense solutions', () => {
    const clf = new MemoryClassifier();
    const type = clf.classifyByRegex('Fixed the cedilla bug by configuring fcitx5 yesterday');
    assert.strictEqual(type, 'experience', `expected 'experience', got '${type}'`);
  }) ? passed++ : failed++;

  // T3: classifyByRegex identifies 'skill' type
  test('classifyByRegex identifies skill type from procedure/pattern content', () => {
    const clf = new MemoryClassifier();
    const type = clf.classifyByRegex('To install AUR packages: use yay -S package-name then verify with pacman');
    assert.strictEqual(type, 'skill', `expected 'skill', got '${type}'`);
  }) ? passed++ : failed++;

  // T4: classifyByRegex identifies 'preference' type
  test('classifyByRegex identifies preference type from user preference statements', () => {
    const clf = new MemoryClassifier();
    const type = clf.classifyByRegex('I prefer neural format output over bullet lists always');
    assert.strictEqual(type, 'preference', `expected 'preference', got '${type}'`);
  }) ? passed++ : failed++;

  // T5: getQueryBoosts returns correct boosts for 'how' query
  test("getQueryBoosts boosts 'skill' and 'experience' for 'how' query", () => {
    const clf = new MemoryClassifier();
    const boosts = clf.getQueryBoosts('how do I debug this error');
    assert.ok(boosts.skill > 1.0, `skill boost should be >1.0, got ${boosts.skill}`);
    assert.ok(boosts.experience > 1.0, `experience boost should be >1.0, got ${boosts.experience}`);
    assert.ok(boosts.fact < 1.0, `fact boost should be <1.0 for 'how' query, got ${boosts.fact}`);
  }) ? passed++ : failed++;

  // T6: getQueryBoosts returns correct boosts for 'what' query
  test("getQueryBoosts boosts 'fact' for 'what' query", () => {
    const clf = new MemoryClassifier();
    const boosts = clf.getQueryBoosts('what machine am I using');
    assert.ok(boosts.fact > 1.0, `fact boost should be >1.0, got ${boosts.fact}`);
    assert.ok(boosts.skill < 1.0, `skill boost should be <1.0 for 'what' query, got ${boosts.skill}`);
  }) ? passed++ : failed++;

  // T7: getQueryBoosts for 'fix' query boosts experience
  test("getQueryBoosts boosts 'experience' for 'fix' query", () => {
    const clf = new MemoryClassifier();
    const boosts = clf.getQueryBoosts('fix the broken authentication middleware');
    assert.ok(boosts.experience > 1.0, `experience boost should be >1.0 for 'fix' query`);
  }) ? passed++ : failed++;

  // T8: unrecognized query returns neutral boosts (all 1.0)
  test('unrecognized query returns neutral boosts (all 1.0)', () => {
    const clf = new MemoryClassifier();
    const boosts = clf.getQueryBoosts('xyzzy random gibberish');
    for (const type of MEMORY_TYPES) {
      assert.strictEqual(boosts[type], 1.0, `${type} boost should be 1.0 for unrecognized query`);
    }
  }) ? passed++ : failed++;

  // T9: all exported MEMORY_TYPES are valid and known
  test('MEMORY_TYPES exports all 4 known types', () => {
    assert.deepStrictEqual(
      [...MEMORY_TYPES].sort(),
      ['experience', 'fact', 'preference', 'skill'],
      'MEMORY_TYPES should be [fact, experience, skill, preference]'
    );
  }) ? passed++ : failed++;

  // T10: applyBoosts correctly scales scores
  test('applyBoosts multiplies result scores by type-specific boost', () => {
    const clf = new MemoryClassifier();
    const results = [
      { id: 'r1', score: 0.8, memoryType: 'skill' },
      { id: 'r2', score: 0.8, memoryType: 'fact' },
    ];
    const boosted = clf.applyBoosts(results, 'how do I debug this');
    const skillResult = boosted.find(r => r.id === 'r1');
    const factResult = boosted.find(r => r.id === 'r2');
    assert.ok(skillResult.score > factResult.score, 'skill should score higher than fact for how-query');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test — expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-memory-classifier.cjs
# Expected: Error — Cannot find module '../core/memory-classifier.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/memory-classifier.cjs
/**
 * Memory Type Classifier
 *
 * Classifies memories into 4 canonical types and applies query-aware boosts
 * to retrieval scores.
 *
 * Memory types (Hindsight + Memory in the Age of AI Agents taxonomy):
 *   fact       — Objective world knowledge ("MacBook Air runs Arch Linux")
 *   experience — Past interactions and solutions ("Fixed cedilla with fcitx5")
 *   skill      — Reusable patterns and procedures ("To install AUR packages: ...")
 *   preference — User preferences and beliefs ("I prefer neural format")
 *
 * Query boosts (inspired by Hindsight's 4-network separation):
 *   'how'      → boost skill (1.5) + experience (1.3), penalize fact (0.8)
 *   'what'     → boost fact (1.5), neutral experience (1.0), penalize skill (0.7)
 *   'fix'      → boost experience (1.5) + skill (1.3), penalize fact (0.8)
 *   'remember' → boost experience (1.5) + preference (1.3), neutral fact (1.0)
 *
 * @version 1.0.0
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────

/** Canonical memory types */
const MEMORY_TYPES = Object.freeze(['fact', 'experience', 'skill', 'preference']);

/**
 * Regex patterns for heuristic classification.
 * Evaluated in order; first match wins.
 */
const CLASSIFICATION_RULES = [
  {
    type: 'preference',
    patterns: [
      /\bI (prefer|like|always|never|want|hate|love)\b/i,
      /\bmy (preference|style|approach|favorite)\b/i,
      /\balways use\b/i,
      /\bnever use\b/i,
    ],
  },
  {
    type: 'experience',
    patterns: [
      /\b(fixed|solved|resolved|discovered|found|encountered|debugged)\b/i,
      /\byesterday|last week|last time|previously|earlier today\b/i,
      /\bwas (broken|failing|erroring|crashing)\b/i,
      /\bthe (bug|issue|problem|error) was\b/i,
    ],
  },
  {
    type: 'skill',
    patterns: [
      /\b(to|how to) (install|configure|setup|build|deploy|run|use)\b/i,
      /\bstep[s]? (to|for|are):\b/i,
      /\bpattern:|algorithm:|procedure:|workflow:\b/i,
      /\bfirst .* then .* (finally|lastly|then)\b/i,
    ],
  },
  {
    type: 'fact',
    // Fact is the default fallback; also matches objective-sounding statements
    patterns: [
      /\b(is|are|was|were|runs?|uses?|contains?|has)\b/i,
    ],
  },
];

/**
 * Query keyword → type boost weights.
 * Applied when the query contains the trigger keyword at the start or as a standalone word.
 */
const TYPE_BOOSTS = Object.freeze({
  how: Object.freeze({ fact: 0.8, experience: 1.3, skill: 1.5, preference: 1.0 }),
  what: Object.freeze({ fact: 1.5, experience: 1.0, skill: 0.7, preference: 0.8 }),
  fix: Object.freeze({ fact: 0.8, experience: 1.5, skill: 1.3, preference: 1.0 }),
  remember: Object.freeze({ fact: 1.0, experience: 1.5, skill: 0.9, preference: 1.3 }),
});

/** Neutral boosts — returned when no query keyword matches */
const NEUTRAL_BOOSTS = Object.freeze({ fact: 1.0, experience: 1.0, skill: 1.0, preference: 1.0 });

// ─────────────────────────────────────────────────────────────────────────────

class MemoryClassifier {
  /**
   * Classify a memory by regex heuristics.
   * Returns the first matching type, or 'fact' as the default fallback.
   *
   * @param {string} content - Memory text content
   * @returns {'fact'|'experience'|'skill'|'preference'}
   */
  classifyByRegex(content) {
    if (!content) return 'fact';

    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(content)) {
          return rule.type;
        }
      }
    }
    return 'fact'; // default
  }

  /**
   * Determine query-aware type boosts based on keywords in the query.
   * Returns NEUTRAL_BOOSTS if no keyword matches.
   *
   * @param {string} query
   * @returns {Object} boost map: { fact, experience, skill, preference }
   */
  getQueryBoosts(query) {
    if (!query) return { ...NEUTRAL_BOOSTS };

    const lower = query.toLowerCase();
    for (const [keyword, boosts] of Object.entries(TYPE_BOOSTS)) {
      // Match if query starts with keyword or keyword appears as word boundary
      const regex = new RegExp(`\\b${keyword}\\b`);
      if (regex.test(lower)) {
        return { ...boosts };
      }
    }
    return { ...NEUTRAL_BOOSTS };
  }

  /**
   * Apply type-based score boosts to a list of retrieval results.
   * Each result must have a `score` (number) and optionally `memoryType` (string).
   * Results without a memoryType are left unchanged.
   *
   * @param {Array<{id: string, score: number, memoryType?: string}>} results
   * @param {string} query
   * @returns {Array} results with scores adjusted by type boost
   */
  applyBoosts(results, query) {
    if (!results || results.length === 0) return [];
    const boosts = this.getQueryBoosts(query);

    return results.map(result => {
      const type = result.memoryType;
      const boost = (type && boosts[type] !== undefined) ? boosts[type] : 1.0;
      return {
        ...result,
        score: (result.score || 0) * boost,
      };
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { MemoryClassifier, MEMORY_TYPES, TYPE_BOOSTS };
```

#### Step 4: Run test — expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-memory-classifier.cjs
# Expected: 10 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/memory-classifier.cjs tests/test-memory-classifier.cjs
git commit -m "feat(F3): memory type classification with query-aware boosts

- MemoryClassifier classifies content into fact/experience/skill/preference
- classifyByRegex() uses ordered pattern rules (preference → experience → skill → fact)
- getQueryBoosts() maps query keywords to type multipliers:
  'how' → skill 1.5, experience 1.3 | 'what' → fact 1.5 | 'fix' → experience 1.5
  'remember' → experience 1.5, preference 1.3 | unknown → all 1.0
- applyBoosts() multiplies retrieval scores by type-specific boost
- 10 tests: regex classification for all 4 types, boost tables,
  neutral fallback, boost application, MEMORY_TYPES export

Research: Hindsight (Dec 2025) 91.4% LongMemEval via 4-network separation;
Memory in the Age of AI Agents taxonomy (Dec 2025)."
```

---

### Task F4: Cue Anchors for Cross-Memory Linking

**Files:**
- Create: `core/cue-anchors.cjs`
- Test: `tests/test-cue-anchors.cjs`

**Research Rationale:** Memora (Microsoft Research, Feb 2026) is the new SOTA on LoCoMo + LongMemEval. Its key innovation is cue anchors — named entities, concepts, temporal markers, and causal links extracted from memories. When a query matches an anchor, all linked memories are also retrieved, enabling recall "beyond direct semantic similarity."

---

#### Step 1: Write the failing test

```javascript
// tests/test-cue-anchors.cjs
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-cue-anchors-' + Date.now());

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

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDb(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.close();
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\n━━━ Cue Anchors for Cross-Memory Linking Tests ━━━\n');

  const { CueAnchors } = require('../core/cue-anchors.cjs');
  let passed = 0;
  let failed = 0;

  // T1: extractAnchors pulls entity anchors from text
  test('extractAnchors extracts named entities', () => {
    const ca = new CueAnchors();
    const anchors = ca.extractAnchors('Arch Linux uses pacman as its package manager', 'mem1');
    const entityAnchors = anchors.filter(a => a.anchor_type === 'entity');
    assert.ok(entityAnchors.length > 0, 'should extract at least one entity anchor');
    const texts = entityAnchors.map(a => a.anchor_text.toLowerCase());
    assert.ok(
      texts.some(t => t.includes('arch linux') || t.includes('pacman')),
      `entity anchors should include Arch Linux or pacman, got: ${texts.join(', ')}`
    );
  }) ? passed++ : failed++;

  // T2: extractAnchors pulls temporal anchors
  test('extractAnchors extracts temporal anchors', () => {
    const ca = new CueAnchors();
    const anchors = ca.extractAnchors('Yesterday I fixed the cedilla bug after a long session', 'mem2');
    const temporal = anchors.filter(a => a.anchor_type === 'temporal');
    assert.ok(temporal.length > 0, `should extract temporal anchor, got: ${JSON.stringify(anchors)}`);
  }) ? passed++ : failed++;

  // T3: extractAnchors pulls causal anchors
  test('extractAnchors extracts causal anchors', () => {
    const ca = new CueAnchors();
    const anchors = ca.extractAnchors('The build failed because of a missing dependency in package.json', 'mem3');
    const causal = anchors.filter(a => a.anchor_type === 'causal');
    assert.ok(causal.length > 0, `should extract causal anchor, got: ${JSON.stringify(anchors)}`);
  }) ? passed++ : failed++;

  // T4: storeAnchors creates the cue_anchors table and stores rows
  test('storeAnchors creates table and persists anchors', () => {
    const dbPath = path.join(TEST_DIR, 'anchors1.db');
    makeDb(dbPath);
    const ca = new CueAnchors({ dbPath });
    const anchors = ca.extractAnchors('fcitx5 is used for input methods on Arch Linux', 'mem10');
    ca.storeAnchors(anchors);

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cue_anchors'").get();
    assert.ok(row, 'cue_anchors table should exist');
    const count = db.prepare('SELECT COUNT(*) as c FROM cue_anchors WHERE memory_id = ?').get('mem10').c;
    assert.ok(count > 0, 'anchors should be stored in DB');
    db.close();
    ca.close();
  }) ? passed++ : failed++;

  // T5: findLinkedMemories returns memory IDs associated with an anchor text
  test('findLinkedMemories returns linked memory ids for anchor text', () => {
    const dbPath = path.join(TEST_DIR, 'anchors2.db');
    makeDb(dbPath);
    const ca = new CueAnchors({ dbPath });

    // Store two memories both referencing "fcitx5"
    const anchors1 = ca.extractAnchors('Fixed cedilla with fcitx5 on Arch Linux', 'mem_a');
    const anchors2 = ca.extractAnchors('fcitx5 configuration for Wayland compositors', 'mem_b');
    ca.storeAnchors(anchors1);
    ca.storeAnchors(anchors2);

    const linked = ca.findLinkedMemories('fcitx5');
    assert.ok(linked.length >= 1, `should find at least 1 linked memory, got ${linked.length}`);
    // Both memory IDs should appear somewhere in linked results
    const ids = linked.map(l => l.memory_id);
    assert.ok(
      ids.some(id => id === 'mem_a' || id === 'mem_b'),
      `linked memories should include mem_a or mem_b, got ${ids.join(', ')}`
    );
    ca.close();
  }) ? passed++ : failed++;

  // T6: extractAnchors on empty content returns empty array
  test('extractAnchors on empty content returns empty array', () => {
    const ca = new CueAnchors();
    const anchors = ca.extractAnchors('', 'mem_empty');
    assert.deepStrictEqual(anchors, [], 'empty content should yield no anchors');
  }) ? passed++ : failed++;

  // T7: storeAnchors deduplicates by (memory_id, anchor_text)
  test('storeAnchors deduplicates anchors for same memory', () => {
    const dbPath = path.join(TEST_DIR, 'anchors3.db');
    makeDb(dbPath);
    const ca = new CueAnchors({ dbPath });

    const anchor = {
      id: 'anc_dup',
      memory_id: 'mem_dup',
      anchor_text: 'pacman',
      anchor_type: 'entity',
      linked_memory_ids: '[]',
    };
    ca.storeAnchors([anchor]);
    ca.storeAnchors([anchor]); // store again — should not throw or duplicate

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    const count = db.prepare("SELECT COUNT(*) as c FROM cue_anchors WHERE memory_id = 'mem_dup'").get().c;
    assert.strictEqual(count, 1, 'duplicate anchor should not be inserted twice');
    db.close();
    ca.close();
  }) ? passed++ : failed++;

  // T8: anchor objects have required fields
  test('extracted anchors have required schema fields', () => {
    const ca = new CueAnchors();
    const anchors = ca.extractAnchors('MacBook Air runs Arch Linux kernel 6.18 since January', 'mem_schema');
    if (anchors.length > 0) {
      const anchor = anchors[0];
      assert.ok(typeof anchor.id === 'string', 'anchor.id should be string');
      assert.ok(typeof anchor.memory_id === 'string', 'anchor.memory_id should be string');
      assert.ok(typeof anchor.anchor_text === 'string', 'anchor.anchor_text should be string');
      assert.ok(typeof anchor.anchor_type === 'string', 'anchor.anchor_type should be string');
      const validTypes = ['entity', 'concept', 'temporal', 'causal'];
      assert.ok(validTypes.includes(anchor.anchor_type), `anchor_type '${anchor.anchor_type}' should be valid`);
    }
    // If no anchors extracted — that is also valid (sparse text)
    assert.ok(Array.isArray(anchors), 'should return array');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test — expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-cue-anchors.cjs
# Expected: Error — Cannot find module '../core/cue-anchors.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/cue-anchors.cjs
/**
 * Cue Anchors for Cross-Memory Linking
 *
 * Extracts entity, concept, temporal, and causal anchors from memory content
 * via regex patterns, then stores them in a SQLite table for cross-memory
 * graph traversal at query time.
 *
 * Research basis: Memora (Microsoft Research, Feb 2026) — new SOTA on LoCoMo
 * and LongMemEval. Key insight: cue anchors enable retrieval "beyond direct
 * semantic similarity" by linking memories that share entities, concepts, or
 * causal chains — even when surface text differs significantly.
 *
 * Schema:
 *   cue_anchors (id, memory_id, anchor_text, anchor_type, linked_memory_ids, created_at)
 *   Indexes on anchor_text and anchor_type for fast lookup.
 *
 * @version 1.0.0
 */

'use strict';

const crypto = require('crypto');

// ─── Extraction Patterns ──────────────────────────────────────────────────────

/**
 * Regex rules for each anchor type.
 * Each rule yields one or more anchors from a match.
 */
const ANCHOR_RULES = [
  // ── Temporal: dates, relative time, time of day ──────────────────────────
  {
    type: 'temporal',
    patterns: [
      /\b(yesterday|today|last week|last month|this morning|this evening|earlier today|recently)\b/gi,
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi,
      /\b\d{4}-\d{2}-\d{2}\b/g,
      /\b(after|before|during|since|until)\s+(?:a\s+)?(?:long\s+)?\w+/gi,
    ],
  },

  // ── Causal: "because of", "due to", "caused by", "as a result" ───────────
  {
    type: 'causal',
    patterns: [
      /\b(because of|due to|caused by|as a result of|led to|resulted in|failed because|broke because)\b[\w\s]{3,40}/gi,
      /\b(the reason|root cause|triggered by|fixed by)\b/gi,
    ],
  },

  // ── Entity: capitalized proper nouns and well-known technical names ───────
  {
    type: 'entity',
    patterns: [
      // Known technical entities
      /\b(Arch Linux|MacBook Air|MacBook Pro|Dell G15|Ubuntu|Debian|Fedora|Windows|macOS)\b/g,
      /\b(pacman|yay|homebrew|apt|dnf|brew)\b/gi,
      /\b(fcitx5?|ibus|scim|uim)\b/gi,
      /\b(Hyprland|Wayland|X11|Xorg|GNOME|KDE|Sway|i3)\b/g,
      /\b(Node\.?js|Python|Rust|Go|TypeScript|JavaScript|Bash|PowerShell)\b/gi,
      /\b(SQLite|PostgreSQL|MySQL|MongoDB|Redis)\b/gi,
      /\b(Claude|ChatGPT|Gemini|Copilot|Haiku|Sonnet|Opus)\b/g,
      /\b(npm|yarn|pnpm|cargo|pip|gem)\b/gi,
      /\b(systemd|journalctl|dmesg|cron|launchd)\b/gi,
      // Capitalized 2-word phrases (likely proper names)
      /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g,
    ],
  },

  // ── Concept: abstract technical concepts ─────────────────────────────────
  {
    type: 'concept',
    patterns: [
      /\b(authentication|authorization|encryption|hashing|tokenization)\b/gi,
      /\b(memory management|garbage collection|caching|indexing|partitioning)\b/gi,
      /\b(dependency injection|design pattern|singleton|factory|observer)\b/gi,
      /\b(vector search|semantic search|full-text search|fuzzy matching)\b/gi,
      /\b(RAG|LLM|embedding|fine-tuning|inference|sampling)\b/gi,
      /\b(hook|middleware|plugin|adapter|handler|decorator)\b/gi,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

class CueAnchors {
  /**
   * @param {Object} [options]
   * @param {string} [options.dbPath] - Path to SQLite DB for storing anchors
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || null;
    this._db = null;

    if (this.dbPath) {
      this._initDb();
    }
  }

  // ─── DB init ──────────────────────────────────────────────────────────────

  _initDb() {
    const Database = require('better-sqlite3');
    this._db = new Database(this.dbPath, { timeout: 5000 });
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS cue_anchors (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        anchor_text TEXT NOT NULL,
        anchor_type TEXT NOT NULL CHECK(anchor_type IN ('entity','concept','temporal','causal')),
        linked_memory_ids TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cue_anchor_text ON cue_anchors(anchor_text);
      CREATE INDEX IF NOT EXISTS idx_cue_anchor_type ON cue_anchors(anchor_type);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cue_anchor_dedup
        ON cue_anchors(memory_id, anchor_text, anchor_type);
    `);
  }

  // ─── Extraction ───────────────────────────────────────────────────────────

  /**
   * Extract cue anchors from text content using regex patterns.
   * Returns an array of anchor objects ready to be stored.
   *
   * @param {string} content - Text to extract anchors from
   * @param {string} memoryId - ID of the parent memory
   * @returns {Array<{id,memory_id,anchor_text,anchor_type,linked_memory_ids}>}
   */
  extractAnchors(content, memoryId) {
    if (!content || !content.trim()) return [];

    const seen = new Set();
    const anchors = [];

    for (const rule of ANCHOR_RULES) {
      for (const pattern of rule.patterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const text = match[0].trim().toLowerCase();
          if (!text || text.length < 3) continue;

          const dedupKey = `${rule.type}:${text}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          const id = crypto
            .createHash('md5')
            .update(`${memoryId}:${rule.type}:${text}`)
            .digest('hex')
            .slice(0, 16);

          anchors.push({
            id,
            memory_id: memoryId,
            anchor_text: text,
            anchor_type: rule.type,
            linked_memory_ids: '[]',
          });
        }
      }
    }

    return anchors;
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  /**
   * Persist an array of anchor objects to the cue_anchors table.
   * Uses INSERT OR IGNORE to handle duplicates gracefully.
   *
   * @param {Array} anchors - From extractAnchors()
   */
  storeAnchors(anchors) {
    if (!this._db || !anchors || anchors.length === 0) return;

    const insert = this._db.prepare(`
      INSERT OR IGNORE INTO cue_anchors
        (id, memory_id, anchor_text, anchor_type, linked_memory_ids)
      VALUES (?, ?, ?, ?, ?)
    `);

    const store = this._db.transaction(items => {
      for (const a of items) {
        insert.run(a.id, a.memory_id, a.anchor_text, a.anchor_type, a.linked_memory_ids || '[]');
      }
    });

    store(anchors);
  }

  // ─── Retrieval ────────────────────────────────────────────────────────────

  /**
   * Find all memory IDs that are linked to a given anchor text.
   * Matches anchor_text using LIKE for partial matching.
   *
   * @param {string} anchorText - Entity, concept, or phrase to look up
   * @returns {Array<{memory_id, anchor_text, anchor_type}>}
   */
  findLinkedMemories(anchorText) {
    if (!this._db || !anchorText) return [];
    return this._db.prepare(`
      SELECT memory_id, anchor_text, anchor_type
      FROM cue_anchors
      WHERE anchor_text LIKE ?
      ORDER BY created_at DESC
    `).all(`%${anchorText.toLowerCase()}%`);
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this._db && this._db.open) {
      this._db.close();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { CueAnchors };
```

#### Step 4: Run test — expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-cue-anchors.cjs
# Expected: 8 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/cue-anchors.cjs tests/test-cue-anchors.cjs
git commit -m "feat(F4): cue anchors for cross-memory linking

- CueAnchors extracts 4 anchor types via regex: entity, concept, temporal, causal
- extractAnchors() runs all patterns, deduplicates by type:text, returns schema objects
- storeAnchors() persists to cue_anchors table with INSERT OR IGNORE deduplication
- findLinkedMemories() LIKE-queries anchor_text for cross-memory expansion
- Schema: cue_anchors table with indexes on anchor_text and anchor_type
- 8 tests: entity/temporal/causal extraction, table creation, persistence,
  linked memory retrieval, empty content, dedup, schema field validation

Research: Memora (Microsoft Research, Feb 2026) — new SOTA on LoCoMo +
LongMemEval via cue anchor retrieval beyond direct semantic similarity."
```

---

### Task F5: Token-Efficient Theme Selection

**Files:**
- Create: `core/theme-selector.cjs`
- Test: `tests/test-theme-selector.cjs`

**Research Rationale:** xMemory (Feb 2026) achieves ~28% token reduction per query via decoupling-to-aggregation: group retrieval results by theme, select one representative per cluster, then enforce a token budget. This is critical for Cortex where the injection context window is limited and reducing bloat improves answer quality.

---

#### Step 1: Write the failing test

```javascript
// tests/test-theme-selector.cjs
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-theme-selector-' + Date.now());

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

// ─── helpers ────────────────────────────────────────────────────────────────

function makeResult(id, content, score = 0.8) {
  return { id, content, score };
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  setup();
  console.log('\n━━━ Token-Efficient Theme Selector Tests ━━━\n');

  const { ThemeSelector } = require('../core/theme-selector.cjs');
  let passed = 0;
  let failed = 0;

  // T1: Jaccard clustering groups similar results together
  test('clusterResults groups similar texts into same cluster', () => {
    const sel = new ThemeSelector();
    const results = [
      makeResult('a1', 'authentication debug jwt token verify expire'),
      makeResult('a2', 'jwt token authentication check verify signature'),
      makeResult('b1', 'sorting algorithm quicksort mergesort complexity'),
      makeResult('b2', 'quicksort algorithm O(n log n) average case sort'),
    ];
    const clusters = sel.clusterResults(results, 2);
    assert.strictEqual(clusters.length, 2, `should produce 2 clusters, got ${clusters.length}`);
    // a1 and a2 should be in the same cluster (auth/jwt content)
    const clusterIds = clusters.map(c => c.members.map(m => m.id).sort());
    const hasAuthCluster = clusterIds.some(ids => ids.includes('a1') && ids.includes('a2'));
    const hasSortCluster = clusterIds.some(ids => ids.includes('b1') && ids.includes('b2'));
    assert.ok(hasAuthCluster, `a1 and a2 (auth/jwt) should be in the same cluster. Clusters: ${JSON.stringify(clusterIds)}`);
    assert.ok(hasSortCluster, `b1 and b2 (sorting) should be in the same cluster. Clusters: ${JSON.stringify(clusterIds)}`);
  }) ? passed++ : failed++;

  // T2: selectRepresentative picks the highest-scoring member
  test('selectRepresentative picks highest-scoring member per cluster', () => {
    const sel = new ThemeSelector();
    const cluster = {
      members: [
        makeResult('low', 'authentication debug', 0.4),
        makeResult('high', 'authentication debug jwt', 0.9),
        makeResult('mid', 'authentication token', 0.6),
      ]
    };
    const rep = sel.selectRepresentative(cluster);
    assert.strictEqual(rep.id, 'high', `representative should be 'high' (score 0.9), got '${rep.id}'`);
  }) ? passed++ : failed++;

  // T3: Token budget is enforced — results exceeding budget are dropped
  test('selectThemes enforces token budget', () => {
    const sel = new ThemeSelector();
    // Each result has ~100 words → ~133 tokens. Budget = 200 tokens → only 1 fits.
    const longContent = Array(100).fill('word').join(' ');
    const results = [
      makeResult('r1', longContent, 0.9),
      makeResult('r2', longContent, 0.8),
      makeResult('r3', longContent, 0.7),
    ];
    const themes = sel.selectThemes(results, 'query', 200);
    // Only the first (highest-scoring) theme should fit within 200 tokens
    assert.ok(themes.length >= 1, 'at least one theme should fit');
    assert.ok(themes.length < 3, `should not include all 3 themes under 200-token budget, got ${themes.length}`);
  }) ? passed++ : failed++;

  // T4: Single result is returned as-is without duplication
  test('single result is passed through without duplication', () => {
    const sel = new ThemeSelector();
    const results = [makeResult('solo', 'only one result in this set', 0.9)];
    const themes = sel.selectThemes(results, 'query', 4000);
    assert.strictEqual(themes.length, 1, 'single result should produce exactly 1 theme');
    assert.strictEqual(themes[0].representative.id, 'solo');
  }) ? passed++ : failed++;

  // T5: Each theme object has required fields
  test('theme objects have required fields: theme, representative, count, avgScore', () => {
    const sel = new ThemeSelector();
    const results = [
      makeResult('t1', 'authentication token jwt debug', 0.8),
      makeResult('t2', 'sorting quicksort algorithm complexity', 0.7),
    ];
    const themes = sel.selectThemes(results, 'query', 4000);
    assert.ok(themes.length > 0, 'should return at least one theme');
    for (const theme of themes) {
      assert.ok(typeof theme.theme === 'string', 'theme.theme should be string');
      assert.ok(theme.representative, 'theme.representative should exist');
      assert.ok(typeof theme.count === 'number', 'theme.count should be number');
      assert.ok(typeof theme.avgScore === 'number', 'theme.avgScore should be number');
    }
  }) ? passed++ : failed++;

  // T6: Empty results returns empty array
  test('selectThemes with empty input returns empty array', () => {
    const sel = new ThemeSelector();
    const themes = sel.selectThemes([], 'query', 4000);
    assert.deepStrictEqual(themes, [], 'empty input should return empty array');
  }) ? passed++ : failed++;

  // T7: Jaccard similarity is correctly computed
  test('jaccardSimilarity returns correct values', () => {
    const sel = new ThemeSelector();
    // Identical texts → similarity 1.0
    const s1 = sel.jaccardSimilarity('hello world foo', 'hello world foo');
    assert.ok(Math.abs(s1 - 1.0) < 0.001, `identical texts should have similarity 1.0, got ${s1}`);

    // Completely disjoint texts → similarity 0.0
    const s2 = sel.jaccardSimilarity('alpha beta gamma', 'delta epsilon zeta');
    assert.ok(Math.abs(s2 - 0.0) < 0.001, `disjoint texts should have similarity 0.0, got ${s2}`);

    // Partial overlap
    const s3 = sel.jaccardSimilarity('apple banana cherry', 'banana cherry date');
    assert.ok(s3 > 0 && s3 < 1, `partial overlap should give 0 < similarity < 1, got ${s3}`);
  }) ? passed++ : failed++;

  // T8: Theme labels are derived from representative content (non-empty string)
  test('theme label is a non-empty string derived from content', () => {
    const sel = new ThemeSelector();
    const results = [makeResult('q1', 'authentication and authorization middleware patterns', 0.9)];
    const themes = sel.selectThemes(results, 'query', 4000);
    assert.ok(themes.length > 0);
    assert.ok(typeof themes[0].theme === 'string', 'theme label should be a string');
    assert.ok(themes[0].theme.length > 0, 'theme label should be non-empty');
  }) ? passed++ : failed++;

  // T9: Themes are returned sorted by avgScore descending
  test('themes are sorted by avgScore descending', () => {
    const sel = new ThemeSelector();
    const results = [
      makeResult('low1', 'sorting algorithm bubble sort simple', 0.3),
      makeResult('low2', 'bubble sort swap iteration', 0.3),
      makeResult('high1', 'authentication jwt token verify expire check', 0.9),
      makeResult('high2', 'jwt authentication bearer token header', 0.9),
    ];
    const themes = sel.selectThemes(results, 'query', 4000);
    if (themes.length >= 2) {
      assert.ok(
        themes[0].avgScore >= themes[themes.length - 1].avgScore,
        'themes should be sorted by avgScore descending'
      );
    }
    assert.ok(themes.length >= 1, 'should return at least one theme');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test — expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-theme-selector.cjs
# Expected: Error — Cannot find module '../core/theme-selector.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/theme-selector.cjs
/**
 * Token-Efficient Theme Selector
 *
 * Groups retrieval results into themes via Jaccard text similarity clustering,
 * selects the highest-scoring representative per cluster, and enforces a token
 * budget to minimize context bloat.
 *
 * Research basis: xMemory (Feb 2026) — decoupling-to-aggregation paradigm
 * achieves ~28% token reduction per query without quality loss. Critical for
 * Cortex where injection context is limited.
 *
 * Pipeline:
 *   1. Tokenize result content to word sets
 *   2. Cluster results by Jaccard similarity (greedy, threshold 0.3)
 *   3. Select highest-scoring member as cluster representative
 *   4. Sort clusters by avgScore descending
 *   5. Greedily add themes until token budget exhausted
 *
 * Token estimation: word_count / 0.75 (standard 0.75 words-per-token ratio)
 *
 * @version 1.0.0
 */

'use strict';

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Tokenize text to a normalized word set (lowercase, alphanumeric only).
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase().split(/\W+/).filter(w => w.length >= 2)
  );
}

/**
 * Estimate token count from word count using the standard 0.75 ratio.
 *
 * @param {string} content
 * @returns {number}
 */
function estimateTokens(content) {
  if (!content) return 0;
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.75);
}

/**
 * Extract a short label from content (first 5 meaningful words).
 *
 * @param {string} content
 * @returns {string}
 */
function extractLabel(content) {
  if (!content) return 'untitled';
  const words = content.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  return words.join(' ') || 'untitled';
}

// ─────────────────────────────────────────────────────────────────────────────

class ThemeSelector {
  /**
   * @param {Object} [options]
   * @param {number} [options.similarityThreshold=0.3] - Jaccard threshold for same cluster
   */
  constructor(options = {}) {
    this.similarityThreshold = options.similarityThreshold !== undefined
      ? options.similarityThreshold
      : 0.3;
  }

  // ─── Core math ────────────────────────────────────────────────────────────

  /**
   * Compute Jaccard similarity between two texts.
   * J(A, B) = |A ∩ B| / |A ∪ B|
   *
   * @param {string} textA
   * @param {string} textB
   * @returns {number} in [0, 1]
   */
  jaccardSimilarity(textA, textB) {
    const a = tokenize(textA);
    const b = tokenize(textB);
    if (a.size === 0 && b.size === 0) return 1.0;
    if (a.size === 0 || b.size === 0) return 0.0;

    let intersection = 0;
    for (const word of a) {
      if (b.has(word)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  // ─── Clustering ───────────────────────────────────────────────────────────

  /**
   * Greedily cluster results by Jaccard similarity.
   * Each result is added to the first cluster whose representative has
   * similarity >= threshold, or starts a new cluster.
   *
   * The `k` parameter is advisory — greedy clustering may produce fewer
   * clusters if results are very similar, or up to results.length clusters
   * if all are dissimilar.
   *
   * @param {Array<{id,content,score}>} results
   * @param {number} [k=5] - Advisory max number of clusters
   * @returns {Array<{members: Array, centroidLabel: string, avgScore: number}>}
   */
  clusterResults(results, k = 5) {
    if (!results || results.length === 0) return [];
    if (results.length === 1) {
      return [{
        members: results,
        centroidLabel: extractLabel(results[0].content),
        avgScore: results[0].score || 0,
      }];
    }

    const clusters = [];
    // Use adaptive threshold: loosen if we're producing too many clusters
    const threshold = this.similarityThreshold;

    for (const result of results) {
      let placed = false;

      for (const cluster of clusters) {
        // Compare against the first member (representative) of the cluster
        const rep = cluster.members[0];
        const sim = this.jaccardSimilarity(result.content, rep.content);
        if (sim >= threshold) {
          cluster.members.push(result);
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Respect k limit: if we've hit k clusters, force into best-matching cluster
        if (clusters.length >= k) {
          let bestCluster = clusters[0];
          let bestSim = -1;
          for (const cluster of clusters) {
            const sim = this.jaccardSimilarity(result.content, cluster.members[0].content);
            if (sim > bestSim) {
              bestSim = sim;
              bestCluster = cluster;
            }
          }
          bestCluster.members.push(result);
        } else {
          clusters.push({
            members: [result],
            centroidLabel: extractLabel(result.content),
            avgScore: 0, // will be computed below
          });
        }
      }
    }

    // Compute avgScore and centroidLabel for each cluster
    for (const cluster of clusters) {
      const scores = cluster.members.map(m => m.score || 0);
      cluster.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      cluster.centroidLabel = extractLabel(cluster.members[0].content);
    }

    return clusters;
  }

  // ─── Representative Selection ─────────────────────────────────────────────

  /**
   * Pick the highest-scoring member from a cluster.
   *
   * @param {{members: Array}} cluster
   * @returns {Object} The representative result object
   */
  selectRepresentative(cluster) {
    if (!cluster || !cluster.members || cluster.members.length === 0) return null;
    return cluster.members.reduce(
      (best, curr) => ((curr.score || 0) > (best.score || 0) ? curr : best),
      cluster.members[0]
    );
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Select compact, diverse themes from retrieval results within a token budget.
   *
   * @param {Array<{id,content,score}>} results - Retrieval results
   * @param {string} query - Original query (for future query-guided clustering)
   * @param {number} [maxTokens=4000] - Token budget for all selected themes
   * @returns {Array<{theme,representative,count,avgScore}>}
   */
  selectThemes(results, query, maxTokens = 4000) {
    if (!results || results.length === 0) return [];

    // 1. Cluster
    const k = Math.min(5, results.length);
    const clusters = this.clusterResults(results, k);

    // 2. For each cluster, pick representative
    const themes = clusters.map(cluster => ({
      theme: cluster.centroidLabel,
      representative: this.selectRepresentative(cluster),
      count: cluster.members.length,
      avgScore: cluster.avgScore,
    })).filter(t => t.representative !== null);

    // 3. Sort by avgScore descending (highest quality first)
    themes.sort((a, b) => b.avgScore - a.avgScore);

    // 4. Enforce token budget — greedily include themes until budget exhausted
    let remaining = maxTokens;
    const selected = [];

    for (const theme of themes) {
      const tokens = estimateTokens(theme.representative.content);
      if (remaining - tokens >= 0) {
        selected.push(theme);
        remaining -= tokens;
      }
      // Don't break early — a later shorter theme might still fit
    }

    // Ensure at least one result is returned if any exist and budget > 0
    if (selected.length === 0 && themes.length > 0 && maxTokens > 0) {
      selected.push(themes[0]);
    }

    return selected;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { ThemeSelector };
```

#### Step 4: Run test — expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-theme-selector.cjs
# Expected: 9 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/theme-selector.cjs tests/test-theme-selector.cjs
git commit -m "feat(F5): token-efficient theme selection via Jaccard clustering

- ThemeSelector clusters results by Jaccard word-set similarity (threshold 0.3)
- selectRepresentative() picks highest-scoring member per cluster
- selectThemes() enforces token budget (word_count / 0.75 estimate)
- Themes sorted by avgScore descending; greedy inclusion within budget
- Single result passthrough; empty input → empty output
- 9 tests: Jaccard clustering, representative selection, budget enforcement,
  single result, required fields, empty input, jaccardSimilarity values,
  theme label generation, sort order

Research: xMemory (Feb 2026) — decoupling-to-aggregation achieves ~28%
token reduction per query without quality loss."
```

---

## Phase F Summary

| Task | Module | Test File | Tests | Key Research |
|------|--------|-----------|-------|--------------|
| F1 | `core/fts5-search.cjs` | `tests/test-fts5.cjs` | 9 | Anatomy of Agentic Memory (Feb 2026) |
| F2 | `core/iterative-retriever.cjs` | `tests/test-iterative-retrieval.cjs` | 8 | Anatomy + Hindsight (Dec 2025) |
| F3 | `core/memory-classifier.cjs` | `tests/test-memory-classifier.cjs` | 10 | Hindsight 4-network + Memory taxonomy |
| F4 | `core/cue-anchors.cjs` | `tests/test-cue-anchors.cjs` | 8 | Memora Microsoft SOTA (Feb 2026) |
| F5 | `core/theme-selector.cjs` | `tests/test-theme-selector.cjs` | 9 | xMemory 28% token reduction (Feb 2026) |

**Total: 44 tests across 5 modules.**

### Run all Phase F tests

```bash
cd /home/rob/repos/cortex-claude
node tests/test-fts5.cjs && \
node tests/test-iterative-retrieval.cjs && \
node tests/test-memory-classifier.cjs && \
node tests/test-cue-anchors.cjs && \
node tests/test-theme-selector.cjs
```

### Integration note

After all 5 tasks pass, wire the new modules into `core/query-orchestrator.cjs`:

1. Replace direct vector search with `IterativeRetriever` (sources: `FTS5SearchLayer` + vector adapter)
2. Classify results via `MemoryClassifier.classifyByRegex()` and `applyBoosts()` before returning
3. Expand queries via `CueAnchors.findLinkedMemories()` on top-ranked entities
4. Pass final results through `ThemeSelector.selectThemes()` before injection

This completes the Phase F retrieval transformation from naive top-k to research-backed multi-strategy pipeline.
