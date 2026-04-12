#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MarkdownTreeAdapter } = require('../src/adapters/markdown-tree-adapter.cjs');

const TEST_DIR = path.join(os.tmpdir(), `markdown-tree-adapter-${Date.now()}`);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed++;
  }
}

function write(relativePath, content) {
  const fullPath = path.join(TEST_DIR, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

async function main() {
  fs.mkdirSync(TEST_DIR, { recursive: true });

  write('memory/feedback_action_oriented.md', `---
name: Action oriented
description: Short preference note
type: feedback
tags:
  - claude
  - style
---

# Action oriented

- Prefer direct answers.
`);

  write('memory/project_cortex.md', `---
name: Cortex project
description: Memory system roadmap
type: project
---

# Cortex Project

This note documents vector search plans and retrieval ideas.
`);

  write('learnings/debugging.md', `# Debugging

When a boot issue disagrees with /etc, inspect the embedded artifact instead.
`);

  const adapter = new MarkdownTreeAdapter({
    roots: [
      {
        name: 'sync-memory',
        path: path.join(TEST_DIR, 'memory'),
        tags: ['sync'],
      },
      {
        name: 'sync-learnings',
        path: path.join(TEST_DIR, 'learnings'),
        tags: ['learnings'],
      },
    ],
  });

  console.log('\n  MarkdownTreeAdapter\n');

  test('constructor enables adapter when roots provided', () => {
    assert.strictEqual(adapter.enabled, true);
    assert.strictEqual(adapter.name, 'markdown-tree');
  });

  test('normalize maps feedback markdown to preference type', () => {
    const record = adapter.normalize({
      content: fs.readFileSync(path.join(TEST_DIR, 'memory/feedback_action_oriented.md'), 'utf8'),
      filePath: path.join(TEST_DIR, 'memory/feedback_action_oriented.md'),
      rootName: 'sync-memory',
      relativePath: 'feedback_action_oriented.md',
      modifiedTime: new Date().toISOString(),
      rootTags: ['sync'],
    });

    assert(record);
    assert.strictEqual(record.type, 'preference');
    assert.ok(record.tags.includes('sync'));
    assert.ok(record.tags.includes('style'));
    assert.ok(record.summary.includes('Short preference note'));
  });

  await asyncTest('query returns records from all markdown roots', async () => {
    const records = await adapter.query({ tags: [], intent: null, projectHash: null }, {});
    assert.strictEqual(records.length, 3);
  });

  await asyncTest('query filters by context tags when provided', async () => {
    const records = await adapter.query({ tags: ['vector'], intent: null, projectHash: null }, {});
    assert.strictEqual(records.length, 1);
    assert.ok(records[0].content.includes('vector search'));
  });

  await asyncTest('query respects type filters', async () => {
    const records = await adapter.query({ tags: [], intent: null, projectHash: null }, { types: ['preference'] });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].type, 'preference');
  });

  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
