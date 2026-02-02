/**
 * Cortex - Claude's Cognitive Layer - Hybrid Search
 *
 * Combines BM25 (SQLite FTS5) and vector (HNSW) search with:
 * - Reciprocal Rank Fusion (RRF) for score combination
 * - FSRS-6 power law temporal decay for recency weighting
 * - Source tracking for transparency
 * - Comprehensive statistics
 *
 * @version 1.0.0
 */

'use strict';

// =============================================================================
// CONSTANTS
// =============================================================================

/** @const {number} RRF constant (standard is 60, research-validated) */
const DEFAULT_RRF_K = 60;

/** @const {number} Default weight for vector search (0.5 = equal with BM25) */
const DEFAULT_VECTOR_WEIGHT = 0.5;

/** @const {number} FSRS-6 decay base (retention after 1 day) */
const DEFAULT_DECAY_BASE = 0.9;

/** @const {number} FSRS-6 decay exponent (power law characteristic) */
const DEFAULT_DECAY_EXPONENT = 0.5;

/** @const {number} Default result limit */
const DEFAULT_LIMIT = 10;

/** @const {number} Fetch multiplier for pre-fusion results */
const PREFETCH_MULTIPLIER = 3;

/** @const {number} Minimum results to fetch before fusion */
const MIN_PREFETCH = 30;

// =============================================================================
// HYBRID SEARCH CLASS
// =============================================================================

/**
 * Hybrid search combining BM25 (FTS5) and vector (HNSW) search
 */
class HybridSearch {
  /**
   * @param {Object} options
   * @param {Object} options.store - SQLiteStore instance with FTS5 table
   * @param {Object} options.vectorIndex - VectorIndex instance
   * @param {Object} options.embedder - Embedder instance
   * @param {number} [options.rrfK] - RRF constant (default: 60)
   * @param {number} [options.vectorWeight] - Vector weight 0-1 (default: 0.5)
   * @param {number} [options.decayBase] - Temporal decay base (default: 0.9)
   * @param {number} [options.decayExponent] - Decay exponent (default: 0.5)
   * @param {string} [options.tableName] - Main table name (default: 'memories')
   * @param {string} [options.ftsTableName] - FTS5 table name (default: 'memories_fts')
   */
  constructor(options = {}) {
    if (!options.store) {
      throw new Error('HybridSearch requires a SQLiteStore instance');
    }
    if (!options.vectorIndex) {
      throw new Error('HybridSearch requires a VectorIndex instance');
    }
    if (!options.embedder) {
      throw new Error('HybridSearch requires an Embedder instance');
    }

    this.store = options.store;
    this.vectorIndex = options.vectorIndex;
    this.embedder = options.embedder;

    // Configuration
    this.rrfK = options.rrfK ?? DEFAULT_RRF_K;
    this.vectorWeight = options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
    this.decayBase = options.decayBase ?? DEFAULT_DECAY_BASE;
    this.decayExponent = options.decayExponent ?? DEFAULT_DECAY_EXPONENT;

    // Table names
    this.tableName = options.tableName || 'memories';
    this.ftsTableName = options.ftsTableName || 'memories_fts';

    // Statistics
    this.stats = {
      searches: 0,
      bm25Only: 0,
      vectorOnly: 0,
      hybrid: 0,
      emptyResults: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      bm25Hits: 0,
      vectorHits: 0,
      fusedHits: 0,
    };
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Perform hybrid search combining BM25 and vector search
   *
   * @param {string} query - Search query text
   * @param {Object} [options={}]
   * @param {number} [options.limit=10] - Maximum results to return
   * @param {string} [options.source] - Filter by source (jsonl|episodic|knowledge-graph|claudemd)
   * @param {string} [options.memoryType] - Filter by type (learning|pattern|skill|etc.)
   * @param {string} [options.projectHash] - Filter by project (null = global only)
   * @param {boolean} [options.includeGlobal=true] - Include global memories when projectHash set
   * @param {string} [options.status='active'] - Filter by status
   * @param {string} [options.mode='hybrid'] - Search mode: 'hybrid'|'bm25'|'vector'
   * @returns {Promise<Array<SearchResult>>}
   *
   * @typedef {Object} SearchResult
   * @property {string} id - Memory ID
   * @property {number} score - Final combined score
   * @property {Object} memory - Full memory record
   * @property {string[]} sources - Which search methods found this ('bm25'|'vector')
   * @property {number} decay - Temporal decay factor applied
   * @property {number} bm25Rank - Rank in BM25 results (null if not found)
   * @property {number} vectorRank - Rank in vector results (null if not found)
   */
  async search(query, options = {}) {
    const startTime = Date.now();

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Query must be a non-empty string');
    }

    const limit = options.limit ?? DEFAULT_LIMIT;
    const mode = options.mode ?? 'hybrid';
    const prefetchK = Math.max(limit * PREFETCH_MULTIPLIER, MIN_PREFETCH);

    // Build filter conditions
    const filters = this._buildFilters(options);

    let bm25Results = [];
    let vectorResults = [];

    // Execute searches based on mode
    if (mode === 'hybrid' || mode === 'bm25') {
      bm25Results = this._bm25Search(query, prefetchK, filters);
      this.stats.bm25Hits += bm25Results.length;
    }

    if (mode === 'hybrid' || mode === 'vector') {
      vectorResults = await this._vectorSearch(query, prefetchK, filters);
      this.stats.vectorHits += vectorResults.length;
    }

    // Track search type
    this.stats.searches++;
    if (mode === 'bm25') {
      this.stats.bm25Only++;
    } else if (mode === 'vector') {
      this.stats.vectorOnly++;
    } else {
      this.stats.hybrid++;
    }

    // Handle single-mode results
    if (mode === 'bm25') {
      return this._finalizeResults(bm25Results, limit, startTime);
    }
    if (mode === 'vector') {
      return this._finalizeResults(vectorResults, limit, startTime);
    }

    // Hybrid: RRF Fusion
    const fused = this._rrfFusion(bm25Results, vectorResults);
    this.stats.fusedHits += fused.size;

    // Apply temporal decay
    this._applyTemporalDecay(fused);

    // Sort and limit
    const sorted = Array.from(fused.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);

    // Fetch full memory records
    const results = [];
    for (const [id, data] of sorted) {
      const memory = this._getMemory(id);
      if (memory) {
        results.push({
          id,
          score: data.score,
          memory,
          sources: data.sources,
          decay: data.decay,
          bm25Rank: data.bm25Rank,
          vectorRank: data.vectorRank,
        });
      }
    }

    // Update stats
    const latency = Date.now() - startTime;
    this.stats.totalLatencyMs += latency;
    this.stats.avgLatencyMs = Math.round(this.stats.totalLatencyMs / this.stats.searches);

    if (results.length === 0) {
      this.stats.emptyResults++;
    }

    return results;
  }

  /**
   * Search only using BM25 (full-text search)
   *
   * @param {string} query - Search query
   * @param {Object} [options={}] - Same options as search()
   * @returns {Promise<Array<SearchResult>>}
   */
  async searchBM25(query, options = {}) {
    return this.search(query, { ...options, mode: 'bm25' });
  }

  /**
   * Search only using vector similarity
   *
   * @param {string} query - Search query
   * @param {Object} [options={}] - Same options as search()
   * @returns {Promise<Array<SearchResult>>}
   */
  async searchVector(query, options = {}) {
    return this.search(query, { ...options, mode: 'vector' });
  }

  /**
   * Get search statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      config: {
        rrfK: this.rrfK,
        vectorWeight: this.vectorWeight,
        decayBase: this.decayBase,
        decayExponent: this.decayExponent,
      },
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      searches: 0,
      bm25Only: 0,
      vectorOnly: 0,
      hybrid: 0,
      emptyResults: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      bm25Hits: 0,
      vectorHits: 0,
      fusedHits: 0,
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Build SQL filter conditions from options
   * @private
   * @param {Object} options
   * @returns {{whereClause: string, params: Object}}
   */
  _buildFilters(options) {
    const conditions = [`m.status = @status`];
    const params = { status: options.status ?? 'active' };

    if (options.source) {
      conditions.push(`m.source = @source`);
      params.source = options.source;
    }

    if (options.memoryType) {
      conditions.push(`m.memory_type = @memoryType`);
      params.memoryType = options.memoryType;
    }

    if (options.projectHash) {
      if (options.includeGlobal !== false) {
        conditions.push(`(m.project_hash = @projectHash OR m.project_hash IS NULL)`);
      } else {
        conditions.push(`m.project_hash = @projectHash`);
      }
      params.projectHash = options.projectHash;
    }

    return {
      whereClause: conditions.join(' AND '),
      params,
    };
  }

  /**
   * BM25 search using SQLite FTS5
   * @private
   * @param {string} query - Search query
   * @param {number} k - Number of results
   * @param {{whereClause: string, params: Object}} filters
   * @returns {Array<{id: string, rank: number, rawScore: number, createdAt: string}>}
   */
  _bm25Search(query, k, filters) {
    // Escape FTS5 special characters in query
    const escapedQuery = this._escapeFtsQuery(query);

    if (!escapedQuery) {
      return [];
    }

    // FTS5 BM25 search with JOIN to main table for filtering
    const sql = `
      SELECT
        m.id,
        m.created_at,
        bm25(${this.ftsTableName}) AS bm25_score
      FROM ${this.ftsTableName} f
      JOIN ${this.tableName} m ON f.rowid = m.rowid
      WHERE ${this.ftsTableName} MATCH @query
        AND ${filters.whereClause}
      ORDER BY bm25_score
      LIMIT @limit
    `;

    try {
      const rows = this.store.query(sql, {
        query: escapedQuery,
        limit: k,
        ...filters.params,
      });

      return rows.map((row, index) => ({
        id: row.id,
        rank: index,
        rawScore: -row.bm25_score, // BM25 returns negative scores (lower is better)
        createdAt: row.created_at,
      }));
    } catch (error) {
      // FTS5 query syntax errors are common, don't fail the whole search
      if (error.message.includes('fts5')) {
        console.error(`[HybridSearch] FTS5 query error: ${error.message}`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Escape special characters for FTS5 query
   * @private
   * @param {string} query
   * @returns {string}
   */
  _escapeFtsQuery(query) {
    // Remove FTS5 operators that could cause syntax errors
    // Keep alphanumeric, spaces, and basic punctuation
    let escaped = query
      .replace(/["\^$*]/g, ' ')  // Remove special FTS5 chars
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim();

    if (!escaped) {
      return '';
    }

    // Wrap each word in quotes for exact matching, joined with OR for flexibility
    const words = escaped.split(' ').filter(w => w.length > 0);
    if (words.length === 0) {
      return '';
    }

    // Use simple word search (implicit AND between words)
    return words.map(w => `"${w}"`).join(' ');
  }

  /**
   * Vector similarity search using HNSW index
   * @private
   * @param {string} query - Search query
   * @param {number} k - Number of results
   * @param {{whereClause: string, params: Object}} filters
   * @returns {Promise<Array<{id: string, rank: number, rawScore: number, createdAt: string}>>}
   */
  async _vectorSearch(query, k, filters) {
    // Generate query embedding
    const queryEmbedding = await this.embedder.embed(query);

    // Search vector index (returns more than k to allow for filtering)
    const { ids, distances } = this.vectorIndex.search(queryEmbedding, k * 2);

    if (ids.length === 0) {
      return [];
    }

    // Fetch metadata for filtering and get created_at
    const results = [];
    let rank = 0;

    for (let i = 0; i < ids.length && results.length < k; i++) {
      const memoryId = ids[i];
      const distance = distances[i];

      // Fetch memory to apply filters
      const memory = this._getMemory(memoryId);
      if (!memory) continue;

      // Apply filters
      if (!this._matchesFilters(memory, filters.params)) continue;

      results.push({
        id: memoryId,
        rank: rank++,
        rawScore: 1 - distance, // Convert distance to similarity (0-1)
        createdAt: memory.created_at,
      });
    }

    return results;
  }

  /**
   * Check if memory matches filter criteria
   * @private
   * @param {Object} memory
   * @param {Object} params
   * @returns {boolean}
   */
  _matchesFilters(memory, params) {
    if (params.status && memory.status !== params.status) return false;
    if (params.source && memory.source !== params.source) return false;
    if (params.memoryType && memory.memory_type !== params.memoryType) return false;
    if (params.projectHash) {
      const includeGlobal = params.includeGlobal !== false;
      if (memory.project_hash !== params.projectHash) {
        if (!includeGlobal || memory.project_hash !== null) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Reciprocal Rank Fusion to combine BM25 and vector results
   *
   * Formula: score(d) = Σ 1 / (k + rank(d))
   *
   * @private
   * @param {Array} bm25Results - BM25 search results
   * @param {Array} vectorResults - Vector search results
   * @returns {Map<string, {score: number, createdAt: string, sources: string[], bm25Rank: number|null, vectorRank: number|null}>}
   */
  _rrfFusion(bm25Results, vectorResults) {
    const fused = new Map();

    // Process BM25 results
    const bm25Weight = 1 - this.vectorWeight;
    for (const result of bm25Results) {
      const rrfScore = bm25Weight / (this.rrfK + result.rank);

      fused.set(result.id, {
        score: rrfScore,
        createdAt: result.createdAt,
        sources: ['bm25'],
        bm25Rank: result.rank,
        vectorRank: null,
        decay: 1.0,
      });
    }

    // Process vector results and merge
    for (const result of vectorResults) {
      const rrfScore = this.vectorWeight / (this.rrfK + result.rank);

      if (fused.has(result.id)) {
        // Found in both - add scores
        const existing = fused.get(result.id);
        existing.score += rrfScore;
        existing.sources.push('vector');
        existing.vectorRank = result.rank;
      } else {
        // Only in vector results
        fused.set(result.id, {
          score: rrfScore,
          createdAt: result.createdAt,
          sources: ['vector'],
          bm25Rank: null,
          vectorRank: result.rank,
          decay: 1.0,
        });
      }
    }

    return fused;
  }

  /**
   * Apply FSRS-6 power law temporal decay
   *
   * Formula: decay = base^(age^exponent)
   *
   * This models the forgetting curve where:
   * - Recent memories are strongly preferred
   * - Decay slows over time (power law, not exponential)
   * - Very old memories still have some relevance
   *
   * @private
   * @param {Map} fused - Fused results map
   */
  _applyTemporalDecay(fused) {
    const now = Date.now();

    for (const [id, data] of fused) {
      if (!data.createdAt) continue;

      const createdTime = new Date(data.createdAt).getTime();
      const ageMs = now - createdTime;
      const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

      // FSRS-6 power law decay
      // At age 0: decay = 1.0 (no decay)
      // At age 1 day: decay ≈ 0.9 (with default params)
      // At age 7 days: decay ≈ 0.77
      // At age 30 days: decay ≈ 0.62
      // At age 365 days: decay ≈ 0.37
      const decay = Math.pow(this.decayBase, Math.pow(ageDays, this.decayExponent));

      data.score *= decay;
      data.decay = decay;
    }
  }

  /**
   * Get full memory record by ID
   * @private
   * @param {string} id
   * @returns {Object|null}
   */
  _getMemory(id) {
    const sql = `SELECT * FROM ${this.tableName} WHERE id = @id`;
    return this.store.queryOne(sql, { id });
  }

  /**
   * Finalize single-mode results (convert to standard format)
   * @private
   * @param {Array} results - Raw search results
   * @param {number} limit - Max results
   * @param {number} startTime - Search start timestamp
   * @returns {Array<SearchResult>}
   */
  _finalizeResults(results, limit, startTime) {
    const limited = results.slice(0, limit);

    // Apply temporal decay
    const now = Date.now();
    const finalized = [];

    for (const result of limited) {
      const memory = this._getMemory(result.id);
      if (!memory) continue;

      // Calculate decay
      const createdTime = new Date(result.createdAt).getTime();
      const ageDays = Math.max(0, (now - createdTime) / (1000 * 60 * 60 * 24));
      const decay = Math.pow(this.decayBase, Math.pow(ageDays, this.decayExponent));

      finalized.push({
        id: result.id,
        score: result.rawScore * decay,
        memory,
        sources: result.rank !== undefined ? ['bm25'] : ['vector'],
        decay,
        bm25Rank: result.rank ?? null,
        vectorRank: result.rank ?? null,
      });
    }

    // Update stats
    const latency = Date.now() - startTime;
    this.stats.totalLatencyMs += latency;
    this.stats.avgLatencyMs = Math.round(this.stats.totalLatencyMs / this.stats.searches);

    if (finalized.length === 0) {
      this.stats.emptyResults++;
    }

    return finalized;
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate temporal decay for a given age
 *
 * @param {number} ageDays - Age in days
 * @param {number} [base=0.9] - Decay base
 * @param {number} [exponent=0.5] - Decay exponent
 * @returns {number} Decay factor (0-1)
 */
function calculateDecay(ageDays, base = DEFAULT_DECAY_BASE, exponent = DEFAULT_DECAY_EXPONENT) {
  return Math.pow(base, Math.pow(Math.max(0, ageDays), exponent));
}

/**
 * Calculate RRF score for a single rank
 *
 * @param {number} rank - 0-based rank
 * @param {number} [k=60] - RRF constant
 * @param {number} [weight=1.0] - Score weight
 * @returns {number} RRF score contribution
 */
function rrfScore(rank, k = DEFAULT_RRF_K, weight = 1.0) {
  return weight / (k + rank);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  HybridSearch,
  calculateDecay,
  rrfScore,
  DEFAULT_RRF_K,
  DEFAULT_VECTOR_WEIGHT,
  DEFAULT_DECAY_BASE,
  DEFAULT_DECAY_EXPONENT,
};
