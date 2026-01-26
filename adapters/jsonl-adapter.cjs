/**
 * Cortex - Claude's Cognitive Layer - JSONL Adapter
 *
 * Queries local JSONL memory files (working, short-term, long-term, skills).
 * This adapter is ALWAYS available and provides the fastest access to memories.
 *
 * @version 1.1.0
 * @see Design: ~/.claude/dev/skill-activator/docs/plans/2026-01-26-claude-memory-orchestrator-design.md#section-2.3.1
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

    // Load if not already loaded
    if (!store.loaded) {
      await store.load();
    }

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
        if (!store.loaded) {
          await store.load();
        }
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
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  JSONLAdapter,
};
