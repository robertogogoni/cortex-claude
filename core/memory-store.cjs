/**
 * Cortex - Claude's Cognitive Layer - Memory Store
 *
 * SQLite-based memory storage with:
 * - Full schema with FTS5 for BM25 full-text search
 * - Embedding BLOB storage
 * - Automatic FTS sync via triggers
 * - CRUD operations for memories
 * - Quality metrics and temporal decay tracking
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const { SQLiteStore } = require('./sqlite-store.cjs');
const { expandPath } = require('./types.cjs');
const { Embedder } = require('./embedder.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/** @const {string} Default database path */
const DEFAULT_DB_PATH = '~/.claude/memory/data/memories.db';

/** @const {string} Table name for memories */
const TABLE_NAME = 'memories';

/** @const {string} FTS5 virtual table name */
const FTS_TABLE_NAME = 'memories_fts';

/** @const {string[]} Valid memory types */
const MEMORY_TYPES = [
  'observation',
  'learning',
  'pattern',
  'skill',
  'correction',
  'preference',
  'fact',
  'procedure',
  'concept',
  'decision',
];

/** @const {string[]} Valid memory sources */
const MEMORY_SOURCES = [
  'jsonl',
  'episodic',
  'knowledge-graph',
  'claudemd',
  'user',
  'system',
];

/** @const {string[]} Valid memory statuses */
const MEMORY_STATUSES = ['active', 'archived', 'deleted'];

// =============================================================================
// MEMORY STORE CLASS
// =============================================================================

/**
 * Memory storage with SQLite, FTS5, and embedding support
 */
class MemoryStore {
  /**
   * @param {Object} options
   * @param {string} [options.dbPath] - Database file path
   * @param {Object} [options.embedder] - Embedder instance (optional)
   * @param {boolean} [options.autoEmbed=false] - Auto-generate embeddings on insert
   * @param {number} [options.timeout] - SQLite busy timeout
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.embedder = options.embedder || null;
    this.autoEmbed = options.autoEmbed ?? false;

    // Create SQLiteStore instance
    this.store = new SQLiteStore(this.dbPath, {
      timeout: options.timeout || 5000,
      wal: true,
    });

    // Track initialization state
    this.initialized = false;

    // Statistics
    this.stats = {
      inserts: 0,
      updates: 0,
      deletes: 0,
      reads: 0,
      embeddingsGenerated: 0,
    };
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the store - open database and create schema
   *
   * @returns {Promise<{created: boolean, memoryCount: number}>}
   */
  async initialize() {
    if (this.initialized) {
      const count = this.getCount();
      return { created: false, memoryCount: count };
    }

    // Open database
    this.store.open();

    // Create schema
    const tableExists = this.store.tableExists(TABLE_NAME);
    this._createSchema();

    this.initialized = true;

    const memoryCount = this.getCount();
    return { created: !tableExists, memoryCount };
  }

  /**
   * Close the store
   */
  close() {
    if (this.store.isOpen()) {
      this.store.close();
    }
    this.initialized = false;
  }

  /**
   * Check if store is open
   * @returns {boolean}
   */
  isOpen() {
    return this.store.isOpen();
  }

  // ===========================================================================
  // SCHEMA
  // ===========================================================================

  /**
   * Create database schema with FTS5 and triggers
   * @private
   */
  _createSchema() {
    const schema = `
      -- Core memories table
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id TEXT PRIMARY KEY,
          version INTEGER DEFAULT 1,

          -- Content
          content TEXT NOT NULL,
          summary TEXT,

          -- Classification
          memory_type TEXT DEFAULT 'observation',
          intent TEXT,
          tags TEXT DEFAULT '[]',

          -- Provenance
          source TEXT NOT NULL,
          source_id TEXT,
          project_hash TEXT,
          session_id TEXT,

          -- Quality metrics
          extraction_confidence REAL DEFAULT 0.5,
          quality_score REAL DEFAULT 0.5,

          -- Usage tracking
          usage_count INTEGER DEFAULT 0,
          usage_success_rate REAL DEFAULT 0.5,
          last_accessed TEXT,

          -- Temporal decay
          strength REAL DEFAULT 1.0,
          decay_score REAL DEFAULT 1.0,

          -- Embedding (stored as BLOB - 384-dim float32 = 1536 bytes)
          embedding BLOB,

          -- Timestamps
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),

          -- Status
          status TEXT DEFAULT 'active'
      );

      -- FTS5 for BM25 full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME} USING fts5(
          content,
          summary,
          tags,
          content='${TABLE_NAME}',
          content_rowid='rowid'
      );

      -- Indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_memories_type ON ${TABLE_NAME}(memory_type);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON ${TABLE_NAME}(project_hash);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON ${TABLE_NAME}(source);
      CREATE INDEX IF NOT EXISTS idx_memories_status ON ${TABLE_NAME}(status);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON ${TABLE_NAME}(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON ${TABLE_NAME}(updated_at);
    `;

    this.store.exec(schema);

    // Create triggers separately (can't be in multi-statement exec)
    this._createTriggers();
  }

  /**
   * Create FTS5 sync triggers
   * @private
   */
  _createTriggers() {
    // Check if triggers exist
    const triggerExists = this.store.queryOne(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='memories_ai'"
    );

    if (triggerExists) {
      return; // Triggers already exist
    }

    // Insert trigger
    this.store.exec(`
      CREATE TRIGGER memories_ai AFTER INSERT ON ${TABLE_NAME} BEGIN
          INSERT INTO ${FTS_TABLE_NAME}(rowid, content, summary, tags)
          VALUES (new.rowid, new.content, new.summary, new.tags);
      END
    `);

    // Delete trigger
    this.store.exec(`
      CREATE TRIGGER memories_ad AFTER DELETE ON ${TABLE_NAME} BEGIN
          INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}, rowid, content, summary, tags)
          VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      END
    `);

    // Update trigger
    this.store.exec(`
      CREATE TRIGGER memories_au AFTER UPDATE ON ${TABLE_NAME} BEGIN
          INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}, rowid, content, summary, tags)
          VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
          INSERT INTO ${FTS_TABLE_NAME}(rowid, content, summary, tags)
          VALUES (new.rowid, new.content, new.summary, new.tags);
      END
    `);
  }

  // ===========================================================================
  // CRUD OPERATIONS
  // ===========================================================================

  /**
   * Insert a new memory
   *
   * @param {Object} memory
   * @param {string} memory.content - Full content (required)
   * @param {string} memory.source - Source identifier (required)
   * @param {string} [memory.id] - Custom ID (auto-generated if not provided)
   * @param {string} [memory.summary] - Brief summary
   * @param {string} [memory.memory_type] - Type classification
   * @param {string} [memory.intent] - Detected intent
   * @param {string[]} [memory.tags] - Tags array
   * @param {string} [memory.source_id] - Original ID in source
   * @param {string} [memory.project_hash] - Project identifier (null = global)
   * @param {string} [memory.session_id] - Session identifier
   * @param {number} [memory.extraction_confidence] - Confidence 0-1
   * @param {number} [memory.quality_score] - Quality 0-1
   * @param {Float32Array|Buffer} [memory.embedding] - Pre-computed embedding
   * @returns {Promise<{id: string, embedded: boolean}>}
   */
  async insert(memory) {
    this._ensureOpen();

    if (!memory.content || typeof memory.content !== 'string') {
      throw new Error('Memory content is required and must be a string');
    }

    if (!memory.source || typeof memory.source !== 'string') {
      throw new Error('Memory source is required and must be a string');
    }

    // Validate memory_type if provided
    if (memory.memory_type && !MEMORY_TYPES.includes(memory.memory_type)) {
      throw new Error(`Invalid memory_type: ${memory.memory_type}. Valid types: ${MEMORY_TYPES.join(', ')}`);
    }

    // Validate source
    if (!MEMORY_SOURCES.includes(memory.source)) {
      console.warn(`[MemoryStore] Unknown source: ${memory.source}`);
    }

    // Generate ID if not provided
    const id = memory.id || this._generateId();

    // Handle embedding
    let embeddingBlob = null;
    let embedded = false;

    if (memory.embedding) {
      embeddingBlob = this._toBlob(memory.embedding);
      embedded = true;
    } else if (this.autoEmbed && this.embedder) {
      const embedding = await this.embedder.embed(memory.content);
      embeddingBlob = Embedder.toBuffer(embedding);
      embedded = true;
      this.stats.embeddingsGenerated++;
    }

    // Serialize tags
    const tags = Array.isArray(memory.tags) ? JSON.stringify(memory.tags) : '[]';

    const sql = `
      INSERT INTO ${TABLE_NAME} (
        id, content, summary, memory_type, intent, tags,
        source, source_id, project_hash, session_id,
        extraction_confidence, quality_score, embedding
      ) VALUES (
        @id, @content, @summary, @memory_type, @intent, @tags,
        @source, @source_id, @project_hash, @session_id,
        @extraction_confidence, @quality_score, @embedding
      )
    `;

    this.store.run(sql, {
      id,
      content: memory.content,
      summary: memory.summary || null,
      memory_type: memory.memory_type || 'observation',
      intent: memory.intent || null,
      tags,
      source: memory.source,
      source_id: memory.source_id || null,
      project_hash: memory.project_hash || null,
      session_id: memory.session_id || null,
      extraction_confidence: memory.extraction_confidence ?? 0.5,
      quality_score: memory.quality_score ?? 0.5,
      embedding: embeddingBlob,
    });

    this.stats.inserts++;

    return { id, embedded };
  }

  /**
   * Insert multiple memories in a transaction
   *
   * @param {Array<Object>} memories - Array of memory objects
   * @returns {Promise<{inserted: number, embedded: number, errors: Array}>}
   */
  async insertBatch(memories) {
    this._ensureOpen();

    if (!Array.isArray(memories)) {
      throw new Error('memories must be an array');
    }

    let inserted = 0;
    let embedded = 0;
    const errors = [];

    this.store.transaction(() => {
      for (let i = 0; i < memories.length; i++) {
        try {
          // Note: In transaction context, we need sync operations
          // For batch with auto-embed, generate embeddings first
          const result = this._insertSync(memories[i]);
          inserted++;
          if (result.embedded) embedded++;
        } catch (error) {
          errors.push({ index: i, error: error.message });
        }
      }
    });

    return { inserted, embedded, errors };
  }

  /**
   * Synchronous insert (for transactions)
   * @private
   */
  _insertSync(memory) {
    if (!memory.content || !memory.source) {
      throw new Error('Memory content and source are required');
    }

    const id = memory.id || this._generateId();
    let embeddingBlob = null;
    let embedded = false;

    if (memory.embedding) {
      embeddingBlob = this._toBlob(memory.embedding);
      embedded = true;
    }

    const tags = Array.isArray(memory.tags) ? JSON.stringify(memory.tags) : '[]';

    const sql = `
      INSERT INTO ${TABLE_NAME} (
        id, content, summary, memory_type, intent, tags,
        source, source_id, project_hash, session_id,
        extraction_confidence, quality_score, embedding
      ) VALUES (
        @id, @content, @summary, @memory_type, @intent, @tags,
        @source, @source_id, @project_hash, @session_id,
        @extraction_confidence, @quality_score, @embedding
      )
    `;

    this.store.run(sql, {
      id,
      content: memory.content,
      summary: memory.summary || null,
      memory_type: memory.memory_type || 'observation',
      intent: memory.intent || null,
      tags,
      source: memory.source,
      source_id: memory.source_id || null,
      project_hash: memory.project_hash || null,
      session_id: memory.session_id || null,
      extraction_confidence: memory.extraction_confidence ?? 0.5,
      quality_score: memory.quality_score ?? 0.5,
      embedding: embeddingBlob,
    });

    this.stats.inserts++;

    return { id, embedded };
  }

  /**
   * Get a memory by ID
   *
   * @param {string} id - Memory ID
   * @param {boolean} [includeEmbedding=false] - Include embedding in result
   * @returns {Object|null}
   */
  get(id, includeEmbedding = false) {
    this._ensureOpen();

    const columns = includeEmbedding ? '*' : this._getColumnsWithoutEmbedding();
    const sql = `SELECT ${columns} FROM ${TABLE_NAME} WHERE id = @id`;

    const row = this.store.queryOne(sql, { id });
    this.stats.reads++;

    if (!row) return null;

    return this._parseMemory(row, includeEmbedding);
  }

  /**
   * Update a memory
   *
   * @param {string} id - Memory ID
   * @param {Object} updates - Fields to update
   * @returns {boolean} True if updated
   */
  update(id, updates) {
    this._ensureOpen();

    if (!id) throw new Error('Memory ID is required');
    if (!updates || Object.keys(updates).length === 0) {
      throw new Error('No updates provided');
    }

    // Build SET clause
    const allowedFields = [
      'content', 'summary', 'memory_type', 'intent', 'tags',
      'extraction_confidence', 'quality_score', 'strength',
      'decay_score', 'status', 'embedding',
      // Usage tracking fields
      'usage_count', 'usage_success_rate', 'last_accessed'
    ];

    const setClauses = [];
    const params = { id };

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key)) continue;

      if (key === 'tags') {
        setClauses.push(`tags = @${key}`);
        params[key] = Array.isArray(value) ? JSON.stringify(value) : value;
      } else if (key === 'embedding') {
        setClauses.push(`embedding = @${key}`);
        params[key] = this._toBlob(value);
      } else {
        setClauses.push(`${key} = @${key}`);
        params[key] = value;
      }
    }

    if (setClauses.length === 0) {
      return false;
    }

    // Always update timestamp and version
    setClauses.push("updated_at = datetime('now')");
    setClauses.push('version = version + 1');

    const sql = `UPDATE ${TABLE_NAME} SET ${setClauses.join(', ')} WHERE id = @id`;
    const result = this.store.run(sql, params);

    if (result.changes > 0) {
      this.stats.updates++;
      return true;
    }

    return false;
  }

  /**
   * Delete a memory (soft delete by default)
   *
   * @param {string} id - Memory ID
   * @param {boolean} [hard=false] - Hard delete if true
   * @returns {boolean} True if deleted
   */
  delete(id, hard = false) {
    this._ensureOpen();

    let result;

    if (hard) {
      const sql = `DELETE FROM ${TABLE_NAME} WHERE id = @id`;
      result = this.store.run(sql, { id });
    } else {
      const sql = `
        UPDATE ${TABLE_NAME}
        SET status = 'deleted', updated_at = datetime('now')
        WHERE id = @id
      `;
      result = this.store.run(sql, { id });
    }

    if (result.changes > 0) {
      this.stats.deletes++;
      return true;
    }

    return false;
  }

  /**
   * Check if a memory exists
   *
   * @param {string} id - Memory ID
   * @returns {boolean}
   */
  exists(id) {
    this._ensureOpen();

    const sql = `SELECT 1 FROM ${TABLE_NAME} WHERE id = @id`;
    return this.store.queryOne(sql, { id }) !== null;
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  /**
   * Query memories with filters
   *
   * @param {Object} [options={}]
   * @param {string} [options.status='active'] - Filter by status
   * @param {string} [options.source] - Filter by source
   * @param {string} [options.memoryType] - Filter by memory_type
   * @param {string} [options.projectHash] - Filter by project_hash
   * @param {string[]} [options.tags] - Filter by tags (any match)
   * @param {number} [options.limit=100] - Max results
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.orderBy='created_at'] - Sort field
   * @param {string} [options.order='DESC'] - Sort direction
   * @returns {Array<Object>}
   */
  query(options = {}) {
    this._ensureOpen();

    const conditions = [];
    const params = {};

    // Status filter
    conditions.push(`status = @status`);
    params.status = options.status || 'active';

    // Optional filters
    if (options.source) {
      conditions.push(`source = @source`);
      params.source = options.source;
    }

    if (options.memoryType) {
      conditions.push(`memory_type = @memoryType`);
      params.memoryType = options.memoryType;
    }

    if (options.projectHash) {
      conditions.push(`(project_hash = @projectHash OR project_hash IS NULL)`);
      params.projectHash = options.projectHash;
    }

    if (options.tags && Array.isArray(options.tags) && options.tags.length > 0) {
      // JSON array contains any of the tags
      const tagConditions = options.tags.map((tag, i) => {
        params[`tag${i}`] = `%"${tag}"%`;
        return `tags LIKE @tag${i}`;
      });
      conditions.push(`(${tagConditions.join(' OR ')})`);
    }

    // Build query
    const orderBy = ['created_at', 'updated_at', 'quality_score', 'strength']
      .includes(options.orderBy) ? options.orderBy : 'created_at';
    const order = options.order === 'ASC' ? 'ASC' : 'DESC';
    const limit = Math.min(options.limit || 100, 1000);
    const offset = options.offset || 0;

    const sql = `
      SELECT ${this._getColumnsWithoutEmbedding()}
      FROM ${TABLE_NAME}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy} ${order}
      LIMIT @limit OFFSET @offset
    `;

    params.limit = limit;
    params.offset = offset;

    const rows = this.store.query(sql, params);
    this.stats.reads += rows.length;

    return rows.map(row => this._parseMemory(row, false));
  }

  /**
   * Get memories missing embeddings
   *
   * @param {number} [limit=100] - Max results
   * @returns {Array<{id: string, content: string}>}
   */
  getMissingEmbeddings(limit = 100) {
    this._ensureOpen();

    const sql = `
      SELECT id, content
      FROM ${TABLE_NAME}
      WHERE embedding IS NULL AND status = 'active'
      LIMIT @limit
    `;

    return this.store.query(sql, { limit });
  }

  /**
   * Update embedding for a memory
   *
   * @param {string} id - Memory ID
   * @param {Float32Array|Buffer} embedding - Embedding vector
   * @returns {boolean}
   */
  setEmbedding(id, embedding) {
    this._ensureOpen();

    const blob = this._toBlob(embedding);

    const sql = `
      UPDATE ${TABLE_NAME}
      SET embedding = @embedding, updated_at = datetime('now')
      WHERE id = @id
    `;

    const result = this.store.run(sql, { id, embedding: blob });
    return result.changes > 0;
  }

  /**
   * Get embedding for a memory
   *
   * @param {string} id - Memory ID
   * @returns {Float32Array|null}
   */
  getEmbedding(id) {
    this._ensureOpen();

    const sql = `SELECT embedding FROM ${TABLE_NAME} WHERE id = @id`;
    const row = this.store.queryOne(sql, { id });

    if (!row || !row.embedding) return null;

    return Embedder.fromBuffer(row.embedding);
  }

  /**
   * Record a memory access (updates usage stats)
   *
   * @param {string} id - Memory ID
   * @param {boolean} [successful=true] - Whether the access was successful
   */
  recordAccess(id, successful = true) {
    this._ensureOpen();

    // Update usage count and success rate
    const sql = `
      UPDATE ${TABLE_NAME}
      SET
        usage_count = usage_count + 1,
        usage_success_rate = (usage_success_rate * usage_count + @success) / (usage_count + 1),
        last_accessed = datetime('now'),
        updated_at = datetime('now')
      WHERE id = @id
    `;

    this.store.run(sql, { id, success: successful ? 1.0 : 0.0 });
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get total memory count
   *
   * @param {string} [status='active'] - Filter by status
   * @returns {number}
   */
  getCount(status = 'active') {
    this._ensureOpen();

    return this.store.getRowCount(TABLE_NAME, 'status = ?', [status]);
  }

  /**
   * Get count by source
   *
   * @returns {Object<string, number>}
   */
  getCountBySource() {
    this._ensureOpen();

    const sql = `
      SELECT source, COUNT(*) as count
      FROM ${TABLE_NAME}
      WHERE status = 'active'
      GROUP BY source
    `;

    const rows = this.store.query(sql);
    return rows.reduce((acc, row) => {
      acc[row.source] = row.count;
      return acc;
    }, {});
  }

  /**
   * Get count by memory type
   *
   * @returns {Object<string, number>}
   */
  getCountByType() {
    this._ensureOpen();

    const sql = `
      SELECT memory_type, COUNT(*) as count
      FROM ${TABLE_NAME}
      WHERE status = 'active'
      GROUP BY memory_type
    `;

    const rows = this.store.query(sql);
    return rows.reduce((acc, row) => {
      acc[row.memory_type] = row.count;
      return acc;
    }, {});
  }

  /**
   * Get embedding coverage stats
   *
   * @returns {{total: number, withEmbedding: number, coverage: number}}
   */
  getEmbeddingCoverage() {
    this._ensureOpen();

    const sql = `
      SELECT
        COUNT(*) as total,
        COUNT(embedding) as with_embedding
      FROM ${TABLE_NAME}
      WHERE status = 'active'
    `;

    const row = this.store.queryOne(sql);

    return {
      total: row.total,
      withEmbedding: row.with_embedding,
      coverage: row.total > 0 ? row.with_embedding / row.total : 0,
    };
  }

  /**
   * Get store statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      dbStats: this.store.getStats(),
      memoryCount: this.isOpen() ? this.getCount() : 0,
    };
  }

  // ===========================================================================
  // MAINTENANCE
  // ===========================================================================

  /**
   * Vacuum the database (reclaim space)
   */
  vacuum() {
    this._ensureOpen();
    this.store.exec('VACUUM');
  }

  /**
   * Rebuild the FTS index
   */
  rebuildFtsIndex() {
    this._ensureOpen();
    this.store.exec(`INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}) VALUES('rebuild')`);
  }

  /**
   * Optimize the FTS index
   */
  optimizeFtsIndex() {
    this._ensureOpen();
    this.store.exec(`INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}) VALUES('optimize')`);
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Ensure database is open
   * @private
   */
  _ensureOpen() {
    if (!this.initialized || !this.store.isOpen()) {
      throw new Error('MemoryStore not initialized. Call initialize() first.');
    }
  }

  /**
   * Generate a unique memory ID
   * @private
   * @returns {string}
   */
  _generateId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `mem_${timestamp}_${random}`;
  }

  /**
   * Convert embedding to BLOB
   * @private
   * @param {Float32Array|Buffer|number[]} embedding
   * @returns {Buffer}
   */
  _toBlob(embedding) {
    if (Buffer.isBuffer(embedding)) {
      return embedding;
    }
    if (embedding instanceof Float32Array) {
      return Buffer.from(embedding.buffer);
    }
    if (Array.isArray(embedding)) {
      return Buffer.from(new Float32Array(embedding).buffer);
    }
    throw new Error('Invalid embedding format');
  }

  /**
   * Get column list without embedding (for efficiency)
   * @private
   * @returns {string}
   */
  _getColumnsWithoutEmbedding() {
    return `
      id, version, content, summary, memory_type, intent, tags,
      source, source_id, project_hash, session_id,
      extraction_confidence, quality_score, usage_count,
      usage_success_rate, last_accessed, strength, decay_score,
      created_at, updated_at, status
    `;
  }

  /**
   * Parse memory row from database
   * @private
   * @param {Object} row
   * @param {boolean} includeEmbedding
   * @returns {Object}
   */
  _parseMemory(row, includeEmbedding) {
    const memory = {
      ...row,
      tags: this._parseTags(row.tags),
    };

    if (includeEmbedding && row.embedding) {
      memory.embedding = Embedder.fromBuffer(row.embedding);
    } else {
      delete memory.embedding;
    }

    return memory;
  }

  /**
   * Parse tags JSON string
   * @private
   * @param {string} tags
   * @returns {string[]}
   */
  _parseTags(tags) {
    if (!tags) return [];
    try {
      return JSON.parse(tags);
    } catch {
      return [];
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  MemoryStore,
  TABLE_NAME,
  FTS_TABLE_NAME,
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_STATUSES,
  DEFAULT_DB_PATH,
};
