/**
 * Cortex - Claude's Cognitive Layer - Episodic Memory Adapter
 *
 * Direct SQLite access to the Episodic Memory database for cross-session search.
 * Bypasses MCP-to-MCP limitation by querying the database directly using
 * better-sqlite3 + sqlite-vec (vec0 extension) for vector similarity search.
 *
 * Database: ~/.config/superpowers/conversation-index/db.sqlite
 * - 8,198+ exchanges with 384-dim vectors (all-MiniLM-L6-v2)
 * - vec0 virtual table for approximate nearest neighbor search
 * - Full text via LIKE (FTS5 planned for Phase F)
 *
 * @version 2.0.0
 * @see Design: ../docs/plans/2026-02-25-cortex-v3-full-transformation.md#task-e1
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { BaseAdapter } = require('./base-adapter.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default path to episodic memory SQLite database */
const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  '.config', 'superpowers', 'conversation-index', 'db.sqlite'
);

/** Maximum text length for embedding generation (model limit ~512 tokens) */
const MAX_EMBED_CHARS = 2000;

// =============================================================================
// EPISODIC MEMORY ADAPTER — DIRECT SQLITE
// =============================================================================

/**
 * Adapter for Episodic Memory via direct SQLite access
 * Priority: 0.9 - Rich cross-session context
 *
 * v2.0: Bypasses MCP entirely — uses better-sqlite3 + sqlite-vec for
 * vector search and LIKE for text search. Works WITHOUT mcpCaller.
 */
class EpisodicMemoryAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} [config.dbPath] - Path to SQLite database (auto-detected)
   * @param {number} [config.maxResults=20] - Maximum results per query
   * @param {'vector' | 'text' | 'both'} [config.searchMode='both'] - Search mode
   * @param {Object} [config.embedder] - Shared Embedder instance (from core/embedder.cjs)
   * @param {Function} [config.mcpCaller] - Legacy MCP caller (unused in v2, kept for compat)
   */
  constructor(config = {}) {
    super({
      name: 'episodic-memory',
      priority: 0.9,
      timeout: 5000,  // Allow time for first embedding model load
      enabled: config.enabled !== false,
    });

    this.dbPath = config.dbPath || DEFAULT_DB_PATH;
    this.maxResults = config.maxResults || 20;
    this.searchMode = config.searchMode || 'both';
    this.mcpCaller = config.mcpCaller || null;  // Legacy compat

    // Lazy-loaded resources
    this._db = null;
    this._embedder = config.embedder || null;
    this._vecLoaded = false;

    // Prepared statements cache
    this._stmts = {};

    // Result cache with TTL
    this._cache = new Map();
    this._cacheTTL = 5 * 60 * 1000;  // 5 minutes
  }

  // ---------------------------------------------------------------------------
  // DATABASE INITIALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Ensure database is open with vec0 extension loaded
   * @private
   * @returns {Object} better-sqlite3 Database instance
   */
  _ensureDb() {
    if (this._db) return this._db;

    // Check database exists
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(
        `Episodic memory database not found at ${this.dbPath}. ` +
        'Is the episodic-memory plugin installed?'
      );
    }

    const Database = require('better-sqlite3');
    this._db = new Database(this.dbPath, { readonly: true });

    // Load sqlite-vec extension for vec0 virtual table
    try {
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(this._db);
      this._vecLoaded = true;
    } catch (err) {
      console.warn(
        '[EpisodicMemoryAdapter] sqlite-vec not available, vector search disabled:',
        err.message
      );
      this._vecLoaded = false;
    }

    // Prepare reusable statements
    this._prepareStatements();

    return this._db;
  }

  /**
   * Ensure embedder is loaded for vector search
   * @private
   * @returns {Promise<Object>} Embedder instance
   */
  async _ensureEmbedder() {
    if (this._embedder) return this._embedder;

    const { getSharedEmbedder } = require('../core/embedder-provider.cjs');
    this._embedder = getSharedEmbedder({ verbose: false });
    return this._embedder;
  }

  /**
   * Prepare reusable SQL statements for performance
   * @private
   */
  _prepareStatements() {
    const db = this._db;

    // Vector similarity search (requires vec0)
    if (this._vecLoaded) {
      this._stmts.vectorSearch = db.prepare(`
        SELECT
          e.id,
          e.project,
          e.timestamp,
          e.user_message,
          e.assistant_message,
          e.archive_path,
          e.line_start,
          e.line_end,
          e.session_id,
          e.cwd,
          e.git_branch,
          vec.distance
        FROM vec_exchanges AS vec
        JOIN exchanges AS e ON vec.id = e.id
        WHERE vec.embedding MATCH ?
          AND k = ?
        ORDER BY vec.distance ASC
      `);
    }

    // Text search (LIKE-based, works without extensions)
    this._stmts.textSearch = db.prepare(`
      SELECT
        id, project, timestamp,
        user_message, assistant_message,
        archive_path, line_start, line_end,
        session_id, cwd, git_branch,
        0.5 as distance
      FROM exchanges
      WHERE (user_message LIKE ? OR assistant_message LIKE ?)
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    // Fetch exchanges by IDs (for merging/dedup)
    this._stmts.byId = db.prepare(`
      SELECT
        id, project, timestamp,
        user_message, assistant_message,
        archive_path, line_start, line_end,
        session_id, cwd, git_branch
      FROM exchanges
      WHERE id = ?
    `);

    // Count total exchanges
    this._stmts.count = db.prepare('SELECT count(*) as total FROM exchanges');

    // Recent exchanges (fallback when no query terms)
    this._stmts.recent = db.prepare(`
      SELECT
        id, project, timestamp,
        user_message, assistant_message,
        archive_path, line_start, line_end,
        session_id, cwd, git_branch,
        0.5 as distance
      FROM exchanges
      ORDER BY timestamp DESC
      LIMIT ?
    `);
  }

  // ---------------------------------------------------------------------------
  // CORE QUERY — DIRECT SQLITE
  // ---------------------------------------------------------------------------

  /**
   * Query episodic memory for relevant conversations
   * Uses direct SQLite + vec0 vector search, bypassing MCP entirely
   *
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const searchQuery = this._buildSearchQuery(context);
      const queryStr = Array.isArray(searchQuery) ? searchQuery.join(' ') : searchQuery;

      // Check cache
      const cacheKey = this._getCacheKey(queryStr, options);
      const cached = this._getFromCache(cacheKey);
      if (cached) {
        this._trackCacheAccess(true);
        return cached;
      }
      this._trackCacheAccess(false);

      // Open database
      this._ensureDb();

      const limit = options.limit || this.maxResults;
      let rawResults = [];

      // Determine effective search mode
      const mode = this._getEffectiveSearchMode();

      if (queryStr === 'recent') {
        // Fallback: just return recent exchanges
        rawResults = this._stmts.recent.all(limit);
      } else if (mode === 'vector' || mode === 'both') {
        // Vector search
        const vectorResults = await this._vectorSearch(queryStr, limit);
        rawResults = vectorResults;

        if (mode === 'both') {
          // Merge with text results
          const textResults = this._textSearch(queryStr, limit);
          rawResults = this._mergeResults(vectorResults, textResults);
        }
      } else {
        // Text-only search
        rawResults = this._textSearch(queryStr, limit);
      }

      // Normalize to MemoryRecord format
      const records = rawResults
        .map(r => this.normalize(r))
        .filter(r => r !== null);

      // Apply additional filters (type, project, confidence)
      const filtered = this._applyQueryOptions(records, options);

      // Limit final results
      const limited = filtered.slice(0, limit);

      // Cache results
      this._setCache(cacheKey, limited);

      return limited;
    });
  }

  /**
   * Determine effective search mode based on available extensions
   * @private
   * @returns {'vector' | 'text' | 'both'}
   */
  _getEffectiveSearchMode() {
    if (!this._vecLoaded) {
      // vec0 not available — fall back to text search
      if (this.searchMode !== 'text') {
        // Only warn once
        if (!this._warnedNoVec) {
          console.warn('[EpisodicMemoryAdapter] vec0 not loaded, falling back to text search');
          this._warnedNoVec = true;
        }
      }
      return 'text';
    }
    return this.searchMode;
  }

  /**
   * Execute vector similarity search via vec0
   * @private
   * @param {string} query - Search query text
   * @param {number} limit - Max results
   * @returns {Promise<Object[]>} Raw database rows with distance
   */
  async _vectorSearch(query, limit) {
    if (!this._vecLoaded || !this._stmts.vectorSearch) {
      return [];
    }

    try {
      // Generate query embedding
      const embedder = await this._ensureEmbedder();
      const embedding = await embedder.embed(query);

      // Convert Float32Array to Buffer for sqlite-vec
      const vecBuffer = Buffer.from(embedding.buffer);

      // Execute vec0 similarity search
      return this._stmts.vectorSearch.all(vecBuffer, limit * 2);
    } catch (err) {
      console.error('[EpisodicMemoryAdapter] Vector search failed:', err.message);
      return [];
    }
  }

  /**
   * Execute text search via LIKE
   * @private
   * @param {string} query - Search query text
   * @param {number} limit - Max results
   * @returns {Object[]} Raw database rows
   */
  _textSearch(query, limit) {
    try {
      const pattern = `%${query}%`;
      return this._stmts.textSearch.all(pattern, pattern, limit * 2);
    } catch (err) {
      console.error('[EpisodicMemoryAdapter] Text search failed:', err.message);
      return [];
    }
  }

  /**
   * Merge vector and text search results, deduplicating by ID
   * @private
   * @param {Object[]} vectorResults - Results from vector search (scored by distance)
   * @param {Object[]} textResults - Results from text search
   * @returns {Object[]} Merged and deduplicated results
   */
  _mergeResults(vectorResults, textResults) {
    const seen = new Set();
    const merged = [];

    // Vector results first (they have meaningful distance scores)
    for (const r of vectorResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }

    // Then text results (fill in any missing)
    for (const r of textResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }

    return merged;
  }

  // ---------------------------------------------------------------------------
  // QUERY BUILDING
  // ---------------------------------------------------------------------------

  /**
   * Build search query from analysis context
   * @private
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @returns {string | string[]}
   */
  _buildSearchQuery(context) {
    const terms = [];

    if (context.intent && context.intentConfidence > 0.5) {
      terms.push(context.intent);
    }

    if (context.tags?.length) {
      terms.push(...context.tags.slice(0, 3));
    }

    if (context.projectName) {
      terms.push(context.projectName);
    }

    if (context.domains?.length) {
      terms.push(...context.domains.slice(0, 2));
    }

    if (terms.length === 0) {
      return 'recent';
    }

    return terms.length > 1 ? terms : terms[0];
  }

  // ---------------------------------------------------------------------------
  // AVAILABILITY & STATS
  // ---------------------------------------------------------------------------

  /**
   * Extract all available memories from episodic memory database
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async harvest(options = {}) {
    return this._executeQuery(async () => {
      this._ensureDb();
      const rows = this._db.prepare('SELECT * FROM exchanges').all();
      return rows
        .map(r => this.normalize(r))
        .filter(r => r !== null);
    });
  }

  /**
   * Check if episodic memory database is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      if (!fs.existsSync(this.dbPath)) return false;
      this._ensureDb();
      const row = this._stmts.count.get();
      return row && row.total > 0;
    } catch (err) {
      console.error('[EpisodicMemoryAdapter] Availability check failed:', err.message);
      return false;
    }
  }

  /**
   * Get exchange count from database
   * @returns {number}
   */
  getExchangeCount() {
    try {
      this._ensureDb();
      return this._stmts.count.get().total;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // NORMALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Normalize a database row to MemoryRecord format
   * @param {Object} raw - Raw database row
   * @returns {import('./base-adapter.cjs').MemoryRecord | null}
   */
  normalize(raw) {
    if (!raw) return null;

    // Build content from user + assistant messages
    const userMsg = raw.user_message || '';
    const assistantMsg = raw.assistant_message || '';
    const content = `User: ${userMsg}\nAssistant: ${assistantMsg}`;

    // Score: convert vec0 distance to similarity (1 - distance)
    // For text results, distance is 0.5 (neutral)
    const score = typeof raw.distance === 'number' ? Math.max(0, 1 - raw.distance) : 0.5;

    // Extract project hash from archive path
    const projectHash = this._extractProjectHash(raw.archive_path);

    // Infer memory type from content
    const type = this._inferType(content);

    // Extract tags from content
    const extractedTags = this._extractTags(content);

    return this._createBaseRecord({
      id: raw.id || this._generateId(),
      version: 2,
      type,
      content,
      summary: userMsg.slice(0, 100),
      projectHash,
      tags: extractedTags,
      intent: 'general',
      sourceSessionId: raw.session_id || 'unknown',
      sourceTimestamp: raw.timestamp || new Date().toISOString(),
      extractionConfidence: score,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: this._calculateDecay(raw.timestamp),
      status: 'active',
      createdAt: raw.timestamp || new Date().toISOString(),
      updatedAt: raw.timestamp || new Date().toISOString(),
      _source: 'episodic-memory',
      _sourcePriority: this.priority,
      _originalScore: score,
      _archivePath: raw.archive_path,
      _lineStart: raw.line_start,
      _lineEnd: raw.line_end,
      _gitBranch: raw.git_branch,
      _cwd: raw.cwd,
      _project: raw.project,
    });
  }

  // ---------------------------------------------------------------------------
  // READ OPERATIONS — DIRECT FILE ACCESS
  // ---------------------------------------------------------------------------

  /**
   * Read a full conversation by archive path (direct file access)
   * @param {string} conversationPath - Path to conversation JSONL file
   * @param {Object} [options]
   * @param {number} [options.startLine] - Start line (1-indexed)
   * @param {number} [options.endLine] - End line (1-indexed)
   * @returns {Promise<{success: boolean, content?: string, error?: string}>}
   */
  async read(conversationPath, options = {}) {
    try {
      if (!fs.existsSync(conversationPath)) {
        return { success: false, error: `File not found: ${conversationPath}` };
      }

      const fullContent = fs.readFileSync(conversationPath, 'utf-8');
      const lines = fullContent.split('\n');

      // Apply line range if specified
      const start = (options.startLine || 1) - 1;  // Convert to 0-indexed
      const end = options.endLine || lines.length;
      const sliced = lines.slice(start, end).join('\n');

      return {
        success: true,
        content: sliced,
        path: conversationPath,
        startLine: options.startLine,
        endLine: options.endLine,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Show conversation details with metadata
   * @param {string} conversationPath
   * @param {Object} [options]
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async show(conversationPath, options = {}) {
    const result = await this.read(conversationPath, options);

    if (!result.success) return result;

    const data = {
      path: conversationPath,
      content: result.content,
      metadata: {},
    };

    if (options.includeMetadata !== false) {
      data.metadata = this._extractConversationMetadata(result.content);
    }

    return { success: true, data };
  }

  /**
   * Search and return full conversation context
   * @param {string | string[]} query
   * @param {Object} [options]
   * @returns {Promise<Array<{record: Object, context: string}>>}
   */
  async searchWithContext(query, options = {}) {
    const limit = options.limit || 5;
    const contextLines = options.contextLines || 50;

    const context = { tags: Array.isArray(query) ? query : [query] };
    const searchResults = await this.query(context, { limit });

    const enrichedResults = [];

    for (const record of searchResults) {
      try {
        // Use archive_path from metadata for file access
        const archivePath = record._archivePath;
        if (archivePath) {
          const readResult = await this.read(archivePath, {
            startLine: record._lineStart,
            endLine: Math.min(
              (record._lineStart || 1) + contextLines,
              record._lineEnd || Infinity
            ),
          });

          enrichedResults.push({
            record,
            context: readResult.success ? readResult.content : null,
          });
        } else {
          enrichedResults.push({ record, context: null });
        }
      } catch {
        enrichedResults.push({ record, context: null });
      }
    }

    return enrichedResults;
  }

  // ---------------------------------------------------------------------------
  // LEGACY COMPAT
  // ---------------------------------------------------------------------------

  /**
   * Set MCP caller (legacy, kept for backward compatibility)
   * In v2, the adapter works without mcpCaller via direct SQLite access.
   * @param {Function} mcpCaller
   */
  setMcpCaller(mcpCaller) {
    if (typeof mcpCaller !== 'function') {
      throw new Error('mcpCaller must be a function');
    }
    this.mcpCaller = mcpCaller;
  }

  // ---------------------------------------------------------------------------
  // HELPERS (preserved from v1)
  // ---------------------------------------------------------------------------

  /**
   * Extract project hash from archive file path
   * @private
   */
  _extractProjectHash(archivePath) {
    if (!archivePath) return null;
    const match = archivePath.match(/conversation-archive\/([^/]+)\//);
    if (match) {
      return match[1].replace(/-/g, '/');
    }
    return null;
  }

  /**
   * Infer memory type from content
   * @private
   */
  _inferType(content) {
    const lower = content.toLowerCase();

    if (lower.includes('fixed') || lower.includes('solved') || lower.includes('solution')) {
      return 'learning';
    }
    if (lower.includes('pattern') || lower.includes('always') || lower.includes('workflow')) {
      return 'pattern';
    }
    if (lower.includes('prefer') || lower.includes('standard') || lower.includes('use')) {
      return 'preference';
    }
    if (lower.includes('skill') || lower.includes('command') || lower.includes('how to')) {
      return 'skill';
    }
    if (lower.includes("don't") || lower.includes('avoid') || lower.includes('warning')) {
      return 'correction';
    }

    return 'learning';
  }

  /**
   * Extract tags from content
   * @private
   */
  _extractTags(content) {
    const tags = [];
    const lower = content.toLowerCase();

    const techPatterns = [
      'javascript', 'typescript', 'python', 'node', 'react', 'vue',
      'git', 'docker', 'kubernetes', 'aws', 'linux', 'bash',
      'claude', 'mcp', 'hook', 'plugin', 'skill',
    ];

    for (const tech of techPatterns) {
      if (lower.includes(tech)) {
        tags.push(tech);
      }
    }

    return tags.slice(0, 5);
  }

  /**
   * Calculate decay score based on date
   * @private
   */
  _calculateDecay(dateStr) {
    if (!dateStr) return 0.5;

    const timestamp = new Date(dateStr).getTime();
    if (isNaN(timestamp)) return 0.5;

    const age = Date.now() - timestamp;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const decay = Math.exp(-age / thirtyDays);

    return Math.max(0.1, Math.min(1.0, decay));
  }

  /**
   * Extract metadata from conversation content
   * @private
   */
  _extractConversationMetadata(content) {
    if (!content) return {};

    const lines = content.split('\n');
    const metadata = {
      lineCount: lines.length,
      messageCount: 0,
      technologies: [],
    };

    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.role || parsed.type) {
            metadata.messageCount++;
          }
        } catch {
          // Not JSON
        }
      }
    }

    const lowerContent = content.toLowerCase();
    const techPatterns = [
      'javascript', 'typescript', 'python', 'node', 'react',
      'git', 'docker', 'kubernetes', 'linux', 'bash',
      'claude', 'mcp', 'hook', 'plugin',
    ];

    for (const tech of techPatterns) {
      if (lowerContent.includes(tech)) {
        metadata.technologies.push(tech);
      }
    }

    return metadata;
  }

  // ---------------------------------------------------------------------------
  // CACHE MANAGEMENT (preserved from v1)
  // ---------------------------------------------------------------------------

  /** @private */
  _getCacheKey(query, options) {
    const queryStr = Array.isArray(query) ? query.join(',') : query;
    return `${queryStr}:${JSON.stringify(options)}`;
  }

  /** @private */
  _getFromCache(key) {
    const cached = this._cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this._cacheTTL) {
      this._cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /** @private */
  _setCache(key, data) {
    this._cache.set(key, { data, timestamp: Date.now() });

    if (this._cache.size > 100) {
      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [k, entry] of this._cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) this._cache.delete(oldestKey);
    }
  }

  clearCache() {
    this._cache.clear();
  }

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  /**
   * Close database connection (call when shutting down)
   */
  close() {
    if (this._db) {
      try {
        this._db.close();
      } catch {
        // Already closed
      }
      this._db = null;
      this._stmts = {};
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  EpisodicMemoryAdapter,
  DEFAULT_DB_PATH,
};
