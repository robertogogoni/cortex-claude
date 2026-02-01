#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Gemini Adapter Tests
 *
 * Tests for the GeminiAdapter which reads Google Antigravity/Gemini
 * task sessions from ~/.gemini/antigravity/brain/
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test utilities
const TEST_DIR = path.join(os.tmpdir(), 'gemini-adapter-test-' + Date.now());
const MOCK_BRAIN_DIR = path.join(TEST_DIR, '.gemini', 'antigravity', 'brain');

// Sample UUIDs for test sessions
const SESSION_1_UUID = '02e3c4fb-e4f3-4169-a09b-0a7e984f1c43';
const SESSION_2_UUID = '56053522-4df5-40fc-b98d-09bb0f027059';
const SESSION_3_UUID = '7fd50d40-f892-4815-9ef6-ccab85b322ca';

// Sample markdown content (realistic examples from actual Gemini sessions)
const SAMPLE_TASK_MD = `# Task: Debug Critical Functionality
- [x] Debug Stream Parsing <!-- id: 10 -->
    - [x] Locate stream interception logic <!-- id: 11 -->
    - [x] Verify content script injection and matching <!-- id: 12 -->
- [x] Debug Download Functionality <!-- id: 17 -->
    - [x] Verify extension -> companion communication <!-- id: 18 -->
`;

const SAMPLE_IMPLEMENTATION_PLAN_MD = `# Phase 3: Final Integration & Full Functionality

## Goal Description
The objective is to achieve a fully functional extension where a user can detect a stream, click download, see progress, and get a merged MP4 file.

## Proposed Changes

### Background & Offscreen
Fix the communication pipeline for file merging.

#### [MODIFY] [index.html](file:///home/rob/cat-catch-enhanced/src/offscreen/index.html)
- Change script source to load correct entry point.

### User Interface
Ensure the user sees what's happening with download progress.
`;

const SAMPLE_WALKTHROUGH_MD = `# Automated Testing Setup & Verification

## Overview
We have successfully set up an automated testing environment using **Vitest** and **JSDOM**.

## Environment Configuration
- **Test Runner**: Vitest
- **Environment**: JSDOM (Simulates browser DOM)
- **Mocks**: Custom setup.ts mocking chrome.* APIs and Dexie.

## Verification Results

### Unit Tests
All tests passed (3/3), confirming store synchronization works correctly.

### Integration Verification
1. **Build Success**: The project builds cleanly.
2. **Linting**: Fixed all type errors.
`;

const SAMPLE_VERIFICATION_PLAN_MD = `# Verification Plan: Docker Container Setup

## Objective
Verify that the docker-compose setup correctly initializes all services.

## Manual Verification Steps
1. Build & Install: Run docker-compose up.
2. Check Services: Verify all containers are running.
3. Test Connectivity: Ensure services can communicate.

## Automated Tests
Run integration test suite to verify end-to-end flow.
`;

function setup() {
  // Create mock brain directory structure
  fs.mkdirSync(MOCK_BRAIN_DIR, { recursive: true });

  // Session 1: Full session with all file types
  const session1Dir = path.join(MOCK_BRAIN_DIR, SESSION_1_UUID);
  fs.mkdirSync(session1Dir, { recursive: true });
  fs.writeFileSync(path.join(session1Dir, 'task.md'), SAMPLE_TASK_MD);
  fs.writeFileSync(path.join(session1Dir, 'implementation_plan.md'), SAMPLE_IMPLEMENTATION_PLAN_MD);
  fs.writeFileSync(path.join(session1Dir, 'walkthrough.md'), SAMPLE_WALKTHROUGH_MD);
  fs.writeFileSync(path.join(session1Dir, 'verification_plan.md'), SAMPLE_VERIFICATION_PLAN_MD);

  // Session 2: Partial session (only task.md and implementation_plan.md)
  const session2Dir = path.join(MOCK_BRAIN_DIR, SESSION_2_UUID);
  fs.mkdirSync(session2Dir, { recursive: true });
  fs.writeFileSync(path.join(session2Dir, 'task.md'), '# Task: Install Warp Terminal\n- [ ] Download warp\n');
  fs.writeFileSync(path.join(session2Dir, 'implementation_plan.md'), '# Installation Plan\n## Steps\n1. Download from website\n2. Run installer\n');

  // Session 3: Minimal session (only task.md)
  const session3Dir = path.join(MOCK_BRAIN_DIR, SESSION_3_UUID);
  fs.mkdirSync(session3Dir, { recursive: true });
  fs.writeFileSync(path.join(session3Dir, 'task.md'), '# Task: Configure Git\n- [ ] Set user.name\n- [ ] Set user.email\n');

  // Empty session directory (edge case)
  const emptySessionDir = path.join(MOCK_BRAIN_DIR, '00000000-0000-0000-0000-000000000000');
  fs.mkdirSync(emptySessionDir, { recursive: true });
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

let GeminiAdapter, BaseAdapter;

try {
  ({ GeminiAdapter } = require('../adapters/gemini-adapter.cjs'));
  ({ BaseAdapter } = require('../adapters/base-adapter.cjs'));
} catch (error) {
  console.error('Failed to import GeminiAdapter:', error.message);
  console.error('This is expected if running tests before implementation.');
  console.error(error.stack);
  process.exit(1);
}

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

async function runConstructorTests() {
  console.log('\n📋 GeminiAdapter Constructor Tests');
  let passed = 0;
  let total = 0;

  // Test: Extends BaseAdapter
  total++;
  if (test('GeminiAdapter extends BaseAdapter', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    assert.ok(adapter instanceof BaseAdapter, 'Should extend BaseAdapter');
  })) passed++;

  // Test: Default configuration
  total++;
  if (test('Uses correct default configuration', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    assert.strictEqual(adapter.name, 'gemini', 'Name should be "gemini"');
    assert.strictEqual(adapter.priority, 0.7, 'Priority should be 0.7');
    assert.strictEqual(adapter.timeout, 200, 'Timeout should be 200ms');
    assert.strictEqual(adapter.enabled, true, 'Should be enabled by default');
  })) passed++;

  // Test: Auto-discovers brain path when not provided
  total++;
  if (test('Auto-discovers default brain path', () => {
    const adapter = new GeminiAdapter({});
    const expectedPath = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    assert.strictEqual(adapter.brainPath, expectedPath, 'Should auto-discover default brain path');
  })) passed++;

  // Test: Accepts explicit brain path
  total++;
  if (test('Accepts explicit brain path', () => {
    const customPath = '/custom/brain/path';
    const adapter = new GeminiAdapter({ brainPath: customPath });
    assert.strictEqual(adapter.brainPath, customPath, 'Should use provided brain path');
  })) passed++;

  // Test: Read-only adapter
  total++;
  if (test('supportsWrite returns false (read-only)', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    assert.strictEqual(adapter.supportsWrite(), false, 'Should not support writes');
  })) passed++;

  // Test: Custom enabled flag
  total++;
  if (test('Respects enabled flag', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR, enabled: false });
    assert.strictEqual(adapter.enabled, false, 'Should respect enabled flag');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// AVAILABILITY TESTS
// =============================================================================

async function runAvailabilityTests() {
  console.log('\n📋 GeminiAdapter Availability Tests');
  let passed = 0;
  let total = 0;

  // Test: isAvailable returns true for existing brain directory
  total++;
  if (await testAsync('isAvailable returns true for valid brain directory', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const available = await adapter.isAvailable();
    assert.strictEqual(available, true, 'Should be available when brain directory exists');
  })) passed++;

  // Test: isAvailable returns false for non-existent directory
  total++;
  if (await testAsync('isAvailable returns false for non-existent directory', async () => {
    const adapter = new GeminiAdapter({ brainPath: '/nonexistent/path/brain' });
    const available = await adapter.isAvailable();
    assert.strictEqual(available, false, 'Should not be available when directory does not exist');
  })) passed++;

  // Test: getSessionCount returns correct count
  total++;
  if (await testAsync('getSessionCount returns correct session count', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const count = await adapter.getSessionCount();
    // We have 4 session directories (3 with content + 1 empty)
    assert.strictEqual(count, 4, 'Should count all session directories');
  })) passed++;

  // Test: getSessionCount returns 0 for non-existent directory
  total++;
  if (await testAsync('getSessionCount returns 0 for non-existent directory', async () => {
    const adapter = new GeminiAdapter({ brainPath: '/nonexistent/path/brain' });
    const count = await adapter.getSessionCount();
    assert.strictEqual(count, 0, 'Should return 0 for non-existent directory');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// QUERY TESTS
// =============================================================================

async function runQueryTests() {
  console.log('\n📋 GeminiAdapter Query Tests');
  let passed = 0;
  let total = 0;

  // Test: Query returns results from all sessions
  total++;
  if (await testAsync('Query returns results from sessions', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({});
    assert.ok(results.length > 0, 'Should return results');
    assert.ok(results.every(r => r._source === 'gemini'), 'All results should have source "gemini"');
  })) passed++;

  // Test: Query respects limit option
  total++;
  if (await testAsync('Query respects limit option', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({}, { limit: 2 });
    assert.ok(results.length <= 2, 'Should respect limit');
  })) passed++;

  // Test: Query filters by memory type
  total++;
  if (await testAsync('Query filters by memory type', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({}, { types: ['skill'] });
    assert.ok(results.every(r => r.type === 'skill'), 'All results should be skills');
  })) passed++;

  // Test: Query searches content
  total++;
  if (await testAsync('Query searches content by tags', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({ tags: ['docker'] });
    assert.ok(results.length > 0, 'Should find results matching docker');
    assert.ok(
      results.some(r => r.content.toLowerCase().includes('docker')),
      'At least one result should contain docker'
    );
  })) passed++;

  // Test: Query handles empty brain directory
  total++;
  if (await testAsync('Query handles non-existent brain directory', async () => {
    const adapter = new GeminiAdapter({ brainPath: '/nonexistent/path' });
    const results = await adapter.query({});
    assert.strictEqual(results.length, 0, 'Should return empty array for non-existent directory');
  })) passed++;

  // Test: Query filters by minConfidence
  total++;
  if (await testAsync('Query filters by minimum confidence', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({}, { minConfidence: 0.95 });
    assert.ok(
      results.every(r => r.extractionConfidence >= 0.95),
      'All results should meet minimum confidence'
    );
  })) passed++;

  return { passed, total };
}

// =============================================================================
// NORMALIZE TESTS
// =============================================================================

async function runNormalizeTests() {
  console.log('\n📋 GeminiAdapter Normalize Tests');
  let passed = 0;
  let total = 0;

  // Test: Normalizes task.md to skill type with confidence 1.0
  total++;
  if (test('Normalizes task.md to skill type with confidence 1.0', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: SAMPLE_TASK_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    assert.strictEqual(record.type, 'skill', 'task.md should be skill type');
    assert.strictEqual(record.extractionConfidence, 1.0, 'task.md should have confidence 1.0');
    assert.ok(record.id.includes(SESSION_1_UUID), 'ID should include session UUID');
    assert.ok(record.id.includes('task.md'), 'ID should include file name');
  })) passed++;

  // Test: Normalizes implementation_plan.md to pattern type
  total++;
  if (test('Normalizes implementation_plan.md to pattern type with confidence 0.9', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'implementation_plan.md',
      content: SAMPLE_IMPLEMENTATION_PLAN_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'implementation_plan.md'),
    });

    assert.strictEqual(record.type, 'pattern', 'implementation_plan.md should be pattern type');
    assert.strictEqual(record.extractionConfidence, 0.9, 'implementation_plan.md should have confidence 0.9');
  })) passed++;

  // Test: Normalizes walkthrough.md to skill type
  total++;
  if (test('Normalizes walkthrough.md to skill type with confidence 0.8', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'walkthrough.md',
      content: SAMPLE_WALKTHROUGH_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'walkthrough.md'),
    });

    assert.strictEqual(record.type, 'skill', 'walkthrough.md should be skill type');
    assert.strictEqual(record.extractionConfidence, 0.8, 'walkthrough.md should have confidence 0.8');
  })) passed++;

  // Test: Normalizes verification_plan.md to pattern type
  total++;
  if (test('Normalizes verification_plan.md to pattern type with confidence 0.7', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'verification_plan.md',
      content: SAMPLE_VERIFICATION_PLAN_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'verification_plan.md'),
    });

    assert.strictEqual(record.type, 'pattern', 'verification_plan.md should be pattern type');
    assert.strictEqual(record.extractionConfidence, 0.7, 'verification_plan.md should have confidence 0.7');
  })) passed++;

  // Test: Extracts title from first # heading
  total++;
  if (test('Extracts title from first # heading as summary', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: SAMPLE_TASK_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    assert.ok(
      record.summary.includes('Debug Critical Functionality'),
      'Summary should include title from # heading'
    );
  })) passed++;

  // Test: Extracts tags from content
  total++;
  if (test('Extracts technology tags from content', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'verification_plan.md',
      content: SAMPLE_VERIFICATION_PLAN_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'verification_plan.md'),
    });

    assert.ok(record.tags.includes('docker'), 'Should extract docker tag');
  })) passed++;

  // Test: Handles null input
  total++;
  if (test('Returns null for null input', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize(null);
    assert.strictEqual(record, null, 'Should return null for null input');
  })) passed++;

  // Test: Handles missing content
  total++;
  if (test('Handles missing content gracefully', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: '',
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    assert.ok(record, 'Should return a record');
    assert.strictEqual(record.content, '', 'Content should be empty string');
  })) passed++;

  // Test: Record has all required fields
  total++;
  if (test('Normalized record has all required MemoryRecord fields', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: SAMPLE_TASK_MD,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    // Check all required MemoryRecord fields
    assert.ok(record.id, 'Should have id');
    assert.ok(record.version, 'Should have version');
    assert.ok(record.type, 'Should have type');
    assert.ok(typeof record.content === 'string', 'Should have content');
    assert.ok(typeof record.summary === 'string', 'Should have summary');
    assert.ok(Array.isArray(record.tags), 'Should have tags array');
    assert.ok(record.sourceSessionId, 'Should have sourceSessionId');
    assert.ok(record.sourceTimestamp, 'Should have sourceTimestamp');
    assert.ok(typeof record.extractionConfidence === 'number', 'Should have extractionConfidence');
    assert.ok(typeof record.usageCount === 'number', 'Should have usageCount');
    assert.ok(typeof record.usageSuccessRate === 'number', 'Should have usageSuccessRate');
    assert.ok(typeof record.decayScore === 'number', 'Should have decayScore');
    assert.ok(record.status, 'Should have status');
    assert.ok(record.createdAt, 'Should have createdAt');
    assert.ok(record.updatedAt, 'Should have updatedAt');
    assert.strictEqual(record._source, 'gemini', 'Should have _source set to gemini');
    assert.strictEqual(record._sourcePriority, 0.7, 'Should have _sourcePriority');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// CACHING TESTS
// =============================================================================

async function runCachingTests() {
  console.log('\n📋 GeminiAdapter Caching Tests');
  let passed = 0;
  let total = 0;

  // Test: Cache is populated after first query
  total++;
  if (await testAsync('Cache is populated after first query', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });

    // First query should populate cache
    await adapter.query({});

    // Cache should have entries
    const stats = await adapter.getStats();
    assert.ok(stats.cacheHitRate === 0, 'Cache hit rate should be 0 after first query');
  })) passed++;

  // Test: Second query uses cache
  total++;
  if (await testAsync('Second identical query uses cache', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });

    // First query
    const results1 = await adapter.query({});

    // Second query (should hit cache)
    const results2 = await adapter.query({});

    // Results should be identical
    assert.strictEqual(results1.length, results2.length, 'Results should be identical');

    // Check cache hit tracking
    const stats = await adapter.getStats();
    assert.ok(stats.cacheHitRate > 0, 'Cache hit rate should be greater than 0 after second query');
  })) passed++;

  // Test: Cache respects TTL
  total++;
  if (await testAsync('Cache expires after TTL', async () => {
    // Create adapter with very short TTL for testing
    const adapter = new GeminiAdapter({
      brainPath: MOCK_BRAIN_DIR,
      cacheTTL: 50, // 50ms TTL for testing
    });

    // First query
    await adapter.query({});

    // Wait for cache to expire
    await new Promise(resolve => setTimeout(resolve, 100));

    // Reset stats to track new cache behavior
    adapter._stats.cacheHits = 0;
    adapter._stats.cacheMisses = 0;

    // Third query should miss cache (expired)
    await adapter.query({});

    const stats = await adapter.getStats();
    assert.strictEqual(stats.cacheHitRate, 0, 'Cache should have expired');
  })) passed++;

  // Test: clearCache works
  total++;
  if (await testAsync('clearCache invalidates all cached data', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });

    // Populate cache
    await adapter.query({});

    // Clear cache
    adapter.clearCache();

    // Reset stats
    adapter._stats.cacheHits = 0;
    adapter._stats.cacheMisses = 0;

    // Next query should miss cache
    await adapter.query({});

    const stats = await adapter.getStats();
    assert.strictEqual(stats.cacheHitRate, 0, 'Cache should be empty after clearCache');
  })) passed++;

  // Test: Different queries don't share cache
  total++;
  if (await testAsync('Different queries do not share cache', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });

    // Query with no filters
    await adapter.query({});

    // Reset stats
    adapter._stats.cacheHits = 0;
    adapter._stats.cacheMisses = 0;

    // Query with different options (should miss cache)
    await adapter.query({}, { limit: 1 });

    const stats = await adapter.getStats();
    // Different query options should not hit cache
    assert.strictEqual(stats.cacheHitRate, 0, 'Different queries should not share cache');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

async function runEdgeCaseTests() {
  console.log('\n📋 GeminiAdapter Edge Case Tests');
  let passed = 0;
  let total = 0;

  // Test: Handles empty session directories
  total++;
  if (await testAsync('Handles empty session directories gracefully', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({});

    // Should still return results from valid sessions
    assert.ok(results.length > 0, 'Should return results from valid sessions');
  })) passed++;

  // Test: Handles non-markdown files
  total++;
  if (await testAsync('Ignores non-markdown files', async () => {
    // Create a non-markdown file
    const session1Dir = path.join(MOCK_BRAIN_DIR, SESSION_1_UUID);
    fs.writeFileSync(path.join(session1Dir, 'image.png'), 'fake image data');
    fs.writeFileSync(path.join(session1Dir, 'data.json'), '{"key": "value"}');

    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const results = await adapter.query({});

    // Should only include .md files
    assert.ok(
      results.every(r => r.id.endsWith('.md')),
      'All results should be from .md files'
    );

    // Cleanup
    fs.unlinkSync(path.join(session1Dir, 'image.png'));
    fs.unlinkSync(path.join(session1Dir, 'data.json'));
  })) passed++;

  // Test: Handles files with no # heading
  total++;
  if (test('Handles files with no # heading', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: 'Just some content without a heading',
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    assert.ok(record.summary, 'Should have a summary even without heading');
    assert.ok(record.summary.length <= 100, 'Summary should be truncated to 100 chars');
  })) passed++;

  // Test: Handles very long content
  total++;
  if (test('Handles very long content', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const longContent = '# Very Long Task\n' + 'x'.repeat(10000);
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: longContent,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    assert.ok(record, 'Should handle long content');
    assert.ok(record.summary.length <= 100, 'Summary should be truncated');
  })) passed++;

  // Test: Handles special characters in content
  total++;
  if (test('Handles special characters in content', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const specialContent = '# Task with $pecial Ch@racters!\n- Item with "quotes"\n- Item with <html>';
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'task.md',
      content: specialContent,
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'task.md'),
    });

    assert.ok(record, 'Should handle special characters');
    assert.ok(record.content.includes('$pecial'), 'Should preserve special characters');
  })) passed++;

  // Test: Unknown file type defaults to learning
  total++;
  if (test('Unknown file type defaults to learning', () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    const record = adapter.normalize({
      sessionId: SESSION_1_UUID,
      fileName: 'random_file.md',
      content: '# Random Notes\nSome random notes here.',
      filePath: path.join(MOCK_BRAIN_DIR, SESSION_1_UUID, 'random_file.md'),
    });

    assert.strictEqual(record.type, 'learning', 'Unknown file type should default to learning');
    assert.ok(record.extractionConfidence < 1.0, 'Unknown file should have lower confidence');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// STATS TESTS
// =============================================================================

async function runStatsTests() {
  console.log('\n📋 GeminiAdapter Stats Tests');
  let passed = 0;
  let total = 0;

  // Test: getStats returns valid structure
  total++;
  if (await testAsync('getStats returns valid AdapterStats structure', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });
    await adapter.query({});

    const stats = await adapter.getStats();

    assert.strictEqual(stats.name, 'gemini', 'Name should be gemini');
    assert.strictEqual(stats.supportsWrite, false, 'Should not support write');
    assert.strictEqual(typeof stats.available, 'boolean', 'available should be boolean');
    assert.strictEqual(typeof stats.totalRecords, 'number', 'totalRecords should be number');
    assert.strictEqual(typeof stats.lastQueryTime, 'number', 'lastQueryTime should be number');
    assert.strictEqual(typeof stats.cacheHitRate, 'number', 'cacheHitRate should be number');
  })) passed++;

  // Test: Query updates totalRecords
  total++;
  if (await testAsync('Query updates totalRecords stat', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });

    // Initially 0
    let stats = await adapter.getStats();
    assert.strictEqual(stats.totalRecords, 0, 'Initial totalRecords should be 0');

    // After query
    await adapter.query({});
    stats = await adapter.getStats();
    assert.ok(stats.totalRecords > 0, 'totalRecords should be updated after query');
  })) passed++;

  // Test: Query updates lastQueryTime
  total++;
  if (await testAsync('Query updates lastQueryTime stat', async () => {
    const adapter = new GeminiAdapter({ brainPath: MOCK_BRAIN_DIR });

    await adapter.query({});
    const stats = await adapter.getStats();

    assert.ok(stats.lastQueryTime >= 0, 'lastQueryTime should be set');
  })) passed++;

  return { passed, total };
}

// =============================================================================
// RUN ALL TESTS
// =============================================================================

async function runAllTests() {
  console.log('═'.repeat(60));
  console.log('🧪 GeminiAdapter Tests');
  console.log('═'.repeat(60));

  setup();

  let totalPassed = 0;
  let totalTests = 0;

  try {
    const constructorResults = await runConstructorTests();
    totalPassed += constructorResults.passed;
    totalTests += constructorResults.total;

    const availabilityResults = await runAvailabilityTests();
    totalPassed += availabilityResults.passed;
    totalTests += availabilityResults.total;

    const queryResults = await runQueryTests();
    totalPassed += queryResults.passed;
    totalTests += queryResults.total;

    const normalizeResults = await runNormalizeTests();
    totalPassed += normalizeResults.passed;
    totalTests += normalizeResults.total;

    const cachingResults = await runCachingTests();
    totalPassed += cachingResults.passed;
    totalTests += cachingResults.total;

    const edgeCaseResults = await runEdgeCaseTests();
    totalPassed += edgeCaseResults.passed;
    totalTests += edgeCaseResults.total;

    const statsResults = await runStatsTests();
    totalPassed += statsResults.passed;
    totalTests += statsResults.total;

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
