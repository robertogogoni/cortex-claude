/**
 * Cortex - Claude's Cognitive Layer - Vector Search Provider
 *
 * Unified coordinator for all vector search components:
 * - Embedder: Local embedding generation (all-MiniLM-L6-v2)
 * - VectorIndex: HNSW approximate nearest neighbor
 * - MemoryStore: SQLite + FTS5 storage
 * - HybridSearch: BM25 + Vector with RRF fusion
 *
 * This provider solves the MCP process isolation problem by keeping
 * all vector operations within a single process.
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { expandPath } = require('./types.cjs');
const { Embedder, EMBEDDING_DIM } = require('./embedder.cjs');
const { VectorIndex } = require('./vector-index.cjs');
const { MemoryStore } = require('./memory-store.cjs');
const { HybridSearch } = require('./hybrid-search.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/** @const {string} Default base path for vector data */
const DEFAULT_BASE_PATH = '~/.claude/memory';

/** @const {number} Default limit for search results */
const DEFAULT_SEARCH_LIMIT = 10;

/** @const {number} Batch size for embedding generation */
const EMBEDDING_BATCH_SIZE = 10;

// =============================================================================
// VECTOR SEARCH PROVIDER
// =============================================================================

/**
 * Unified vector search provider that coordinates all components
 */
class VectorSearchProvider {
  /**
   * @param {Object} options
   * @param {string} [options.basePath] - Base path for data storage
   * @param {Object} [options.embedder] - Embedder configuration
   * @param {Object} [options.vectorIndex] - VectorIndex configuration
   * @param {Object} [options.memoryStore] - MemoryStore configuration
   * @param {Object} [options.hybridSearch] - HybridSearch configuration
   */
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || DEFAULT_BASE_PATH);

    // Initialize state
    this.initialized = false;
    this._initializingPromise = null;

    // Component references (lazy-initialized)
    this._embedder = null;
    this._vectorIndex = null;
    this._memoryStore = null;
    this._hybridSearch = null;

    // Configuration for each component
    this._embedderConfig = options.embedder || {};
    this._vectorIndexConfig = {
      indexPath: `${this.basePath}/data/vector/index.bin`,
      mappingPath: `${this.basePath}/data/vector/mapping.json`,
      ...options.vectorIndex,
    };
    this._memoryStoreConfig = {
      dbPath: `${this.basePath}/data/memories.db`,
      ...options.memoryStore,
    };
    this._hybridSearchConfig = options.hybridSearch || {};

    // Statistics
    this.stats = {
      initialized: false,
      initializationTimeMs: 0,
      totalQueries: 0,
      totalInserts: 0,
      totalUpdates: 0,
      totalDeletes: 0,
      lastQueryTimeMs: 0,
      avgQueryTimeMs: 0,
      errors: 0,
    };
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Initialize all components
   * @returns {Promise<{success: boolean, components: Object}>}
   */
  async initialize() {
    if (this.initialized) {
      return {
        success: true,
        components: this._getComponentStatus(),
      };
    }

    // Prevent concurrent initialization
    if (this._initializingPromise) {
      return this._initializingPromise;
    }

    this._initializingPromise = this._doInitialize();
    const result = await this._initializingPromise;
    this._initializingPromise = null;

    return result;
  }

  /**
   * Actual initialization logic
   * @private
   */
  async _doInitialize() {
    const startTime = Date.now();
    const results = {
      embedder: { success: false, error: null },
      vectorIndex: { success: false, error: null },
      memoryStore: { success: false, error: null },
      hybridSearch: { success: false, error: null },
    };

    try {
      // Ensure data directories exist
      this._ensureDirectories();

      // 1. Initialize Embedder (lazy load model)
      try {
        this._embedder = new Embedder(this._embedderConfig);
        results.embedder.success = true;
      } catch (error) {
        results.embedder.error = error.message;
        throw error;
      }

      // 2. Initialize MemoryStore (SQLite + FTS5)
      try {
        this._memoryStore = new MemoryStore(this._memoryStoreConfig);
        await this._memoryStore.initialize();
        results.memoryStore.success = true;
        results.memoryStore.memoryCount = this._memoryStore.getCount();
      } catch (error) {
        results.memoryStore.error = error.message;
        throw error;
      }

      // 3. Initialize VectorIndex (HNSW)
      try {
        this._vectorIndex = new VectorIndex(this._vectorIndexConfig);
        const indexResult = await this._vectorIndex.initialize();
        results.vectorIndex.success = true;
        results.vectorIndex.loaded = indexResult.loaded;
        results.vectorIndex.vectorCount = indexResult.vectorCount;
      } catch (error) {
        results.vectorIndex.error = error.message;
        throw error;
      }

      // 4. Initialize HybridSearch (coordinator)
      // HybridSearch needs the low-level SQLiteStore, not the high-level MemoryStore
      // Note: HybridSearch is ready to use after construction (no initialize method)
      try {
        this._hybridSearch = new HybridSearch({
          store: this._memoryStore.store,
          vectorIndex: this._vectorIndex,
          embedder: this._embedder,
          ...this._hybridSearchConfig,
        });
        results.hybridSearch.success = true;
      } catch (error) {
        results.hybridSearch.error = error.message;
        throw error;
      }

      this.initialized = true;
      this.stats.initialized = true;
      this.stats.initializationTimeMs = Date.now() - startTime;

      return {
        success: true,
        components: results,
        initializationTimeMs: this.stats.initializationTimeMs,
      };
    } catch (error) {
      this.stats.errors++;
      return {
        success: false,
        error: error.message,
        components: results,
        initializationTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Ensure required directories exist
   * @private
   */
  _ensureDirectories() {
    const dirs = [
      `${this.basePath}/data`,
      `${this.basePath}/data/vector`,
    ];

    for (const dir of dirs) {
      const expanded = expandPath(dir);
      if (!fs.existsSync(expanded)) {
        fs.mkdirSync(expanded, { recursive: true, mode: 0o700 });
      }
    }
  }

  /**
   * Ensure provider is initialized
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('VectorSearchProvider not initialized. Call initialize() first.');
    }
  }

  // ===========================================================================
  // SEARCH OPERATIONS
  // ===========================================================================

  /**
   * Perform hybrid search (BM25 + Vector with RRF fusion)
   *
   * @param {string} query - Search query
   * @param {Object} [options] - Search options
   * @param {number} [options.limit=10] - Maximum results
   * @param {string[]} [options.types] - Filter by memory types
   * @param {string} [options.projectHash] - Filter by project
   * @param {string} [options.source] - Filter by source
   * @param {number} [options.vectorWeight=0.5] - Weight for vector search (0-1)
   * @returns {Promise<{results: Array, stats: Object}>}
   */
  async search(query, options = {}) {
    this._ensureInitialized();

    const startTime = Date.now();

    // Handle empty queries gracefully
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        results: [],
        stats: {
          queryTimeMs: 0,
          resultCount: 0,
          searchType: 'hybrid',
        },
      };
    }

    try {
      // Convert types array to memoryType (HybridSearch expects singular param)
      const memoryType = Array.isArray(options.types) && options.types.length > 0
        ? options.types[0]
        : options.types;

      const results = await this._hybridSearch.search(query, {
        limit: options.limit || DEFAULT_SEARCH_LIMIT,
        memoryType,
        projectHash: options.projectHash,
        source: options.source,
        vectorWeight: options.vectorWeight,
      });

      // Update stats
      const queryTime = Date.now() - startTime;
      this.stats.totalQueries++;
      this.stats.lastQueryTimeMs = queryTime;
      this.stats.avgQueryTimeMs = Math.round(
        (this.stats.avgQueryTimeMs * (this.stats.totalQueries - 1) + queryTime) /
        this.stats.totalQueries
      );

      return {
        results,
        stats: {
          queryTimeMs: queryTime,
          resultCount: results.length,
          searchType: 'hybrid',
        },
      };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Perform vector-only search (semantic similarity)
   *
   * @param {string} query - Search query
   * @param {number} [k=10] - Number of results
   * @returns {Promise<{results: Array, stats: Object}>}
   */
  async searchVector(query, k = DEFAULT_SEARCH_LIMIT) {
    this._ensureInitialized();

    const startTime = Date.now();

    try {
      const results = await this._hybridSearch.searchVector(query, k);

      const queryTime = Date.now() - startTime;
      this.stats.totalQueries++;
      this.stats.lastQueryTimeMs = queryTime;

      return {
        results,
        stats: {
          queryTimeMs: queryTime,
          resultCount: results.length,
          searchType: 'vector',
        },
      };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Perform BM25-only search (keyword matching)
   *
   * @param {string} query - Search query
   * @param {number} [limit=10] - Number of results
   * @returns {Promise<{results: Array, stats: Object}>}
   */
  async searchBM25(query, limit = DEFAULT_SEARCH_LIMIT) {
    this._ensureInitialized();

    const startTime = Date.now();

    try {
      const results = await this._hybridSearch.searchBM25(query, limit);

      const queryTime = Date.now() - startTime;
      this.stats.totalQueries++;
      this.stats.lastQueryTimeMs = queryTime;

      return {
        results,
        stats: {
          queryTimeMs: queryTime,
          resultCount: results.length,
          searchType: 'bm25',
        },
      };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  // ===========================================================================
  // MEMORY OPERATIONS
  // ===========================================================================

  /**
   * Insert a new memory with automatic embedding generation
   *
   * @param {Object} memory - Memory record
   * @param {string} memory.content - Full content (required)
   * @param {string} [memory.summary] - Brief summary
   * @param {string} [memory.type] - Memory type
   * @param {string[]} [memory.tags] - Tags
   * @param {string} [memory.source] - Source identifier
   * @param {string} [memory.projectHash] - Project scope
   * @param {Object} [options] - Options
   * @param {boolean} [options.generateEmbedding=true] - Generate embedding
   * @returns {Promise<{id: string, embedding: boolean}>}
   */
  async insert(memory, options = {}) {
    this._ensureInitialized();

    const generateEmbedding = options.generateEmbedding !== false;

    try {
      // Generate embedding if requested
      let embedding = null;
      if (generateEmbedding) {
        const textToEmbed = memory.summary || memory.content;
        embedding = await this._embedder.embed(textToEmbed);
      }

      // Insert into MemoryStore
      const result = await this._memoryStore.insert({
        ...memory,
        embedding,
      });

      // Add to vector index if embedding was generated
      if (embedding && result.id) {
        this._vectorIndex.add(result.id, embedding);
      }

      this.stats.totalInserts++;

      return {
        id: result.id,
        embedding: !!embedding,
      };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Batch insert memories with automatic embedding generation
   *
   * @param {Object[]} memories - Array of memory records
   * @param {Object} [options] - Options
   * @returns {Promise<{inserted: number, errors: number}>}
   */
  async insertBatch(memories, options = {}) {
    this._ensureInitialized();

    let inserted = 0;
    let errors = 0;

    // Process in batches to manage memory
    for (let i = 0; i < memories.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = memories.slice(i, i + EMBEDDING_BATCH_SIZE);

      for (const memory of batch) {
        try {
          await this.insert(memory, options);
          inserted++;
        } catch (error) {
          errors++;
          console.error(`[VectorSearchProvider] Insert error: ${error.message}`);
        }
      }
    }

    return { inserted, errors };
  }

  /**
   * Update a memory's content and regenerate embedding
   *
   * @param {string} id - Memory ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<{success: boolean}>}
   */
  async update(id, updates) {
    this._ensureInitialized();

    try {
      // If content is being updated, regenerate embedding
      if (updates.content || updates.summary) {
        const textToEmbed = updates.summary || updates.content;
        updates.embedding = await this._embedder.embed(textToEmbed);

        // Update vector index
        this._vectorIndex.add(id, updates.embedding);
      }

      // MemoryStore.update() returns boolean, not object with .changes
      const success = this._memoryStore.update(id, updates);

      if (success) {
        this.stats.totalUpdates++;
      }

      return { success };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Delete a memory
   *
   * @param {string} id - Memory ID
   * @param {boolean} [hard=false] - Permanent deletion
   * @returns {Promise<{success: boolean}>}
   */
  async delete(id, hard = false) {
    this._ensureInitialized();

    try {
      // MemoryStore.delete() returns boolean, not object with .changes
      const success = this._memoryStore.delete(id, hard);

      // Remove from vector index
      this._vectorIndex.remove(id);

      if (success) {
        this.stats.totalDeletes++;
      }

      return { success };
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get a memory by ID
   *
   * @param {string} id - Memory ID
   * @param {boolean} [includeEmbedding=false] - Include embedding
   * @returns {Object|null}
   */
  get(id, includeEmbedding = false) {
    this._ensureInitialized();
    return this._memoryStore.get(id, includeEmbedding);
  }

  // ===========================================================================
  // EMBEDDING OPERATIONS
  // ===========================================================================

  /**
   * Generate embedding for text
   *
   * @param {string} text - Input text
   * @returns {Promise<Float32Array>} 384-dimensional vector
   */
  async embed(text) {
    this._ensureInitialized();
    return this._embedder.embed(text);
  }

  /**
   * Preload the embedding model (warmup)
   * @returns {Promise<void>}
   */
  async preloadModel() {
    this._ensureInitialized();
    await this._embedder.preload();
  }

  /**
   * Backfill embeddings for memories that don't have them
   *
   * @param {Object} [options] - Options
   * @param {number} [options.batchSize=50] - Batch size
   * @param {Function} [options.onProgress] - Progress callback
   * @returns {Promise<{processed: number, skipped: number, errors: number}>}
   */
  async backfillEmbeddings(options = {}) {
    this._ensureInitialized();

    const batchSize = options.batchSize || 50;
    const onProgress = options.onProgress || (() => {});

    let processed = 0;
    let skipped = 0;
    let errors = 0;
    let offset = 0;

    while (true) {
      // Get memories without embeddings
      const memories = this._memoryStore.listWithoutEmbedding(batchSize, offset);

      if (memories.length === 0) {
        break;
      }

      for (const memory of memories) {
        try {
          const textToEmbed = memory.summary || memory.content;
          const embedding = await this._embedder.embed(textToEmbed);

          // Update memory with embedding
          this._memoryStore.setEmbedding(memory.id, embedding);

          // Add to vector index
          this._vectorIndex.add(memory.id, embedding);

          processed++;
        } catch (error) {
          errors++;
          console.error(`[VectorSearchProvider] Backfill error for ${memory.id}: ${error.message}`);
        }
      }

      offset += batchSize;
      onProgress({ processed, skipped, errors, total: offset });
    }

    // Save vector index after backfill
    await this._vectorIndex.save();

    return { processed, skipped, errors };
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  /**
   * Save all indices and data to disk
   * @returns {Promise<{vectorIndex: Object}>}
   */
  async save() {
    this._ensureInitialized();

    const vectorResult = await this._vectorIndex.save();

    return {
      vectorIndex: vectorResult,
    };
  }

  /**
   * Shutdown provider cleanly
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this.initialized) {
      return;
    }

    // Save vector index
    await this._vectorIndex.save();

    // Close memory store
    this._memoryStore.close();

    this.initialized = false;
    this.stats.initialized = false;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get provider statistics
   * @returns {Object}
   */
  getStats() {
    const componentStats = this._getComponentStatus();

    return {
      ...this.stats,
      components: componentStats,
    };
  }

  /**
   * Get component status
   * @private
   */
  _getComponentStatus() {
    return {
      embedder: this._embedder?.getStats() || null,
      vectorIndex: this._vectorIndex?.getStats() || null,
      memoryStore: this._memoryStore?.getStats() || null,
      hybridSearch: this._hybridSearch?.getStats() || null,
    };
  }

  /**
   * Get health status
   * @returns {Promise<{healthy: boolean, checks: Object}>}
   */
  async healthCheck() {
    const checks = {
      initialized: { healthy: this.initialized, message: '' },
      embedder: { healthy: false, message: '' },
      vectorIndex: { healthy: false, message: '' },
      memoryStore: { healthy: false, message: '' },
    };

    if (!this.initialized) {
      checks.initialized.message = 'Not initialized';
      return { healthy: false, checks };
    }

    // Embedder check
    try {
      const stats = this._embedder.getStats();
      checks.embedder.healthy = true;
      checks.embedder.message = `Model loaded: ${stats.modelLoaded}`;
    } catch (e) {
      checks.embedder.message = e.message;
    }

    // Vector index check
    try {
      const stats = this._vectorIndex.getStats();
      checks.vectorIndex.healthy = stats.vectorCount >= 0;
      checks.vectorIndex.message = `Vectors: ${stats.vectorCount}`;
    } catch (e) {
      checks.vectorIndex.message = e.message;
    }

    // Memory store check
    try {
      const stats = this._memoryStore.getStats();
      checks.memoryStore.healthy = stats.initialized;
      checks.memoryStore.message = `Memories: ${stats.totalMemories}`;
    } catch (e) {
      checks.memoryStore.message = e.message;
    }

    const healthy = Object.values(checks).every(c => c.healthy);
    return { healthy, checks };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let providerInstance = null;

/**
 * Get singleton VectorSearchProvider instance
 * @param {Object} [options] - Configuration options
 * @returns {VectorSearchProvider}
 */
function getVectorSearchProvider(options) {
  if (!providerInstance) {
    providerInstance = new VectorSearchProvider(options);
  }
  return providerInstance;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  VectorSearchProvider,
  getVectorSearchProvider,
  DEFAULT_SEARCH_LIMIT,
  EMBEDDING_BATCH_SIZE,
};
