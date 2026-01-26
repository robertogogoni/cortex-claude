/**
 * Cortex - Claude's Cognitive Layer - Storage Layer
 *
 * JSONL-based persistent storage with:
 * - Atomic writes (temp file + rename pattern)
 * - In-memory indexing for fast lookups
 * - Automatic corruption detection and recovery
 * - Append-only design for crash safety
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateId, getTimestamp, expandPath, ERROR_CODES } = require('./types.cjs');

// =============================================================================
// JSONL STORE
// =============================================================================

class JSONLStore {
  /**
   * @param {string} filePath - Path to the JSONL file
   * @param {Object} options
   * @param {Function} options.indexFn - Function to extract index key from record
   * @param {boolean} options.autoCreate - Create file if missing
   */
  constructor(filePath, options = {}) {
    this.filePath = expandPath(filePath);
    this.indexFn = options.indexFn || ((record) => record.id);
    this.autoCreate = options.autoCreate !== false;

    // In-memory index for fast lookups
    this.index = new Map();
    this.records = [];
    this.loaded = false;
    this.dirty = false;

    // Stats for telemetry
    this.stats = {
      reads: 0,
      writes: 0,
      appends: 0,
      errors: 0,
      lastLoadTime: null,
      lastWriteTime: null,
    };
  }

  /**
   * Load all records from file into memory
   * @returns {Promise<{success: boolean, count: number, corrupted: number}>}
   */
  async load() {
    const startTime = Date.now();

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Create empty file if missing
    if (!fs.existsSync(this.filePath)) {
      if (this.autoCreate) {
        fs.writeFileSync(this.filePath, '', { mode: 0o600 });
        this.loaded = true;
        this.stats.lastLoadTime = Date.now() - startTime;
        return { success: true, count: 0, corrupted: 0 };
      }
      return { success: false, count: 0, corrupted: 0, error: ERROR_CODES.CONFIG_MISSING };
    }

    // Read and parse file
    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    let corrupted = 0;
    this.records = [];
    this.index.clear();

    for (let i = 0; i < lines.length; i++) {
      try {
        const record = JSON.parse(lines[i]);
        const key = this.indexFn(record);

        // Handle updates: later records with same key replace earlier ones
        const existingIndex = this.index.get(key);
        if (existingIndex !== undefined) {
          // Mark old record as replaced (for compaction)
          this.records[existingIndex] = null;
        }

        this.index.set(key, this.records.length);
        this.records.push(record);
      } catch (e) {
        corrupted++;
        this.stats.errors++;
        // Log corrupted line but continue
        console.error(`[Cortex Storage] Corrupted line ${i + 1}: ${e.message}`);
      }
    }

    this.loaded = true;
    this.stats.reads++;
    this.stats.lastLoadTime = Date.now() - startTime;

    return { success: true, count: this.records.filter(r => r !== null).length, corrupted };
  }

  /**
   * Get a record by key
   * @param {string} key
   * @returns {Object|null}
   */
  get(key) {
    if (!this.loaded) {
      throw new Error('Store not loaded. Call load() first.');
    }
    const index = this.index.get(key);
    return index !== undefined ? this.records[index] : null;
  }

  /**
   * Get all active records (non-null)
   * @returns {Object[]}
   */
  getAll() {
    if (!this.loaded) {
      throw new Error('Store not loaded. Call load() first.');
    }
    return this.records.filter(r => r !== null);
  }

  /**
   * Query records with a filter function
   * @param {Function} filterFn
   * @returns {Object[]}
   */
  query(filterFn) {
    return this.getAll().filter(filterFn);
  }

  /**
   * Append a new record (atomic)
   * @param {Object} record
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async append(record) {
    if (!this.loaded) {
      throw new Error('Store not loaded. Call load() first.');
    }

    // Ensure record has required fields
    const enrichedRecord = {
      ...record,
      id: record.id || generateId(),
      createdAt: record.createdAt || getTimestamp(),
      updatedAt: getTimestamp(),
    };

    const line = JSON.stringify(enrichedRecord) + '\n';

    try {
      // Atomic append using temp file
      const tempPath = `${this.filePath}.tmp.${process.pid}`;

      // Read current content, append new line
      const current = fs.existsSync(this.filePath)
        ? fs.readFileSync(this.filePath, 'utf8')
        : '';
      fs.writeFileSync(tempPath, current + line, { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);

      // Update in-memory state
      const key = this.indexFn(enrichedRecord);
      const existingIndex = this.index.get(key);
      if (existingIndex !== undefined) {
        this.records[existingIndex] = null; // Replace old
      }
      this.index.set(key, this.records.length);
      this.records.push(enrichedRecord);

      this.stats.appends++;
      this.stats.writes++;
      this.stats.lastWriteTime = Date.now();

      return { success: true, id: enrichedRecord.id };
    } catch (e) {
      this.stats.errors++;
      return { success: false, error: ERROR_CODES.STORAGE_WRITE_FAILED, message: e.message };
    }
  }

  /**
   * Update an existing record
   * @param {string} key
   * @param {Object} updates
   * @returns {Promise<{success: boolean}>}
   */
  async update(key, updates) {
    const existing = this.get(key);
    if (!existing) {
      return { success: false, error: 'Record not found' };
    }

    const updated = {
      ...existing,
      ...updates,
      id: existing.id, // Preserve original ID
      createdAt: existing.createdAt, // Preserve creation time
      updatedAt: getTimestamp(),
    };

    return this.append(updated);
  }

  /**
   * Soft delete a record (marks as deleted)
   * @param {string} key
   * @returns {Promise<{success: boolean}>}
   */
  async softDelete(key) {
    return this.update(key, { status: 'deleted', deletedAt: getTimestamp() });
  }

  /**
   * Compact the file (remove nulls and deleted records)
   * @param {Object} options
   * @param {boolean} options.removeDeleted - Also remove soft-deleted records
   * @returns {Promise<{success: boolean, before: number, after: number}>}
   */
  async compact(options = {}) {
    if (!this.loaded) {
      throw new Error('Store not loaded. Call load() first.');
    }

    const before = this.records.length;
    let activeRecords = this.records.filter(r => r !== null);

    if (options.removeDeleted) {
      activeRecords = activeRecords.filter(r => r.status !== 'deleted');
    }

    // Write compacted file atomically
    const tempPath = `${this.filePath}.tmp.${process.pid}`;
    const content = activeRecords.map(r => JSON.stringify(r)).join('\n') + (activeRecords.length ? '\n' : '');

    try {
      fs.writeFileSync(tempPath, content, { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);

      // Rebuild in-memory state
      this.records = activeRecords;
      this.index.clear();
      activeRecords.forEach((record, i) => {
        this.index.set(this.indexFn(record), i);
      });

      this.stats.writes++;
      this.stats.lastWriteTime = Date.now();

      return { success: true, before, after: activeRecords.length };
    } catch (e) {
      this.stats.errors++;
      return { success: false, error: ERROR_CODES.STORAGE_WRITE_FAILED, message: e.message };
    }
  }

  /**
   * Get storage statistics
   * @returns {Object}
   */
  getStats() {
    const fileSize = fs.existsSync(this.filePath)
      ? fs.statSync(this.filePath).size
      : 0;

    return {
      ...this.stats,
      recordCount: this.records.filter(r => r !== null).length,
      totalSlots: this.records.length,
      nullSlots: this.records.filter(r => r === null).length,
      fileSizeBytes: fileSize,
      fileSizeKB: Math.round(fileSize / 1024 * 10) / 10,
      loaded: this.loaded,
    };
  }
}

// =============================================================================
// MEMORY INDEX
// =============================================================================

class MemoryIndex {
  /**
   * In-memory index with multiple access patterns
   */
  constructor() {
    this.byId = new Map();
    this.byProject = new Map();      // projectHash -> Set<id>
    this.byType = new Map();         // type -> Set<id>
    this.byTag = new Map();          // tag -> Set<id>
    this.byIntent = new Map();       // intent -> Set<id>
    this.byStatus = new Map();       // status -> Set<id>

    this.stats = {
      rebuilds: 0,
      lastRebuildTime: null,
    };
  }

  /**
   * Add a record to all indexes
   * @param {MemoryRecord} record
   */
  add(record) {
    const { id, projectHash, type, tags, intent, status } = record;

    this.byId.set(id, record);

    // Project index (null = global)
    const projectKey = projectHash || '__global__';
    if (!this.byProject.has(projectKey)) {
      this.byProject.set(projectKey, new Set());
    }
    this.byProject.get(projectKey).add(id);

    // Type index
    if (!this.byType.has(type)) {
      this.byType.set(type, new Set());
    }
    this.byType.get(type).add(id);

    // Tag indexes
    for (const tag of (tags || [])) {
      if (!this.byTag.has(tag)) {
        this.byTag.set(tag, new Set());
      }
      this.byTag.get(tag).add(id);
    }

    // Intent index
    if (intent) {
      if (!this.byIntent.has(intent)) {
        this.byIntent.set(intent, new Set());
      }
      this.byIntent.get(intent).add(id);
    }

    // Status index
    if (!this.byStatus.has(status)) {
      this.byStatus.set(status, new Set());
    }
    this.byStatus.get(status).add(id);
  }

  /**
   * Remove a record from all indexes
   * @param {string} id
   */
  remove(id) {
    const record = this.byId.get(id);
    if (!record) return;

    this.byId.delete(id);

    const projectKey = record.projectHash || '__global__';
    this.byProject.get(projectKey)?.delete(id);
    this.byType.get(record.type)?.delete(id);
    this.byIntent.get(record.intent)?.delete(id);
    this.byStatus.get(record.status)?.delete(id);

    for (const tag of (record.tags || [])) {
      this.byTag.get(tag)?.delete(id);
    }
  }

  /**
   * Rebuild indexes from a list of records
   * @param {MemoryRecord[]} records
   */
  rebuild(records) {
    const startTime = Date.now();

    // Clear all indexes
    this.byId.clear();
    this.byProject.clear();
    this.byType.clear();
    this.byTag.clear();
    this.byIntent.clear();
    this.byStatus.clear();

    // Rebuild from records
    for (const record of records) {
      if (record) this.add(record);
    }

    this.stats.rebuilds++;
    this.stats.lastRebuildTime = Date.now() - startTime;
  }

  /**
   * Query using multiple criteria
   * @param {Object} criteria
   * @returns {MemoryRecord[]}
   */
  query(criteria) {
    let resultIds = null;

    // Start with most restrictive filter
    if (criteria.id) {
      const record = this.byId.get(criteria.id);
      return record ? [record] : [];
    }

    // Intersect all matching criteria
    const filters = [
      { key: 'projectHash', index: this.byProject, value: criteria.projectHash || '__global__' },
      { key: 'type', index: this.byType, value: criteria.type },
      { key: 'intent', index: this.byIntent, value: criteria.intent },
      { key: 'status', index: this.byStatus, value: criteria.status || 'active' },
    ];

    for (const { key, index, value } of filters) {
      if (value) {
        const matches = index.get(value);
        if (!matches) return [];

        if (resultIds === null) {
          resultIds = new Set(matches);
        } else {
          resultIds = new Set([...resultIds].filter(id => matches.has(id)));
        }
      }
    }

    // Tag intersection (all tags must match)
    if (criteria.tags?.length) {
      for (const tag of criteria.tags) {
        const matches = this.byTag.get(tag);
        if (!matches) return [];

        if (resultIds === null) {
          resultIds = new Set(matches);
        } else {
          resultIds = new Set([...resultIds].filter(id => matches.has(id)));
        }
      }
    }

    // Convert IDs to records
    if (resultIds === null) {
      return Array.from(this.byId.values());
    }

    return Array.from(resultIds)
      .map(id => this.byId.get(id))
      .filter(Boolean);
  }

  /**
   * Get index statistics
   * @returns {Object}
   */
  getStats() {
    return {
      totalRecords: this.byId.size,
      projects: this.byProject.size,
      types: this.byType.size,
      tags: this.byTag.size,
      intents: this.byIntent.size,
      statuses: this.byStatus.size,
      ...this.stats,
    };
  }
}

// =============================================================================
// STORAGE MANAGER
// =============================================================================

class StorageManager {
  /**
   * High-level storage manager coordinating JSONL stores and indexes
   */
  constructor(basePath = '~/.claude/memory') {
    this.basePath = expandPath(basePath);

    // Initialize stores
    this.memories = new JSONLStore(
      path.join(this.basePath, 'data/memories/global.jsonl'),
      { indexFn: r => r.id }
    );

    this.patterns = new JSONLStore(
      path.join(this.basePath, 'data/patterns/decisions.jsonl'),
      { indexFn: r => r.id }
    );

    this.outcomes = new JSONLStore(
      path.join(this.basePath, 'data/patterns/outcomes.jsonl'),
      { indexFn: r => r.decisionId }
    );

    // In-memory indexes
    this.memoryIndex = new MemoryIndex();

    this.initialized = false;
  }

  /**
   * Initialize all stores
   * @returns {Promise<{success: boolean}>}
   */
  async initialize() {
    const results = await Promise.all([
      this.memories.load(),
      this.patterns.load(),
      this.outcomes.load(),
    ]);

    // Build memory index
    this.memoryIndex.rebuild(this.memories.getAll());

    this.initialized = true;

    return {
      success: results.every(r => r.success),
      stores: {
        memories: results[0],
        patterns: results[1],
        outcomes: results[2],
      },
      indexStats: this.memoryIndex.getStats(),
    };
  }

  /**
   * Get project-specific store path
   * @param {string} projectHash
   * @returns {string}
   */
  getProjectStorePath(projectHash) {
    return path.join(this.basePath, `data/memories/projects/${projectHash}.jsonl`);
  }

  /**
   * Get or create project store
   * @param {string} projectHash
   * @returns {JSONLStore}
   */
  async getProjectStore(projectHash) {
    const store = new JSONLStore(
      this.getProjectStorePath(projectHash),
      { indexFn: r => r.id }
    );
    await store.load();
    return store;
  }

  /**
   * Get all storage statistics
   * @returns {Object}
   */
  getStats() {
    return {
      memories: this.memories.getStats(),
      patterns: this.patterns.getStats(),
      outcomes: this.outcomes.getStats(),
      index: this.memoryIndex.getStats(),
      initialized: this.initialized,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  JSONLStore,
  MemoryIndex,
  StorageManager,
};
