/**
 * Cortex - Claude's Cognitive Layer - Knowledge Graph Adapter
 *
 * Direct file access to the @modelcontextprotocol/server-memory knowledge graph.
 * Bypasses MCP-to-MCP limitation by reading the JSONL file directly.
 *
 * Storage format: JSONL with entity/relation objects
 *   Entity: {"type":"entity","name":"...","entityType":"...","observations":["..."]}
 *   Relation: {"type":"relation","from":"...","to":"...","relationType":"..."}
 *
 * Discovery strategy (in order):
 *   1. Explicit config.filePath
 *   2. MEMORY_FILE_PATH env var
 *   3. Auto-discover in npx cache (~/.npm/_npx/.../server-memory/dist/)
 *
 * @version 2.0.0
 * @see Design: ../docs/plans/2026-02-25-cortex-v3-full-transformation.md#task-e2
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { BaseAdapter } = require('./base-adapter.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

/** Common file names to search for */
const MEMORY_FILE_NAMES = ['memory.jsonl', 'memory.json'];

/** npm cache base for npx-invoked packages */
const NPX_CACHE_BASE = path.join(os.homedir(), '.npm', '_npx');

// =============================================================================
// KNOWLEDGE GRAPH ADAPTER — DIRECT FILE ACCESS
// =============================================================================

/**
 * Adapter for Knowledge Graph via direct JSONL file access
 * Priority: 0.8 - Structured cross-project knowledge
 *
 * v2.0: Bypasses MCP entirely — reads the JSONL file that
 * @modelcontextprotocol/server-memory stores its data in.
 */
class KnowledgeGraphAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} [config.filePath] - Explicit path to memory JSONL file
   * @param {number} [config.maxResults=50] - Maximum results per query
   * @param {Function} [config.mcpCaller] - Legacy MCP caller (unused in v2)
   */
  constructor(config = {}) {
    super({
      name: 'knowledge-graph',
      priority: 0.8,
      timeout: 2000,
      enabled: config.enabled !== false,
    });

    this.maxResults = config.maxResults || 50;
    this.mcpCaller = config.mcpCaller || null;  // Legacy compat
    this._explicitPath = config.filePath || null;

    // In-memory graph cache
    this._graph = null;
    this._graphLoadedAt = 0;
    this._graphTTL = 60 * 1000;  // Reload from disk every 60 seconds

    // File path (resolved lazily)
    this._resolvedPath = null;

    // Result cache with TTL
    this._cache = new Map();
    this._cacheTTL = 10 * 60 * 1000;  // 10 minutes
  }

  // ---------------------------------------------------------------------------
  // FILE DISCOVERY
  // ---------------------------------------------------------------------------

  /**
   * Resolve the path to the knowledge graph JSONL file
   * @private
   * @returns {string | null} File path, or null if not found
   */
  _resolveFilePath() {
    if (this._resolvedPath && fs.existsSync(this._resolvedPath)) {
      return this._resolvedPath;
    }

    // Strategy 1: Explicit config path (if set, don't fall through)
    if (this._explicitPath) {
      if (fs.existsSync(this._explicitPath)) {
        this._resolvedPath = this._explicitPath;
        return this._resolvedPath;
      }
      // Explicit path provided but doesn't exist — don't auto-discover
      return null;
    }

    // Strategy 2: MEMORY_FILE_PATH environment variable
    const envPath = process.env.MEMORY_FILE_PATH;
    if (envPath) {
      const resolved = path.isAbsolute(envPath) ? envPath : path.resolve(envPath);
      if (fs.existsSync(resolved)) {
        this._resolvedPath = resolved;
        return this._resolvedPath;
      }
    }

    // Strategy 3: Auto-discover in npx cache
    if (fs.existsSync(NPX_CACHE_BASE)) {
      try {
        const cacheEntries = fs.readdirSync(NPX_CACHE_BASE);
        for (const entry of cacheEntries) {
          const distDir = path.join(
            NPX_CACHE_BASE, entry,
            'node_modules', '@modelcontextprotocol', 'server-memory', 'dist'
          );
          for (const fileName of MEMORY_FILE_NAMES) {
            const candidate = path.join(distDir, fileName);
            if (fs.existsSync(candidate)) {
              this._resolvedPath = candidate;
              return this._resolvedPath;
            }
          }
        }
      } catch {
        // Permission error or similar — fall through
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // GRAPH LOADING
  // ---------------------------------------------------------------------------

  /**
   * Load the knowledge graph from JSONL file
   * @private
   * @returns {{entities: Object[], relations: Object[]}}
   */
  _loadGraph() {
    const now = Date.now();

    // Return cached if fresh
    if (this._graph && (now - this._graphLoadedAt) < this._graphTTL) {
      return this._graph;
    }

    const filePath = this._resolveFilePath();
    if (!filePath) {
      this._graph = { entities: [], relations: [] };
      this._graphLoadedAt = now;
      return this._graph;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entities = [];
      const relations = [];

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === 'entity') {
            entities.push({
              name: obj.name,
              entityType: obj.entityType,
              observations: obj.observations || [],
            });
          } else if (obj.type === 'relation') {
            relations.push({
              from: obj.from,
              to: obj.to,
              relationType: obj.relationType,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }

      this._graph = { entities, relations };
      this._graphLoadedAt = now;
      return this._graph;
    } catch (err) {
      console.error('[KnowledgeGraphAdapter] Failed to load graph:', err.message);
      this._graph = { entities: [], relations: [] };
      this._graphLoadedAt = now;
      return this._graph;
    }
  }

  // ---------------------------------------------------------------------------
  // CORE QUERY — DIRECT SEARCH
  // ---------------------------------------------------------------------------

  /**
   * Query knowledge graph for relevant entities
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const searchQuery = this._buildSearchQuery(context);

      // Check cache
      const cacheKey = this._getCacheKey(searchQuery, options);
      const cached = this._getFromCache(cacheKey);
      if (cached) {
        this._trackCacheAccess(true);
        return cached;
      }
      this._trackCacheAccess(false);

      // Load graph
      const graph = this._loadGraph();
      if (graph.entities.length === 0) {
        return [];
      }

      // Score each entity against query
      const scored = graph.entities
        .map(entity => ({
          entity,
          score: this._scoreEntity(entity, searchQuery),
        }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

      // Normalize to MemoryRecord
      const records = scored
        .map(s => this.normalize(s.entity, s.score))
        .filter(r => r !== null);

      // Apply additional filters
      const filtered = this._applyQueryOptions(records, options);

      // Limit results
      const limited = filtered.slice(0, options.limit || this.maxResults);

      // Cache results
      this._setCache(cacheKey, limited);

      return limited;
    });
  }

  /**
   * Score an entity against a search query
   * Uses keyword matching against name, type, and observations
   * @private
   * @param {Object} entity - Knowledge graph entity
   * @param {string} query - Search query string
   * @returns {number} Score 0.0-1.0
   */
  _scoreEntity(entity, query) {
    if (!query || query === 'recent') {
      // Return all entities with a base score
      return 0.3;
    }

    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);
    let score = 0;
    let maxScore = 0;

    // Name matching (highest weight)
    const nameLower = (entity.name || '').toLowerCase();
    for (const term of queryTerms) {
      maxScore += 0.4;
      if (nameLower.includes(term)) {
        score += 0.4;
      }
    }

    // Entity type matching
    const typeLower = (entity.entityType || '').toLowerCase();
    for (const term of queryTerms) {
      maxScore += 0.2;
      if (typeLower.includes(term)) {
        score += 0.2;
      }
    }

    // Observation matching (most content)
    const allObs = (entity.observations || []).join(' ').toLowerCase();
    for (const term of queryTerms) {
      maxScore += 0.4;
      if (allObs.includes(term)) {
        score += 0.4;
      }
    }

    // Normalize to 0-1
    return maxScore > 0 ? Math.min(1.0, score / maxScore) : 0;
  }

  // ---------------------------------------------------------------------------
  // QUERY BUILDING
  // ---------------------------------------------------------------------------

  /**
   * Build search query from analysis context
   * @private
   */
  _buildSearchQuery(context) {
    const parts = [];

    if (context.tags?.length) {
      parts.push(...context.tags.slice(0, 5));
    }

    if (context.intent && context.intentConfidence > 0.5) {
      parts.push(context.intent);
    }

    if (context.projectName) {
      parts.push(context.projectName);
    }

    return parts.join(' ') || 'recent';
  }

  // ---------------------------------------------------------------------------
  // AVAILABILITY
  // ---------------------------------------------------------------------------

  /**
   * Check if knowledge graph file is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const filePath = this._resolveFilePath();
      if (!filePath) return false;
      const graph = this._loadGraph();
      return graph.entities.length > 0;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // ENTITY ACCESS
  // ---------------------------------------------------------------------------

  /**
   * Get specific entities by name
   * @param {string[]} names - Entity names to retrieve
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async getByNames(names) {
    if (!names?.length) return [];

    const graph = this._loadGraph();
    const nameSet = new Set(names.map(n => n.toLowerCase()));

    return graph.entities
      .filter(e => nameSet.has(e.name.toLowerCase()))
      .map(e => this.normalize(e, 0.9))
      .filter(r => r !== null);
  }

  /**
   * Read entire knowledge graph
   * @returns {Promise<{entities: Object[], relations: Object[]}>}
   */
  async readFullGraph() {
    return this._loadGraph();
  }

  /**
   * Get relations for an entity
   * @param {string} entityName
   * @returns {Object[]} Relations involving this entity
   */
  getRelationsFor(entityName) {
    const graph = this._loadGraph();
    const nameLower = entityName.toLowerCase();
    return graph.relations.filter(
      r => r.from.toLowerCase() === nameLower || r.to.toLowerCase() === nameLower
    );
  }

  // ---------------------------------------------------------------------------
  // NORMALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Normalize knowledge graph entity to MemoryRecord format
   * @param {Object} entity - Raw entity
   * @param {number} [score=0.5] - Match score
   * @returns {import('./base-adapter.cjs').MemoryRecord | null}
   */
  normalize(entity, score = 0.5) {
    if (!entity) return null;

    const observations = entity.observations || [];
    const content = observations.join('\n');
    const summary = observations[0]?.slice(0, 100) || entity.name;
    const type = this._mapEntityType(entity.entityType);
    const tags = this._extractTags(entity);

    return this._createBaseRecord({
      id: `kg:${entity.name}`,
      version: 2,
      type,
      content,
      summary,
      projectHash: null,  // Knowledge graph is cross-project
      tags,
      intent: 'general',
      sourceSessionId: 'knowledge-graph',
      sourceTimestamp: new Date().toISOString(),
      extractionConfidence: score,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: 1.0,  // Graph entries don't decay
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _source: 'knowledge-graph',
      _sourcePriority: this.priority,
      _entityName: entity.name,
      _entityType: entity.entityType,
    });
  }

  // ---------------------------------------------------------------------------
  // WRITE OPERATIONS — DIRECT FILE ACCESS
  // ---------------------------------------------------------------------------

  supportsWrite() {
    return true;
  }

  /**
   * Write a new entity to the knowledge graph
   * @param {import('./base-adapter.cjs').MemoryRecord} record
   * @param {import('./base-adapter.cjs').WriteOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async write(record, options = {}) {
    return this._executeWrite(async () => {
      const entity = {
        type: 'entity',
        name: record.id?.replace(/^kg:/, '') || record.summary?.slice(0, 50) || 'unnamed',
        entityType: this._mapMemoryTypeToEntityType(record.type),
        observations: record.content ? [record.content] : [],
      };

      if (record.tags?.length) {
        entity.observations.push(`Tags: ${record.tags.join(', ')}`);
      }

      return this._appendToFile(entity);
    });
  }

  /**
   * Update an existing entity by adding observations
   * @param {string} id
   * @param {Partial<import('./base-adapter.cjs').MemoryRecord>} updates
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async update(id, updates, options = {}) {
    return this._executeWrite(async () => {
      // For JSONL format, we need to rewrite the entire file
      // to update an entity's observations in place
      const entityName = id.replace(/^kg:/, '');
      const graph = this._loadGraph();

      const entity = graph.entities.find(
        e => e.name.toLowerCase() === entityName.toLowerCase()
      );

      if (!entity) {
        return { success: false, error: `Entity not found: ${entityName}` };
      }

      // Add new observations
      if (updates.content) {
        entity.observations.push(updates.content);
      }
      if (updates.summary) {
        entity.observations.push(`Summary: ${updates.summary}`);
      }
      if (updates.tags?.length) {
        entity.observations.push(`Tags: ${updates.tags.join(', ')}`);
      }

      // Rewrite entire file with updated entity
      return this._rewriteGraph(graph);
    });
  }

  /**
   * Delete an entity from the knowledge graph
   * @param {string} id
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async delete(id, options = {}) {
    return this._executeWrite(async () => {
      const entityName = id.replace(/^kg:/, '');
      const graph = this._loadGraph();

      const beforeCount = graph.entities.length;
      graph.entities = graph.entities.filter(
        e => e.name.toLowerCase() !== entityName.toLowerCase()
      );
      // Also remove relations involving this entity
      graph.relations = graph.relations.filter(
        r => r.from.toLowerCase() !== entityName.toLowerCase() &&
             r.to.toLowerCase() !== entityName.toLowerCase()
      );

      if (graph.entities.length === beforeCount) {
        return { success: false, error: `Entity not found: ${entityName}` };
      }

      return this._rewriteGraph(graph);
    });
  }

  /**
   * Create multiple entities
   * @param {Array<{name: string, entityType: string, observations: string[]}>} entities
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async createEntities(entities) {
    try {
      for (const entity of entities) {
        await this._appendToFile({
          type: 'entity',
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations || [],
        });
      }

      this._invalidateGraph();
      this.clearCache();
      return { success: true, affectedCount: entities.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Create relations between entities
   * @param {Array<{from: string, to: string, relationType: string}>} relations
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async createRelations(relations) {
    try {
      for (const rel of relations) {
        await this._appendToFile({
          type: 'relation',
          from: rel.from,
          to: rel.to,
          relationType: rel.relationType,
        });
      }

      this._invalidateGraph();
      this.clearCache();
      return { success: true, affectedCount: relations.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Add observations to an existing entity
   * @param {string} entityName
   * @param {string[]} contents - Observations to add
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async addObservations(entityName, contents) {
    return this.update(`kg:${entityName}`, { content: contents.join('\n') });
  }

  /**
   * Delete entities
   * @param {string[]} entityNames
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async deleteEntities(entityNames) {
    const graph = this._loadGraph();

    const nameSet = new Set(entityNames.map(n => n.toLowerCase()));
    const before = graph.entities.length;
    graph.entities = graph.entities.filter(e => !nameSet.has(e.name.toLowerCase()));
    graph.relations = graph.relations.filter(
      r => !nameSet.has(r.from.toLowerCase()) && !nameSet.has(r.to.toLowerCase())
    );

    if (graph.entities.length === before) {
      return { success: false, error: 'No matching entities found' };
    }

    return this._rewriteGraph(graph);
  }

  /**
   * Delete relations
   * @param {Array<{from: string, to: string, relationType: string}>} relations
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async deleteRelations(relations) {
    const graph = this._loadGraph();
    const before = graph.relations.length;

    for (const rel of relations) {
      graph.relations = graph.relations.filter(
        r => !(r.from === rel.from && r.to === rel.to && r.relationType === rel.relationType)
      );
    }

    if (graph.relations.length === before) {
      return { success: false, error: 'No matching relations found' };
    }

    return this._rewriteGraph(graph);
  }

  /**
   * Delete specific observations from an entity
   * @param {string} entityName
   * @param {string[]} observations - Exact observation strings to remove
   * @returns {Promise<import('./base-adapter.cjs').WriteResult>}
   */
  async deleteObservations(entityName, observations) {
    const graph = this._loadGraph();
    const entity = graph.entities.find(
      e => e.name.toLowerCase() === entityName.toLowerCase()
    );

    if (!entity) {
      return { success: false, error: `Entity not found: ${entityName}` };
    }

    const obsSet = new Set(observations);
    const before = entity.observations.length;
    entity.observations = entity.observations.filter(o => !obsSet.has(o));

    if (entity.observations.length === before) {
      return { success: false, error: 'No matching observations found' };
    }

    return this._rewriteGraph(graph);
  }

  // ---------------------------------------------------------------------------
  // FILE OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Append a line to the JSONL file
   * @private
   */
  async _appendToFile(obj) {
    const filePath = this._resolveFilePath();
    if (!filePath) {
      return { success: false, error: 'Knowledge graph file not found' };
    }

    fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
    this._invalidateGraph();
    this.clearCache();
    return { success: true, affectedCount: 1 };
  }

  /**
   * Rewrite the entire JSONL file from the in-memory graph
   * @private
   */
  _rewriteGraph(graph) {
    const filePath = this._resolveFilePath();
    if (!filePath) {
      return { success: false, error: 'Knowledge graph file not found' };
    }

    const lines = [];

    for (const entity of graph.entities) {
      lines.push(JSON.stringify({
        type: 'entity',
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
      }));
    }

    for (const rel of graph.relations) {
      lines.push(JSON.stringify({
        type: 'relation',
        from: rel.from,
        to: rel.to,
        relationType: rel.relationType,
      }));
    }

    fs.writeFileSync(filePath, lines.join('\n') + '\n');
    this._invalidateGraph();
    this.clearCache();
    return { success: true, affectedCount: lines.length };
  }

  /**
   * Invalidate cached graph data
   * @private
   */
  _invalidateGraph() {
    this._graph = null;
    this._graphLoadedAt = 0;
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Map entity type to memory type
   * @private
   */
  _mapEntityType(entityType) {
    if (!entityType) return 'learning';
    const lower = entityType.toLowerCase();
    const mapping = {
      'pattern': 'pattern',
      'solution': 'learning',
      'preference': 'preference',
      'skill': 'skill',
      'correction': 'correction',
      'warning': 'correction',
      'learning': 'learning',
      'bug': 'learning',
      'fix': 'learning',
      'technique': 'skill',
      'workflow': 'pattern',
      'config': 'preference',
      'setting': 'preference',
      'project': 'learning',
      'feature': 'skill',
      'testing': 'learning',
      'reference': 'learning',
      'session': 'learning',
      'insight': 'learning',
      'todo': 'learning',
    };
    return mapping[lower] || 'learning';
  }

  /**
   * Map memory type to entity type string
   * @private
   */
  _mapMemoryTypeToEntityType(type) {
    const mapping = {
      'learning': 'Learning',
      'pattern': 'Pattern',
      'skill': 'Skill',
      'correction': 'Correction',
      'preference': 'Preference',
    };
    return mapping[type] || 'Learning';
  }

  /**
   * Extract tags from entity
   * @private
   */
  _extractTags(entity) {
    const tags = new Set();

    if (entity.entityType) {
      tags.add(entity.entityType.toLowerCase());
    }

    const nameWords = (entity.name || '')
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter(w => w.length > 2);

    for (const word of nameWords.slice(0, 3)) {
      tags.add(word);
    }

    const allText = (entity.observations || []).join(' ').toLowerCase();
    const techKeywords = [
      'javascript', 'typescript', 'python', 'node', 'react',
      'git', 'docker', 'linux', 'bash', 'claude', 'mcp',
    ];

    for (const tech of techKeywords) {
      if (allText.includes(tech)) {
        tags.add(tech);
      }
    }

    return Array.from(tags).slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // CACHE MANAGEMENT
  // ---------------------------------------------------------------------------

  /** @private */
  _getCacheKey(query, options) {
    return `${query}:${JSON.stringify(options)}`;
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

    if (this._cache.size > 50) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }
  }

  clearCache() {
    this._cache.clear();
  }

  // ---------------------------------------------------------------------------
  // LEGACY COMPAT
  // ---------------------------------------------------------------------------

  /**
   * Set MCP caller (legacy, kept for backward compatibility)
   * @param {Function} mcpCaller
   */
  setMcpCaller(mcpCaller) {
    if (typeof mcpCaller !== 'function') {
      throw new Error('mcpCaller must be a function');
    }
    this.mcpCaller = mcpCaller;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  KnowledgeGraphAdapter,
};
