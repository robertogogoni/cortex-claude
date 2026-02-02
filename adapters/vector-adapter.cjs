/**
 * Cortex - Claude's Cognitive Layer - Vector Search Adapter
 *
 * Integrates semantic vector search with the multi-source adapter system.
 * Uses VectorSearchProvider internally for hybrid BM25 + vector search.
 *
 * Features:
 * - Semantic similarity search using local embeddings
 * - BM25 full-text search for keyword matching
 * - Reciprocal Rank Fusion (RRF) for result combination
 * - Automatic embedding generation on write
 * - Lazy initialization (no startup delay)
 *
 * @version 1.0.0
 * @see Design: ../docs/plans/2026-02-01-unified-cortex-vector-design.md
 */

'use strict';

const { BaseAdapter } = require('./base-adapter.cjs');
const { getVectorSearchProvider } = require('../core/vector-search-provider.cjs');
const { expandPath } = require('../core/types.cjs');

// =============================================================================
// VECTOR SEARCH ADAPTER
// =============================================================================

/**
 * Adapter for semantic vector search + BM25 hybrid search
 * Priority: 0.95 (very high) - Provides best semantic relevance
 */
class VectorSearchAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} [config.basePath] - Base path for vector storage
   * @param {number} [config.vectorWeight] - Weight for vector search (0-1)
   * @param {number} [config.bm25Weight] - Weight for BM25 search (0-1)
   * @param {number} [config.rrfK] - RRF ranking parameter (default: 60)
   * @param {number} [config.minScore] - Minimum relevance score threshold
   */
  constructor(config = {}) {
    super({
      name: 'vector',
      priority: 0.95,  // High priority - best semantic understanding
      timeout: 500,    // Local computation, may need time for first model load
      enabled: config.enabled !== false,
    });

    this.basePath = expandPath(config.basePath || '~/.claude/memory');
    this.vectorWeight = config.vectorWeight || 0.6;
    this.bm25Weight = config.bm25Weight || 0.4;
    this.rrfK = config.rrfK || 60;
    this.minScore = config.minScore || 0.1;

    // VectorSearchProvider instance (lazy-loaded)
    this._provider = null;
    this._initPromise = null;
    this._initializationFailed = false;
    this._initializationError = null;
    this._isShutdown = false;
  }

  /**
   * Get or initialize the VectorSearchProvider
   * @private
   * @returns {Promise<import('../core/vector-search-provider.cjs').VectorSearchProvider>}
   */
  async _getProvider() {
    // Fast path - already initialized
    if (this._provider?.initialized) {
      return this._provider;
    }

    // Fast fail if initialization already failed
    if (this._initializationFailed) {
      throw new Error(`Vector search unavailable: ${this._initializationError}`);
    }

    // Serialize initialization attempts
    if (this._initPromise) {
      await this._initPromise;
      return this._provider;
    }

    // Initialize
    this._initPromise = this._initializeProvider();
    await this._initPromise;
    this._initPromise = null;

    return this._provider;
  }

  /**
   * Initialize the VectorSearchProvider
   * @private
   */
  async _initializeProvider() {
    try {
      this._provider = getVectorSearchProvider({
        basePath: this.basePath,
        vectorWeight: this.vectorWeight,
        bm25Weight: this.bm25Weight,
        rrfK: this.rrfK,
        minScore: this.minScore,
      });

      await this._provider.initialize();
    } catch (error) {
      this._initializationFailed = true;
      this._initializationError = error.message;
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ---------------------------------------------------------------------------

  /**
   * Query memories using hybrid vector + BM25 search
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const provider = await this._getProvider();

      // Build query text from context
      const queryText = this._buildQueryText(context);

      if (!queryText) {
        return [];
      }

      // Execute hybrid search
      const searchResult = await provider.search(queryText, {
        limit: options.limit || 20,
        types: options.types,
        projectHash: options.projectHash || context.projectHash,
        minScore: options.minConfidence || this.minScore,
      });

      // Normalize and return results (searchResult is { results, stats })
      return searchResult.results.map(r => this.normalize(r));
    });
  }

  /**
   * Build query text from analysis context
   * @private
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @returns {string}
   */
  _buildQueryText(context) {
    const parts = [];

    // Include detected intent
    if (context.intent && context.intentConfidence > 0.3) {
      parts.push(context.intent);
    }

    // Include relevant tags
    if (context.tags?.length) {
      parts.push(...context.tags.slice(0, 5));
    }

    // Include domains
    if (context.domains?.length) {
      parts.push(...context.domains.slice(0, 3));
    }

    // Include project context if available
    if (context.projectName) {
      parts.push(context.projectName);
    }

    if (context.projectType) {
      parts.push(context.projectType);
    }

    return parts.join(' ').trim();
  }

  /**
   * Check if vector search is available
   * Returns true if provider is initialized, false otherwise.
   * Does NOT trigger re-initialization if provider was shut down.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // If shut down, return false (don't re-initialize)
    if (this._isShutdown) {
      return false;
    }

    // If already initialized, return current state
    if (this._provider?.initialized) {
      return true;
    }

    // If initialization previously failed, don't retry
    if (this._initializationFailed) {
      return false;
    }

    // Not yet initialized - try to initialize
    try {
      const provider = await this._getProvider();
      return provider.initialized;
    } catch {
      return false;
    }
  }

  /**
   * Normalize a vector search result to MemoryRecord format
   * @param {Object} rawData - Raw data from vector search
   * @returns {import('./base-adapter.cjs').MemoryRecord}
   */
  normalize(rawData) {
    return this._createBaseRecord({
      id: rawData.id,
      version: rawData.version || 1,
      type: rawData.type || 'learning',
      content: rawData.content || '',
      summary: rawData.summary || (rawData.content || '').slice(0, 100),
      projectHash: rawData.projectHash || rawData.project_hash || null,
      tags: this._parseTags(rawData.tags),
      intent: rawData.intent || 'general',
      sourceSessionId: rawData.sourceSessionId || rawData.source_session_id || 'unknown',
      sourceTimestamp: rawData.sourceTimestamp || rawData.source_timestamp || rawData.created_at,
      extractionConfidence: rawData.extractionConfidence || rawData.extraction_confidence || 0.7,
      usageCount: rawData.usageCount || rawData.usage_count || 0,
      usageSuccessRate: rawData.usageSuccessRate || rawData.usage_success_rate || 0.5,
      lastUsed: rawData.lastUsed || rawData.last_used || null,
      decayScore: rawData.decayScore || rawData.decay_score || 1.0,
      embedding: rawData.embedding || null,
      status: rawData.status || 'active',
      createdAt: rawData.createdAt || rawData.created_at,
      updatedAt: rawData.updatedAt || rawData.updated_at,
      // Search-specific metadata
      _source: 'vector',
      _sourcePriority: this.priority,
      relevanceScore: rawData.relevanceScore || rawData.score || rawData._relevance || 0,
    });
  }

  /**
   * Parse tags from various formats
   * @private
   * @param {string|string[]|null} tags
   * @returns {string[]}
   */
  _parseTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') {
      // Handle JSON string or comma-separated
      try {
        return JSON.parse(tags);
      } catch {
        return tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // WRITE OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Vector adapter supports write operations
   * @returns {boolean}
   */
  supportsWrite() {
    return true;
  }

  /**
   * Write a new memory record with automatic embedding generation
   * @param {import('./base-adapter.cjs').MemoryRecord} record
   * @param {import('./base-adapter.cjs').WriteOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async write(record, options = {}) {
    return this._executeWrite(async () => {
      const provider = await this._getProvider();

      // Convert to internal format
      const memory = this._toInternalFormat(record);

      // Insert with automatic embedding generation
      const result = await provider.insert(memory, {
        generateEmbedding: true,
        skipIfExists: !options.overwrite,
      });

      return {
        success: true,
        id: result.id,
      };
    });
  }

  /**
   * Update an existing memory record
   * @param {string} id - Record ID
   * @param {Partial<import('./base-adapter.cjs').MemoryRecord>} updates
   * @param {import('./base-adapter.cjs').WriteOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async update(id, updates, options = {}) {
    return this._executeWrite(async () => {
      const provider = await this._getProvider();

      // Convert updates to internal format
      const internalUpdates = {};

      if (updates.content !== undefined) internalUpdates.content = updates.content;
      if (updates.summary !== undefined) internalUpdates.summary = updates.summary;
      if (updates.type !== undefined) internalUpdates.type = updates.type;
      if (updates.tags !== undefined) internalUpdates.tags = JSON.stringify(updates.tags);
      if (updates.status !== undefined) internalUpdates.status = updates.status;
      if (updates.usageCount !== undefined) internalUpdates.usage_count = updates.usageCount;
      if (updates.usageSuccessRate !== undefined) internalUpdates.usage_success_rate = updates.usageSuccessRate;
      if (updates.lastUsed !== undefined) internalUpdates.last_used = updates.lastUsed;
      if (updates.decayScore !== undefined) internalUpdates.decay_score = updates.decayScore;

      const result = await provider.update(id, internalUpdates);

      return {
        success: result.success,
        id,
        error: result.error,
        affectedCount: result.affectedCount,
      };
    });
  }

  /**
   * Delete a memory record
   * @param {string} id - Record ID
   * @param {import('./base-adapter.cjs').WriteOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async delete(id, options = {}) {
    return this._executeWrite(async () => {
      const provider = await this._getProvider();

      const result = await provider.delete(id, !options.archive);

      return {
        success: result.success,
        id,
        error: result.error,
      };
    });
  }

  /**
   * Convert MemoryRecord to internal storage format
   * @private
   * @param {import('./base-adapter.cjs').MemoryRecord} record
   * @returns {Object}
   */
  _toInternalFormat(record) {
    return {
      id: record.id,
      type: record.type || 'learning',
      content: record.content || '',
      summary: record.summary || (record.content || '').slice(0, 100),
      project_hash: record.projectHash || null,
      tags: JSON.stringify(record.tags || []),
      intent: record.intent || 'general',
      source: record._source || 'direct',
      source_session_id: record.sourceSessionId || 'unknown',
      source_timestamp: record.sourceTimestamp || new Date().toISOString(),
      extraction_confidence: record.extractionConfidence || 0.7,
      usage_count: record.usageCount || 0,
      usage_success_rate: record.usageSuccessRate || 0.5,
      decay_score: record.decayScore || 1.0,
      status: record.status || 'active',
    };
  }

  // ---------------------------------------------------------------------------
  // ADDITIONAL METHODS
  // ---------------------------------------------------------------------------

  /**
   * Direct semantic search (vector only, no BM25)
   * @param {string} queryText - Query text
   * @param {number} [k=10] - Number of results
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async semanticSearch(queryText, k = 10) {
    const provider = await this._getProvider();
    const searchResult = await provider.searchVector(queryText, k);
    // searchResult is { results, stats }
    return searchResult.results.map(r => this.normalize(r));
  }

  /**
   * Direct keyword search (BM25 only, no vector)
   * @param {string} queryText - Query text
   * @param {number} [limit=10] - Number of results
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async keywordSearch(queryText, limit = 10) {
    const provider = await this._getProvider();
    const searchResult = await provider.searchBM25(queryText, limit);
    // searchResult is { results, stats }
    return searchResult.results.map(r => this.normalize(r));
  }

  /**
   * Backfill embeddings for existing memories
   * @param {Object} [options]
   * @param {number} [options.batchSize] - Records per batch
   * @param {Function} [options.onProgress] - Progress callback
   * @returns {Promise<{processed: number, errors: number}>}
   */
  async backfillEmbeddings(options = {}) {
    const provider = await this._getProvider();
    return provider.backfillEmbeddings(options);
  }

  /**
   * Get detailed statistics
   * @returns {Promise<import('./base-adapter.cjs').AdapterStats>}
   */
  async getStats() {
    const baseStats = await super.getStats();

    if (!this._provider?.initialized) {
      return {
        ...baseStats,
        vectorSearch: { available: false },
      };
    }

    const providerStats = this._provider.getStats();

    return {
      ...baseStats,
      totalRecords: providerStats.memoryCount,
      vectorSearch: {
        available: true,
        vectorCount: providerStats.vectorCount,
        embeddingsGenerated: providerStats.embeddingsGenerated,
        searchesPerformed: providerStats.searchesPerformed,
        avgSearchTimeMs: providerStats.avgSearchTimeMs,
        modelLoaded: providerStats.modelLoaded,
        indexFillRatio: providerStats.indexFillRatio,
      },
    };
  }

  /**
   * Save indices to disk
   * @returns {Promise<void>}
   */
  async save() {
    if (this._provider?.initialized) {
      await this._provider.save();
    }
  }

  /**
   * Shutdown the adapter cleanly
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this._provider?.initialized) {
      await this._provider.shutdown();
    }
    this._provider = null;
    this._initPromise = null;
    this._initializationFailed = false;
    this._initializationError = null;
    this._isShutdown = true;  // Mark as shut down to prevent re-initialization
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  VectorSearchAdapter,
};
