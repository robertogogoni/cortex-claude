# Cortex Phase I: Memory Intelligence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add intelligence layer: auto-categorization, breakthrough detection, importance scoring, topic lifecycle, cross-project sharing, LADS integration, health visualization, export tool, provenance tracking, and user notifications.

**Architecture:** 10 modules building on Phase H's MarkdownTopicAdapter and GapDetector. All CommonJS, standalone testable. Extends existing LADS framework and injection formatter.

**Tech Stack:** Node.js (CommonJS `.cjs`), custom test runner, no new external deps

**Depends on:** Phase H (MarkdownTopicAdapter, GapDetector, TopicCompiler)

**See also:**
- [Unified Roadmap (Phases H-K)](2026-03-02-cortex-unified-roadmap-phases-h-k.md) — high-level design, dependencies, cost analysis
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) — links to all phase plans

---



test-a', state: 'fresh', daysSinceAccess: 5 },
      { name: 'test-b', state: 'stale', daysSinceAccess: 120 },
    ];

    const output = renderer.render(statuses);

    if (test('no-color mode works', () => {
      // Should not contain ANSI escape codes
      const ansiRegex = /\x1b\[[0-9;]*m/;
      assert.ok(!ansiRegex.test(output),
        'should not contain ANSI color codes in no-color mode');
      assert.ok(output.includes('test-a'), 'should still show topic names');
    })) passed++; else failed++;
  })();

  // --- Test 6: Uses box drawing characters ---
  (function () {
    const renderer = new TopicHealthRenderer();

    const statuses = [
      { name: 'boxed', state: 'fresh', daysSinceAccess: 1 },
    ];

    const output = renderer.render(statuses);

    if (test('uses box drawing characters', () => {
      const boxChars = ['┌', '┐', '└', '┘', '─', '│', '├', '┤'];
      const hasBox = boxChars.some(c => output.includes(c));
      assert.ok(hasBox, 'should use box drawing characters');
    })) passed++; else failed++;
  })();

  // --- Test 7: Summary section shows totals ---
  (function () {
    const renderer = new TopicHealthRenderer();

    const statuses = [
      { name: 'a', state: 'fresh', daysSinceAccess: 1 },
      { name: 'b', state: 'aging', daysSinceAccess: 50 },
      { name: 'c', state: 'stale', daysSinceAccess: 100 },
      { name: 'd', state: 'archive', daysSinceAccess: 200 },
    ];

    const output = renderer.render(statuses);

    if (test('summary section shows totals', () => {
      // Should show total count somewhere
      assert.ok(output.includes('4') || output.includes('Total'),
        'should show total topic count');
    })) passed++; else failed++;
  })();

  // --- Test 8: Topics are sorted by state severity (stale/archive first) ---
  (function () {
    const renderer = new TopicHealthRenderer();

    const statuses = [
      { name: 'fresh-one', state: 'fresh', daysSinceAccess: 1 },
      { name: 'archive-one', state: 'archive', daysSinceAccess: 200 },
      { name: 'stale-one', state: 'stale', daysSinceAccess: 100 },
    ];

    const output = renderer.render(statuses);

    if (test('topics are sorted by state severity (stale/archive first)', () => {
      const archivePos = output.indexOf('archive-one');
      const stalePos = output.indexOf('stale-one');
      const freshPos = output.indexOf('fresh-one');
      assert.ok(archivePos < freshPos,
        'archive should appear before fresh in output');
      assert.ok(stalePos < freshPos,
        'stale should appear before fresh in output');
    })) passed++; else failed++;
  })();

  // --- Test 9: Render returns string, never null/undefined ---
  (function () {
    const renderer = new TopicHealthRenderer();

    if (test('render returns string, never null/undefined', () => {
      assert.strictEqual(typeof renderer.render([]), 'string');
      assert.strictEqual(typeof renderer.render(null), 'string');
      assert.strictEqual(typeof renderer.render(undefined), 'string');
    })) passed++; else failed++;
  })();

  // --- Test 10: All-same-state still renders correctly ---
  (function () {
    const renderer = new TopicHealthRenderer();

    const statuses = [
      { name: 'x', state: 'aging', daysSinceAccess: 40 },
      { name: 'y', state: 'aging', daysSinceAccess: 60 },
      { name: 'z', state: 'aging', daysSinceAccess: 80 },
    ];

    const output = renderer.render(statuses);

    if (test('all-same-state still renders correctly', () => {
      assert.ok(output.includes('aging'), 'should mention aging');
      assert.ok(output.includes('x'), 'should show topic x');
      assert.ok(output.includes('y'), 'should show topic y');
      assert.ok(output.includes('z'), 'should show topic z');
    })) passed++; else failed++;
  })();

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-topic-health-renderer.cjs`
Expected: FAIL — `Cannot find module '../core/topic-health-renderer.cjs'`

**Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
'use strict';

/**
 * @typedef {Object} TopicStatus
 * @property {string} name
 * @property {'fresh'|'aging'|'stale'|'archive'} state
 * @property {number} daysSinceAccess
 */

const STATE_ORDER = { archive: 0, stale: 1, aging: 2, fresh: 3 };

const STATE_LABELS = {
  fresh:   { symbol: '\u25CF', label: 'fresh',   colorCode: '\x1b[32m' }, // green
  aging:   { symbol: '\u25CF', label: 'aging',   colorCode: '\x1b[33m' }, // yellow
  stale:   { symbol: '\u25CF', label: 'stale',   colorCode: '\x1b[31m' }, // red
  archive: { symbol: '\u25CB', label: 'archive', colorCode: '\x1b[90m' }, // gray
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const MAX_DETAIL_TOPICS = 15;
const BAR_MAX_WIDTH = 20;

/**
 * TopicHealthRenderer — Renders ASCII health display for topic files.
 *
 * Shows per-state counts, proportional bar charts, and a detail listing
 * sorted by severity (archive/stale first). Uses box drawing characters
 * consistent with CortexRenderer.
 */
class TopicHealthRenderer {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.color=true] - Whether to use ANSI colors
   */
  constructor(options = {}) {
    this.color = options.color !== false;
  }

  /**
   * Apply color if enabled.
   * @param {string} text
   * @param {string} colorCode - ANSI escape code
   * @returns {string}
   */
  c(text, colorCode) {
    if (!this.color) return text;
    return `${colorCode}${text}${RESET}`;
  }

  /**
   * Bold text if color enabled.
   * @param {string} text
   * @returns {string}
   */
  bold(text) {
    return this.c(text, BOLD);
  }

  /**
   * Create a proportional bar.
   * @param {number} count
   * @param {number} total
   * @param {string} colorCode
   * @returns {string}
   */
  bar(count, total, colorCode) {
    if (total === 0) return '';
    const width = Math.max(1, Math.round((count / total) * BAR_MAX_WIDTH));
    const blocks = '\u2588'.repeat(width);
    return this.c(blocks, colorCode);
  }

  /**
   * Render topic health display.
   * @param {TopicStatus[]|null|undefined} statuses
   * @returns {string}
   */
  render(statuses) {
    if (!statuses || statuses.length === 0) {
      return [
        '\u250C\u2500\u2500 Topic Health \u2500\u2500\u2510',
        '\u2502 No topics found.   \u2502',
        '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518',
      ].join('\n');
    }

    // Count per state
    const counts = { fresh: 0, aging: 0, stale: 0, archive: 0 };
    for (const s of statuses) {
      if (s.state in counts) counts[s.state]++;
    }
    const total = statuses.length;

    // Sort by severity (archive first, fresh last), then by days descending
    const sorted = [...statuses].sort((a, b) => {
      const orderDiff = (STATE_ORDER[a.state] ?? 99) - (STATE_ORDER[b.state] ?? 99);
      if (orderDiff !== 0) return orderDiff;
      return b.daysSinceAccess - a.daysSinceAccess;
    });

    const lines = [];

    // Header
    lines.push(`\u250C\u2500\u2500 ${this.bold('Topic Health')} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);

    // Bar chart section
    lines.push(`\u2502`);
    for (const state of ['fresh', 'aging', 'stale', 'archive']) {
      const info = STATE_LABELS[state];
      const count = counts[state];
      const barStr = this.bar(count, total, info.colorCode);
      const label = `${info.label}`.padEnd(8);
      lines.push(`\u2502  ${this.c(info.symbol, info.colorCode)} ${label} ${barStr} ${count}`);
    }

    // Separator
    lines.push(`\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524`);

    // Detail listing (truncated to MAX_DETAIL_TOPICS)
    const displayCount = Math.min(sorted.length, MAX_DETAIL_TOPICS);
    for (let i = 0; i < displayCount; i++) {
      const s = sorted[i];
      const info = STATE_LABELS[s.state] || STATE_LABELS.fresh;
      const name = s.name.length > 22 ? s.name.substring(0, 19) + '...' : s.name;
      const daysStr = `${Math.round(s.daysSinceAccess)}d`;
      lines.push(`\u2502  ${this.c(info.symbol, info.colorCode)} ${name.padEnd(22)} ${daysStr.padStart(5)} ${this.c(s.state, info.colorCode)}`);
    }

    if (sorted.length > MAX_DETAIL_TOPICS) {
      const remaining = sorted.length - MAX_DETAIL_TOPICS;
      lines.push(`\u2502  ... and ${remaining} more topics (${sorted.length} total, 15 shown)`);
    }

    // Footer with total
    lines.push(`\u2502`);
    lines.push(`\u2502  Total: ${total} topics`);
    lines.push(`\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518`);

    return lines.join('\n');
  }
}

module.exports = { TopicHealthRenderer };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-topic-health-renderer.cjs`
Expected: All 10 tests PASS

**Step 5: Commit**

```
git add core/topic-health-renderer.cjs tests/test-topic-health-renderer.cjs
git commit -m "feat(I7): TopicHealthRenderer — ASCII health display with bar charts and box drawing"
```

---

### Task 20: `cortex__export` MCP Tool (I8)

**Files:**
- Create: `core/memory-exporter.cjs`
- Modify: `cortex/server.cjs` (add tool registration)
- Test: `tests/test-export-tool.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-export-' + Date.now());

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

function writeTopicFile(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), content, 'utf8');
}

async function main() {
  console.log('\nMemoryExporter Tests\n');
  setup();
  let passed = 0;
  let failed = 0;

  const { MemoryExporter } = require('../core/memory-exporter.cjs');

  // --- Setup: create sample topic files ---
  const projectDir = path.join(TEST_DIR, 'project', 'topics');
  const globalDir = path.join(TEST_DIR, 'global', 'topics');

  writeTopicFile(projectDir, 'git-workflow', [
    '# Git Workflow',
    '',
    '## Entries',
    '',
    '- rebase strategy for feature branches',
    '- squash commits before merge',
  ].join('\n'));

  writeTopicFile(projectDir, 'docker-setup', [
    '# Docker Setup',
    '',
    '## Entries',
    '',
    '- multi-stage build for Node apps',
  ].join('\n'));

  writeTopicFile(globalDir, 'shared-patterns', [
    '# Shared Patterns',
    '',
    '## Entries',
    '',
    '- adapter pattern for storage abstraction',
  ].join('\n'));

  // --- Test 1: JSON output is valid ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'json', scope: 'all' });

    if (test('JSON output is valid', () => {
      assert.strictEqual(result.format, 'json');
      const parsed = JSON.parse(result.content);
      assert.ok(Array.isArray(parsed.topics), 'should have topics array');
      assert.strictEqual(parsed.topics.length, 3, 'should have 3 topics');
      assert.ok(parsed.exportedAt, 'should have exportedAt timestamp');
      assert.ok(parsed.version, 'should have version');
    })) passed++; else failed++;
  })();

  // --- Test 2: Markdown output has TOC ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'markdown', scope: 'all' });

    if (test('markdown output has TOC', () => {
      assert.strictEqual(result.format, 'markdown');
      assert.ok(result.content.includes('Table of Contents') ||
                result.content.includes('## Contents'),
                'should have a table of contents section');
      assert.ok(result.content.includes('git-workflow'), 'should reference topic names');
      assert.ok(result.content.includes('docker-setup'), 'should reference topic names');
      assert.ok(result.content.includes('shared-patterns'), 'should reference topic names');
    })) passed++; else failed++;
  })();

  // --- Test 3: JSONL output — one entry per line ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'jsonl', scope: 'all' });

    if (test('JSONL output — one entry per line', () => {
      assert.strictEqual(result.format, 'jsonl');
      const lines = result.content.trim().split('\n');
      assert.strictEqual(lines.length, 3, 'should have 3 lines (one per topic)');

      // Each line must be valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.ok(parsed.name, 'each line should have a name');
        assert.ok(parsed.content !== undefined, 'each line should have content');
      }
    })) passed++; else failed++;
  })();

  // --- Test 4: Scope filtering — project only ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'json', scope: 'project' });

    if (test('scope filtering — project only', () => {
      const parsed = JSON.parse(result.content);
      assert.strictEqual(parsed.topics.length, 2, 'project scope should have 2 topics');
      const names = parsed.topics.map(t => t.name);
      assert.ok(names.includes('git-workflow'), 'should include git-workflow');
      assert.ok(names.includes('docker-setup'), 'should include docker-setup');
      assert.ok(!names.includes('shared-patterns'), 'should not include global topic');
    })) passed++; else failed++;
  })();

  // --- Test 5: Scope filtering — global only ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'json', scope: 'global' });

    if (test('scope filtering — global only', () => {
      const parsed = JSON.parse(result.content);
      assert.strictEqual(parsed.topics.length, 1, 'global scope should have 1 topic');
      assert.strictEqual(parsed.topics[0].name, 'shared-patterns');
    })) passed++; else failed++;
  })();

  // --- Test 6: Empty export handled ---
  (function () {
    const emptyDir = path.join(TEST_DIR, 'empty-project', 'topics');
    fs.mkdirSync(emptyDir, { recursive: true });

    const exporter = new MemoryExporter({
      projectTopicDir: emptyDir,
    });

    const result = exporter.export({ format: 'json', scope: 'all' });

    if (test('empty export handled', () => {
      const parsed = JSON.parse(result.content);
      assert.strictEqual(parsed.topics.length, 0, 'should have 0 topics');
      assert.ok(parsed.exportedAt, 'should still have metadata');
    })) passed++; else failed++;
  })();

  // --- Test 7: Format parameter validation ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
    });

    if (test('format parameter validation', () => {
      assert.throws(() => {
        exporter.export({ format: 'xml', scope: 'all' });
      }, /unsupported format/i);

      assert.throws(() => {
        exporter.export({ format: '', scope: 'all' });
      }, /unsupported format|format is required/i);
    })) passed++; else failed++;
  })();

  // --- Test 8: Each topic entry includes scope and name ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'json', scope: 'all' });

    if (test('each topic entry includes scope and name', () => {
      const parsed = JSON.parse(result.content);
      for (const topic of parsed.topics) {
        assert.ok(topic.name, `topic should have name, got: ${JSON.stringify(topic)}`);
        assert.ok(topic.scope === 'project' || topic.scope === 'global',
          `topic scope should be project or global, got: ${topic.scope}`);
        assert.ok(typeof topic.content === 'string', 'content should be string');
      }
    })) passed++; else failed++;
  })();

  // --- Test 9: Scope defaults to 'all' ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'json' });

    if (test('scope defaults to all', () => {
      const parsed = JSON.parse(result.content);
      assert.strictEqual(parsed.topics.length, 3, 'default scope should return all');
    })) passed++; else failed++;
  })();

  // --- Test 10: Markdown export includes topic content ---
  (function () {
    const exporter = new MemoryExporter({
      projectTopicDir: projectDir,
      globalTopicDir: globalDir,
    });

    const result = exporter.export({ format: 'markdown', scope: 'all' });

    if (test('markdown export includes topic content', () => {
      assert.ok(result.content.includes('rebase strategy'), 'should include topic content');
      assert.ok(result.content.includes('multi-stage build'), 'should include topic content');
      assert.ok(result.content.includes('adapter pattern'), 'should include global topic content');
    })) passed++; else failed++;
  })();

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-export-tool.cjs`
Expected: FAIL — `Cannot find module '../core/memory-exporter.cjs'`

**Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_FORMATS = ['json', 'markdown', 'jsonl'];
const SUPPORTED_SCOPES = ['project', 'global', 'all'];
const VERSION = '1.0.0';

/**
 * @typedef {Object} TopicData
 * @property {string} name
 * @property {string} content
 * @property {'project'|'global'} scope
 */

/**
 * @typedef {Object} ExportOptions
 * @property {'json'|'markdown'|'jsonl'} format
 * @property {'project'|'global'|'all'} [scope='all']
 */

/**
 * @typedef {Object} ExportResult
 * @property {string} format
 * @property {string} content
 */

/**
 * MemoryExporter — Exports memory topics in json/markdown/jsonl formats.
 * Supports scope filtering (project/global/all).
 */
class MemoryExporter {
  /**
   * @param {Object} options
   * @param {string} options.projectTopicDir - Path to project-local topics
   * @param {string} [options.globalTopicDir] - Path to global topics
   */
  constructor(options = {}) {
    this.projectTopicDir = options.projectTopicDir;
    this.globalTopicDir = options.globalTopicDir || null;
  }

  /**
   * Scan a directory for .md topic files.
   * @param {string} dir
   * @param {'project'|'global'} scope
   * @returns {TopicData[]}
   */
  scanDir(dir, scope) {
    if (!dir || !fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir);
    const topics = [];

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(dir, entry);
      if (!fs.statSync(filePath).isFile()) continue;

      topics.push({
        name: entry.replace(/\.md$/, ''),
        content: fs.readFileSync(filePath, 'utf8'),
        scope,
      });
    }

    return topics;
  }

  /**
   * Gather all topics according to scope filter.
   * @param {'project'|'global'|'all'} scope
   * @returns {TopicData[]}
   */
  gatherTopics(scope) {
    let topics = [];

    if (scope === 'project' || scope === 'all') {
      topics = topics.concat(this.scanDir(this.projectTopicDir, 'project'));
    }

    if (scope === 'global' || scope === 'all') {
      topics = topics.concat(this.scanDir(this.globalTopicDir, 'global'));
    }

    return topics;
  }

  /**
   * Export memories in the specified format.
   * @param {ExportOptions} options
   * @returns {ExportResult}
   */
  export(options = {}) {
    const format = options.format;
    const scope = options.scope || 'all';

    if (!format || !SUPPORTED_FORMATS.includes(format)) {
      throw new Error(`Unsupported format: "${format}". Use one of: ${SUPPORTED_FORMATS.join(', ')}`);
    }

    const topics = this.gatherTopics(scope);

    switch (format) {
      case 'json':
        return this._exportJSON(topics);
      case 'markdown':
        return this._exportMarkdown(topics);
      case 'jsonl':
        return this._exportJSONL(topics);
      default:
        throw new Error(`Unsupported format: "${format}"`);
    }
  }

  /**
   * Export as JSON.
   * @param {TopicData[]} topics
   * @returns {ExportResult}
   */
  _exportJSON(topics) {
    const payload = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      topicCount: topics.length,
      topics: topics.map(t => ({
        name: t.name,
        scope: t.scope,
        content: t.content,
      })),
    };

    return {
      format: 'json',
      content: JSON.stringify(payload, null, 2),
    };
  }

  /**
   * Export as Markdown with table of contents.
   * @param {TopicData[]} topics
   * @returns {ExportResult}
   */
  _exportMarkdown(topics) {
    const lines = [];

    lines.push('# Cortex Memory Export');
    lines.push('');
    lines.push(`Exported: ${new Date().toISOString()}`);
    lines.push(`Topics: ${topics.length}`);
    lines.push('');

    // Table of Contents
    lines.push('## Table of Contents');
    lines.push('');
    for (const t of topics) {
      const anchor = t.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      lines.push(`- [${t.name}](#${anchor}) (${t.scope})`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // Topic content
    for (const t of topics) {
      lines.push(`## ${t.name}`);
      lines.push('');
      lines.push(`> Scope: ${t.scope}`);
      lines.push('');
      lines.push(t.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return {
      format: 'markdown',
      content: lines.join('\n'),
    };
  }

  /**
   * Export as JSONL (one JSON object per line).
   * @param {TopicData[]} topics
   * @returns {ExportResult}
   */
  _exportJSONL(topics) {
    const lines = topics.map(t => JSON.stringify({
      name: t.name,
      scope: t.scope,
      content: t.content,
      exportedAt: new Date().toISOString(),
    }));

    return {
      format: 'jsonl',
      content: lines.join('\n'),
    };
  }
}

module.exports = { MemoryExporter };
```

For `cortex/server.cjs`, add the following tool registration in the tool definitions section:

```javascript
// --- ADDITION to cortex/server.cjs tool registration ---
// Add alongside existing tool registrations (cortex__query, etc.)

{
  name: 'cortex__export',
  description: 'Export memory topics in json, markdown, or jsonl format. Supports scope filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['json', 'markdown', 'jsonl'],
        description: 'Output format',
      },
      scope: {
        type: 'string',
        enum: ['project', 'global', 'all'],
        description: 'Which topics to include (default: all)',
        default: 'all',
      },
    },
    required: ['format'],
  },
  handler: async (params) => {
    const { MemoryExporter } = require('../core/memory-exporter.cjs');
    const exporter = new MemoryExporter({
      projectTopicDir: path.join(memoryDir, 'topics'),
      globalTopicDir: path.join(os.homedir(), '.claude', 'memory', 'topics'),
    });
    const result = exporter.export({
      format: params.format,
      scope: params.scope || 'all',
    });
    return { content: [{ type: 'text', text: result.content }] };
  },
}
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-export-tool.cjs`
Expected: All 10 tests PASS

**Step 5: Commit**

```
git add core/memory-exporter.cjs cortex/server.cjs tests/test-export-tool.cjs
git commit -m "feat(I8): cortex__export MCP tool — export topics as json/markdown/jsonl with scope filtering"
```

---

### Task 21: Memory Provenance (I9)

**Files:**
- Create: `core/provenance-tracker.cjs`
- Test: `tests/test-provenance.cjs`

**Step 1: Write the failing test**

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-provenance-' + Date.now());

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

async function main() {
  console.log('\nProvenanceTracker Tests\n');
  setup();
  let passed = 0;
  let failed = 0;

  const { ProvenanceTracker } = require('../core/provenance-tracker.cjs');

  // --- Test 1: Direct observation tracking ---
  (function () {
    const tracker = new ProvenanceTracker();

    tracker.record({
      memoryId: 'mem-001',
      sourceType: 'direct',
      sessionId: 'sess-1',
      content: 'Database connection timeout on port 5432',
    });

    const prov = tracker.getProvenance('mem-001');

    if (test('direct observation tracking', () => {
      assert.ok(prov, 'should return provenance');
      assert.strictEqual(prov.sourceType, 'direct');
      assert.strictEqual(prov.confidence, 1.0, 'direct observations have confidence 1.0');
      assert.strictEqual(prov.sessionId, 'sess-1');
      assert.strictEqual(prov.chain.length, 0, 'direct has no chain');
    })) passed++; else failed++;
  })();

  // --- Test 2: Consolidated provenance chain ---
  (function () {
    const tracker = new ProvenanceTracker();

    // Record source memories
    tracker.record({
      memoryId: 'mem-a',
      sourceType: 'direct',
      sessionId: 'sess-1',
      content: 'Connection timeout error',
    });
    tracker.record({
      memoryId: 'mem-b',
      sourceType: 'direct',
      sessionId: 'sess-2',
      content: 'Another connection timeout error',
    });

    // Consolidate: mem-c is merged from mem-a and mem-b
    tracker.recordConsolidation({
      memoryId: 'mem-c',
      mergedFrom: ['mem-a', 'mem-b'],
      sessionId: 'sess-3',
      content: 'Recurring connection timeout (consolidated)',
    });

    const prov = tracker.getProvenance('mem-c');

    if (test('consolidated provenance chain', () => {
      assert.strictEqual(prov.sourceType, 'consolidated');
      assert.deepStrictEqual(prov.mergedFrom.sort(), ['mem-a', 'mem-b']);
      assert.strictEqual(prov.confidence, 1.0,
        'consolidated from direct sources has confidence 1.0');
      assert.strictEqual(prov.chain.length, 1, 'one hop: direct → consolidated');
    })) passed++; else failed++;
  })();

  // --- Test 3: Inference chain decay (0.9^hop) ---
  (function () {
    const tracker = new ProvenanceTracker();

    // Direct observation
    tracker.record({
      memoryId: 'base',
      sourceType: 'direct',
      sessionId: 'sess-1',
      content: 'Observed fact A',
    });

    // First inference from base
    tracker.recordInference({
      memoryId: 'infer-1',
      inferredFrom: ['base'],
      sessionId: 'sess-1',
      content: 'Inferred fact B from A',
    });

    // Second inference from first inference
    tracker.recordInference({
      memoryId: 'infer-2',
      inferredFrom: ['infer-1'],
      sessionId: 'sess-1',
      content: 'Inferred fact C from B',
    });

    // Third inference
    tracker.recordInference({
      memoryId: 'infer-3',
      inferredFrom: ['infer-2'],
      sessionId: 'sess-1',
      content: 'Inferred fact D from C',
    });

    const p1 = tracker.getProvenance('infer-1');
    const p2 = tracker.getProvenance('infer-2');
    const p3 = tracker.getProvenance('infer-3');

    if (test('inference chain decay (0.9^hop)', () => {
      // 1 hop: 0.9^1 = 0.9
      assert.ok(Math.abs(p1.confidence - 0.9) < 0.01,
        `infer-1 confidence should be ~0.9, got ${p1.confidence}`);
      // 2 hops: 0.9^2 = 0.81
      assert.ok(Math.abs(p2.confidence - 0.81) < 0.01,
        `infer-2 confidence should be ~0.81, got ${p2.confidence}`);
      // 3 hops: 0.9^3 = 0.729
      assert.ok(Math.abs(p3.confidence - 0.729) < 0.01,
        `infer-3 confidence should be ~0.729, got ${p3.confidence}`);
    })) passed++; else failed++;
  })();

  // --- Test 4: Max chain depth enforcement ---
  (function () {
    const tracker = new ProvenanceTracker({ maxChainDepth: 3 });

    tracker.record({ memoryId: 'd0', sourceType: 'direct', sessionId: 's1', content: 'base' });
    tracker.recordInference({ memoryId: 'd1', inferredFrom: ['d0'], sessionId: 's1', content: 'hop1' });
    tracker.recordInference({ memoryId: 'd2', inferredFrom: ['d1'], sessionId: 's1', content: 'hop2' });
    tracker.recordInference({ memoryId: 'd3', inferredFrom: ['d2'], sessionId: 's1', content: 'hop3' });

    if (test('max chain depth enforcement', () => {
      // Attempting a 4th hop should fail or return error
      assert.throws(() => {
        tracker.recordInference({
          memoryId: 'd4', inferredFrom: ['d3'], sessionId: 's1', content: 'hop4',
        });
      }, /max.*depth|chain.*too.*deep/i);
    })) passed++; else failed++;
  })();

  // --- Test 5: Source type enum validation ---
  (function () {
    const tracker = new ProvenanceTracker();

    if (test('source type enum validation', () => {
      assert.throws(() => {
        tracker.record({
          memoryId: 'bad',
          sourceType: 'telepathy',
          sessionId: 's1',
          content: 'invalid',
        });
      }, /invalid source type|unsupported/i);
    })) passed++; else failed++;
  })();

  // --- Test 6: getProvenance returns null for unknown memory ---
  (function () {
    const tracker = new ProvenanceTracker();

    if (test('getProvenance returns null for unknown memory', () => {
      const prov = tracker.getProvenance('nonexistent-id');
      assert.strictEqual(prov, null);
    })) passed++; else failed++;
  })();

  // --- Test 7: Inference from multiple sources uses min confidence * decay ---
  (function () {
    const tracker = new ProvenanceTracker();

    tracker.record({ memoryId: 'src-a', sourceType: 'direct', sessionId: 's1', content: 'a' });
    tracker.recordInference({ memoryId: 'src-b', inferredFrom: ['src-a'], sessionId: 's1', content: 'b' });

    // Infer from both direct (1.0) and inferred (0.9)
    tracker.recordInference({
      memoryId: 'multi',
      inferredFrom: ['src-a', 'src-b'],
      sessionId: 's1',
      content: 'from both',
    });

    const prov = tracker.getProvenance('multi');

    if (test('inference from multiple sources uses min confidence * decay', () => {
      // Min source confidence = 0.9 (from src-b), * 0.9 decay = 0.81
      assert.ok(Math.abs(prov.confidence - 0.81) < 0.01,
        `multi confidence should be ~0.81, got ${prov.confidence}`);
    })) passed++; else failed++;
  })();

  // --- Test 8: Full chain is reconstructable ---
  (function () {
    const tracker = new ProvenanceTracker();

    tracker.record({ memoryId: 'origin', sourceType: 'direct', sessionId: 's1', content: 'start' });
    tracker.recordInference({ memoryId: 'step1', inferredFrom: ['origin'], sessionId: 's1', content: 'mid' });
    tracker.recordInference({ memoryId: 'step2', inferredFrom: ['step1'], sessionId: 's1', content: 'end' });

    const chain = tracker.getFullChain('step2');

    if (test('full chain is reconstructable', () => {
      assert.ok(Array.isArray(chain), 'chain should be an array');
      assert.strictEqual(chain.length, 3, 'chain should have 3 entries');
      assert.strictEqual(chain[0].memoryId, 'origin');
      assert.strictEqual(chain[1].memoryId, 'step1');
      assert.strictEqual(chain[2].memoryId, 'step2');
    })) passed++; else failed++;
  })();

  // --- Test 9: Consolidation from inferred source inherits reduced confidence ---
  (function () {
    const tracker = new ProvenanceTracker();

    tracker.record({ memoryId: 'raw', sourceType: 'direct', sessionId: 's1', content: 'raw data' });
    tracker.recordInference({ memoryId: 'inf', inferredFrom: ['raw'], sessionId: 's1', content: 'inference' });

    // Consolidate from an inferred source
    tracker.recordConsolidation({
      memoryId: 'cons',
      mergedFrom: ['inf'],
      sessionId: 's2',
      content: 'consolidated from inference',
    });

    const prov = tracker.getProvenance('cons');

    if (test('consolidation from inferred source inherits reduced confidence', () => {
      // inf has confidence 0.9, consolidation preserves source confidence
      assert.ok(Math.abs(prov.confidence - 0.9) < 0.01,
        `consolidated confidence should be ~0.9, got ${prov.confidence}`);
    })) passed++; else failed++;
  })();

  // --- Test 10: Record with timestamp is preserved ---
  (function () {
    const tracker = new ProvenanceTracker();

    const ts = '2026-02-15T10:30:00Z';
    tracker.record({
      memoryId: 'ts-test',
      sourceType: 'direct',
      sessionId: 's1',
      content: 'timestamped',
      timestamp: ts,
    });

    const prov = tracker.getProvenance('ts-test');

    if (test('record with timestamp is preserved', () => {
      assert.strictEqual(prov.timestamp, ts);
    })) passed++; else failed++;
  })();

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-provenance.cjs`
Expected: FAIL — `Cannot find module '../core/provenance-tracker.cjs'`

**Step 3: Write minimal implementation**

```javascript
#!/usr/bin/env node
'use strict';

const VALID_SOURCE_TYPES = ['direct', 'consolidated', 'inferred'];
const DEFAULT_DECAY_FACTOR = 0.9;
const DEFAULT_MAX_CHAIN_DEPTH = 10;

/**
 * @typedef {Object} ProvenanceRecord
 * @property {string} memoryId
 * @property {'direct'|'consolidated'|'inferred'} sourceType
 * @property {string} sessionId
 * @property {string} content
 * @property {number} confidence - 0.0 to 1.0
 * @property {string[]} mergedFrom - For consolidated records
 * @property {string[]} inferredFrom - For inferred records
 * @property {Array<{memoryId: string, sourceType: string}>} chain - Provenance chain
 * @property {string} timestamp
 */

/**
 * ProvenanceTracker — Track source chains for memories.
 *
 * - Direct observations: confidence = 1.0, no chain
 * - Consolidated: inherits min confidence from sources
 * - Inferred: min(source confidences) * 0.9 per hop
 *
 * Enforces max chain depth.
 */
class ProvenanceTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.decayFactor=0.9] - Confidence decay per inference hop
   * @param {number} [options.maxChainDepth=10] - Maximum inference chain depth
   */
  constructor(options = {}) {
    this.decayFactor = options.decayFactor ?? DEFAULT_DECAY_FACTOR;
    this.maxChainDepth = options.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;

    /** @type {Map<string, ProvenanceRecord>} */
    this.records = new Map();
  }

  /**
   * Get the chain depth for a memory (number of inference/consolidation hops back to a direct source).
   * @param {string} memoryId
   * @returns {number}
   */
  getDepth(memoryId) {
    const record = this.records.get(memoryId);
    if (!record) return 0;
    if (record.sourceType === 'direct') return 0;

    const sources = record.mergedFrom || record.inferredFrom || [];
    let maxDepth = 0;
    for (const srcId of sources) {
      maxDepth = Math.max(maxDepth, this.getDepth(srcId));
    }
    return maxDepth + 1;
  }

  /**
   * Get the minimum confidence across a set of source memory IDs.
   * @param {string[]} sourceIds
   * @returns {number}
   */
  getMinSourceConfidence(sourceIds) {
    if (!sourceIds || sourceIds.length === 0) return 1.0;

    let minConf = 1.0;
    for (const id of sourceIds) {
      const rec = this.records.get(id);
      if (rec) {
        minConf = Math.min(minConf, rec.confidence);
      }
    }
    return minConf;
  }

  /**
   * Build the provenance chain for a record.
   * @param {string} memoryId
   * @returns {Array<{memoryId: string, sourceType: string}>}
   */
  buildChain(memoryId) {
    const record = this.records.get(memoryId);
    if (!record || record.sourceType === 'direct') return [];

    const sources = record.mergedFrom || record.inferredFrom || [];
    if (sources.length === 0) return [];

    // Use the first source for chain traversal (primary lineage)
    const primarySource = sources[0];
    const parentChain = this.buildChain(primarySource);

    return [...parentChain, { memoryId: primarySource, sourceType: this.records.get(primarySource)?.sourceType || 'unknown' }];
  }

  /**
   * Record a direct observation or manual entry.
   * @param {Object} params
   * @param {string} params.memoryId
   * @param {'direct'} params.sourceType
   * @param {string} params.sessionId
   * @param {string} params.content
   * @param {string} [params.timestamp]
   */
  record(params) {
    if (!VALID_SOURCE_TYPES.includes(params.sourceType)) {
      throw new Error(`Invalid source type: "${params.sourceType}". Unsupported. Use one of: ${VALID_SOURCE_TYPES.join(', ')}`);
    }

    if (params.sourceType !== 'direct') {
      throw new Error('Use recordConsolidation or recordInference for non-direct sources');
    }

    this.records.set(params.memoryId, {
      memoryId: params.memoryId,
      sourceType: 'direct',
      sessionId: params.sessionId,
      content: params.content,
      confidence: 1.0,
      mergedFrom: [],
      inferredFrom: [],
      chain: [],
      timestamp: params.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Record a consolidated memory (merged from multiple sources).
   * @param {Object} params
   * @param {string} params.memoryId
   * @param {string[]} params.mergedFrom - Source memory IDs
   * @param {string} params.sessionId
   * @param {string} params.content
   * @param {string} [params.timestamp]
   */
  recordConsolidation(params) {
    const confidence = this.getMinSourceConfidence(params.mergedFrom);
    const chain = this.buildChain(params.memoryId);

    this.records.set(params.memoryId, {
      memoryId: params.memoryId,
      sourceType: 'consolidated',
      sessionId: params.sessionId,
      content: params.content,
      confidence,
      mergedFrom: [...params.mergedFrom],
      inferredFrom: [],
      chain: [{ memoryId: params.mergedFrom[0], sourceType: 'source' }],
      timestamp: params.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Record an inferred memory (derived from existing memories with confidence decay).
   * @param {Object} params
   * @param {string} params.memoryId
   * @param {string[]} params.inferredFrom - Source memory IDs
   * @param {string} params.sessionId
   * @param {string} params.content
   * @param {string} [params.timestamp]
   */
  recordInference(params) {
    // Check chain depth for each source
    for (const srcId of params.inferredFrom) {
      const depth = this.getDepth(srcId);
      if (depth + 1 > this.maxChainDepth) {
        throw new Error(
          `Max chain depth (${this.maxChainDepth}) exceeded. ` +
          `Source "${srcId}" is already at depth ${depth}. Chain too deep.`
        );
      }
    }

    const minSourceConf = this.getMinSourceConfidence(params.inferredFrom);
    const confidence = minSourceConf * this.decayFactor;

    // Build chain entries
    const chainEntries = [];
    for (const srcId of params.inferredFrom) {
      const srcRec = this.records.get(srcId);
      if (srcRec) {
        chainEntries.push({ memoryId: srcId, sourceType: srcRec.sourceType });
      }
    }

    this.records.set(params.memoryId, {
      memoryId: params.memoryId,
      sourceType: 'inferred',
      sessionId: params.sessionId,
      content: params.content,
      confidence,
      mergedFrom: [],
      inferredFrom: [...params.inferredFrom],
      chain: chainEntries,
      timestamp: params.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Get provenance for a single memory.
   * @param {string} memoryId
   * @returns {ProvenanceRecord|null}
   */
  getProvenance(memoryId) {
    return this.records.get(memoryId) || null;
  }

  /**
   * Reconstruct the full provenance chain from origin to the given memory.
   * @param {string} memoryId
   * @returns {ProvenanceRecord[]}
   */
  getFullChain(memoryId) {
    const record = this.records.get(memoryId);
    if (!record) return [];

    if (record.sourceType === 'direct') {
      return [record];
    }

    const sources = record.inferredFrom.length > 0
      ? record.inferredFrom
      : record.mergedFrom;

    if (sources.length === 0) return [record];

    // Follow the primary source (first in list) for linear chain
    const parentChain = this.getFullChain(sources[0]);
    return [...parentChain, record];
  }
}

module.exports = { ProvenanceTracker };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-provenance.cjs`
Expected: All 10 tests PASS

**Step 5: Commit**

```
git add core/provenance-tracker.cjs tests/test-provenance.cjs
git commit -m "feat(I9): ProvenanceTracker — source chain tracking with confidence decay for inferred memories"
```

---

### Task 22: User Notification System (I10)

**Files:**
- Modify: `hooks/injection-formatter.cjs`
- Test: add to `tests/test-hooks.cjs`

**Step 1: Write the failing test**

Append these tests to `tests/test-hooks.cjs`. They test the new `NotificationBuilder` class exported from `hooks/injection-formatter.cjs`.

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-notifications-' + Date.now());

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

async function main() {
  console.log('\nNotificationBuilder Tests\n');
  setup();
  let passed = 0;
  let failed = 0;

  const { NotificationBuilder } = require('../hooks/injection-formatter.cjs');

  // --- Test 1: [NEW] appears for new topics ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addNewTopic('git-workflow');
    builder.addNewTopic('docker-setup');

    const output = builder.render();

    if (test('[NEW] appears for new topics', () => {
      assert.ok(output.includes('[NEW]'), 'should contain [NEW] tag');
      assert.ok(output.includes('git-workflow'), 'should mention new topic name');
      assert.ok(output.includes('docker-setup'), 'should mention new topic name');
    })) passed++; else failed++;
  })();

  // --- Test 2: [STALE] appears for stale topics ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addStaleTopic('old-patterns', 120);

    const output = builder.render();

    if (test('[STALE] appears for stale topics', () => {
      assert.ok(output.includes('[STALE]'), 'should contain [STALE] tag');
      assert.ok(output.includes('old-patterns'), 'should mention stale topic name');
    })) passed++; else failed++;
  })();

  // --- Test 3: [SYNC] appears for synced changes ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addSyncEvent('3 topics updated from global');

    const output = builder.render();

    if (test('[SYNC] appears for synced changes', () => {
      assert.ok(output.includes('[SYNC]'), 'should contain [SYNC] tag');
      assert.ok(output.includes('3 topics'), 'should mention sync details');
    })) passed++; else failed++;
  })();

  // --- Test 4: No section when nothing happened ---
  (function () {
    const builder = new NotificationBuilder();

    const output = builder.render();

    if (test('no section when nothing happened', () => {
      assert.strictEqual(output, '', 'should return empty string when no notifications');
    })) passed++; else failed++;
  })();

  // --- Test 5: Multiple notifications combined ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addNewTopic('api-patterns');
    builder.addStaleTopic('legacy-code', 150);
    builder.addSyncEvent('2 topics synced');

    const output = builder.render();

    if (test('multiple notifications combined', () => {
      assert.ok(output.includes('[NEW]'), 'should have NEW');
      assert.ok(output.includes('[STALE]'), 'should have STALE');
      assert.ok(output.includes('[SYNC]'), 'should have SYNC');
      assert.ok(output.includes('api-patterns'), 'should include new topic');
      assert.ok(output.includes('legacy-code'), 'should include stale topic');
    })) passed++; else failed++;
  })();

  // --- Test 6: Formatting consistent — uses consistent line format ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addNewTopic('test-topic');

    const output = builder.render();
    const lines = output.split('\n').filter(l => l.trim());

    if (test('formatting consistent — uses consistent line format', () => {
      // Should have a header line and at least one notification line
      assert.ok(lines.length >= 1, 'should have at least 1 line');
      // Each notification line should start with a tag in brackets
      const notifLines = lines.filter(l => l.includes('[NEW]') || l.includes('[STALE]') || l.includes('[SYNC]'));
      assert.ok(notifLines.length >= 1, 'should have at least 1 notification line');
    })) passed++; else failed++;
  })();

  // --- Test 7: Multiple new topics are listed ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addNewTopic('topic-a');
    builder.addNewTopic('topic-b');
    builder.addNewTopic('topic-c');

    const output = builder.render();

    if (test('multiple new topics are listed', () => {
      assert.ok(output.includes('topic-a'), 'should list topic-a');
      assert.ok(output.includes('topic-b'), 'should list topic-b');
      assert.ok(output.includes('topic-c'), 'should list topic-c');
    })) passed++; else failed++;
  })();

  // --- Test 8: Stale topic includes days count ---
  (function () {
    const builder = new NotificationBuilder();

    builder.addStaleTopic('ancient-topic', 200);

    const output = builder.render();

    if (test('stale topic includes days count', () => {
      assert.ok(output.includes('200'), 'should include days count');
    })) passed++; else failed++;
  })();

  // --- Test 9: render returns string type always ---
  (function () {
    const builder = new NotificationBuilder();

    if (test('render returns string type always', () => {
      assert.strictEqual(typeof builder.render(), 'string');
      builder.addNewTopic('x');
      assert.strictEqual(typeof builder.render(), 'string');
    })) passed++; else failed++;
  })();

  // --- Test 10: hasNotifications reflects actual state ---
  (function () {
    const builder = new NotificationBuilder();

    if (test('hasNotifications reflects actual state', () => {
      assert.strictEqual(builder.hasNotifications(), false, 'initially no notifications');
      builder.addNewTopic('something');
      assert.strictEqual(builder.hasNotifications(), true, 'after adding: has notifications');
    })) passed++; else failed++;
  })();

  // --- Summary ---
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-hooks.cjs`
Expected: FAIL — `NotificationBuilder is not a constructor` or not exported

**Step 3: Write minimal implementation**

Add the following `NotificationBuilder` class to `hooks/injection-formatter.cjs` and include it in the module exports.

```javascript
// --- ADDITION to hooks/injection-formatter.cjs ---
// Add this class and export it alongside InjectionFormatter:
// module.exports = { InjectionFormatter, NotificationBuilder };

/**
 * NotificationBuilder — Builds a notification section for the SessionStart banner.
 *
 * Supports three notification types:
 *   [NEW]   — New topic files created since last session
 *   [STALE] — Topics that haven't been accessed in 90+ days
 *   [SYNC]  — Changes synced from global/cross-project sources
 *
 * When no notifications exist, render() returns an empty string (no section added).
 */
class NotificationBuilder {
  constructor() {
    /** @type {Array<{tag: string, message: string}>} */
    this.notifications = [];
  }

  /**
   * Add a notification for a newly created topic.
   * @param {string} topicName
   */
  addNewTopic(topicName) {
    this.notifications.push({
      tag: '[NEW]',
      message: `Topic created: ${topicName}`,
    });
  }

  /**
   * Add a notification for a stale topic.
   * @param {string} topicName
   * @param {number} daysSinceAccess
   */
  addStaleTopic(topicName, daysSinceAccess) {
    this.notifications.push({
      tag: '[STALE]',
      message: `${topicName} — ${daysSinceAccess} days since last access`,
    });
  }

  /**
   * Add a notification for a sync event.
   * @param {string} details - Description of what was synced
   */
  addSyncEvent(details) {
    this.notifications.push({
      tag: '[SYNC]',
      message: details,
    });
  }

  /**
   * Check if there are any pending notifications.
   * @returns {boolean}
   */
  hasNotifications() {
    return this.notifications.length > 0;
  }

  /**
   * Render the notification section.
   * Returns empty string if no notifications exist.
   * @returns {string}
   */
  render() {
    if (this.notifications.length === 0) return '';

    const lines = [];
    lines.push('  Notifications:');

    for (const notif of this.notifications) {
      lines.push(`    ${notif.tag} ${notif.message}`);
    }

    return lines.join('\n');
  }
}

// Export alongside existing exports:
// module.exports = { InjectionFormatter, NotificationBuilder };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-hooks.cjs`
Expected: All 10 tests PASS

**Step 5: Commit**

```
git add hooks/injection-formatter.cjs tests/test-hooks.cjs
git commit -m "feat(I10): NotificationBuilder — [NEW]/[STALE]/[SYNC] notifications in SessionStart banner"
```

---

## Phase I Summary

| Task | ID | Module | Tests | Purpose |
|------|----|--------|-------|---------|
| 13 | I1 | `core/topic-router.cjs` | 10 | Auto-categorize memories to topic files via Jaccard similarity |
| 14 | I2 | `core/breakthrough-detector.cjs` | 10 | Detect recurring patterns, solution evolution, architectural insights |
| 15 | I3 | `core/importance-scorer.cjs` | 10 | 5-dimension weighted importance scoring |
| 16 | I4 | `core/topic-lifecycle.cjs` | 10 | Fresh/aging/stale/archive lifecycle states with access reset |
| 17 | I5 | `adapters/markdown-topic-adapter.cjs` | 10 | Cross-project memory sharing with project/global priority |
| 18 | I6 | `core/lads/index.cjs` | 10 | Hook topic events into LADS Learnable/Adaptive/Documenting/Self-improving |
| 19 | I7 | `core/topic-health-renderer.cjs` | 10 | ASCII health display with proportional bar charts |
| 20 | I8 | `core/memory-exporter.cjs` | 10 | Export tool: json/markdown/jsonl with scope filtering |
| 21 | I9 | `core/provenance-tracker.cjs` | 10 | Source chain tracking with 0.9^hop confidence decay |
| 22 | I10 | `hooks/injection-formatter.cjs` | 10 | [NEW]/[STALE]/[SYNC] banner notifications |

**Total Phase I: 10 tasks, 100 tests, 8 new files, 3 modified files**

**Dependencies within Phase I:**
- Task 19 (TopicHealthRenderer) depends on Task 16 (TopicLifecycle) for status data
- Task 22 (NotificationBuilder) depends on Task 16 (TopicLifecycle) for stale detection
- Task 17 (Cross-Project) is independent but enhances Task 20 (Export) scope filtering
- All other tasks are independent and can be implemented in parallel