/**
 * Cortex - Claude's Cognitive Layer - Embedder
 *
 * Local embedding generation using @xenova/transformers.
 * Generates 384-dimensional vectors for semantic similarity search.
 *
 * Features:
 * - Lazy model loading (no startup delay)
 * - LRU cache with configurable size and TTL
 * - Batch embedding support
 * - Cosine similarity utility
 * - Comprehensive statistics tracking
 *
 * @version 1.0.0
 */

'use strict';

const crypto = require('crypto');

// =============================================================================
// CONSTANTS
// =============================================================================

/** @const {string} Default embedding model */
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** @const {number} Embedding dimension for MiniLM-L6-v2 */
const EMBEDDING_DIM = 384;

/** @const {number} Maximum tokens the model can handle */
const MAX_TOKENS = 512;

/** @const {number} Approximate chars per token (conservative estimate) */
const CHARS_PER_TOKEN = 4;

/** @const {number} Maximum input length in characters */
const MAX_INPUT_LENGTH = MAX_TOKENS * CHARS_PER_TOKEN;

/** @const {number} Default cache size */
const DEFAULT_CACHE_SIZE = 1000;

/** @const {number} Default cache TTL in milliseconds (1 hour) */
const DEFAULT_CACHE_TTL = 60 * 60 * 1000;

// =============================================================================
// LRU CACHE WITH TTL
// =============================================================================

/**
 * LRU Cache with Time-To-Live support
 * Used to avoid redundant embedding generation
 */
class LRUCache {
  /**
   * @param {number} maxSize - Maximum number of entries
   * @param {number} ttl - Time-to-live in milliseconds
   */
  constructor(maxSize = DEFAULT_CACHE_SIZE, ttl = DEFAULT_CACHE_TTL) {
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cache = new Map();
  }

  /**
   * Get a value from cache
   * @param {string} key
   * @returns {Float32Array|null}
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in cache
   * @param {string} key
   * @param {Float32Array} value
   */
  set(key, value) {
    // Delete if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Prune expired entries
   * @returns {number} Number of entries removed
   */
  prune() {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

// =============================================================================
// EMBEDDER CLASS
// =============================================================================

/**
 * Embedding generator using local transformer model
 */
class Embedder {
  /**
   * @param {Object} options
   * @param {string} [options.model] - HuggingFace model ID (default: Xenova/all-MiniLM-L6-v2)
   * @param {number} [options.cacheSize] - Maximum cache entries (default: 1000)
   * @param {number} [options.cacheTTL] - Cache TTL in ms (default: 1 hour)
   * @param {boolean} [options.verbose] - Log model loading progress
   */
  constructor(options = {}) {
    this.modelId = options.model || DEFAULT_MODEL;
    this.verbose = options.verbose || false;

    // Pipeline instance (lazy loaded)
    this.pipeline = null;
    this.loadingPromise = null;
    this.modelLoaded = false;

    // Embedding cache
    this.cache = new LRUCache(
      options.cacheSize || DEFAULT_CACHE_SIZE,
      options.cacheTTL || DEFAULT_CACHE_TTL
    );

    // Statistics
    this.stats = {
      totalEmbeddings: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalLatencyMs: 0,
      modelLoadTimeMs: 0,
      errors: 0,
      lastError: null,
    };
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Generate embedding for a single text
   *
   * @param {string} text - Input text (will be truncated if too long)
   * @returns {Promise<Float32Array>} 384-dimensional embedding vector
   * @throws {Error} If model loading or embedding fails
   */
  async embed(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Input must be a non-empty string');
    }

    // Check cache first
    const cacheKey = this._hash(text);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    this.stats.cacheMisses++;

    // Ensure model is loaded
    await this._ensureLoaded();

    const startTime = Date.now();

    try {
      // Truncate to max length
      const truncated = this._truncate(text);

      // Generate embedding
      const output = await this.pipeline(truncated, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract Float32Array from tensor
      const embedding = new Float32Array(output.data);

      // Validate dimension
      if (embedding.length !== EMBEDDING_DIM) {
        throw new Error(
          `Unexpected embedding dimension: ${embedding.length}, expected ${EMBEDDING_DIM}`
        );
      }

      // Update stats
      const latency = Date.now() - startTime;
      this.stats.totalEmbeddings++;
      this.stats.totalLatencyMs += latency;

      // Cache result
      this.cache.set(cacheKey, embedding);

      return embedding;
    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date().toISOString(),
      };
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   *
   * @param {string[]} texts - Array of input texts
   * @returns {Promise<Float32Array[]>} Array of embedding vectors
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts)) {
      throw new Error('Input must be an array of strings');
    }

    // Process in parallel but with concurrency limit to avoid memory issues
    const BATCH_SIZE = 10;
    const results = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Check if model is loaded
   * @returns {boolean}
   */
  isLoaded() {
    return this.modelLoaded;
  }

  /**
   * Preload the model (useful for warmup)
   * @returns {Promise<void>}
   */
  async preload() {
    await this._ensureLoaded();
  }

  /**
   * Get embedding dimension
   * @returns {number}
   */
  getDimension() {
    return EMBEDDING_DIM;
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const avgLatency = this.stats.totalEmbeddings > 0
      ? Math.round(this.stats.totalLatencyMs / this.stats.totalEmbeddings)
      : 0;

    const cacheHitRate = (this.stats.cacheHits + this.stats.cacheMisses) > 0
      ? this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)
      : 0;

    return {
      modelId: this.modelId,
      dimension: EMBEDDING_DIM,
      modelLoaded: this.modelLoaded,
      modelLoadTimeMs: this.stats.modelLoadTimeMs,
      totalEmbeddings: this.stats.totalEmbeddings,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      cacheSize: this.cache.size,
      avgLatencyMs: avgLatency,
      errors: this.stats.errors,
      lastError: this.stats.lastError,
    };
  }

  /**
   * Clear the embedding cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Prune expired cache entries
   * @returns {number} Number of entries removed
   */
  pruneCache() {
    return this.cache.prune();
  }

  // ===========================================================================
  // STATIC UTILITY METHODS
  // ===========================================================================

  /**
   * Compute cosine similarity between two vectors
   *
   * @param {Float32Array|number[]} a - First vector
   * @param {Float32Array|number[]} b - Second vector
   * @returns {number} Similarity score between -1 and 1
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Compute Euclidean distance between two vectors
   *
   * @param {Float32Array|number[]} a - First vector
   * @param {Float32Array|number[]} b - Second vector
   * @returns {number} Distance (0 = identical)
   */
  static euclideanDistance(a, b) {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * Normalize a vector to unit length
   *
   * @param {Float32Array|number[]} v - Input vector
   * @returns {Float32Array} Normalized vector
   */
  static normalize(v) {
    let norm = 0;
    for (let i = 0; i < v.length; i++) {
      norm += v[i] * v[i];
    }
    norm = Math.sqrt(norm);

    if (norm === 0) {
      return new Float32Array(v.length);
    }

    const result = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      result[i] = v[i] / norm;
    }

    return result;
  }

  /**
   * Convert embedding to Buffer for SQLite BLOB storage
   *
   * @param {Float32Array} embedding
   * @returns {Buffer}
   */
  static toBuffer(embedding) {
    return Buffer.from(embedding.buffer);
  }

  /**
   * Convert Buffer from SQLite BLOB to Float32Array
   *
   * @param {Buffer} buffer
   * @returns {Float32Array}
   */
  static fromBuffer(buffer) {
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.length / Float32Array.BYTES_PER_ELEMENT
    );
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Ensure the model is loaded (lazy loading)
   * @private
   */
  async _ensureLoaded() {
    if (this.pipeline) {
      return;
    }

    // Prevent multiple concurrent loads
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this._loadModel();
    await this.loadingPromise;
    this.loadingPromise = null;
  }

  /**
   * Load the transformer model
   * @private
   */
  async _loadModel() {
    const startTime = Date.now();

    if (this.verbose) {
      process.stderr.write(`[Embedder] Loading model: ${this.modelId}...\n`);
    }

    try {
      // Dynamic import for ESM module
      const { pipeline } = await import('@xenova/transformers');

      this.pipeline = await pipeline('feature-extraction', this.modelId, {
        // Use default cache location (~/.cache/huggingface)
        // quantized: true,  // Use quantized model if available (smaller, faster)
      });

      this.modelLoaded = true;
      this.stats.modelLoadTimeMs = Date.now() - startTime;

      if (this.verbose) {
        process.stderr.write(
          `[Embedder] Model loaded in ${this.stats.modelLoadTimeMs}ms\n`
        );
      }
    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = {
        message: `Model loading failed: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
      throw new Error(`Failed to load embedding model: ${error.message}`);
    }
  }

  /**
   * Truncate text to maximum length
   * @private
   * @param {string} text
   * @returns {string}
   */
  _truncate(text) {
    if (text.length <= MAX_INPUT_LENGTH) {
      return text;
    }

    // Truncate at word boundary if possible
    const truncated = text.slice(0, MAX_INPUT_LENGTH);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > MAX_INPUT_LENGTH * 0.8) {
      return truncated.slice(0, lastSpace);
    }

    return truncated;
  }

  /**
   * Generate cache key from text
   * @private
   * @param {string} text
   * @returns {string}
   */
  _hash(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  Embedder,
  LRUCache,
  EMBEDDING_DIM,
  DEFAULT_MODEL,
  MAX_INPUT_LENGTH,
};
