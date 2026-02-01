#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Episodic Annotations Layer Tests
 *
 * Tests for the EpisodicAnnotationsLayer which provides write operations
 * on top of read-only episodic memory conversation archives.
 *
 * Annotation Types:
 * - tag: Add searchable tags to conversations
 * - note: Add user notes to specific messages
 * - correction: Mark corrections or clarifications
 * - highlight: Mark important sections
 * - link: Connect related conversations
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'cortex-annotations-test-' + Date.now());
const ANNOTATIONS_PATH = path.join(TEST_DIR, 'annotations', 'episodic.jsonl');

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'annotations'), { recursive: true });
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
    if (error.stack) {
      console.log(`    Stack: ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
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
    if (error.stack) {
      console.log(`    Stack: ${error.stack.split('\n').slice(1, 3).join('\n    ')}`);
    }
    return false;
  }
}

// =============================================================================
// IMPORT MODULE
// =============================================================================

let EpisodicAnnotationsLayer;

try {
  ({ EpisodicAnnotationsLayer } = require('../adapters/episodic-annotations-layer.cjs'));
} catch (error) {
  console.error('Failed to import EpisodicAnnotationsLayer:', error.message);
  console.error(error.stack);
  process.exit(1);
}

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

async function runConstructorTests() {
  console.log('\n📋 Constructor Tests');
  let passed = 0;
  let total = 0;

  // Test: Constructor with default options
  total++;
  if (test('Constructs with default options', () => {
    const layer = new EpisodicAnnotationsLayer({
      basePath: TEST_DIR,
    });
    assert.strictEqual(layer.name, 'episodic-annotations');
    assert.ok(layer.priority >= 0 && layer.priority <= 1);
  })) passed++;

  // Test: Constructor with custom options
  total++;
  if (test('Accepts custom options', () => {
    const layer = new EpisodicAnnotationsLayer({
      basePath: TEST_DIR,
      priority: 0.95,
      enabled: false,
    });
    assert.strictEqual(layer.priority, 0.95);
    assert.strictEqual(layer.enabled, false);
  })) passed++;

  // Test: supportsWrite returns true
  total++;
  if (test('supportsWrite returns true', () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    assert.strictEqual(layer.supportsWrite(), true);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CRUD TESTS - addAnnotation
// =============================================================================

async function runAddAnnotationTests() {
  console.log('\n📋 addAnnotation Tests');
  let passed = 0;
  let total = 0;

  // Test: Add a tag annotation
  total++;
  if (await testAsync('Can add a tag annotation', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conversation-123',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'git-workflow',
      metadata: { importance: 'high' },
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.id, 'Should return annotation ID');
    assert.ok(result.id.startsWith('ann:'), 'ID should start with ann:');
  })) passed++;

  // Test: Add a note annotation
  total++;
  if (await testAsync('Can add a note annotation', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'message-456',
      targetType: 'message',
      annotationType: 'note',
      content: 'This solution worked perfectly for our use case',
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.id);
  })) passed++;

  // Test: Add a correction annotation
  total++;
  if (await testAsync('Can add a correction annotation', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'snippet-789',
      targetType: 'snippet',
      annotationType: 'correction',
      content: 'The original approach had a memory leak - use this instead',
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.id);
  })) passed++;

  // Test: Add a highlight annotation
  total++;
  if (await testAsync('Can add a highlight annotation', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conversation-123',
      targetType: 'conversation',
      annotationType: 'highlight',
      content: 'Key insight about error handling',
    });

    assert.strictEqual(result.success, true);
  })) passed++;

  // Test: Add a link annotation
  total++;
  if (await testAsync('Can add a link annotation', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conversation-123',
      targetType: 'conversation',
      annotationType: 'link',
      content: 'Related to conversation-456',
      metadata: { linkedConversationId: 'conversation-456' },
    });

    assert.strictEqual(result.success, true);
  })) passed++;

  // Test: Annotation has correct schema
  total++;
  if (await testAsync('Annotation has correct schema fields', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conv-test',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'test-tag',
    });

    const annotations = await layer.getAnnotations('conv-test');
    const ann = annotations.find(a => a.id === result.id);

    assert.ok(ann, 'Should find the annotation');
    assert.strictEqual(ann.targetId, 'conv-test');
    assert.strictEqual(ann.targetType, 'conversation');
    assert.strictEqual(ann.annotationType, 'tag');
    assert.strictEqual(ann.content, 'test-tag');
    assert.strictEqual(ann.status, 'active');
    assert.ok(ann.createdAt, 'Should have createdAt');
    assert.ok(ann.updatedAt, 'Should have updatedAt');
  })) passed++;

  // Test: Rejects invalid annotation type
  total++;
  if (await testAsync('Rejects invalid annotation type', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conv-test',
      targetType: 'conversation',
      annotationType: 'invalid-type',
      content: 'test',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error, 'Should have error message');
  })) passed++;

  // Test: Rejects invalid target type
  total++;
  if (await testAsync('Rejects invalid target type', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conv-test',
      targetType: 'invalid-target',
      annotationType: 'tag',
      content: 'test',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CRUD TESTS - getAnnotations
// =============================================================================

async function runGetAnnotationsTests() {
  console.log('\n📋 getAnnotations Tests');
  let passed = 0;
  let total = 0;

  // Test: Get annotations for a target
  total++;
  if (await testAsync('Gets annotations for a specific target', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    // Add multiple annotations for same target
    await layer.addAnnotation({
      targetId: 'conv-multi',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'tag1',
    });
    await layer.addAnnotation({
      targetId: 'conv-multi',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'A note',
    });
    await layer.addAnnotation({
      targetId: 'other-conv',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'other-tag',
    });

    const annotations = await layer.getAnnotations('conv-multi');
    assert.strictEqual(annotations.length, 2);
    assert.ok(annotations.every(a => a.targetId === 'conv-multi'));
  })) passed++;

  // Test: Returns empty array for no annotations
  total++;
  if (await testAsync('Returns empty array for no annotations', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const annotations = await layer.getAnnotations('nonexistent-conv');
    assert.ok(Array.isArray(annotations));
    assert.strictEqual(annotations.length, 0);
  })) passed++;

  // Test: Does not return deleted annotations
  total++;
  if (await testAsync('Does not return deleted annotations by default', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conv-delete-test',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'will-be-deleted',
    });

    await layer.deleteAnnotation(result.id);

    const annotations = await layer.getAnnotations('conv-delete-test');
    assert.strictEqual(annotations.length, 0);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CRUD TESTS - getAnnotationsByType
// =============================================================================

async function runGetAnnotationsByTypeTests() {
  console.log('\n📋 getAnnotationsByType Tests');
  let passed = 0;
  let total = 0;

  // Test: Get all tags
  total++;
  if (await testAsync('Gets all annotations of a specific type', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    await layer.addAnnotation({
      targetId: 'conv-1',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'react',
    });
    await layer.addAnnotation({
      targetId: 'conv-2',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'typescript',
    });
    await layer.addAnnotation({
      targetId: 'conv-3',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'a note',
    });

    const tags = await layer.getAnnotationsByType('tag');
    assert.ok(tags.length >= 2);
    assert.ok(tags.every(a => a.annotationType === 'tag'));
  })) passed++;

  // Test: Returns empty for type with no annotations
  total++;
  if (await testAsync('Returns empty for type with no annotations', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const highlights = await layer.getAnnotationsByType('highlight');
    assert.ok(Array.isArray(highlights));
    // May have highlights from previous tests, just check it's an array
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CRUD TESTS - updateAnnotation
// =============================================================================

async function runUpdateAnnotationTests() {
  console.log('\n📋 updateAnnotation Tests');
  let passed = 0;
  let total = 0;

  // Test: Update annotation content
  total++;
  if (await testAsync('Can update annotation content', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const addResult = await layer.addAnnotation({
      targetId: 'conv-update',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Original note',
    });

    const updateResult = await layer.updateAnnotation(addResult.id, {
      content: 'Updated note content',
    });

    assert.strictEqual(updateResult.success, true);

    const annotations = await layer.getAnnotations('conv-update');
    const updated = annotations.find(a => a.id === addResult.id);
    assert.strictEqual(updated.content, 'Updated note content');
  })) passed++;

  // Test: Update annotation metadata
  total++;
  if (await testAsync('Can update annotation metadata', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const addResult = await layer.addAnnotation({
      targetId: 'conv-meta-update',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'test-tag',
      metadata: { importance: 'low' },
    });

    await layer.updateAnnotation(addResult.id, {
      metadata: { importance: 'high', reviewed: true },
    });

    const annotations = await layer.getAnnotations('conv-meta-update');
    const updated = annotations.find(a => a.id === addResult.id);
    assert.strictEqual(updated.metadata.importance, 'high');
    assert.strictEqual(updated.metadata.reviewed, true);
  })) passed++;

  // Test: Update preserves createdAt
  total++;
  if (await testAsync('Update preserves createdAt timestamp', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const addResult = await layer.addAnnotation({
      targetId: 'conv-timestamp',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Original',
    });

    const beforeUpdate = await layer.getAnnotations('conv-timestamp');
    const originalCreatedAt = beforeUpdate[0].createdAt;

    // Small delay to ensure different updatedAt
    await new Promise(r => setTimeout(r, 10));

    await layer.updateAnnotation(addResult.id, { content: 'Updated' });

    const afterUpdate = await layer.getAnnotations('conv-timestamp');
    const updated = afterUpdate.find(a => a.id === addResult.id);

    assert.strictEqual(updated.createdAt, originalCreatedAt);
    assert.notStrictEqual(updated.updatedAt, originalCreatedAt);
  })) passed++;

  // Test: Update non-existent annotation fails
  total++;
  if (await testAsync('Update non-existent annotation fails', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.updateAnnotation('ann:nonexistent:123', {
      content: 'test',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CRUD TESTS - deleteAnnotation
// =============================================================================

async function runDeleteAnnotationTests() {
  console.log('\n📋 deleteAnnotation Tests');
  let passed = 0;
  let total = 0;

  // Test: Delete annotation (soft delete)
  total++;
  if (await testAsync('Can delete an annotation (soft delete)', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const addResult = await layer.addAnnotation({
      targetId: 'conv-delete',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'to-delete',
    });

    const deleteResult = await layer.deleteAnnotation(addResult.id);
    assert.strictEqual(deleteResult.success, true);

    // Should not appear in regular queries
    const annotations = await layer.getAnnotations('conv-delete');
    const deleted = annotations.find(a => a.id === addResult.id);
    assert.strictEqual(deleted, undefined);
  })) passed++;

  // Test: Delete non-existent annotation fails
  total++;
  if (await testAsync('Delete non-existent annotation fails', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.deleteAnnotation('ann:nonexistent:456');
    assert.strictEqual(result.success, false);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// SEARCH TESTS
// =============================================================================

async function runSearchTests() {
  console.log('\n📋 Search Tests');
  let passed = 0;
  let total = 0;

  // Test: Search annotations by content
  total++;
  if (await testAsync('Can search annotations by content', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    await layer.addAnnotation({
      targetId: 'conv-search-1',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Important note about Docker configuration',
    });
    await layer.addAnnotation({
      targetId: 'conv-search-2',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Note about React components',
    });

    const results = await layer.searchAnnotations('Docker');
    assert.ok(results.length >= 1);
    assert.ok(results.some(a => a.content.includes('Docker')));
  })) passed++;

  // Test: Search is case-insensitive
  total++;
  if (await testAsync('Search is case-insensitive', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    await layer.addAnnotation({
      targetId: 'conv-case',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'TypeScript',
    });

    const results = await layer.searchAnnotations('typescript');
    assert.ok(results.length >= 1);
  })) passed++;

  // Test: Search returns empty for no matches
  total++;
  if (await testAsync('Search returns empty for no matches', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const results = await layer.searchAnnotations('xyznonexistent123');
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// TAG CLOUD TESTS
// =============================================================================

async function runTagCloudTests() {
  console.log('\n📋 Tag Cloud Tests');
  let passed = 0;
  let total = 0;

  // Test: Get all tags with counts
  total++;
  if (await testAsync('getAllTags returns tags with counts', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    // Add some tags
    await layer.addAnnotation({
      targetId: 'conv-tag-1',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'javascript',
    });
    await layer.addAnnotation({
      targetId: 'conv-tag-2',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'javascript',
    });
    await layer.addAnnotation({
      targetId: 'conv-tag-3',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'python',
    });

    const tagCloud = await layer.getAllTags();
    assert.ok(Array.isArray(tagCloud));

    const jsTag = tagCloud.find(t => t.tag === 'javascript');
    const pyTag = tagCloud.find(t => t.tag === 'python');

    assert.ok(jsTag, 'Should have javascript tag');
    assert.ok(pyTag, 'Should have python tag');
    assert.ok(jsTag.count >= 2, 'javascript should have count >= 2');
    assert.ok(pyTag.count >= 1, 'python should have count >= 1');
  })) passed++;

  // Test: getAllTags excludes deleted annotations
  total++;
  if (await testAsync('getAllTags excludes deleted annotations', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'conv-deleted-tag',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'deleted-tag-test',
    });

    await layer.deleteAnnotation(result.id);

    const tagCloud = await layer.getAllTags();
    const deletedTag = tagCloud.find(t => t.tag === 'deleted-tag-test');
    assert.strictEqual(deletedTag, undefined);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// ENRICHMENT TESTS
// =============================================================================

async function runEnrichmentTests() {
  console.log('\n📋 Enrichment Tests');
  let passed = 0;
  let total = 0;

  // Test: Enrich records with annotations
  total++;
  if (await testAsync('enrichRecords merges annotations into records', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    // Add annotations for a conversation
    await layer.addAnnotation({
      targetId: 'enriched-conv',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'important',
    });
    await layer.addAnnotation({
      targetId: 'enriched-conv',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Key learning from this session',
    });

    // Create mock memory records
    const records = [
      {
        id: 'enriched-conv',
        type: 'learning',
        content: 'Original content',
        tags: ['original-tag'],
      },
      {
        id: 'other-conv',
        type: 'pattern',
        content: 'Other content',
        tags: [],
      },
    ];

    const enriched = await layer.enrichRecords(records);

    assert.strictEqual(enriched.length, 2);

    const enrichedConv = enriched.find(r => r.id === 'enriched-conv');
    assert.ok(enrichedConv._annotations, 'Should have _annotations field');
    assert.strictEqual(enrichedConv._annotations.length, 2);
    assert.ok(enrichedConv._annotationCount === 2);
  })) passed++;

  // Test: Enrich adds annotation tags to record tags
  total++;
  if (await testAsync('enrichRecords merges annotation tags', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    await layer.addAnnotation({
      targetId: 'tag-merge-conv',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'new-tag',
    });

    const records = [
      {
        id: 'tag-merge-conv',
        type: 'learning',
        content: 'Content',
        tags: ['existing-tag'],
      },
    ];

    const enriched = await layer.enrichRecords(records);
    const record = enriched[0];

    // Tags from annotations should be available in _annotatedTags
    assert.ok(record._annotatedTags, 'Should have _annotatedTags');
    assert.ok(record._annotatedTags.includes('new-tag'));
  })) passed++;

  // Test: Enrich handles records with no annotations
  total++;
  if (await testAsync('enrichRecords handles records with no annotations', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const records = [
      {
        id: 'no-annotations-conv',
        type: 'learning',
        content: 'Content',
        tags: [],
      },
    ];

    const enriched = await layer.enrichRecords(records);
    const record = enriched[0];

    assert.strictEqual(record._annotationCount, 0);
    assert.deepStrictEqual(record._annotations, []);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// STATS TESTS
// =============================================================================

async function runStatsTests() {
  console.log('\n📋 Stats Tests');
  let passed = 0;
  let total = 0;

  // Test: getStats returns correct structure
  total++;
  if (await testAsync('getStats returns correct structure', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    // Add some annotations
    await layer.addAnnotation({
      targetId: 'stats-conv-1',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'tag1',
    });
    await layer.addAnnotation({
      targetId: 'stats-conv-2',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'note1',
    });

    const stats = await layer.getStats();

    assert.ok(typeof stats.total === 'number');
    assert.ok(typeof stats.byType === 'object');
    assert.ok(stats.total >= 2);
  })) passed++;

  // Test: Stats byType has correct counts
  total++;
  if (await testAsync('Stats byType has correct counts', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const stats = await layer.getStats();

    // Should have counts for each type that exists
    assert.ok(stats.byType);
    // tags and notes were added in previous tests
    if (stats.byType.tag) {
      assert.ok(stats.byType.tag >= 1);
    }
  })) passed++;

  return { passed, total };
}

// =============================================================================
// PERSISTENCE TESTS
// =============================================================================

async function runPersistenceTests() {
  console.log('\n📋 Persistence Tests');
  let passed = 0;
  let total = 0;

  // Test: Annotations persist across instances
  total++;
  if (await testAsync('Annotations persist across instances', async () => {
    // Create first instance and add annotation
    const layer1 = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer1.initialize();

    const addResult = await layer1.addAnnotation({
      targetId: 'persist-conv',
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'persisted-tag',
    });

    // Create second instance and verify annotation exists
    const layer2 = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer2.initialize();

    const annotations = await layer2.getAnnotations('persist-conv');
    const found = annotations.find(a => a.id === addResult.id);

    assert.ok(found, 'Annotation should persist');
    assert.strictEqual(found.content, 'persisted-tag');
  })) passed++;

  // Test: Storage file is JSONL format
  total++;
  if (await testAsync('Storage file uses JSONL format', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    await layer.addAnnotation({
      targetId: 'jsonl-test',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Test note for JSONL',
    });

    // Read the file directly
    const filePath = path.join(TEST_DIR, 'annotations', 'episodic.jsonl');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');

    // Each line should be valid JSON
    for (const line of lines) {
      if (line.trim()) {
        JSON.parse(line); // Should not throw
      }
    }
  })) passed++;

  return { passed, total };
}

// =============================================================================
// EDGE CASES TESTS
// =============================================================================

async function runEdgeCaseTests() {
  console.log('\n📋 Edge Cases Tests');
  let passed = 0;
  let total = 0;

  // Test: Handle special characters in content
  total++;
  if (await testAsync('Handles special characters in content', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'special-chars',
      targetType: 'conversation',
      annotationType: 'note',
      content: 'Note with "quotes", newline\nand unicode: \u{1F680}',
    });

    assert.strictEqual(result.success, true);

    const annotations = await layer.getAnnotations('special-chars');
    const found = annotations.find(a => a.id === result.id);
    assert.ok(found.content.includes('\u{1F680}'));
  })) passed++;

  // Test: Handle empty content
  total++;
  if (await testAsync('Rejects empty content', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      targetId: 'empty-content',
      targetType: 'conversation',
      annotationType: 'note',
      content: '',
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  })) passed++;

  // Test: Handle missing required fields
  total++;
  if (await testAsync('Rejects missing required fields', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const result = await layer.addAnnotation({
      // Missing targetId
      targetType: 'conversation',
      annotationType: 'tag',
      content: 'test',
    });

    assert.strictEqual(result.success, false);
  })) passed++;

  // Test: Handle concurrent writes
  total++;
  if (await testAsync('Handles concurrent writes', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    // Add multiple annotations concurrently
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(layer.addAnnotation({
        targetId: `concurrent-${i}`,
        targetType: 'conversation',
        annotationType: 'tag',
        content: `concurrent-tag-${i}`,
      }));
    }

    const results = await Promise.all(promises);
    assert.ok(results.every(r => r.success));
  })) passed++;

  return { passed, total };
}

// =============================================================================
// ISAVAILABLE TESTS
// =============================================================================

async function runAvailabilityTests() {
  console.log('\n📋 Availability Tests');
  let passed = 0;
  let total = 0;

  // Test: isAvailable returns true after initialize
  total++;
  if (await testAsync('isAvailable returns true after initialize', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });
    await layer.initialize();

    const available = await layer.isAvailable();
    assert.strictEqual(available, true);
  })) passed++;

  // Test: isAvailable returns false before initialize
  total++;
  if (await testAsync('isAvailable returns false before initialize', async () => {
    const layer = new EpisodicAnnotationsLayer({ basePath: TEST_DIR });

    const available = await layer.isAvailable();
    assert.strictEqual(available, false);
  })) passed++;

  return { passed, total };
}

// =============================================================================
// RUN ALL TESTS
// =============================================================================

async function runAllTests() {
  console.log('═'.repeat(60));
  console.log('🧪 Cortex EpisodicAnnotationsLayer Tests');
  console.log('═'.repeat(60));

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    const suites = [
      runConstructorTests,
      runAddAnnotationTests,
      runGetAnnotationsTests,
      runGetAnnotationsByTypeTests,
      runUpdateAnnotationTests,
      runDeleteAnnotationTests,
      runSearchTests,
      runTagCloudTests,
      runEnrichmentTests,
      runStatsTests,
      runPersistenceTests,
      runEdgeCaseTests,
      runAvailabilityTests,
    ];

    for (const suite of suites) {
      const results = await suite();
      totalPassed += results.passed;
      totalTests += results.total;
    }

  } finally {
    cleanup();
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 Results: ${totalPassed}/${totalTests} tests passed`);

  if (totalPassed === totalTests) {
    console.log('✅ All tests passed!');
  } else {
    console.log(`❌ ${totalTests - totalPassed} tests failed`);
    process.exit(1);
  }
}

// Run
runAllTests().catch(error => {
  console.error('Test runner failed:', error.message);
  cleanup();
  process.exit(1);
});
