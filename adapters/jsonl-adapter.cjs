/**
 * Cortex - Claude's Cognitive Layer - JSONL Adapter
 *
 * Queries local JSONL memory files (working, short-term, long-term, skills).
 * This adapter is ALWAYS available and provides the fastest access to memories.
 *
 * @version 1.1.0
 * @see Design: ../docs/design/memory-orchestrator.md#section-2.3.1
 */

'use strict';

const path = require('path');
const { BaseAdapter } = require('./base-adapter.cjs');
const { JSONLStore } = require('../core/storage.cjs');
const { expandPath } = require('../core/types.cjs');

// =============================================================================
// JSONL ADAPTER
// =============================================================================

/**
 * Adapter for local JSONL memory files
 * Priority: 1.0 (highest) - Always available, fastest access
 */
class JSONLAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} config.basePath - Base path for memory storage
   * @param {Array<{name: string, path: string, maxAge?: number}>} config.sources - JSONL sources
   */
  constructor(config = {}) {
    super({
      name: 'jsonl',
      priority: 1.0,  // Highest priority - always available
      timeout: 100,   // Local files are fast
      enabled: true,  // Always enabled
    });

    this.basePath = expandPath(config.basePath || '~/.claude/memory');

    // Default sources if not provided
    this.sources = config.sources || [
      {
        name: 'working',
        path: 'data/memories/working.jsonl',
        maxAge: 24 * 60 * 60 * 1000,  // 24 hours
        priority: 1.0,
      },
      {
        name: 'short-term',
        path: 'data/memories/short-term.jsonl',
        maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
        priority: 0.9,
      },
      {
        name: 'long-term',
        path: 'data/memories/long-term.jsonl',
        maxAge: null,  // No expiry
        priority: 0.7,
      },
      {
        name: 'skills',
        path: 'data/skills/index.jsonl',
        maxAge: null,
        priority: 0.8,
      },
    ];

    // Store cache (lazy-loaded)
    this._stores = new Map();

    // Track loading promises to prevent race conditions
    this._loadPromises = new Map();
  }

  /**
   * Get or create a store for a source
   * @private
   * @param {string} sourcePath - Relative path to JSONL file
   * @returns {JSONLStore}
   */
  _getStore(sourcePath) {
    const fullPath = path.join(this.basePath, sourcePath);

    if (!this._stores.has(fullPath)) {
      this._stores.set(fullPath, new JSONLStore(fullPath, {
        indexFn: r => r.id,
      }));
    }

    return this._stores.get(fullPath);
  }

  /**
   * Ensure a store is loaded with race condition protection
   * Uses Promise-based guard to prevent concurrent loads
   * @private
   * @param {JSONLStore} store - The store instance
   * @param {string} fullPath - Full path to the store file (used as cache key)
   */
  async _ensureStoreLoaded(store, fullPath) {
    // Already loaded - fast path
    if (store.loaded) return;

    // Check if loading is in progress - serialize concurrent calls
    if (this._loadPromises.has(fullPath)) {
      await this._loadPromises.get(fullPath);
      return;
    }

    // Start loading and track the promise
    const loadPromise = (async () => {
      try {
        await store.load();
      } catch (error) {
        // Remove promise on failure so retry is possible
        this._loadPromises.delete(fullPath);
        console.error(`[JSONLAdapter] Failed to load store ${fullPath}:`, error.message);
        throw error;
      }
    })();

    this._loadPromises.set(fullPath, loadPromise);
    await loadPromise;
    // Keep promise in map - it's resolved, so future awaits return immediately
  }

  /**
   * Query all JSONL sources for relevant memories
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const allResults = [];

      for (const source of this.sources) {
        try {
          const records = await this._querySource(source, context);
          allResults.push(...records);
        } catch (error) {
          // Log error but continue with other sources
          console.error(`[JSONLAdapter] Failed to query ${source.name}:`, error.message);
        }
      }

      // Apply common filters
      const filtered = this._applyQueryOptions(allResults, options);

      // Sort by source priority
      return filtered.sort((a, b) =>
        (b._sourcePriority || 0) - (a._sourcePriority || 0)
      );
    });
  }

  /**
   * Query a single JSONL source
   * @private
   * @param {Object} source - Source configuration
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async _querySource(source, context) {
    const store = this._getStore(source.path);
    const fullPath = path.join(this.basePath, source.path);

    // Ensure store is loaded with race condition protection
    await this._ensureStoreLoaded(store, fullPath);

    let records = store.getAll();

    // Apply maxAge filter
    if (source.maxAge) {
      const cutoff = Date.now() - source.maxAge;
      records = records.filter(r => {
        const ts = new Date(r.timestamp || r.createdAt || 0).getTime();
        return ts >= cutoff;
      });
    }

    // Apply project filter - include global (null) and matching project
    if (context.projectHash) {
      records = records.filter(r =>
        r.projectHash === null || r.projectHash === context.projectHash
      );
    }

    // Normalize all records
    return records.map(r => this.normalize(r, source));
  }

  /**
   * Check if any JSONL source is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // JSONL adapter is always available if files exist
    const fs = require('fs');

    for (const source of this.sources) {
      const fullPath = path.join(this.basePath, source.path);
      if (fs.existsSync(fullPath)) {
        return true;
      }
    }

    // Even if no files exist, we can create them
    return true;
  }

  /**
   * Get statistics for all JSONL sources
   * @returns {Promise<import('./base-adapter.cjs').AdapterStats>}
   */
  async getStats() {
    const baseStats = await super.getStats();

    // Count total records across all sources
    let totalRecords = 0;

    for (const source of this.sources) {
      try {
        const store = this._getStore(source.path);
        const fullPath = path.join(this.basePath, source.path);
        await this._ensureStoreLoaded(store, fullPath);
        totalRecords += store.getAll().length;
      } catch {
        // Skip unavailable sources
      }
    }

    return {
      ...baseStats,
      totalRecords,
      sources: this.sources.map(s => s.name),
    };
  }

  /**
   * Normalize raw JSONL record to MemoryRecord format
   * @param {Object} rawData - Raw record from JSONL file
   * @param {Object} source - Source configuration
   * @returns {import('./base-adapter.cjs').MemoryRecord}
   */
  normalize(rawData, source = {}) {
    // Calculate adjusted priority based on source
    const sourcePriority = source.priority || this.priority;

    return this._createBaseRecord({
      id: rawData.id,
      version: rawData.version || 1,
      type: rawData.type || 'learning',
      content: rawData.content || rawData.summary || '',
      summary: rawData.summary || (rawData.content || '').slice(0, 100),
      projectHash: rawData.projectHash || null,
      tags: rawData.tags || [],
      intent: rawData.intent || 'general',
      sourceSessionId: rawData.sourceSessionId || rawData.sessionId || 'unknown',
      sourceTimestamp: rawData.sourceTimestamp || rawData.timestamp || rawData.createdAt,
      extractionConfidence: rawData.extractionConfidence || rawData.confidence || 0.7,
      usageCount: rawData.usageCount || 0,
      usageSuccessRate: rawData.usageSuccessRate || 0.5,
      lastUsed: rawData.lastUsed || null,
      decayScore: rawData.decayScore || this._calculateDecay(rawData),
      status: rawData.status || 'active',
      createdAt: rawData.createdAt || rawData.timestamp,
      updatedAt: rawData.updatedAt || rawData.timestamp,
      _source: `jsonl:${source.name || 'unknown'}`,
      _sourcePriority: sourcePriority,
    });
  }

  /**
   * Calculate decay score based on age
   * @private
   * @param {Object} record
   * @returns {number} 0.0-1.0
   */
  _calculateDecay(record) {
    const timestamp = new Date(record.timestamp || record.createdAt || 0).getTime();
    const age = Date.now() - timestamp;

    // Decay formula: exponential decay over 30 days
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const decay = Math.exp(-age / thirtyDays);

    return Math.max(0.1, Math.min(1.0, decay));
  }

  /**
   * Query project-specific memory file
   * @param {string} projectHash - Project hash
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async queryProject(projectHash, context, options = {}) {
    if (!projectHash) return [];

    const projectSource = {
      name: `project:${projectHash}`,
      path: `data/projects/${projectHash}.jsonl`,
      maxAge: null,
      priority: 0.85,
    };

    try {
      return await this._querySource(projectSource, context);
    } catch (error) {
      // Project file may not exist yet
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // WRITE OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * JSONL adapter supports write operations
   * @returns {boolean}
   */
  supportsWrite() {
    return true;
  }

  /**
   * Write a new memory record to the appropriate store
   * @param {import('./base-adapter.cjs').MemoryRecord} record - Record to write
   * @param {import('./base-adapter.cjs').WriteOptions} [options] - Write options
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async write(record, options = {}) {
    return this._executeWrite(async () => {
      // Determine target store based on record type or options
      const targetSource = this._selectWriteTarget(record, options);
      const store = this._getStore(targetSource.path);
      const fullPath = path.join(this.basePath, targetSource.path);

      // Ensure store is loaded
      await this._ensureStoreLoaded(store, fullPath);

      // Check for duplicate if not overwriting
      if (!options.overwrite && record.id) {
        const existing = store.get(record.id);
        if (existing) {
          return { success: false, error: 'Record with this ID already exists' };
        }
      }

      // Normalize the record before writing
      const normalizedRecord = this._createBaseRecord({
        ...record,
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: record.status || 'active',
        _source: `jsonl:${targetSource.name}`,
        _sourcePriority: targetSource.priority,
      });

      const result = await store.append(normalizedRecord);
      return {
        success: result.success,
        id: result.id,
        error: result.error,
      };
    });
  }

  /**
   * Update an existing memory record
   * @param {string} id - Record ID to update
   * @param {Partial<import('./base-adapter.cjs').MemoryRecord>} updates - Fields to update
   * @param {import('./base-adapter.cjs').WriteOptions} [options] - Write options
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async update(id, updates, options = {}) {
    return this._executeWrite(async () => {
      // Find which store contains this record
      const { store, fullPath } = await this._findRecordStore(id);

      if (!store) {
        return { success: false, error: 'Record not found' };
      }

      // Perform the update
      const result = await store.update(id, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });

      return {
        success: result.success,
        id,
        error: result.error,
      };
    });
  }

  /**
   * Delete a memory record
   * @param {string} id - Record ID to delete
   * @param {import('./base-adapter.cjs').WriteOptions} [options] - Write options
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async delete(id, options = {}) {
    return this._executeWrite(async () => {
      // Find which store contains this record
      const { store, fullPath } = await this._findRecordStore(id);

      if (!store) {
        return { success: false, error: 'Record not found' };
      }

      if (options.archive) {
        // Soft delete - mark as archived
        const result = await store.update(id, {
          status: 'archived',
          archivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return {
          success: result.success,
          id,
          error: result.error,
        };
      } else {
        // Hard delete - mark as deleted and compact
        const result = await store.softDelete(id);
        return {
          success: result.success,
          id,
          error: result.error,
        };
      }
    });
  }

  /**
   * Archive a memory record (soft delete with archive status)
   * @param {string} id - Record ID to archive
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async archive(id) {
    return this.delete(id, { archive: true });
  }

  /**
   * Get a single record by ID
   * @param {string} id - Record ID
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord|null>}
   */
  async getById(id) {
    const { store, fullPath } = await this._findRecordStore(id);
    if (!store) return null;

    const record = store.get(id);
    if (!record) return null;

    // Find source info for normalization
    const sourceName = fullPath.replace(this.basePath + '/', '')
      .replace('data/memories/', '')
      .replace('.jsonl', '');

    return this.normalize(record, { name: sourceName, priority: this.priority });
  }

  /**
   * Compact all stores (remove deleted records)
   * @param {Object} [options]
   * @param {boolean} [options.removeDeleted=true] - Remove soft-deleted records
   * @returns {Promise<{success: boolean, results: Object}>}
   */
  async compact(options = { removeDeleted: true }) {
    const results = {};
    let allSuccess = true;

    for (const source of this.sources) {
      try {
        const store = this._getStore(source.path);
        const fullPath = path.join(this.basePath, source.path);
        await this._ensureStoreLoaded(store, fullPath);

        const compactResult = await store.compact(options);
        results[source.name] = compactResult;

        if (!compactResult.success) {
          allSuccess = false;
        }
      } catch (error) {
        results[source.name] = { success: false, error: error.message };
        allSuccess = false;
      }
    }

    return { success: allSuccess, results };
  }

  // ---------------------------------------------------------------------------
  // WRITE HELPER METHODS
  // ---------------------------------------------------------------------------

  /**
   * Select target store based on record properties
   * @private
   * @param {import('./base-adapter.cjs').MemoryRecord} record
   * @param {import('./base-adapter.cjs').WriteOptions} options
   * @returns {Object} Source configuration
   */
  _selectWriteTarget(record, options) {
    // Project-specific records go to project store
    if (options.projectHash || record.projectHash) {
      const projectHash = options.projectHash || record.projectHash;
      return {
        name: `project:${projectHash}`,
        path: `data/projects/${projectHash}.jsonl`,
        priority: 0.85,
      };
    }

    // Skills go to skills store
    if (record.type === 'skill') {
      return this.sources.find(s => s.name === 'skills') || this.sources[3];
    }

    // High-priority/recent -> working memory
    if (record.decayScore > 0.9 || record.extractionConfidence > 0.8) {
      return this.sources.find(s => s.name === 'working') || this.sources[0];
    }

    // Default to long-term for persistence
    return this.sources.find(s => s.name === 'long-term') || this.sources[2];
  }

  /**
   * Find which store contains a record by ID
   * @private
   * @param {string} id
   * @returns {Promise<{store: JSONLStore|null, fullPath: string|null}>}
   */
  async _findRecordStore(id) {
    for (const source of this.sources) {
      try {
        const store = this._getStore(source.path);
        const fullPath = path.join(this.basePath, source.path);
        await this._ensureStoreLoaded(store, fullPath);

        if (store.get(id)) {
          return { store, fullPath };
        }
      } catch {
        // Continue searching other stores
      }
    }

    return { store: null, fullPath: null };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  JSONLAdapter,
};
