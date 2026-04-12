#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ObsidianVaultExporter } = require('../src/core/obsidian-vault.cjs');

const TEST_DIR = path.join(os.tmpdir(), `obsidian-vault-export-${Date.now()}`);

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

function main() {
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const records = [
    {
      id: 'markdown-tree:abc12345',
      type: 'learning',
      content: 'Inspect the embedded initrd, not only the live root filesystem.',
      summary: 'Inspect embedded artifacts when boot differs from /etc',
      projectHash: null,
      tags: ['boot', 'linux', 'ukis'],
      intent: 'general',
      sourceSessionId: 'markdown-tree:sync-memory',
      sourceTimestamp: '2026-04-11T00:00:00.000Z',
      extractionConfidence: 0.9,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: 1.0,
      status: 'active',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      validFrom: '2026-04-11T00:00:00.000Z',
      validTo: null,
      _source: 'markdown-tree',
      _noteTitle: 'Macbook Keyboard Fix',
      _sourceFile: '/tmp/macbook-keyboard.md',
    },
    {
      id: 'gemini:session1:task.md',
      type: 'skill',
      content: 'Install Warp Terminal and validate startup.',
      summary: 'Warp terminal install task',
      projectHash: null,
      tags: ['warp', 'terminal'],
      intent: 'project',
      sourceSessionId: 'gemini:session1',
      sourceTimestamp: '2026-04-10T00:00:00.000Z',
      extractionConfidence: 0.8,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: 1.0,
      status: 'active',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
      validFrom: '2026-04-10T00:00:00.000Z',
      validTo: null,
      _source: 'gemini',
      _noteTitle: 'Install Warp',
      _sourceFile: '/tmp/gemini/session1/task.md',
    },
  ];

  const exporter = new ObsidianVaultExporter({
    vaultPath: TEST_DIR,
    clean: true,
  });

  const result = exporter.export(records);
  const root = result.exportRoot;

  console.log('\n  ObsidianVaultExporter\n');

  test('export succeeds and returns manifest', () => {
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.manifest.counts.records, 2);
  });

  test('writes atlas home note', () => {
    const homePath = path.join(root, '00 Home.md');
    assert.ok(fs.existsSync(homePath));
    const content = fs.readFileSync(homePath, 'utf8');
    assert.ok(content.includes('# Cortex Atlas'));
    assert.ok(content.includes('markdown-tree'));
  });

  test('writes source and type index notes', () => {
    assert.ok(fs.existsSync(path.join(root, '20 Sources', 'markdown-tree.md')));
    assert.ok(fs.existsSync(path.join(root, '30 Types', 'learning.md')));
    assert.ok(fs.existsSync(path.join(root, '40 Tags', 'boot.md')));
  });

  test('writes record notes with wikilinks and metadata', () => {
    const recordDir = path.join(root, '10 Records', 'markdown-tree');
    const files = fs.readdirSync(recordDir).filter(file => file.endsWith('.md'));
    assert.strictEqual(files.length, 1);

    const content = fs.readFileSync(path.join(recordDir, files[0]), 'utf8');
    assert.ok(content.includes('origin_path: "/tmp/macbook-keyboard.md"'));
    assert.ok(content.includes(`[[Cortex Atlas/20 Sources/markdown-tree|markdown-tree]]`));
    assert.ok(content.includes('Inspect the embedded initrd'));
  });

  test('writes manifest json', () => {
    const manifestPath = path.join(root, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.counts.bySource['gemini'], 1);
  });

  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
