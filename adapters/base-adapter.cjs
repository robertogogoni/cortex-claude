/**
 * Cortex - Claude's Cognitive Layer - Base Adapter Interface
 *
 * Abstract base class that all memory adapters must implement.
 * Provides the unified interface for querying any memory source.
 *
 * @version 1.1.0
 * @see Design: ~/.claude/dev/skill-activator/docs/plans/2026-01-26-claude-memory-orchestrator-design.md#section-2
 */

'use strict';

// =============================================================================
// TYPE DEFINITIONS (JSDoc for type safety without TypeScript)
// =============================================================================

/**
 * @typedef {'learning' | 'pattern' | 'skill' | 'correction' | 'preference'} MemoryType
 */

/**
 * @typedef {Object} MemoryRecord
 * @property {string} id - Unique identifier
 * @property {number} version - Schema version
 * @property {MemoryType} type - Memory type
 * @property {string} content - Full content
 * @property {string} summary - Brief summary (< 100 chars)
 * @property {string|null} projectHash - null = global
 * @property {string[]} tags - Searchable tags
 * @property {string} intent - Original intent category
 * @property {string} sourceSessionId - Source session
 * @property {string} sourceTimestamp - ISO 8601 timestamp
 * @property {number} extractionConfidence - 0.0-1.0
 * @property {number} usageCount - Times used
 * @property {number} usageSuccessRate - 0.0-1.0
 * @property {string|null} lastUsed - ISO timestamp or null
 * @property {number} decayScore - 0.0-1.0, decreases over time
 * @property {'active' | 'archived' | 'deleted'} status
 * @property {string} createdAt - ISO 8601
 * @property {string} updatedAt - ISO 8601
 * @property {string} [_source] - Source adapter name (internal)
 * @property {number} [_sourcePriority] - Source priority (internal)
 * @property {number} [relevanceScore] - Calculated relevance (internal)
 */

/**
 * @typedef {Object} AdapterStats
 * @property {string} name - Adapter name
 * @property {boolean} available - Whether source is available
 * @property {number} totalRecords - Total records in source
 * @property {number} lastQueryTime - Last query duration (ms)
 * @property {number} cacheHitRate - Cache hit percentage 0.0-1.0
 * @property {number} errorCount - Number of errors since startup
 */

/**
 * @typedef {Object} AnalysisContext
 * @property {string|null} projectHash - Current project hash
 * @property {string|null} projectName - Project name
 * @property {string|null} projectType - Project type (nodejs, python, etc.)
 * @property {string|null} intent - Detected intent
 * @property {number} intentConfidence - Intent confidence 0.0-1.0
 * @property {string[]} tags - Extracted tags
 * @property {string[]} domains - Detected domains
 * @property {string|null} gitBranch - Current git branch
 */

/**
 * @typedef {Object} QueryOptions
 * @property {number} [limit] - Maximum results
 * @property {MemoryType[]} [types] - Filter by memory types
 * @property {string} [projectHash] - Filter by project
 * @property {number} [minConfidence] - Minimum confidence threshold
 */

// =============================================================================
// BASE ADAPTER CLASS
// =============================================================================

/**
 * Abstract base class for memory adapters
 * All adapters must extend this class and implement the abstract methods
 */
class BaseAdapter {
  /**
   * @param {Object} config - Adapter configuration
   * @param {string} config.name - Unique adapter identifier
   * @param {number} config.priority - Priority for ranking (0.0-1.0)
   * @param {number} config.timeout - Query timeout in ms
   */
  constructor(config) {
    if (this.constructor === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly');
    }

    if (!config.name) {
      throw new Error('Adapter name is required');
    }

    /** @readonly */
    this.name = config.name;

    /** @readonly */
    this.priority = typeof config.priority === 'number' ? config.priority : 0.5;

    /** @readonly */
    this.timeout = typeof config.timeout === 'number' ? config.timeout : 500;

    /** @type {boolean} */
    this.enabled = config.enabled !== false;

    // Stats tracking
    this._stats = {
      queriesTotal: 0,
      queriesSuccessful: 0,
      queriesFailed: 0,
      totalRecords: 0,
      lastQueryTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: [],
    };
  }

  // ---------------------------------------------------------------------------
  // ABSTRACT METHODS - Must be implemented by subclasses
  // ---------------------------------------------------------------------------

  /**
   * Query this source for relevant memories
   * @abstract
   * @param {AnalysisContext} context - Analysis context from ContextAnalyzer
   * @param {QueryOptions} [options] - Query options
   * @returns {Promise<MemoryRecord[]>} Array of memory records
   */
  async query(context, options) {
    throw new Error('query() must be implemented by subclass');
  }

  /**
   * Check if this adapter's source is available
   * @abstract
   * @returns {Promise<boolean>} True if source is available
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by subclass');
  }

  /**
   * Transform source-specific data to normalized MemoryRecord
   * @abstract
   * @param {unknown} rawData - Raw data from source
   * @returns {MemoryRecord} Normalized memory record
   */
  normalize(rawData) {
    throw new Error('normalize() must be implemented by subclass');
  }

  // ---------------------------------------------------------------------------
  // CONCRETE METHODS - Shared implementation
  // ---------------------------------------------------------------------------

  /**
   * Get statistics about this adapter
   * @returns {Promise<AdapterStats>}
   */
  async getStats() {
    const available = await this.isAvailable();

    return {
      name: this.name,
      available,
      totalRecords: this._stats.totalRecords,
      lastQueryTime: this._stats.lastQueryTime,
      cacheHitRate: this._calculateCacheHitRate(),
      errorCount: this._stats.queriesFailed,
    };
  }

  /**
   * Execute a query with timing and error tracking
   * @protected
   * @param {Function} queryFn - The query function to execute
   * @returns {Promise<MemoryRecord[]>}
   */
  async _executeQuery(queryFn) {
    const startTime = Date.now();
    this._stats.queriesTotal++;

    try {
      const results = await queryFn();
      this._stats.queriesSuccessful++;
      this._stats.lastQueryTime = Date.now() - startTime;
      this._stats.totalRecords = results.length;
      return results;
    } catch (error) {
      this._stats.queriesFailed++;
      this._stats.lastQueryTime = Date.now() - startTime;
      this._recordError(error);
      throw error;
    }
  }

  /**
   * Record an error for tracking
   * @protected
   * @param {Error} error
   */
  _recordError(error) {
    this._stats.errors.push({
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    });

    // Keep only last 10 errors
    if (this._stats.errors.length > 10) {
      this._stats.errors.shift();
    }
  }

  /**
   * Track cache hit/miss
   * @protected
   * @param {boolean} hit - Whether cache was hit
   */
  _trackCacheAccess(hit) {
    if (hit) {
      this._stats.cacheHits++;
    } else {
      this._stats.cacheMisses++;
    }
  }

  /**
   * Calculate cache hit rate
   * @private
   * @returns {number} 0.0-1.0
   */
  _calculateCacheHitRate() {
    const total = this._stats.cacheHits + this._stats.cacheMisses;
    if (total === 0) return 0;
    return this._stats.cacheHits / total;
  }

  /**
   * Create a base MemoryRecord with default values
   * @protected
   * @param {Partial<MemoryRecord>} data - Partial record data
   * @returns {MemoryRecord}
   */
  _createBaseRecord(data) {
    const now = new Date().toISOString();

    return {
      id: data.id || this._generateId(),
      version: data.version || 1,
      type: data.type || 'learning',
      content: data.content || '',
      summary: data.summary || (data.content || '').slice(0, 100),
      projectHash: data.projectHash || null,
      tags: data.tags || [],
      intent: data.intent || 'general',
      sourceSessionId: data.sourceSessionId || 'unknown',
      sourceTimestamp: data.sourceTimestamp || now,
      extractionConfidence: data.extractionConfidence || 0.5,
      usageCount: data.usageCount || 0,
      usageSuccessRate: data.usageSuccessRate || 0.5,
      lastUsed: data.lastUsed || null,
      decayScore: data.decayScore || 1.0,
      status: data.status || 'active',
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      _source: this.name,
      _sourcePriority: this.priority,
      ...data,
    };
  }

  /**
   * Generate a unique ID
   * @protected
   * @returns {string}
   */
  _generateId() {
    return `${this.name}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Filter records by query options
   * @protected
   * @param {MemoryRecord[]} records
   * @param {QueryOptions} [options]
   * @returns {MemoryRecord[]}
   */
  _applyQueryOptions(records, options = {}) {
    let filtered = records;

    // Filter by types
    if (options.types?.length) {
      filtered = filtered.filter(r => options.types.includes(r.type));
    }

    // Filter by project
    if (options.projectHash) {
      filtered = filtered.filter(r =>
        r.projectHash === null || r.projectHash === options.projectHash
      );
    }

    // Filter by confidence
    if (typeof options.minConfidence === 'number') {
      filtered = filtered.filter(r =>
        r.extractionConfidence >= options.minConfidence
      );
    }

    // Apply limit
    if (typeof options.limit === 'number' && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  BaseAdapter,
};
