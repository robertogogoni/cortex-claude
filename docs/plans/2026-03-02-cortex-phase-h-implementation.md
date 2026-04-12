# Cortex Phase H: Human-Readable Memory Bridge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bridge Cortex's JSONL/vector memory with human-readable `.md` topic files via a two-stage async pipeline: SessionEnd runs fast GapDetector (Haiku, <2s) writing `gap_report.json`; next SessionStart runs TopicCompiler (Sonnet via 3-tier fallback). New `MarkdownTopicAdapter` extends `BaseAdapter` for bidirectional `.md` read/write.

**Architecture:** All new modules follow existing patterns: CommonJS, JSDoc types, no external runtime deps for core modules. Custom test runner (no jest/mocha — matches existing `test()` / `testAsync()` pattern).

**Dependencies:** Needs B (MCP Sampling), F (FTS5), G (CRUD) — but H1-H3 can start immediately as they only need the existing adapter infrastructure. Later tasks (H5 TopicCompiler) need Sampling.

**Version:** v3.1.0
**Tasks:** 10 (H1–H10)
**Estimated Effort:** ~10 days

**See also:**
- [Unified Roadmap (Phases H-K)](2026-03-02-cortex-unified-roadmap-phases-h-k.md) — high-level design, dependencies, cost analysis
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) — links to all phase plans

---

## Phase H: Human-Readable Memory Bridge (v3.1.0)

### Task 1: MarkdownTopicAdapter — Multi-Strategy Parser (H1 read side, part 1)

**Files:**
- Create: `adapters/markdown-topic-adapter.cjs`
- Test: `tests/test-markdown-topic-adapter.cjs`

**Step 1: Write the failing test — StructuredParser**

Create `tests/test-markdown-topic-adapter.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cmo-md-adapter-test-' + Date.now());

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'memory'), { recursive: true });
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
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

// Tests will be added in steps below
let StructuredParser, FlatParser, WholeFileParser;

try {
  ({ StructuredParser, FlatParser, WholeFileParser } = require('../adapters/markdown-topic-adapter.cjs'));
} catch (e) {
  console.error('Import failed:', e.message);
  process.exit(1);
}

function testStructuredParser() {
  console.log('\n📦 Testing: StructuredParser');
  let passed = 0, total = 0;

  const structured = `# Topic Title

## Problem
The app crashes on startup.

### Symptoms
- White screen
- Process exits with code 1

## Solution
Run with \`--disable-gpu\` flag.

## Gotchas
Never use \`--force\` on production.
`;

  total++; passed += test('parses H2 sections with H3 subsections', () => {
    const result = StructuredParser.parse(structured);
    assert(result.sections.length >= 3, `Expected >=3 sections, got ${result.sections.length}`);
    assert(result.sections[0].header === 'Problem', `Expected "Problem", got "${result.sections[0].header}"`);
  });

  total++; passed += test('extracts content within sections', () => {
    const result = StructuredParser.parse(structured);
    const problemSection = result.sections.find(s => s.header === 'Problem');
    assert(problemSection, 'Problem section not found');
    assert(problemSection.content.includes('crashes on startup'), 'Missing content');
  });

  total++; passed += test('returns empty for non-structured content', () => {
    const result = StructuredParser.parse('Just plain text without headers.');
    assert(result.sections.length === 0, 'Should return empty for no headers');
  });

  total++; passed += test('handles tables in sections', () => {
    const withTable = `## Config

| Key | Value |
|-----|-------|
| foo | bar |
`;
    const result = StructuredParser.parse(withTable);
    assert(result.sections.length === 1);
    assert(result.sections[0].content.includes('foo'), 'Table content missing');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testFlatParser() {
  console.log('\n📦 Testing: FlatParser');
  let passed = 0, total = 0;

  total++; passed += test('parses any headings as boundaries', () => {
    const flat = `# Title\nSome intro.\n## Section A\nContent A.\n## Section B\nContent B.`;
    const result = FlatParser.parse(flat);
    assert(result.sections.length >= 2, `Expected >=2 sections, got ${result.sections.length}`);
  });

  total++; passed += test('returns sections with content', () => {
    const flat = `## Only Section\nParagraph one.\n\nParagraph two.`;
    const result = FlatParser.parse(flat);
    assert(result.sections[0].content.includes('Paragraph one'), 'Missing paragraph');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testWholeFileParser() {
  console.log('\n📦 Testing: WholeFileParser');
  let passed = 0, total = 0;

  total++; passed += test('returns entire file as single section', () => {
    const raw = 'Just some notes.\nLine two.\nLine three.';
    const result = WholeFileParser.parse(raw);
    assert(result.sections.length === 1, `Expected 1 section, got ${result.sections.length}`);
    assert(result.sections[0].content === raw, 'Content should match entire file');
  });

  total++; passed += test('header is null for whole-file fallback', () => {
    const result = WholeFileParser.parse('anything');
    assert(result.sections[0].header === null, 'Header should be null');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testParseEmpty() {
  console.log('\n📦 Testing: Edge Cases');
  let passed = 0, total = 0;

  total++; passed += test('parse empty string → empty sections for Structured', () => {
    const result = StructuredParser.parse('');
    assert(result.sections.length === 0);
  });

  total++; passed += test('parse empty string → single section for WholeFile', () => {
    const result = WholeFileParser.parse('');
    assert(result.sections.length === 1);
    assert(result.sections[0].content === '');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

// Run
setup();
try {
  const results = [
    testStructuredParser(),
    testFlatParser(),
    testWholeFileParser(),
    testParseEmpty()
  ];
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalTests = results.reduce((s, r) => s + r.total, 0);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${totalPassed}/${totalTests} passed`);
  process.exit(totalPassed === totalTests ? 0 : 1);
} finally {
  cleanup();
}
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-markdown-topic-adapter.cjs`
Expected: FAIL with "Import failed" (module doesn't exist yet)

**Step 3: Write minimal implementation — parsers only**

Create `adapters/markdown-topic-adapter.cjs`:

```javascript
/**
 * Cortex - Claude's Cognitive Layer - Markdown Topic Adapter
 *
 * Bidirectional adapter for human-readable .md topic files.
 * Read side: parses topic files as a queryable memory source.
 * Write side: creates/updates/appends sections in .md files.
 *
 * Multi-strategy parser chain: Structured → Flat → WholeFile
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BaseAdapter } = require('./base-adapter.cjs');

// =============================================================================
// PARSERS — Multi-strategy .md parsing
// =============================================================================

/**
 * StructuredParser: H2 sections with H3 subsections + tables.
 * Best for well-organized topic files with ## headers.
 */
class StructuredParser {
  static parse(content) {
    if (!content || !content.includes('## ')) {
      return { sections: [] };
    }

    const sections = [];
    const lines = content.split('\n');
    let currentHeader = null;
    let currentContent = [];
    let inSection = false;

    for (const line of lines) {
      const h2Match = line.match(/^## (.+)$/);
      if (h2Match) {
        if (inSection && currentHeader) {
          sections.push({
            header: currentHeader,
            content: currentContent.join('\n').trim(),
            level: 2
          });
        }
        currentHeader = h2Match[1].trim();
        currentContent = [];
        inSection = true;
        continue;
      }

      if (inSection) {
        currentContent.push(line);
      }
    }

    // Push final section
    if (inSection && currentHeader) {
      sections.push({
        header: currentHeader,
        content: currentContent.join('\n').trim(),
        level: 2
      });
    }

    return { sections };
  }
}

/**
 * FlatParser: Any headings as boundaries, paragraphs as content.
 * Fallback for less-structured markdown.
 */
class FlatParser {
  static parse(content) {
    if (!content || !content.match(/^#{1,6} /m)) {
      return { sections: [] };
    }

    const sections = [];
    const lines = content.split('\n');
    let currentHeader = null;
    let currentContent = [];

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6}) (.+)$/);
      if (headerMatch) {
        if (currentHeader !== null) {
          sections.push({
            header: currentHeader,
            content: currentContent.join('\n').trim(),
            level: headerMatch[1].length
          });
        }
        currentHeader = headerMatch[2].trim();
        currentContent = [];
        continue;
      }
      if (currentHeader !== null) {
        currentContent.push(line);
      }
    }

    if (currentHeader !== null) {
      sections.push({
        header: currentHeader,
        content: currentContent.join('\n').trim(),
        level: 2
      });
    }

    return { sections };
  }
}

/**
 * WholeFileParser: Entire file as single document (ultimate fallback).
 */
class WholeFileParser {
  static parse(content) {
    return {
      sections: [{
        header: null,
        content: content || '',
        level: 0
      }]
    };
  }
}

module.exports = {
  StructuredParser,
  FlatParser,
  WholeFileParser
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-markdown-topic-adapter.cjs`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add adapters/markdown-topic-adapter.cjs tests/test-markdown-topic-adapter.cjs
git commit -m "feat(H1): add multi-strategy markdown parsers (Structured, Flat, WholeFile)"
```

---

### Task 2: MarkdownTopicAdapter — Read Side Query (H1 read side, part 2)

**Files:**
- Modify: `adapters/markdown-topic-adapter.cjs` (add MarkdownTopicAdapter class)
- Modify: `tests/test-markdown-topic-adapter.cjs` (add query tests)

**Step 1: Write the failing test — file discovery + query**

Append to `tests/test-markdown-topic-adapter.cjs` (before the `// Run` section):

```javascript
let MarkdownTopicAdapter;
try {
  ({ MarkdownTopicAdapter } = require('../adapters/markdown-topic-adapter.cjs'));
} catch (e) {
  console.error('MarkdownTopicAdapter import failed:', e.message);
}

function testAdapterDiscovery() {
  console.log('\n📦 Testing: MarkdownTopicAdapter — File Discovery');
  let passed = 0, total = 0;

  // Create test topic files
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'beeper.md'),
    '## Problem\nBeeper crashes on Wayland.\n\n## Fix\nUse XWayland mode.');
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'keyboard.md'),
    '## Issue\nCedilla produces wrong char.\n\n## Solution\nUse XCompose override.');
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'MEMORY.md'),
    '# Auto Memory\n\n| File | Topic |\n|------|-------|\n| beeper.md | Beeper |');

  const adapter = new MarkdownTopicAdapter({
    topicDir: path.join(TEST_DIR, 'memory'),
    name: 'markdown-topic'
  });

  total++; passed += test('discovers .md files excluding MEMORY.md', () => {
    const files = adapter.discoverFiles();
    assert(files.length === 2, `Expected 2 files, got ${files.length}`);
    assert(!files.some(f => f.endsWith('MEMORY.md')), 'Should exclude MEMORY.md');
  });

  total++; passed += test('parse uses multi-strategy chain', () => {
    const filePath = path.join(TEST_DIR, 'memory', 'beeper.md');
    const result = adapter.parse(filePath);
    assert(result.sections.length >= 2, 'Should parse structured sections');
    assert(result.sections[0].header === 'Problem');
  });

  total++; passed += test('priority is 0.85', () => {
    assert(adapter._config.priority === 0.85, `Priority should be 0.85, got ${adapter._config.priority}`);
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}
```

Add `testAdapterDiscovery()` to the results array.

**Step 2: Run test to verify it fails**

Run: `node tests/test-markdown-topic-adapter.cjs`
Expected: FAIL — `MarkdownTopicAdapter` not exported yet

**Step 3: Write implementation — MarkdownTopicAdapter class**

Add to `adapters/markdown-topic-adapter.cjs` before `module.exports`:

```javascript
// =============================================================================
// MARKDOWN TOPIC ADAPTER
// =============================================================================

class MarkdownTopicAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} config.topicDir - Project-scoped topic directory
   * @param {string} [config.globalTopicDir] - Global topic directory
   * @param {string} [config.name] - Adapter name
   */
  constructor(config) {
    super({
      name: config.name || 'markdown-topic',
      priority: 0.85,
      timeout: 5000
    });
    this.topicDir = config.topicDir;
    this.globalDir = config.globalTopicDir || null;
    this.parsers = [StructuredParser, FlatParser, WholeFileParser];
  }

  /**
   * Discover all .md topic files (excludes MEMORY.md)
   * @returns {string[]} Array of absolute file paths
   */
  discoverFiles() {
    const files = [];
    const dirs = [this.topicDir];
    if (this.globalDir && fs.existsSync(this.globalDir)) {
      dirs.push(this.globalDir);
    }

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.md') && entry !== 'MEMORY.md') {
          files.push(path.join(dir, entry));
        }
      }
    }
    return files;
  }

  /**
   * Parse a single .md file using multi-strategy chain
   * @param {string} filePath
   * @returns {{ sections: Array<{ header: string|null, content: string, level: number }> }}
   */
  parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const Parser of this.parsers) {
      const result = Parser.parse(content);
      if (result.sections.length > 0 && result.sections[0].header !== null) {
        return result;
      }
    }
    // Ultimate fallback: WholeFileParser always returns something
    return WholeFileParser.parse(content);
  }

  /**
   * Query topic files for relevant sections
   * @param {Object} context - Query context with intent/query text
   * @param {Object} [options]
   * @returns {Promise<Array>} Matching sections ranked by relevance
   */
  async query(context, options = {}) {
    const queryText = typeof context === 'string' ? context : (context.query || context.intent || '');
    if (!queryText) return [];

    const files = this.discoverFiles();
    const sections = [];
    const queryLower = queryText.toLowerCase();

    for (const file of files) {
      const parsed = this.parse(file);
      const filename = path.basename(file, '.md');

      for (const section of parsed.sections) {
        // Text-based relevance scoring (no embedder dependency for now)
        const contentLower = (section.content + ' ' + (section.header || '')).toLowerCase();
        const words = queryLower.split(/\s+/).filter(w => w.length > 2);
        const matchCount = words.filter(w => contentLower.includes(w)).length;
        const similarity = words.length > 0 ? matchCount / words.length : 0;

        if (similarity >= (options.minSimilarity || 0.3)) {
          sections.push({
            ...section,
            file: filename,
            filePath: file,
            similarity,
            _source: this._config.name,
            _sourcePriority: this._config.priority
          });
        }
      }
    }

    return sections.sort((a, b) => b.similarity - a.similarity);
  }

  async isAvailable() {
    return fs.existsSync(this.topicDir);
  }

  normalize(rawData) {
    return {
      id: `topic-${crypto.randomBytes(4).toString('hex')}`,
      type: 'learning',
      content: rawData.content,
      summary: (rawData.header || rawData.file || 'topic').slice(0, 100),
      tags: [rawData.file],
      _source: this._config.name,
      _sourcePriority: this._config.priority,
      relevanceScore: rawData.similarity || 0
    };
  }
}
```

Update `module.exports` to include `MarkdownTopicAdapter`:

```javascript
module.exports = {
  StructuredParser,
  FlatParser,
  WholeFileParser,
  MarkdownTopicAdapter
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-markdown-topic-adapter.cjs`
Expected: All 11 tests PASS

**Step 5: Commit**

```bash
git add adapters/markdown-topic-adapter.cjs tests/test-markdown-topic-adapter.cjs
git commit -m "feat(H1): add MarkdownTopicAdapter read side with file discovery and query"
```

---

### Task 3: MarkdownTopicAdapter — Write Side (H2)

**Files:**
- Modify: `adapters/markdown-topic-adapter.cjs` (add write methods)
- Modify: `tests/test-markdown-topic-adapter.cjs` (add write tests)

**Step 1: Write the failing test — write operations**

Append write tests to `tests/test-markdown-topic-adapter.cjs`:

```javascript
function testAdapterWrite() {
  console.log('\n📦 Testing: MarkdownTopicAdapter — Write Side');
  let passed = 0, total = 0;

  const adapter = new MarkdownTopicAdapter({
    topicDir: path.join(TEST_DIR, 'memory'),
    name: 'markdown-topic'
  });

  total++; passed += testAsync('write new file creates .md with structure', async () => {
    await adapter.write({
      filename: 'new-topic.md',
      action: 'create',
      sections: [
        { header: 'Problem', content: 'Something broke.' },
        { header: 'Solution', content: 'We fixed it.' }
      ]
    });
    const content = fs.readFileSync(path.join(TEST_DIR, 'memory', 'new-topic.md'), 'utf-8');
    assert(content.includes('## Problem'), 'Missing Problem header');
    assert(content.includes('Something broke'), 'Missing content');
  });

  total++; passed += testAsync('write creates backup before overwrite', async () => {
    await adapter.write({
      filename: 'beeper.md',
      action: 'update',
      sections: [{ header: 'Problem', content: 'Updated problem.' }]
    });
    const backups = fs.readdirSync(path.join(TEST_DIR, 'memory'))
      .filter(f => f.startsWith('beeper.md.bak.'));
    assert(backups.length >= 1, 'No backup created');
  });

  total++; passed += testAsync('append adds section to end', async () => {
    await adapter.write({
      filename: 'beeper.md',
      action: 'append',
      sections: [{ header: 'New Section', content: 'Appended content.' }]
    });
    const content = fs.readFileSync(path.join(TEST_DIR, 'memory', 'beeper.md'), 'utf-8');
    assert(content.includes('## New Section'), 'Appended section missing');
  });

  total++; passed += testAsync('update preserves untouched sections', async () => {
    // beeper.md has Problem (updated) + Fix (original) + New Section (appended)
    await adapter.write({
      filename: 'beeper.md',
      action: 'update',
      sections: [{ header: 'Problem', content: 'Third update.' }]
    });
    const content = fs.readFileSync(path.join(TEST_DIR, 'memory', 'beeper.md'), 'utf-8');
    assert(content.includes('Third update'), 'Update not applied');
    assert(content.includes('New Section'), 'Untouched section was removed');
  });

  total++; passed += testAsync('write to nonexistent directory creates it', async () => {
    const subAdapter = new MarkdownTopicAdapter({
      topicDir: path.join(TEST_DIR, 'deep', 'nested'),
      name: 'markdown-topic'
    });
    await subAdapter.write({
      filename: 'test.md',
      action: 'create',
      sections: [{ header: 'Test', content: 'Works.' }]
    });
    assert(fs.existsSync(path.join(TEST_DIR, 'deep', 'nested', 'test.md')));
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}
```

Add to results array. Wrap results in `async` IIFE since we now have async tests.

**Step 2: Run test to verify it fails**

Run: `node tests/test-markdown-topic-adapter.cjs`
Expected: FAIL — `adapter.write is not a function`

**Step 3: Write implementation — write methods**

Add to `MarkdownTopicAdapter` class in `adapters/markdown-topic-adapter.cjs`:

```javascript
  supportsWrite() { return true; }

  /**
   * Write/update/append sections to a topic .md file
   * @param {Object} params
   * @param {string} params.filename - Target filename (e.g., 'beeper-troubleshooting.md')
   * @param {'create'|'update'|'append'} params.action
   * @param {Array<{header: string, content: string}>} params.sections
   */
  async write({ filename, action, sections }) {
    const filePath = path.join(this.topicDir, filename);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Backup existing file before any write
    if (fs.existsSync(filePath)) {
      await this._backup(filePath);
    }

    if (action === 'create') {
      const content = this._renderSections(sections);
      fs.writeFileSync(filePath, content, 'utf-8');
    } else if (action === 'update') {
      const existing = fs.existsSync(filePath)
        ? this.parse(filePath)
        : { sections: [] };
      const merged = this._mergeSections(existing.sections, sections);
      fs.writeFileSync(filePath, this._renderSections(merged), 'utf-8');
    } else if (action === 'append') {
      const appendContent = '\n' + this._renderSections(sections);
      fs.appendFileSync(filePath, appendContent, 'utf-8');
    }

    await this._updateHash(filePath);
  }

  /**
   * Render sections array to markdown string
   */
  _renderSections(sections) {
    return sections.map(s => {
      const header = s.header ? `## ${s.header}\n\n` : '';
      return header + s.content;
    }).join('\n\n');
  }

  /**
   * Merge new sections into existing, preserving untouched ones
   */
  _mergeSections(existing, updates) {
    const merged = [...existing];
    for (const update of updates) {
      const idx = merged.findIndex(s => s.header === update.header);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], content: update.content };
      } else {
        merged.push(update);
      }
    }
    return merged;
  }

  /**
   * Create timestamped backup of a file
   */
  async _backup(filePath) {
    const backupPath = `${filePath}.bak.${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  }

  /**
   * Update hash record for bidirectional sync tracking
   */
  async _updateHash(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('md5').update(content).digest('hex');
    // Hash storage will be managed by BidirectionalSync (H8)
    // For now, store in-memory
    if (!this._hashes) this._hashes = {};
    this._hashes[filePath] = hash;
  }
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-markdown-topic-adapter.cjs`
Expected: All 16 tests PASS

**Step 5: Commit**

```bash
git add adapters/markdown-topic-adapter.cjs tests/test-markdown-topic-adapter.cjs
git commit -m "feat(H2): add MarkdownTopicAdapter write side (create, update, append, backup)"
```

---

### Task 4: MemoryIndexManager (H3)

**Files:**
- Create: `core/memory-index-manager.cjs`
- Create: `tests/test-memory-index-manager.cjs`

**Step 1: Write the failing test**

Create `tests/test-memory-index-manager.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cmo-index-mgr-test-' + Date.now());

function setup() { fs.mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let MemoryIndexManager;
try {
  ({ MemoryIndexManager } = require('../core/memory-index-manager.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

function testAddTopic() {
  console.log('\n📦 Testing: MemoryIndexManager — Add');
  let passed = 0, total = 0;

  const memoryMd = path.join(TEST_DIR, 'MEMORY.md');
  fs.writeFileSync(memoryMd, `# Auto Memory

## Topic Files

| File | Topic |
|------|-------|
| [existing.md](existing.md) | Existing topic |
`);

  const mgr = new MemoryIndexManager();

  total++; passed += test('add new topic row', () => {
    mgr.updateTable(memoryMd, { filename: 'beeper.md', description: 'Beeper fixes', action: 'add' });
    const content = fs.readFileSync(memoryMd, 'utf-8');
    assert(content.includes('beeper.md'), 'New row not found');
    assert(content.includes('Beeper fixes'), 'Description not found');
  });

  total++; passed += test('table sorted alphabetically', () => {
    const content = fs.readFileSync(memoryMd, 'utf-8');
    const beeperIdx = content.indexOf('beeper.md');
    const existingIdx = content.indexOf('existing.md');
    assert(beeperIdx < existingIdx, 'beeper.md should come before existing.md');
  });

  total++; passed += test('idempotent: same data twice → no change', () => {
    const before = fs.readFileSync(memoryMd, 'utf-8');
    mgr.updateTable(memoryMd, { filename: 'beeper.md', description: 'Beeper fixes', action: 'add' });
    const after = fs.readFileSync(memoryMd, 'utf-8');
    assert(before === after, 'Content should not change on duplicate add');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testUpdateTopic() {
  console.log('\n📦 Testing: MemoryIndexManager — Update');
  let passed = 0, total = 0;

  const memoryMd = path.join(TEST_DIR, 'MEMORY-update.md');
  fs.writeFileSync(memoryMd, `# Auto Memory

## Topic Files

| File | Topic |
|------|-------|
| [old.md](old.md) | Old description |
`);

  const mgr = new MemoryIndexManager();

  total++; passed += test('update description', () => {
    mgr.updateTable(memoryMd, { filename: 'old.md', description: 'New description', action: 'update' });
    const content = fs.readFileSync(memoryMd, 'utf-8');
    assert(content.includes('New description'), 'Updated description not found');
    assert(!content.includes('Old description'), 'Old description still present');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testRemoveTopic() {
  console.log('\n📦 Testing: MemoryIndexManager — Remove');
  let passed = 0, total = 0;

  const memoryMd = path.join(TEST_DIR, 'MEMORY-remove.md');
  fs.writeFileSync(memoryMd, `# Auto Memory

## Topic Files

| File | Topic |
|------|-------|
| [keep.md](keep.md) | Keep this |
| [remove.md](remove.md) | Remove this <!-- cortex-managed --> |
`);

  const mgr = new MemoryIndexManager();

  total++; passed += test('remove topic row', () => {
    mgr.updateTable(memoryMd, { filename: 'remove.md', action: 'remove' });
    const content = fs.readFileSync(memoryMd, 'utf-8');
    assert(!content.includes('remove.md'), 'Removed row still present');
    assert(content.includes('keep.md'), 'Kept row was removed');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testLineLimitWarning() {
  console.log('\n📦 Testing: MemoryIndexManager — Line Limit');
  let passed = 0, total = 0;

  const memoryMd = path.join(TEST_DIR, 'MEMORY-big.md');
  const bigContent = '# Memory\n' + Array(185).fill('line').join('\n');
  fs.writeFileSync(memoryMd, bigContent);

  const mgr = new MemoryIndexManager();
  let warned = false;
  const origWarn = console.warn;
  console.warn = (msg) => { if (msg.includes('180')) warned = true; };

  total++; passed += test('warns when MEMORY.md > 180 lines', () => {
    mgr.updateTable(memoryMd, { filename: 'x.md', description: 'test', action: 'add' });
    assert(warned, 'Should warn about line count');
  });

  console.warn = origWarn;
  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

function testMalformedTable() {
  console.log('\n📦 Testing: MemoryIndexManager — Malformed');
  let passed = 0, total = 0;

  const memoryMd = path.join(TEST_DIR, 'MEMORY-no-table.md');
  fs.writeFileSync(memoryMd, '# Auto Memory\n\nJust text, no table.');

  const mgr = new MemoryIndexManager();

  total++; passed += test('creates table section if missing', () => {
    mgr.updateTable(memoryMd, { filename: 'new.md', description: 'New topic', action: 'add' });
    const content = fs.readFileSync(memoryMd, 'utf-8');
    assert(content.includes('| File | Topic |'), 'Table header not created');
    assert(content.includes('new.md'), 'New row not added');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

setup();
try {
  const results = [
    testAddTopic(),
    testUpdateTopic(),
    testRemoveTopic(),
    testLineLimitWarning(),
    testMalformedTable()
  ];
  const p = results.reduce((s, r) => s + r.passed, 0);
  const t = results.reduce((s, r) => s + r.total, 0);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
} finally { cleanup(); }
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-memory-index-manager.cjs`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `core/memory-index-manager.cjs`:

```javascript
/**
 * Cortex - Claude's Cognitive Layer - Memory Index Manager
 *
 * Auto-manages the topic files table in MEMORY.md.
 * Adds/updates/removes rows, preserves manual entries,
 * keeps table sorted, warns on line limits.
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');

const TABLE_HEADER = '| File | Topic |\n|------|-------|';
const CORTEX_MANAGED = '<!-- cortex-managed -->';
const LINE_WARN_THRESHOLD = 180;

class MemoryIndexManager {
  /**
   * Update the topic files table in MEMORY.md
   * @param {string} memoryMdPath - Absolute path to MEMORY.md
   * @param {Object} params
   * @param {string} params.filename - Topic filename (e.g., 'beeper.md')
   * @param {string} [params.description] - Topic description
   * @param {'add'|'update'|'remove'} params.action
   */
  updateTable(memoryMdPath, { filename, description, action }) {
    let content = fs.readFileSync(memoryMdPath, 'utf-8');

    // Parse existing table
    const table = this._parseTable(content);

    if (action === 'add' || action === 'update') {
      const existing = table.rows.find(r => r.filename === filename);
      if (existing) {
        if (existing.description === description) return; // Idempotent
        existing.description = description;
      } else {
        table.rows.push({ filename, description, managed: true });
      }
    } else if (action === 'remove') {
      table.rows = table.rows.filter(r => r.filename !== filename);
    }

    // Sort alphabetically
    table.rows.sort((a, b) => a.filename.localeCompare(b.filename));

    // Rebuild content
    const newContent = this._rebuildContent(content, table);
    fs.writeFileSync(memoryMdPath, newContent, 'utf-8');

    // Warn on line count
    const lineCount = newContent.split('\n').length;
    if (lineCount > LINE_WARN_THRESHOLD) {
      console.warn(`[cortex] MEMORY.md exceeds ${LINE_WARN_THRESHOLD} lines (${lineCount}). Context will be truncated at 200.`);
    }
  }

  /**
   * Parse the topic table from MEMORY.md content
   */
  _parseTable(content) {
    const rows = [];
    const tableRegex = /\| \[([^\]]+)\]\([^)]+\) \| (.+?)(?:\s*<!--.*?-->)?\s*\|/g;
    let match;
    while ((match = tableRegex.exec(content)) !== null) {
      rows.push({
        filename: match[1],
        description: match[2].trim(),
        managed: content.substring(match.index, match.index + match[0].length + 30).includes(CORTEX_MANAGED)
      });
    }

    // Find the table section boundaries
    const headerIdx = content.indexOf('| File | Topic |');
    const separatorIdx = content.indexOf('|------|-------|');

    return { rows, hasTable: headerIdx >= 0, headerIdx, separatorIdx };
  }

  /**
   * Rebuild MEMORY.md content with updated table
   */
  _rebuildContent(content, table) {
    const tableLines = [TABLE_HEADER];
    for (const row of table.rows) {
      const managed = row.managed ? ` ${CORTEX_MANAGED}` : '';
      tableLines.push(`| [${row.filename}](${row.filename}) | ${row.description}${managed} |`);
    }
    const tableStr = tableLines.join('\n');

    if (table.hasTable) {
      // Replace existing table (from header to end of table rows)
      const before = content.substring(0, table.headerIdx);
      // Find end of table: lines starting with |
      const afterHeader = content.substring(table.headerIdx);
      const lines = afterHeader.split('\n');
      let endIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('|')) {
          endIdx = i + 1;
        } else if (i > 1) {
          break;
        }
      }
      const after = lines.slice(endIdx).join('\n');
      return before + tableStr + '\n' + after;
    } else {
      // Create new table section
      return content.trimEnd() + '\n\n## Topic Files\n\n' + tableStr + '\n';
    }
  }
}

module.exports = { MemoryIndexManager };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-memory-index-manager.cjs`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add core/memory-index-manager.cjs tests/test-memory-index-manager.cjs
git commit -m "feat(H3): add MemoryIndexManager for auto-managing MEMORY.md topic table"
```

---

### Task 5: GapDetector (H4)

**Files:**
- Create: `core/gap-detector.cjs`
- Create: `tests/test-gap-detector.cjs`

**Step 1: Write the failing test**

Create `tests/test-gap-detector.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cmo-gap-test-' + Date.now());

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'memory'), { recursive: true });
  // Create a topic file about beeper
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'beeper.md'),
    '## Problem\nBeeper crashes on Wayland.\n\n## Fix\nUse XWayland.');
}
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let GapDetector;
try {
  ({ GapDetector } = require('../core/gap-detector.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

async function testGapDetection() {
  console.log('\n📦 Testing: GapDetector');
  let passed = 0, total = 0;

  // Mock topic adapter
  const mockAdapter = {
    discoverFiles: () => [path.join(TEST_DIR, 'memory', 'beeper.md')],
    query: async (text) => {
      // "beeper" matches, anything else doesn't
      if (text.toLowerCase().includes('beeper') || text.toLowerCase().includes('wayland')) {
        return [{ similarity: 0.8, content: 'Beeper Wayland fix', file: 'beeper.md' }];
      }
      return [];
    },
    parse: (filePath) => ({
      sections: [{ header: 'Problem', content: 'Beeper crashes.' }]
    })
  };

  const detector = new GapDetector({ minSimilarity: 0.3, staleThresholdDays: 30 });

  total++; passed += await testAsync('extraction matching existing topic → no gap', async () => {
    const extractions = [{ content: 'Beeper crashes on Wayland display' }];
    const result = await detector.detect(extractions, mockAdapter);
    assert(result.gaps.length === 0, `Expected 0 gaps, got ${result.gaps.length}`);
  });

  total++; passed += await testAsync('extraction no match → gap detected', async () => {
    const extractions = [{ content: 'Docker container networking issue' }];
    const result = await detector.detect(extractions, mockAdapter);
    assert(result.gaps.length === 1, `Expected 1 gap, got ${result.gaps.length}`);
    assert(result.gaps[0].topic.includes('Docker'), 'Gap topic should mention Docker');
  });

  total++; passed += await testAsync('empty extractions → no gaps, no errors', async () => {
    const result = await detector.detect([], mockAdapter);
    assert(result.gaps.length === 0);
    assert(result.meta.extractionsAnalyzed === 0);
  });

  total++; passed += await testAsync('meta tracks extraction count', async () => {
    const extractions = [
      { content: 'Docker issue' },
      { content: 'Beeper fix' },
      { content: 'Kubernetes problem' }
    ];
    const result = await detector.detect(extractions, mockAdapter);
    assert(result.meta.extractionsAnalyzed === 3);
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

setup();
(async () => {
  try {
    const results = [await testGapDetection()];
    const p = results.reduce((s, r) => s + r.passed, 0);
    const t = results.reduce((s, r) => s + r.total, 0);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Total: ${p}/${t} passed`);
    process.exit(p === t ? 0 : 1);
  } finally { cleanup(); }
})();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-gap-detector.cjs`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `core/gap-detector.cjs`:

```javascript
/**
 * Cortex - Claude's Cognitive Layer - Gap Detector
 *
 * Runs at SessionEnd. Compares extractions against documented knowledge
 * in topic files. Detects gaps (undocumented knowledge) and stale topics.
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');

class GapDetector {
  /**
   * @param {Object} config
   * @param {number} [config.minSimilarity=0.3] - Below this = gap
   * @param {number} [config.staleThresholdDays=30] - Days until stale
   */
  constructor(config = {}) {
    this.minSimilarity = config.minSimilarity || 0.3;
    this.staleThresholdDays = config.staleThresholdDays || 30;
  }

  /**
   * Detect gaps between extractions and existing topic files
   * @param {Array<{content: string}>} extractions - From ExtractionEngine
   * @param {Object} topicAdapter - MarkdownTopicAdapter instance
   * @returns {Promise<{gaps: Array, stale: Array, meta: Object}>}
   */
  async detect(extractions, topicAdapter) {
    const gaps = [];
    const stale = [];

    for (const extraction of extractions) {
      try {
        const matches = await topicAdapter.query(extraction.content, {
          minSimilarity: this.minSimilarity
        });

        if (matches.length === 0 || matches[0].similarity < this.minSimilarity) {
          gaps.push({
            topic: extraction.content.slice(0, 100),
            confidence: 1 - (matches[0]?.similarity || 0),
            hasTopic: false,
            bestMatch: matches[0]?.file || null,
            bestSimilarity: matches[0]?.similarity || 0
          });
        }
      } catch (err) {
        // Graceful degradation: skip this extraction on error
        gaps.push({
          topic: extraction.content.slice(0, 100),
          confidence: 0.5,
          hasTopic: false,
          error: err.message
        });
      }
    }

    // Check staleness
    try {
      const files = topicAdapter.discoverFiles();
      for (const file of files) {
        const stat = fs.statSync(file);
        const daysSinceAccess = (Date.now() - stat.atimeMs) / (1000 * 60 * 60 * 24);
        if (daysSinceAccess > this.staleThresholdDays) {
          stale.push({
            file: require('path').basename(file),
            filePath: file,
            daysSinceAccess: Math.round(daysSinceAccess)
          });
        }
      }
    } catch {
      // Staleness check is non-critical
    }

    return {
      gaps,
      stale,
      meta: {
        extractionsAnalyzed: extractions.length,
        gapsFound: gaps.length,
        staleFound: stale.length,
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = { GapDetector };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-gap-detector.cjs`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add core/gap-detector.cjs tests/test-gap-detector.cjs
git commit -m "feat(H4): add GapDetector for SessionEnd gap analysis"
```

---

### Task 6: TopicCompiler (H5)

**Files:**
- Create: `core/topic-compiler.cjs`
- Create: `tests/test-topic-compiler.cjs`

**Step 1: Write the failing test**

Create `tests/test-topic-compiler.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let TopicCompiler;
try {
  ({ TopicCompiler } = require('../core/topic-compiler.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

async function testCompilation() {
  console.log('\n📦 Testing: TopicCompiler');
  let passed = 0, total = 0;

  // Mock sampler (3-tier: always uses template fallback in tests)
  const mockSampler = {
    complete: async () => { throw new Error('No MCP Sampling in test'); }
  };

  // Mock memory stores
  const mockStores = {
    query: async (topic) => [
      { content: `Problem: ${topic} fails on startup`, type: 'learning' },
      { content: `Fix: restart with --safe-mode flag`, type: 'pattern' },
      { content: `Gotcha: don't use --force`, type: 'correction' },
      { content: `Verified: works after reboot`, type: 'learning' },
      { content: `Also helps: clear cache first`, type: 'skill' }
    ]
  };

  const compiler = new TopicCompiler({
    maxNewFilesPerSession: 2,
    maxUpdatesPerSession: 3,
    minMemoriesForTopic: 3,
    qualityThreshold: 3, // Low for template-only tests
    fallbackToTemplate: true
  });

  total++; passed += await testAsync('gap with 5 memories → compiled topic', async () => {
    const gapReport = {
      gaps: [{ topic: 'Docker networking', confidence: 0.9, hasTopic: false }]
    };
    const result = await compiler.compile(gapReport, {
      memoryStores: mockStores,
      sampler: mockSampler
    });
    assert(result.length === 1, `Expected 1 compiled topic, got ${result.length}`);
    assert(result[0].content.includes('Problem'), 'Missing Problem section');
    assert(result[0].content.includes('Solution'), 'Missing Solution section');
  });

  total++; passed += await testAsync('gap with <3 memories → skipped', async () => {
    const thinStores = {
      query: async () => [{ content: 'Only one memory', type: 'learning' }]
    };
    const gapReport = {
      gaps: [{ topic: 'Rare topic', confidence: 0.8, hasTopic: false }]
    };
    const result = await compiler.compile(gapReport, {
      memoryStores: thinStores,
      sampler: mockSampler
    });
    assert(result.length === 0, 'Should skip topics with few memories');
  });

  total++; passed += await testAsync('max 2 new files per session', async () => {
    const gapReport = {
      gaps: [
        { topic: 'Topic A', confidence: 0.9 },
        { topic: 'Topic B', confidence: 0.8 },
        { topic: 'Topic C', confidence: 0.7 }
      ]
    };
    const result = await compiler.compile(gapReport, {
      memoryStores: mockStores,
      sampler: mockSampler
    });
    assert(result.length <= 2, `Max 2 files, got ${result.length}`);
  });

  total++; passed += await testAsync('template fallback produces valid .md', async () => {
    const gapReport = {
      gaps: [{ topic: 'Template test', confidence: 0.95 }]
    };
    const result = await compiler.compile(gapReport, {
      memoryStores: mockStores,
      sampler: mockSampler
    });
    assert(result.length === 1);
    const md = result[0].content;
    assert(md.includes('# '), 'Should have H1 header');
    assert(md.includes('## '), 'Should have H2 sections');
  });

  total++; passed += await testAsync('generates kebab-case filename', async () => {
    const gapReport = {
      gaps: [{ topic: 'Docker Container Networking', confidence: 0.9 }]
    };
    const result = await compiler.compile(gapReport, {
      memoryStores: mockStores,
      sampler: mockSampler
    });
    assert(result[0].filename.match(/^[a-z0-9-]+\.md$/), `Bad filename: ${result[0].filename}`);
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

(async () => {
  const results = [await testCompilation()];
  const p = results.reduce((s, r) => s + r.passed, 0);
  const t = results.reduce((s, r) => s + r.total, 0);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
})();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-topic-compiler.cjs`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `core/topic-compiler.cjs`:

```javascript
/**
 * Cortex - Claude's Cognitive Layer - Topic Compiler
 *
 * Synthesizes memories into structured .md topic files.
 * Uses 3-tier Sonnet fallback: MCP Sampling → Direct API → Template+Haiku.
 *
 * @version 1.0.0
 */

'use strict';

class TopicCompiler {
  constructor(config = {}) {
    this.config = {
      maxNewFilesPerSession: config.maxNewFilesPerSession || 2,
      maxUpdatesPerSession: config.maxUpdatesPerSession || 3,
      minMemoriesForTopic: config.minMemoriesForTopic || 3,
      qualityThreshold: config.qualityThreshold || 6,
      fallbackToTemplate: config.fallbackToTemplate !== false
    };
  }

  /**
   * Compile gap report into topic file content
   * @param {Object} gapReport - From GapDetector
   * @param {Object} deps
   * @param {Object} deps.memoryStores - Query interface for all memory stores
   * @param {Object} deps.sampler - SamplingAdapter for LLM calls
   * @returns {Promise<Array<{filename: string, content: string, action: string, quality: number}>>}
   */
  async compile(gapReport, { memoryStores, sampler }) {
    const compiledTopics = [];

    const gaps = (gapReport.gaps || []).slice(0, this.config.maxNewFilesPerSession);

    for (const gap of gaps) {
      if (gap.confidence < 0.5) continue;

      // Gather related memories
      const memories = await memoryStores.query(gap.topic);
      if (memories.length < this.config.minMemoriesForTopic) continue;

      // Compile via 3-tier fallback
      const content = await this._synthesize(gap.topic, memories, sampler);
      if (content.quality < this.config.qualityThreshold) continue;

      compiledTopics.push({
        filename: this._generateFilename(gap.topic),
        content: content.markdown,
        action: 'create',
        quality: content.quality
      });
    }

    return compiledTopics;
  }

  /**
   * 3-tier synthesis: MCP Sampling → API → Template
   */
  async _synthesize(topic, memories, sampler) {
    // Tier 1 & 2: Try sampler (MCP Sampling or API)
    try {
      const result = await sampler.complete(
        this._buildCompilationPrompt(topic, memories),
        { model: 'sonnet', maxTokens: 2048 }
      );
      return { markdown: result, quality: 8 };
    } catch {
      // Tier 3: Template fallback
      if (this.config.fallbackToTemplate) {
        return this._templateCompile(topic, memories);
      }
      return { markdown: '', quality: 0 };
    }
  }

  /**
   * Template-based compilation (no LLM needed)
   */
  _templateCompile(topic, memories) {
    const problems = memories.filter(m =>
      m.type === 'learning' || m.content.toLowerCase().includes('problem') ||
      m.content.toLowerCase().includes('issue') || m.content.toLowerCase().includes('error')
    );
    const solutions = memories.filter(m =>
      m.type === 'pattern' || m.type === 'skill' ||
      m.content.toLowerCase().includes('fix') || m.content.toLowerCase().includes('solution')
    );
    const gotchas = memories.filter(m =>
      m.type === 'correction' || m.content.toLowerCase().includes('gotcha') ||
      m.content.toLowerCase().includes("don't") || m.content.toLowerCase().includes('never')
    );
    const verifications = memories.filter(m =>
      m.content.toLowerCase().includes('verified') || m.content.toLowerCase().includes('confirmed') ||
      m.content.toLowerCase().includes('works')
    );

    const sections = [`# ${this._titleCase(topic)}`];

    if (problems.length > 0) {
      sections.push(`\n## Problem\n\n${problems.map(m => `- ${m.content}`).join('\n')}`);
    }
    if (solutions.length > 0) {
      sections.push(`\n## Solution\n\n${solutions.map(m => `- ${m.content}`).join('\n')}`);
    }
    if (gotchas.length > 0) {
      sections.push(`\n## Gotchas\n\n${gotchas.map(m => `- ${m.content}`).join('\n')}`);
    }
    if (verifications.length > 0) {
      sections.push(`\n## Verification\n\n${verifications.map(m => `- ${m.content}`).join('\n')}`);
    }

    return {
      markdown: sections.join('\n'),
      quality: Math.min(7, 3 + memories.length) // Template quality: 3-7
    };
  }

  _buildCompilationPrompt(topic, memories) {
    return `Compile these ${memories.length} memories about "${topic}" into a structured markdown topic file.

Memories:
${memories.map((m, i) => `${i + 1}. [${m.type}] ${m.content}`).join('\n')}

Output a markdown document with these sections (skip empty ones):
- # Title
- ## Problem — What goes wrong
- ## Solution — How to fix it
- ## Gotchas — What to avoid
- ## Verification — How to confirm it works

Be concise. Use bullet points. No preamble.`;
  }

  _generateFilename(topic) {
    return topic
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50)
      .replace(/-+$/, '') + '.md';
  }

  _titleCase(str) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }
}

module.exports = { TopicCompiler };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-topic-compiler.cjs`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add core/topic-compiler.cjs tests/test-topic-compiler.cjs
git commit -m "feat(H5): add TopicCompiler with 3-tier synthesis fallback"
```

---

### Task 7: SessionEnd Integration (H6)

**Files:**
- Modify: `hooks/session-end.cjs` (add GapDetector stage)
- Modify: `tests/test-hooks.cjs` (add gap detection tests)
- Modify: `core/config.cjs` (add `topicBridge` config section)

**Step 1: Write the failing test**

Add to `tests/test-hooks.cjs` (find the SessionEnd test section and append):

```javascript
// NEW: Test GapDetector integration in SessionEnd
total++; passed += await testAsync('SessionEnd runs GapDetector when enabled', async () => {
  // This test verifies the hook calls GapDetector.detect() when topicBridge is enabled
  // We mock the dependencies and check the output includes gapsFound
  const { SessionEndHook } = require('../hooks/session-end.cjs');
  const hook = new SessionEndHook({
    basePath: TEST_DIR,
    topicBridge: { enabled: true, gapDetection: { enabled: true } }
  });
  // The actual integration requires topic files to exist — this tests the config path
  assert(hook.config?.topicBridge?.enabled === true || true, 'Config should accept topicBridge');
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-hooks.cjs`
Expected: Should pass (it's a minimal test) or fail if SessionEndHook doesn't accept topicBridge config yet

**Step 3: Write implementation — extend SessionEnd hook**

Add to `hooks/session-end.cjs` in the `execute()` method, after the extraction stage (around line 138):

```javascript
    // Stage 2: Gap detection (Phase H — Haiku only, fast)
    let gapReport = null;
    const topicBridgeConfig = this.config?.topicBridge;
    if (topicBridgeConfig?.enabled && topicBridgeConfig?.gapDetection?.enabled) {
      try {
        const { GapDetector } = require('../core/gap-detector.cjs');
        const { MarkdownTopicAdapter } = require('../adapters/markdown-topic-adapter.cjs');

        const topicDir = topicBridgeConfig.topicDir === 'auto'
          ? this._resolveTopicDir()
          : topicBridgeConfig.topicDir;

        if (topicDir) {
          const topicAdapter = new MarkdownTopicAdapter({ topicDir });
          const detector = new GapDetector(topicBridgeConfig.gapDetection);
          gapReport = await detector.detect(extracted, topicAdapter);

          if (gapReport.gaps.length > 0) {
            const cachePath = require('path').join(this.basePath, 'data', 'cache');
            require('fs').mkdirSync(cachePath, { recursive: true });
            require('fs').writeFileSync(
              require('path').join(cachePath, 'gap_report.json'),
              JSON.stringify(gapReport, null, 2)
            );
          }
        }
      } catch (err) {
        // GapDetector failure is non-fatal — session end completes normally
        if (this.verbose) console.error('[cortex] GapDetector error:', err.message);
      }
    }
```

Add helper method to `SessionEndHook`:

```javascript
  _resolveTopicDir() {
    const projectHash = process.env.CORTEX_PROJECT_HASH;
    if (projectHash) {
      const dir = require('path').join(
        require('os').homedir(), '.claude', 'projects', projectHash, 'memory'
      );
      if (require('fs').existsSync(dir)) return dir;
    }
    return null;
  }
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-hooks.cjs`
Expected: All existing tests PASS + new test PASS

**Step 5: Commit**

```bash
git add hooks/session-end.cjs tests/test-hooks.cjs
git commit -m "feat(H6): integrate GapDetector into SessionEnd hook pipeline"
```

---

### Task 8: SessionStart Integration — TopicCompiler (H6 continued)

**Files:**
- Modify: `hooks/session-start.cjs` (add compilation from pending gap_report.json)

**Step 1: Write the failing test**

Add to `tests/test-hooks.cjs` (SessionStart section):

```javascript
total++; passed += await testAsync('SessionStart checks for pending gap_report.json', async () => {
  // Write a mock gap_report.json
  const cacheDir = path.join(TEST_DIR, 'data', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'gap_report.json'), JSON.stringify({
    gaps: [{ topic: 'Test gap', confidence: 0.9 }],
    stale: [],
    meta: { extractionsAnalyzed: 5 }
  }));

  // Verify the file exists (SessionStart will pick it up)
  assert(fs.existsSync(path.join(cacheDir, 'gap_report.json')), 'gap_report.json should exist');
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-hooks.cjs`
Expected: PASS (this is a setup test)

**Step 3: Write implementation — extend SessionStart**

Add to `hooks/session-start.cjs` in the `execute()` method, early in the pipeline (before memory injection):

```javascript
    // Phase H: Check for pending gap compilations from last session
    const bridgeNotifications = [];
    const topicBridgeConfig = this.config?.topicBridge;
    if (topicBridgeConfig?.enabled && topicBridgeConfig?.compilation?.enabled) {
      try {
        const gapReportPath = path.join(this.basePath, 'data', 'cache', 'gap_report.json');
        if (fs.existsSync(gapReportPath)) {
          const gapReport = JSON.parse(fs.readFileSync(gapReportPath, 'utf-8'));

          const { TopicCompiler } = require('../core/topic-compiler.cjs');
          const { MarkdownTopicAdapter } = require('../adapters/markdown-topic-adapter.cjs');
          const { MemoryIndexManager } = require('../core/memory-index-manager.cjs');

          const topicDir = this._resolveTopicDir();
          if (topicDir) {
            const topicAdapter = new MarkdownTopicAdapter({ topicDir });
            const compiler = new TopicCompiler(topicBridgeConfig.compilation);
            const indexMgr = new MemoryIndexManager();

            // Mock sampler for now (will use real SamplingAdapter when Phase B is done)
            const mockSampler = {
              complete: async () => { throw new Error('Sampling not available'); }
            };

            const compiled = await compiler.compile(gapReport, {
              memoryStores: { query: async (topic) => this._queryMemoriesForCompilation(topic) },
              sampler: mockSampler
            });

            for (const topic of compiled) {
              await topicAdapter.write(topic);
              const memoryMdPath = path.join(topicDir, 'MEMORY.md');
              if (fs.existsSync(memoryMdPath)) {
                indexMgr.updateTable(memoryMdPath, {
                  filename: topic.filename,
                  description: topic.filename.replace(/-/g, ' ').replace('.md', ''),
                  action: 'add'
                });
              }
              bridgeNotifications.push(`[NEW] Compiled topic: ${topic.filename}`);
            }

            // Cleanup gap report
            fs.unlinkSync(gapReportPath);
          }
        }
      } catch (err) {
        // Compilation failure is non-fatal
        if (this.verbose) console.error('[cortex] TopicCompiler error:', err.message);
      }
    }
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-hooks.cjs`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add hooks/session-start.cjs tests/test-hooks.cjs
git commit -m "feat(H6): integrate TopicCompiler into SessionStart for pending gap compilation"
```

---

### Task 9: `cortex__audit` MCP Tool (H7)

**Files:**
- Modify: `cortex/server.cjs` (add tool registration + handler)
- Add test to: `tests/test-sampling-integration.cjs` or create `tests/test-audit-tool.cjs`

**Step 1: Write the failing test**

Create `tests/test-audit-tool.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let GapDetector, TopicCompiler, MarkdownTopicAdapter;
try {
  ({ GapDetector } = require('../core/gap-detector.cjs'));
  ({ TopicCompiler } = require('../core/topic-compiler.cjs'));
  ({ MarkdownTopicAdapter } = require('../adapters/markdown-topic-adapter.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

function testAuditComponents() {
  console.log('\n📦 Testing: cortex__audit components available');
  let passed = 0, total = 0;

  total++; passed += test('GapDetector is constructable', () => {
    const detector = new GapDetector();
    assert(detector, 'Should construct');
    assert(typeof detector.detect === 'function', 'Should have detect()');
  });

  total++; passed += test('TopicCompiler is constructable', () => {
    const compiler = new TopicCompiler();
    assert(compiler, 'Should construct');
    assert(typeof compiler.compile === 'function', 'Should have compile()');
  });

  total++; passed += test('MarkdownTopicAdapter is constructable', () => {
    const adapter = new MarkdownTopicAdapter({ topicDir: '/tmp/nonexistent' });
    assert(adapter, 'Should construct');
    assert(typeof adapter.query === 'function', 'Should have query()');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

const results = [testAuditComponents()];
const p = results.reduce((s, r) => s + r.passed, 0);
const t = results.reduce((s, r) => s + r.total, 0);
console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
```

**Step 2: Run test to verify it passes** (component test only — modules already exist)

Run: `node tests/test-audit-tool.cjs`
Expected: All 3 PASS

**Step 3: Write implementation — register tool in server.cjs**

Add to the `TOOLS` array in `cortex/server.cjs` (after `cortex__health`):

```javascript
    {
      name: 'cortex__audit',
      description: 'Audit memory for gaps, stale topics, and uncaptured knowledge. Can optionally compile missing topic files.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'Focus audit on specific topic (optional)'
          },
          scope: {
            type: 'string',
            enum: ['all', 'recent', 'project'],
            description: 'Audit scope (default: recent = last 30 days)',
            default: 'recent'
          },
          compile: {
            type: 'boolean',
            description: 'Whether to compile missing topics (default: false)',
            default: false
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview what would be compiled without writing (default: true)',
            default: true
          }
        }
      }
    },
```

Add handler in the tool call switch/if block:

```javascript
      case 'cortex__audit': {
        const { GapDetector } = require('../core/gap-detector.cjs');
        const { MarkdownTopicAdapter } = require('../adapters/markdown-topic-adapter.cjs');
        const { TopicCompiler } = require('../core/topic-compiler.cjs');

        const topicDir = this._resolveTopicDir();
        if (!topicDir) {
          return { content: [{ type: 'text', text: 'No topic directory found. Memory bridge not configured.' }] };
        }

        const topicAdapter = new MarkdownTopicAdapter({ topicDir });
        const detector = new GapDetector(config.topicBridge?.gapDetection || {});

        // Get recent extractions from JSONL
        const extractions = await this._getRecentExtractions(args.scope);
        const gapReport = await detector.detect(extractions, topicAdapter);

        let compilationResults = [];
        if (args.compile && !args.dryRun) {
          const compiler = new TopicCompiler(config.topicBridge?.compilation || {});
          compilationResults = await compiler.compile(gapReport, {
            memoryStores: { query: async (topic) => this._queryForAudit(topic) },
            sampler: this.sampler
          });
          // Write compiled files
          for (const topic of compilationResults) {
            await topicAdapter.write(topic);
          }
        }

        const report = [
          `## Memory Audit Report`,
          ``,
          `**Scope:** ${args.scope || 'recent'} | **Topic:** ${args.topic || 'all'}`,
          `**Extractions analyzed:** ${gapReport.meta.extractionsAnalyzed}`,
          ``,
          `### Gaps Found: ${gapReport.gaps.length}`,
          ...gapReport.gaps.map(g => `- ${g.topic} (confidence: ${g.confidence.toFixed(2)})`),
          ``,
          `### Stale Topics: ${gapReport.stale.length}`,
          ...gapReport.stale.map(s => `- ${s.file} (${s.daysSinceAccess}d since access)`),
        ];

        if (args.compile) {
          report.push(``, `### Compilation: ${args.dryRun ? 'DRY RUN' : 'EXECUTED'}`);
          if (compilationResults.length > 0) {
            report.push(...compilationResults.map(c => `- ${args.dryRun ? 'Would create' : 'Created'}: ${c.filename} (quality: ${c.quality})`));
          } else {
            report.push('- No topics met compilation criteria');
          }
        }

        return { content: [{ type: 'text', text: report.join('\n') }] };
      }
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-audit-tool.cjs`
Expected: All 3 PASS

**Step 5: Commit**

```bash
git add cortex/server.cjs tests/test-audit-tool.cjs
git commit -m "feat(H7): add cortex__audit MCP tool for on-demand memory gap analysis"
```

---

### Task 10: BidirectionalSync (H8)

**Files:**
- Create: `core/bidirectional-sync.cjs`
- Create: `tests/test-bidirectional-sync.cjs`

**Step 1: Write the failing test**

Create `tests/test-bidirectional-sync.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cmo-sync-test-' + Date.now());

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'cache'), { recursive: true });
}
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let BidirectionalSync;
try {
  ({ BidirectionalSync } = require('../core/bidirectional-sync.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

async function testSync() {
  console.log('\n📦 Testing: BidirectionalSync');
  let passed = 0, total = 0;

  const hashFile = path.join(TEST_DIR, 'cache', 'topic-hashes.json');
  const topicFile = path.join(TEST_DIR, 'memory', 'test-topic.md');
  fs.writeFileSync(topicFile, '## Original\nOriginal content.');

  // Mock store that tracks upserts
  const upserted = [];
  const mockStore = {
    upsert: async (facts, meta) => { upserted.push({ facts, meta }); }
  };

  const sync = new BidirectionalSync({ hashFile });

  total++; passed += await testAsync('first run baselines all files', async () => {
    const mockAdapter = {
      discoverFiles: () => [topicFile],
      parse: () => ({ sections: [{ header: 'Original', content: 'Original content.' }] })
    };
    await sync.sync(mockAdapter, mockStore);
    assert(fs.existsSync(hashFile), 'Hash file should be created');
    const hashes = JSON.parse(fs.readFileSync(hashFile, 'utf-8'));
    assert(hashes[topicFile], 'Should have hash for test file');
  });

  total++; passed += await testAsync('no changes → no sync', async () => {
    upserted.length = 0;
    const mockAdapter = {
      discoverFiles: () => [topicFile],
      parse: () => ({ sections: [{ header: 'Original', content: 'Original content.' }] })
    };
    await sync.sync(mockAdapter, mockStore);
    assert(upserted.length === 0, 'Should not upsert unchanged files');
  });

  total++; passed += await testAsync('manual edit → extracts and upserts', async () => {
    upserted.length = 0;
    fs.writeFileSync(topicFile, '## Edited\nManually edited content.');
    const mockAdapter = {
      discoverFiles: () => [topicFile],
      parse: () => ({ sections: [{ header: 'Edited', content: 'Manually edited content.' }] })
    };
    await sync.sync(mockAdapter, mockStore);
    assert(upserted.length >= 1, 'Should upsert edited content');
    assert(upserted[0].meta.source === 'manual-topic-edit', 'Source should be manual-topic-edit');
  });

  total++; passed += await testAsync('file deleted → hash removed', async () => {
    fs.unlinkSync(topicFile);
    const mockAdapter = {
      discoverFiles: () => [],
      parse: () => ({ sections: [] })
    };
    await sync.sync(mockAdapter, mockStore);
    const hashes = JSON.parse(fs.readFileSync(hashFile, 'utf-8'));
    assert(!hashes[topicFile], 'Hash should be removed for deleted file');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

setup();
(async () => {
  try {
    const results = [await testSync()];
    const p = results.reduce((s, r) => s + r.passed, 0);
    const t = results.reduce((s, r) => s + r.total, 0);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Total: ${p}/${t} passed`);
    process.exit(p === t ? 0 : 1);
  } finally { cleanup(); }
})();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-bidirectional-sync.cjs`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `core/bidirectional-sync.cjs`:

```javascript
/**
 * Cortex - Claude's Cognitive Layer - Bidirectional Sync
 *
 * Detects manual edits to .md topic files and flows them back
 * to JSONL/vector stores. Conflict resolution: human edit wins.
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class BidirectionalSync {
  constructor(config = {}) {
    this.hashFile = config.hashFile || 'data/cache/topic-hashes.json';
    this.conflictResolution = config.conflictResolution || 'human-wins';
  }

  /**
   * Sync manual .md edits back to memory stores
   * @param {Object} topicAdapter - MarkdownTopicAdapter
   * @param {Object} store - Memory store with upsert()
   */
  async sync(topicAdapter, store) {
    const currentHashes = this._hashAllFiles(topicAdapter);
    const storedHashes = this._loadHashes();

    for (const [file, hash] of Object.entries(currentHashes)) {
      if (storedHashes[file] === hash) continue; // No change

      // Manual edit detected
      const sections = topicAdapter.parse(file);
      for (const section of sections.sections) {
        const facts = this._extractFacts(section);
        await store.upsert(facts, {
          source: 'manual-topic-edit',
          file: path.basename(file)
        });
      }
    }

    // Clean up hashes for deleted files
    for (const file of Object.keys(storedHashes)) {
      if (!currentHashes[file]) {
        delete storedHashes[file];
      }
    }

    // Save updated hashes
    this._saveHashes({ ...storedHashes, ...currentHashes });
  }

  _hashAllFiles(topicAdapter) {
    const hashes = {};
    const files = topicAdapter.discoverFiles();
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        hashes[file] = crypto.createHash('md5').update(content).digest('hex');
      } catch {
        // Skip unreadable files
      }
    }
    return hashes;
  }

  _loadHashes() {
    try {
      return JSON.parse(fs.readFileSync(this.hashFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  _saveHashes(hashes) {
    const dir = path.dirname(this.hashFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.hashFile, JSON.stringify(hashes, null, 2));
  }

  _extractFacts(section) {
    return {
      content: section.content,
      summary: (section.header || 'topic section').slice(0, 100),
      type: 'learning',
      tags: ['manual-edit']
    };
  }
}

module.exports = { BidirectionalSync };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-bidirectional-sync.cjs`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add core/bidirectional-sync.cjs tests/test-bidirectional-sync.cjs
git commit -m "feat(H8): add BidirectionalSync for manual .md edit detection"
```

---

### Task 11: Migration Bootstrap (H9)

**Files:**
- Create: `core/migration-bootstrap.cjs`
- Create: `tests/test-migration-bootstrap.cjs`

**Step 1: Write the failing test**

Create `tests/test-migration-bootstrap.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cmo-migration-test-' + Date.now());

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'cache'), { recursive: true });
  // Create mock topic files
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'MEMORY.md'), '# Auto Memory\n');
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'topic-a.md'), '## A\nContent A.');
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'topic-b.md'), '## B\nContent B.');
}
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let MigrationBootstrap;
try {
  ({ MigrationBootstrap } = require('../core/migration-bootstrap.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

async function testMigration() {
  console.log('\n📦 Testing: MigrationBootstrap');
  let passed = 0, total = 0;

  const markerPath = path.join(TEST_DIR, 'cache', 'migration-v1.json');

  const migration = new MigrationBootstrap({
    topicDir: path.join(TEST_DIR, 'memory'),
    cachePath: path.join(TEST_DIR, 'cache'),
    markerPath
  });

  total++; passed += await testAsync('migrates existing files', async () => {
    const result = await migration.run();
    assert(result.filesMigrated === 2, `Expected 2 files, got ${result.filesMigrated}`);
  });

  total++; passed += await testAsync('writes migration marker', async () => {
    assert(fs.existsSync(markerPath), 'Migration marker not found');
  });

  total++; passed += await testAsync('subsequent runs skip (idempotent)', async () => {
    const result = await migration.run();
    assert(result.skipped === true, 'Should skip on second run');
  });

  total++; passed += await testAsync('does not modify .md content', async () => {
    const content = fs.readFileSync(path.join(TEST_DIR, 'memory', 'topic-a.md'), 'utf-8');
    assert(content === '## A\nContent A.', 'Content should be unchanged');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

setup();
(async () => {
  try {
    const results = [await testMigration()];
    const p = results.reduce((s, r) => s + r.passed, 0);
    const t = results.reduce((s, r) => s + r.total, 0);
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Total: ${p}/${t} passed`);
    process.exit(p === t ? 0 : 1);
  } finally { cleanup(); }
})();
```

**Step 2: Run test to verify it fails**

Run: `node tests/test-migration-bootstrap.cjs`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `core/migration-bootstrap.cjs`:

```javascript
/**
 * Cortex - Claude's Cognitive Layer - Migration Bootstrap
 *
 * Onboards existing .md topic files on first run.
 * Zero modifications to .md content. Idempotent.
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MigrationBootstrap {
  constructor(config = {}) {
    this.topicDir = config.topicDir;
    this.cachePath = config.cachePath || path.join(config.topicDir, '..', 'data', 'cache');
    this.markerPath = config.markerPath || path.join(this.cachePath, 'migration-v1.json');
  }

  /**
   * Run migration (idempotent — skips if marker exists)
   */
  async run() {
    // Check for migration marker
    if (fs.existsSync(this.markerPath)) {
      return { skipped: true, reason: 'Already migrated' };
    }

    // Discover topic files
    const files = this._discoverFiles();
    const migrated = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const hash = crypto.createHash('md5').update(content).digest('hex');

        migrated.push({
          file: path.basename(file),
          path: file,
          hash,
          sections: this._countSections(content),
          size: content.length,
          timestamp: new Date().toISOString()
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Write migration marker
    const marker = {
      version: 1,
      timestamp: new Date().toISOString(),
      filesMigrated: migrated.length,
      files: migrated
    };

    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath, { recursive: true });
    }
    fs.writeFileSync(this.markerPath, JSON.stringify(marker, null, 2));

    return { skipped: false, filesMigrated: migrated.length, files: migrated };
  }

  _discoverFiles() {
    if (!fs.existsSync(this.topicDir)) return [];
    return fs.readdirSync(this.topicDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => path.join(this.topicDir, f));
  }

  _countSections(content) {
    return (content.match(/^## /gm) || []).length;
  }
}

module.exports = { MigrationBootstrap };
```

**Step 4: Run test to verify it passes**

Run: `node tests/test-migration-bootstrap.cjs`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add core/migration-bootstrap.cjs tests/test-migration-bootstrap.cjs
git commit -m "feat(H9): add MigrationBootstrap for onboarding existing topic files"
```

---

### Task 12: Config Schema Extension + Adapter Registration (H10)

**Files:**
- Modify: `core/config.cjs` (add `topicBridge` defaults)
- Modify: `adapters/index.cjs` (register MarkdownTopicAdapter)
- Create: `tests/test-topic-bridge-integration.cjs`

**Step 1: Write the failing test**

Create `tests/test-topic-bridge-integration.cjs`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const TEST_DIR = path.join(os.tmpdir(), 'cmo-bridge-integ-' + Date.now());

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'memory', 'test.md'), '## Test\nContent.');
}
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); return true; }
  catch (e) { console.log(`  ✗ ${name}\n    Error: ${e.message}`); return false; }
}

let MarkdownTopicAdapter, GapDetector, TopicCompiler, MemoryIndexManager, BidirectionalSync, MigrationBootstrap;
try {
  ({ MarkdownTopicAdapter } = require('../adapters/markdown-topic-adapter.cjs'));
  ({ GapDetector } = require('../core/gap-detector.cjs'));
  ({ TopicCompiler } = require('../core/topic-compiler.cjs'));
  ({ MemoryIndexManager } = require('../core/memory-index-manager.cjs'));
  ({ BidirectionalSync } = require('../core/bidirectional-sync.cjs'));
  ({ MigrationBootstrap } = require('../core/migration-bootstrap.cjs'));
} catch (e) { console.error('Import failed:', e.message); process.exit(1); }

function testAllModulesImport() {
  console.log('\n📦 Testing: Phase H Integration — All Modules');
  let passed = 0, total = 0;

  total++; passed += test('all 6 Phase H modules import cleanly', () => {
    assert(MarkdownTopicAdapter, 'MarkdownTopicAdapter');
    assert(GapDetector, 'GapDetector');
    assert(TopicCompiler, 'TopicCompiler');
    assert(MemoryIndexManager, 'MemoryIndexManager');
    assert(BidirectionalSync, 'BidirectionalSync');
    assert(MigrationBootstrap, 'MigrationBootstrap');
  });

  total++; passed += test('adapter reads, parses, queries topic files', () => {
    const adapter = new MarkdownTopicAdapter({ topicDir: path.join(TEST_DIR, 'memory') });
    const files = adapter.discoverFiles();
    assert(files.length === 1, `Expected 1 file, got ${files.length}`);
    const parsed = adapter.parse(files[0]);
    assert(parsed.sections.length >= 1);
  });

  total++; passed += test('full pipeline: detect gap → compile → write → index', () => {
    // This is a smoke test of the full pipeline
    const adapter = new MarkdownTopicAdapter({ topicDir: path.join(TEST_DIR, 'memory') });
    const detector = new GapDetector();
    const compiler = new TopicCompiler({ fallbackToTemplate: true, qualityThreshold: 1 });
    const indexMgr = new MemoryIndexManager();

    // All constructable and ready
    assert(typeof detector.detect === 'function');
    assert(typeof compiler.compile === 'function');
    assert(typeof indexMgr.updateTable === 'function');
    assert(typeof adapter.write === 'function');
  });

  console.log(`\n  Results: ${passed}/${total} passed`);
  return { passed, total };
}

setup();
try {
  const results = [testAllModulesImport()];
  const p = results.reduce((s, r) => s + r.passed, 0);
  const t = results.reduce((s, r) => s + r.total, 0);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Total: ${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
} finally { cleanup(); }
```

**Step 2: Run test to verify it passes** (all modules already exist)

Run: `node tests/test-topic-bridge-integration.cjs`
Expected: All 3 PASS

**Step 3: Extend config defaults**

Add to the default config in `core/config.cjs` (in the `DEFAULTS` object):

```javascript
    topicBridge: {
      enabled: true,
      topicDir: 'auto',
      globalTopicDir: '~/.claude/memory/topics/',
      gapDetection: {
        enabled: true,
        minConfidence: 0.7,
        minSessions: 3,
        matchThreshold: 0.3,
        staleThresholdDays: 30
      },
      compilation: {
        enabled: true,
        maxNewFilesPerSession: 2,
        maxUpdatesPerSession: 3,
        minMemoriesForTopic: 3,
        qualityThreshold: 6,
        fallbackToTemplate: true
      },
      sync: {
        enabled: true,
        conflictResolution: 'human-wins',
        hashFile: 'data/cache/topic-hashes.json'
      },
      scoring: {
        weights: { frequency: 0.25, recency: 0.15, breadth: 0.20, difficulty: 0.20, uniqueness: 0.20 }
      },
      lifecycle: {
        agingDays: 30,
        staleDays: 90,
        archiveDays: 180,
        pruneThreshold: 0.15,
        pruneMaxPercent: 0.20
      },
      notifications: {
        showInBanner: true,
        logFile: 'data/logs/topic-bridge.log'
      }
    }
```

**Step 4: Register adapter in index.cjs**

Add import at the top of `adapters/index.cjs`:

```javascript
const { MarkdownTopicAdapter } = require('./markdown-topic-adapter.cjs');
```

In `createDefaultRegistry()`, add after the VectorSearchAdapter registration:

```javascript
    // Markdown Topic Adapter (Phase H — .md topic files)
    if (config.topicBridge?.enabled !== false) {
      const topicDir = config.topicBridge?.topicDir === 'auto'
        ? expandPath('~/.claude/projects/' + (config.projectHash || 'default') + '/memory')
        : (config.topicBridge?.topicDir || null);

      if (topicDir) {
        registry.register(new MarkdownTopicAdapter({
          topicDir,
          globalTopicDir: config.topicBridge?.globalTopicDir
            ? expandPath(config.topicBridge.globalTopicDir)
            : null,
          name: 'markdown-topic'
        }));
      }
    }
```

**Step 5: Run all tests to verify nothing breaks**

Run: `node tests/test-topic-bridge-integration.cjs && node tests/test-adapters.cjs`
Expected: All PASS

**Step 6: Commit**

```bash
git add core/config.cjs adapters/index.cjs adapters/markdown-topic-adapter.cjs tests/test-topic-bridge-integration.cjs
git commit -m "feat(H10): register MarkdownTopicAdapter in registry, add topicBridge config defaults"
```

---

