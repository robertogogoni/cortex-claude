/**
 * Cortex - Claude's Cognitive Layer - Warp SQLite Adapter
 *
 * Reads Warp Terminal AI history (1,708+ queries, 49+ agent conversations)
 * and normalizes to MemoryRecord format.
 *
 * Data Sources:
 * - ~/.local/state/warp-terminal/warp.sqlite (primary)
 * - ~/.local/state/warp-terminal-preview/warp.sqlite (preview builds)
 *
 * @version 1.0.0
 * @see Design: ../docs/design/memory-orchestrator.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { BaseAdapter } = require('./base-adapter.cjs');
const { SQLiteStore } = require('../core/sqlite-store.cjs');
const { expandPath } = require('../core/types.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default paths where Warp stores SQLite databases
 */
const DEFAULT_DATABASE_PATHS = [
  '~/.local/state/warp-terminal/warp.sqlite',
  '~/.local/state/warp-terminal-preview/warp.sqlite',
];

/**
 * Technology keywords for tag extraction
 */
const TECH_KEYWORDS = [
  'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'ruby',
  'node', 'nodejs', 'react', 'vue', 'angular', 'svelte',
  'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure',
  'git', 'github', 'gitlab', 'bitbucket',
  'linux', 'bash', 'zsh', 'shell', 'terminal',
  'sql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis',
  'api', 'rest', 'graphql', 'grpc',
  'test', 'jest', 'pytest', 'unittest',
  'claude', 'mcp', 'anthropic', 'openai', 'gpt',
  'npm', 'yarn', 'pnpm', 'pip', 'cargo',
];

// =============================================================================
// WARP SQLITE ADAPTER
// =============================================================================

/**
 * Adapter for reading Warp Terminal AI history
 * Priority: 0.75 - Local SQLite, rich historical data
 */
class WarpSQLiteAdapter extends BaseAdapter {
  /**
   * @param {Object} [config={}]
   * @param {string[]} [config.databasePaths] - Paths to Warp SQLite databases
   * @param {boolean} [config.enabled=true] - Whether adapter is enabled
   */
  constructor(config = {}) {
    super({
      name: 'warp-sqlite',
      priority: 0.75,
      timeout: 500,
      enabled: config.enabled !== false,
    });

    // Set database paths (expand ~ to home directory)
    this.databasePaths = (config.databasePaths || DEFAULT_DATABASE_PATHS)
      .map(p => expandPath(p));

    // Cache of SQLiteStore instances by path
    this._stores = new Map();
  }

  // ===========================================================================
  // REQUIRED ABSTRACT METHODS
  // ===========================================================================

  /**
   * Query Warp databases for relevant memories
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const allRecords = [];

      for (const dbPath of this.databasePaths) {
        try {
          const records = await this._queryDatabase(dbPath, context, options);
          allRecords.push(...records);
        } catch (error) {
          // Log but continue with other databases
          console.warn(`[WarpSQLiteAdapter] Failed to query ${dbPath}: ${error.message}`);
        }
      }

      // Apply common filters from base class
      const filtered = this._applyQueryOptions(allRecords, options);

      // Sort by timestamp (most recent first)
      return filtered.sort((a, b) => {
        const tsA = new Date(a.sourceTimestamp).getTime();
        const tsB = new Date(b.sourceTimestamp).getTime();
        return tsB - tsA;
      });
    });
  }

  /**
   * Check if any Warp database is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    for (const dbPath of this.databasePaths) {
      if (fs.existsSync(dbPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Normalize Warp database row to MemoryRecord format
   * @param {Object} raw - Raw row from database
   * @returns {import('./base-adapter.cjs').MemoryRecord | null}
   */
  normalize(raw) {
    if (!raw) return null;

    const isQuery = raw._type === 'query';
    const isAgent = raw._type === 'agent';

    // Extract content based on record type
    let content = '';
    let queryText = '';
    let contextText = '';

    if (isQuery) {
      const parsed = this._safeParseJSON(raw.input);
      content = this._extractQueryContent(parsed, raw.input);
    } else if (isAgent) {
      const parsed = this._safeParseJSON(raw.conversation_data);
      if (parsed && Array.isArray(parsed.messages)) {
        content = parsed.messages
          .map(m => `${m.role}: ${m.content}`)
          .join('\n\n');
      } else if (parsed && typeof parsed === 'string') {
        content = parsed;
      } else {
        content = raw.conversation_data || '';
      }
    }

    // Determine timestamp
    const timestamp = isQuery ? raw.start_ts : raw.last_modified_at;

    // Extract project hash from working directory
    const projectHash = raw.working_directory || null;

    // Extract tags from content
    const tags = this._extractTags(content);

    // Infer memory type
    const type = this._inferType(content);

    // Infer intent
    const intent = this._inferIntent(content);

    // Calculate confidence based on output status (queries) or content quality
    let confidence = 0.6;
    if (isQuery && raw.output_status === 'success') {
      confidence = 0.75;
    } else if (isQuery && raw.output_status === 'error') {
      confidence = 0.5;
    } else if (isAgent) {
      // Agent conversations tend to be more complete
      confidence = 0.7;
    }

    // Generate unique ID
    const sourceId = isQuery ? `query:${raw.exchange_id || raw.id}` : `agent:${raw.conversation_id || raw.id}`;
    const dbName = path.basename(raw._database || 'unknown');

    return this._createBaseRecord({
      id: `warp:${dbName}:${sourceId}`,
      version: 1,
      type,
      content,
      summary: content.slice(0, 100).replace(/\n/g, ' '),
      projectHash,
      tags,
      intent,
      sourceSessionId: raw.conversation_id || raw.exchange_id || 'unknown',
      sourceTimestamp: timestamp || new Date().toISOString(),
      extractionConfidence: confidence,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: this._calculateDecay(timestamp),
      status: 'active',
      createdAt: timestamp || new Date().toISOString(),
      updatedAt: timestamp || new Date().toISOString(),
      _source: 'warp-sqlite',
      _sourcePriority: this.priority,
      _rawType: raw._type,
      _database: raw._database,
      _model: raw.model_id || null,
    });
  }

  // ===========================================================================
  // WRITE OPERATIONS (NOT SUPPORTED)
  // ===========================================================================

  /**
   * Warp adapter is read-only
   * @returns {boolean}
   */
  supportsWrite() {
    return false;
  }

  /**
   * Write not supported
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async write(record, options) {
    return { success: false, error: 'WarpSQLiteAdapter is read-only' };
  }

  /**
   * Update not supported
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async update(id, updates, options) {
    return { success: false, error: 'WarpSQLiteAdapter is read-only' };
  }

  /**
   * Delete not supported
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async delete(id, options) {
    return { success: false, error: 'WarpSQLiteAdapter is read-only' };
  }

  // ===========================================================================
  // WARP-SPECIFIC METHODS
  // ===========================================================================

  /**
   * Get total counts of records across all databases
   * @returns {Promise<{queries: number, agents: number, total: number, byDatabase: Object}>}
   */
  async getTotalCounts() {
    const result = {
      queries: 0,
      agents: 0,
      total: 0,
      byDatabase: {},
    };

    for (const dbPath of this.databasePaths) {
      if (!fs.existsSync(dbPath)) {
        continue;
      }

      try {
        const store = this._getStore(dbPath);
        store.open();

        const queryCount = store.tableExists('ai_queries')
          ? store.getRowCount('ai_queries')
          : 0;

        const agentCount = store.tableExists('ai_agent_conversations')
          ? store.getRowCount('ai_agent_conversations')
          : 0;

        result.queries += queryCount;
        result.agents += agentCount;
        result.total += queryCount + agentCount;

        result.byDatabase[dbPath] = {
          queries: queryCount,
          agents: agentCount,
          total: queryCount + agentCount,
        };

        store.close();
      } catch (error) {
        console.warn(`[WarpSQLiteAdapter] Failed to count ${dbPath}: ${error.message}`);
      }
    }

    return result;
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Get or create SQLiteStore for a database path
   * @private
   * @param {string} dbPath
   * @returns {SQLiteStore}
   */
  _getStore(dbPath) {
    if (!this._stores.has(dbPath)) {
      this._stores.set(dbPath, new SQLiteStore(dbPath, { readonly: true }));
    }
    return this._stores.get(dbPath);
  }

  /**
   * Query a single Warp database
   * @private
   * @param {string} dbPath
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} options
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async _queryDatabase(dbPath, context, options) {
    if (!fs.existsSync(dbPath)) {
      return [];
    }

    const store = this._getStore(dbPath);
    store.open();

    try {
      const records = [];

      // Query ai_queries table
      if (store.tableExists('ai_queries')) {
        const queries = this._queryQueriesTable(store, dbPath, options);
        records.push(...queries);
      }

      // Query ai_agent_conversations table
      if (store.tableExists('ai_agent_conversations')) {
        const agents = this._queryAgentsTable(store, dbPath, options);
        records.push(...agents);
      }

      return records;
    } finally {
      store.close();
    }
  }

  /**
   * Query ai_queries table
   * @private
   * @param {SQLiteStore} store
   * @param {string} dbPath
   * @param {import('./base-adapter.cjs').QueryOptions} options
   * @returns {import('./base-adapter.cjs').MemoryRecord[]}
   */
  _queryQueriesTable(store, dbPath, options) {
    let sql = 'SELECT * FROM ai_queries';
    const params = [];

    // Add working_directory filter if projectHash provided
    if (options.projectHash) {
      sql += ' WHERE working_directory = ?';
      params.push(options.projectHash);
    }

    sql += ' ORDER BY start_ts DESC';

    const rows = params.length > 0 ? store.query(sql, params) : store.query(sql);

    return rows
      .map(row => this.normalize({
        ...row,
        _type: 'query',
        _database: dbPath,
      }))
      .filter(r => r !== null);
  }

  /**
   * Query ai_agent_conversations table
   * @private
   * @param {SQLiteStore} store
   * @param {string} dbPath
   * @param {import('./base-adapter.cjs').QueryOptions} options
   * @returns {import('./base-adapter.cjs').MemoryRecord[]}
   */
  _queryAgentsTable(store, dbPath, options) {
    const sql = 'SELECT * FROM ai_agent_conversations ORDER BY last_modified_at DESC';
    const rows = store.query(sql);

    return rows
      .map(row => this.normalize({
        ...row,
        _type: 'agent',
        _database: dbPath,
      }))
      .filter(r => r !== null);
  }

  /**
   * Safely parse JSON, returning null on failure
   * @private
   * @param {string} str
   * @returns {Object|null}
   */
  _safeParseJSON(str) {
    if (!str || typeof str !== 'string') return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * Extract content from Warp query input field.
   * Warp stores input as JSON array of events: Query, ActionResult, etc.
   * @private
   * @param {Object|Array|null} parsed - Parsed JSON from input field
   * @param {string} fallback - Raw input string for fallback
   * @returns {string}
   */
  _extractQueryContent(parsed, fallback) {
    if (!parsed) {
      return fallback || '';
    }

    // Handle array format (Warp's actual format)
    if (Array.isArray(parsed)) {
      const parts = [];

      for (const item of parsed) {
        // Query event contains user's question
        if (item.Query && item.Query.text) {
          parts.push(`User: ${item.Query.text}`);
        }

        // ActionResult contains command outputs and AI responses
        if (item.ActionResult) {
          const result = item.ActionResult.result;
          if (result) {
            // RequestCommandOutput has shell command results
            if (result.RequestCommandOutput?.result?.Success) {
              const { command, output } = result.RequestCommandOutput.result.Success;
              parts.push(`Command: ${command}\nOutput: ${output}`);
            }
            // Direct text content
            if (result.text) {
              parts.push(`Response: ${result.text}`);
            }
            // Message content
            if (result.message) {
              parts.push(`Message: ${result.message}`);
            }
          }
        }

        // AssistantMessage (if present)
        if (item.AssistantMessage) {
          parts.push(`Assistant: ${item.AssistantMessage.text || item.AssistantMessage}`);
        }
      }

      if (parts.length > 0) {
        return parts.join('\n\n');
      }
    }

    // Handle object format (legacy or simple format)
    if (typeof parsed === 'object') {
      if (parsed.query) {
        return parsed.query;
      }
      if (parsed.text) {
        return parsed.text;
      }
      if (parsed.Query?.text) {
        return parsed.Query.text;
      }
    }

    // Fallback to raw input
    return fallback || '';
  }

  /**
   * Extract technology tags from content
   * @private
   * @param {string} content
   * @returns {string[]}
   */
  _extractTags(content) {
    if (!content) return [];

    const lower = content.toLowerCase();
    const tags = [];

    for (const keyword of TECH_KEYWORDS) {
      // Use word boundary check to avoid partial matches
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(lower)) {
        tags.push(keyword);
      }
    }

    // Limit to top 10 tags
    return tags.slice(0, 10);
  }

  /**
   * Infer memory type from content
   * @private
   * @param {string} content
   * @returns {import('./base-adapter.cjs').MemoryType}
   */
  _inferType(content) {
    if (!content) return 'learning';

    const lower = content.toLowerCase();

    // Correction indicators
    if (lower.includes('error') || lower.includes('fix') || lower.includes('bug') ||
        lower.includes('wrong') || lower.includes('mistake')) {
      return 'learning';
    }

    // Pattern indicators
    if (lower.includes('pattern') || lower.includes('best practice') ||
        lower.includes('convention') || lower.includes('standard')) {
      return 'pattern';
    }

    // Skill indicators
    if (lower.includes('how to') || lower.includes('how do i') ||
        lower.includes('tutorial') || lower.includes('guide')) {
      return 'skill';
    }

    // Preference indicators
    if (lower.includes('prefer') || lower.includes('should i') ||
        lower.includes('recommend') || lower.includes('better')) {
      return 'preference';
    }

    // Default to learning
    return 'learning';
  }

  /**
   * Infer intent from content
   * @private
   * @param {string} content
   * @returns {string}
   */
  _inferIntent(content) {
    if (!content) return 'general';

    const lower = content.toLowerCase();

    if (lower.includes('debug') || lower.includes('error') || lower.includes('fix')) {
      return 'debugging';
    }
    if (lower.includes('test') || lower.includes('spec') || lower.includes('assertion')) {
      return 'testing';
    }
    if (lower.includes('deploy') || lower.includes('docker') || lower.includes('kubernetes')) {
      return 'deployment';
    }
    if (lower.includes('performance') || lower.includes('optimize') || lower.includes('faster')) {
      return 'optimization';
    }
    if (lower.includes('refactor') || lower.includes('clean') || lower.includes('improve')) {
      return 'refactoring';
    }
    if (lower.includes('learn') || lower.includes('understand') || lower.includes('explain')) {
      return 'learning';
    }
    if (lower.includes('implement') || lower.includes('create') || lower.includes('build')) {
      return 'implementation';
    }
    if (lower.includes('config') || lower.includes('setup') || lower.includes('install')) {
      return 'configuration';
    }

    return 'general';
  }

  /**
   * Calculate decay score based on timestamp
   * @private
   * @param {string} [timestamp]
   * @returns {number} 0.0-1.0
   */
  _calculateDecay(timestamp) {
    if (!timestamp) return 0.5;

    const ts = new Date(timestamp).getTime();
    if (isNaN(ts)) return 0.5;

    const age = Date.now() - ts;

    // Exponential decay over 30 days
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const decay = Math.exp(-age / thirtyDays);

    return Math.max(0.1, Math.min(1.0, decay));
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  WarpSQLiteAdapter,
  DEFAULT_DATABASE_PATHS,
  TECH_KEYWORDS,
};
