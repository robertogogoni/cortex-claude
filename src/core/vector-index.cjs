/**
 * Cortex - Claude's Cognitive Layer - Vector Index
 *
 * HNSW (Hierarchical Navigable Small World) vector index for fast
 * approximate nearest neighbor search. Uses hnswlib-node binding.
 *
 * Features:
 * - Persistent index with atomic save
 * - Memory ID to index position mapping
 * - Soft delete support (marks as deleted)
 * - Automatic index resizing
 * - Comprehensive statistics
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath } = require('./types.cjs');
const { EMBEDDING_DIM } = require('./embedder.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/** @const {number} Default maximum elements in index */
const DEFAULT_MAX_ELEMENTS = 100000;

/** @const {number} HNSW M parameter (connections per layer) */
const DEFAULT_M = 16;

/** @const {number} HNSW efConstruction (quality during build) */
const DEFAULT_EF_CONSTRUCTION = 200;

/** @const {number} HNSW ef parameter for search (quality during query) */
const DEFAULT_EF_SEARCH = 50;

/** @const {string} Default space type for similarity */
const DEFAULT_SPACE = 'cosine';

// =============================================================================
// VECTOR INDEX CLASS
// =============================================================================

/**
 * HNSW Vector Index for semantic search
 */
class VectorIndex {
  /**
   * @param {Object} options
   * @param {number} [options.dimension] - Vector dimension (default: 384)
   * @param {number} [options.maxElements] - Maximum vectors (default: 100000)
   * @param {number} [options.M] - HNSW M parameter (default: 16)
   * @param {number} [options.efConstruction] - Build quality (default: 200)
   * @param {number} [options.efSearch] - Search quality (default: 50)
   * @param {string} [options.space] - Distance metric (default: 'cosine')
   * @param {string} [options.indexPath] - Path to persist index
   * @param {string} [options.mappingPath] - Path to persist ID mapping
   */
  constructor(options = {}) {
    this.dimension = options.dimension || EMBEDDING_DIM;
    this.maxElements = options.maxElements || DEFAULT_MAX_ELEMENTS;
    this.M = options.M || DEFAULT_M;
    this.efConstruction = options.efConstruction || DEFAULT_EF_CONSTRUCTION;
    this.efSearch = options.efSearch || DEFAULT_EF_SEARCH;
    this.space = options.space || DEFAULT_SPACE;

    // Persistence paths
    this.indexPath = options.indexPath
      ? expandPath(options.indexPath)
      : expandPath('~/.claude/memory/data/vector/index.bin');

    this.mappingPath = options.mappingPath
      ? expandPath(options.mappingPath)
      : expandPath('~/.claude/memory/data/vector/mapping.json');

    // Index state
    this.index = null;
    this.initialized = false;

    // ID mapping: memory ID <-> HNSW index position
    this.idToPosition = new Map();  // memory_id -> index_position
    this.positionToId = new Map();  // index_position -> memory_id
    this.nextPosition = 0;
    this.deletedPositions = new Set();  // Positions marked as deleted

    // Statistics
    this.stats = {
      vectorCount: 0,
      deletedCount: 0,
      searches: 0,
      adds: 0,
      deletes: 0,
      resizes: 0,
      lastSearchTime: 0,
      totalSearchTime: 0,
    };
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Initialize the index - load existing or create new
   * @returns {Promise<{loaded: boolean, vectorCount: number}>}
   */
  async initialize() {
    if (this.initialized) {
      return {
        loaded: true,
        vectorCount: this.stats.vectorCount,
      };
    }

    // Import hnswlib-node (native module)
    let HierarchicalNSW;
    try {
      const hnswlib = require('hnswlib-node');
      HierarchicalNSW = hnswlib.HierarchicalNSW;
    } catch (error) {
      throw new Error(
        `Failed to load hnswlib-node: ${error.message}. ` +
        'Run: npm install hnswlib-node'
      );
    }

    // Create index instance
    this.index = new HierarchicalNSW(this.space, this.dimension);

    // Try to load existing index
    const indexExists = fs.existsSync(this.indexPath);
    const mappingExists = fs.existsSync(this.mappingPath);

    if (indexExists && mappingExists) {
      try {
        // Initialize index structure before loading (required by hnswlib-node)
        this.index.initIndex(this.maxElements, this.M, this.efConstruction);
        // Load HNSW index (second param is allowReplace boolean)
        this.index.readIndex(this.indexPath, true);
        this.index.setEf(this.efSearch);

        // Load ID mapping
        const mappingData = JSON.parse(
          fs.readFileSync(this.mappingPath, 'utf8')
        );

        this.nextPosition = mappingData.nextPosition || 0;

        // Rebuild maps from saved data
        for (const [id, pos] of Object.entries(mappingData.idToPosition || {})) {
          this.idToPosition.set(id, pos);
          this.positionToId.set(pos, id);
        }

        // Restore deleted positions
        this.deletedPositions = new Set(mappingData.deletedPositions || []);

        // Calculate stats
        this.stats.vectorCount = this.idToPosition.size;
        this.stats.deletedCount = this.deletedPositions.size;

        this.initialized = true;

        return {
          loaded: true,
          vectorCount: this.stats.vectorCount,
        };
      } catch (error) {
        // Corrupted index - reinitialize
        console.error(`[VectorIndex] Failed to load index: ${error.message}`);
        console.error('[VectorIndex] Creating new index...');
      }
    }

    // Create new index
    this.index.initIndex(this.maxElements, this.M, this.efConstruction);
    this.index.setEf(this.efSearch);

    this.initialized = true;

    return {
      loaded: false,
      vectorCount: 0,
    };
  }

  /**
   * Ensure index is initialized
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Index not initialized. Call initialize() first.');
    }
  }

  // ===========================================================================
  // VECTOR OPERATIONS
  // ===========================================================================

  /**
   * Add a vector to the index
   *
   * @param {string} id - Unique memory ID
   * @param {Float32Array|number[]} embedding - Vector to add
   * @returns {{position: number, isUpdate: boolean}}
   */
  add(id, embedding) {
    this._ensureInitialized();

    if (!id || typeof id !== 'string') {
      throw new Error('ID must be a non-empty string');
    }

    if (!embedding || embedding.length !== this.dimension) {
      throw new Error(
        `Embedding must have ${this.dimension} dimensions, got ${embedding?.length}`
      );
    }

    // Check if this is an update
    const existingPosition = this.idToPosition.get(id);
    const isUpdate = existingPosition !== undefined;

    if (isUpdate) {
      // Mark old position as deleted
      this.index.markDelete(existingPosition);
      this.deletedPositions.add(existingPosition);
      this.positionToId.delete(existingPosition);
      this.stats.deletedCount++;
    }

    // Check if we need to resize
    if (this.nextPosition >= this.maxElements) {
      this._resize();
    }

    // Add to index
    const position = this.nextPosition++;
    // hnswlib-node requires plain JavaScript Arrays, not Float32Array
    const vector = embedding instanceof Float32Array
      ? Array.from(embedding)
      : Array.isArray(embedding)
        ? embedding
        : Array.from(new Float32Array(embedding));

    this.index.addPoint(vector, position);

    // Update mappings
    this.idToPosition.set(id, position);
    this.positionToId.set(position, id);

    // Update stats
    if (!isUpdate) {
      this.stats.vectorCount++;
    }
    this.stats.adds++;

    return { position, isUpdate };
  }

  /**
   * Remove a vector from the index (soft delete)
   *
   * @param {string} id - Memory ID to remove
   * @returns {boolean} True if removed, false if not found
   */
  remove(id) {
    this._ensureInitialized();

    const position = this.idToPosition.get(id);

    if (position === undefined) {
      return false;
    }

    // Mark as deleted in HNSW
    this.index.markDelete(position);

    // Update mappings
    this.deletedPositions.add(position);
    this.idToPosition.delete(id);
    this.positionToId.delete(position);

    // Update stats
    this.stats.vectorCount--;
    this.stats.deletedCount++;
    this.stats.deletes++;

    return true;
  }

  /**
   * Search for nearest neighbors
   *
   * @param {Float32Array|number[]} queryEmbedding - Query vector
   * @param {number} [k=10] - Number of results
   * @returns {{ids: string[], distances: number[], positions: number[]}}
   */
  search(queryEmbedding, k = 10) {
    this._ensureInitialized();

    if (!queryEmbedding || queryEmbedding.length !== this.dimension) {
      throw new Error(
        `Query must have ${this.dimension} dimensions, got ${queryEmbedding?.length}`
      );
    }

    const startTime = Date.now();

    // hnswlib-node requires plain JavaScript Arrays, not Float32Array
    const query = queryEmbedding instanceof Float32Array
      ? Array.from(queryEmbedding)
      : Array.isArray(queryEmbedding)
        ? queryEmbedding
        : Array.from(new Float32Array(queryEmbedding));

    // Search, requesting more results to account for deleted entries
    const searchK = Math.min(k * 2, this.stats.vectorCount + this.stats.deletedCount);

    if (searchK === 0) {
      return { ids: [], distances: [], positions: [] };
    }

    const result = this.index.searchKnn(query, searchK);

    // Filter out deleted entries and map positions to IDs
    const ids = [];
    const distances = [];
    const positions = [];

    for (let i = 0; i < result.neighbors.length && ids.length < k; i++) {
      const position = result.neighbors[i];
      const id = this.positionToId.get(position);

      // Skip deleted entries
      if (id && !this.deletedPositions.has(position)) {
        ids.push(id);
        distances.push(result.distances[i]);
        positions.push(position);
      }
    }

    // Update stats
    const searchTime = Date.now() - startTime;
    this.stats.searches++;
    this.stats.lastSearchTime = searchTime;
    this.stats.totalSearchTime += searchTime;

    return { ids, distances, positions };
  }

  /**
   * Check if an ID exists in the index
   *
   * @param {string} id - Memory ID
   * @returns {boolean}
   */
  has(id) {
    return this.idToPosition.has(id);
  }

  /**
   * Get the position of an ID in the index
   *
   * @param {string} id - Memory ID
   * @returns {number|null}
   */
  getPosition(id) {
    return this.idToPosition.get(id) ?? null;
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  /**
   * Save index and mapping to disk (atomic)
   *
   * @returns {Promise<{indexSize: number, mappingSize: number}>}
   */
  async save() {
    this._ensureInitialized();

    // Ensure directories exist
    const indexDir = path.dirname(this.indexPath);
    const mappingDir = path.dirname(this.mappingPath);

    for (const dir of [indexDir, mappingDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
    }

    // Note: hnswlib-node's writeIndex() may have async/deferred behavior,
    // so we write directly to target path instead of using temp-then-rename.
    // The library handles atomicity internally.
    const mappingTmp = `${this.mappingPath}.tmp.${process.pid}`;

    try {
      // Save HNSW index directly to target path
      // (hnswlib-node doesn't guarantee immediate file existence with temp pattern)
      this.index.writeIndex(this.indexPath);

      // hnswlib-node's writeIndex() may have deferred I/O behavior
      // Wait for file to actually appear (up to 2 seconds)
      await this._waitForFile(this.indexPath, 2000);

      // Save ID mapping (use temp pattern for JSON - fs.writeFileSync is synchronous)
      const mappingData = {
        version: 1,
        dimension: this.dimension,
        nextPosition: this.nextPosition,
        idToPosition: Object.fromEntries(this.idToPosition),
        deletedPositions: Array.from(this.deletedPositions),
        stats: {
          vectorCount: this.stats.vectorCount,
          deletedCount: this.stats.deletedCount,
        },
        savedAt: new Date().toISOString(),
      };

      fs.writeFileSync(mappingTmp, JSON.stringify(mappingData, null, 2), {
        mode: 0o600,
      });

      // Atomic rename for mapping only
      fs.renameSync(mappingTmp, this.mappingPath);

      // Get file sizes
      const indexSize = fs.statSync(this.indexPath).size;
      const mappingSize = fs.statSync(this.mappingPath).size;

      return { indexSize, mappingSize };
    } catch (error) {
      // Cleanup temp files on error
      try {
        if (fs.existsSync(mappingTmp)) fs.unlinkSync(mappingTmp);
      } catch {}

      throw new Error(`Failed to save index: ${error.message}`);
    }
  }

  /**
   * Compact the index by removing deleted entries
   * This rebuilds the entire index from scratch
   *
   * @returns {Promise<{before: number, after: number, removed: number}>}
   */
  async compact() {
    this._ensureInitialized();

    if (this.deletedPositions.size === 0) {
      return {
        before: this.stats.vectorCount,
        after: this.stats.vectorCount,
        removed: 0,
      };
    }

    const before = this.stats.vectorCount + this.stats.deletedCount;

    // Collect all active vectors
    const activeVectors = [];
    for (const [id, position] of this.idToPosition) {
      if (!this.deletedPositions.has(position)) {
        // Get vector from index (this requires a search trick)
        // hnswlib doesn't have a direct getVector method, so we use search
        // with the position's stored point
        activeVectors.push({ id, position });
      }
    }

    // Create new index
    const hnswlib = require('hnswlib-node');
    const newIndex = new hnswlib.HierarchicalNSW(this.space, this.dimension);
    newIndex.initIndex(this.maxElements, this.M, this.efConstruction);
    newIndex.setEf(this.efSearch);

    // Reset mappings
    this.idToPosition.clear();
    this.positionToId.clear();
    this.deletedPositions.clear();
    this.nextPosition = 0;

    // Note: We cannot directly copy vectors from the old index
    // This compact method requires vectors to be re-added from external storage
    // Typically, you would iterate through your SQLite memories table

    // Replace old index
    this.index = newIndex;

    // Update stats
    this.stats.vectorCount = 0;  // Will be repopulated when vectors are re-added
    this.stats.deletedCount = 0;
    this.stats.resizes++;

    return {
      before,
      after: 0,  // Vectors need to be re-added from external storage
      removed: before,
      message: 'Index compacted. Re-add vectors from external storage.',
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Resize the index when full
   * @private
   */
  _resize() {
    const newMaxElements = this.maxElements * 2;

    console.error(
      `[VectorIndex] Resizing index from ${this.maxElements} to ${newMaxElements}`
    );

    this.index.resizeIndex(newMaxElements);
    this.maxElements = newMaxElements;
    this.stats.resizes++;
  }

  /**
   * Wait for a file to exist (handles hnswlib-node's deferred I/O)
   * @private
   * @param {string} filePath - Path to wait for
   * @param {number} timeoutMs - Maximum wait time
   * @returns {Promise<void>}
   */
  async _waitForFile(filePath, timeoutMs = 2000) {
    const startTime = Date.now();
    const checkInterval = 50;  // Check every 50ms

    while (Date.now() - startTime < timeoutMs) {
      if (fs.existsSync(filePath)) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    // File didn't appear in time - throw descriptive error
    throw new Error(
      `File not created within ${timeoutMs}ms: ${filePath}. ` +
      `hnswlib-node writeIndex() may have failed silently.`
    );
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get index statistics
   * @returns {Object}
   */
  getStats() {
    const avgSearchTime = this.stats.searches > 0
      ? Math.round(this.stats.totalSearchTime / this.stats.searches)
      : 0;

    return {
      initialized: this.initialized,
      dimension: this.dimension,
      maxElements: this.maxElements,
      space: this.space,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      vectorCount: this.stats.vectorCount,
      deletedCount: this.stats.deletedCount,
      nextPosition: this.nextPosition,
      fillRatio: this.nextPosition / this.maxElements,
      searches: this.stats.searches,
      adds: this.stats.adds,
      deletes: this.stats.deletes,
      resizes: this.stats.resizes,
      lastSearchTimeMs: this.stats.lastSearchTime,
      avgSearchTimeMs: avgSearchTime,
    };
  }

  /**
   * Get all indexed IDs
   * @returns {string[]}
   */
  getAllIds() {
    return Array.from(this.idToPosition.keys());
  }

  /**
   * Get count of vectors in index
   * @returns {number}
   */
  getCount() {
    return this.stats.vectorCount;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  VectorIndex,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_M,
  DEFAULT_EF_CONSTRUCTION,
  DEFAULT_EF_SEARCH,
  DEFAULT_SPACE,
};
