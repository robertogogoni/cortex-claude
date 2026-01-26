/**
 * Cortex - Claude's Cognitive Layer - Knowledge Graph Adapter
 *
 * Queries the Memory MCP server (knowledge graph) for entities and relations.
 * This adapter provides access to structured knowledge stored in the graph,
 * including patterns, solutions, preferences, and skills as named entities.
 *
 * MCP Tools:
 * - mcp__memory__search_nodes: Search for entities by query
 * - mcp__memory__read_graph: Read entire knowledge graph
 * - mcp__memory__open_nodes: Get specific nodes by name
 *
 * @version 1.1.0
 * @see Design: ~/.claude/dev/skill-activator/docs/plans/2026-01-26-claude-memory-orchestrator-design.md#section-2.3.3
 */

'use strict';

const { BaseAdapter } = require('./base-adapter.cjs');

// =============================================================================
// KNOWLEDGE GRAPH ADAPTER
// =============================================================================

/**
 * Adapter for Memory MCP server (knowledge graph)
 * Priority: 0.8 - Structured cross-project knowledge
 */
class KnowledgeGraphAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {number} [config.maxResults=50] - Maximum results per query
   * @param {Function} [config.mcpCaller] - Function to call MCP tools (for testing)
   */
  constructor(config = {}) {
    super({
      name: 'knowledge-graph',
      priority: 0.8,  // Good priority - structured knowledge
      timeout: 2000,  // Network call
      enabled: config.enabled !== false,
    });

    this.maxResults = config.maxResults || 50;
    this.mcpCaller = config.mcpCaller || null;

    // Result cache with TTL
    this._cache = new Map();
    this._cacheTTL = 10 * 60 * 1000;  // 10 minutes (graph changes less often)
  }

  /**
   * Query knowledge graph for relevant entities
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      // Build search query from context
      const searchQuery = this._buildSearchQuery(context);

      // Check cache
      const cacheKey = this._getCacheKey(searchQuery, options);
      const cached = this._getFromCache(cacheKey);
      if (cached) {
        this._trackCacheAccess(true);
        return cached;
      }
      this._trackCacheAccess(false);

      // Call MCP tool
      const response = await this._callMCP('mcp__memory__search_nodes', {
        query: searchQuery,
      });

      if (!response || !response.entities) {
        return [];
      }

      // Transform entities to MemoryRecord format
      const records = response.entities
        .map(e => this.normalize(e))
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
   * Build search query from analysis context
   * @private
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @returns {string}
   */
  _buildSearchQuery(context) {
    const parts = [];

    // Add tags (most relevant for graph search)
    if (context.tags?.length) {
      parts.push(...context.tags.slice(0, 5));
    }

    // Add intent
    if (context.intent && context.intentConfidence > 0.5) {
      parts.push(context.intent);
    }

    // Add project name
    if (context.projectName) {
      parts.push(context.projectName);
    }

    // Combine into search string
    return parts.join(' ') || 'recent';
  }

  /**
   * Call an MCP tool
   * @private
   * @param {string} toolName
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async _callMCP(toolName, params) {
    // If a custom MCP caller is provided (for testing), use it
    if (this.mcpCaller) {
      return this.mcpCaller(toolName, params);
    }

    // In production, this adapter is called FROM Claude Code which has MCP access
    throw new Error(
      'KnowledgeGraphAdapter requires mcpCaller to be set. ' +
      'The QueryOrchestrator should provide this during initialization.'
    );
  }

  /**
   * Check if Knowledge Graph MCP is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      // Try a minimal query to check availability
      const response = await this._callMCP('mcp__memory__search_nodes', {
        query: 'test',
      });
      return response !== null && response !== undefined;
    } catch (error) {
      console.error('[KnowledgeGraphAdapter] Availability check failed:', error.message);
      return false;
    }
  }

  /**
   * Get specific entities by name
   * @param {string[]} names - Entity names to retrieve
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async getByNames(names) {
    if (!names?.length) return [];

    try {
      const response = await this._callMCP('mcp__memory__open_nodes', {
        names,
      });

      if (!response || !response.entities) {
        return [];
      }

      return response.entities
        .map(e => this.normalize(e))
        .filter(r => r !== null);
    } catch (error) {
      console.error('[KnowledgeGraphAdapter] getByNames failed:', error.message);
      return [];
    }
  }

  /**
   * Read entire knowledge graph (use sparingly - can be large)
   * @returns {Promise<{entities: Object[], relations: Object[]}>}
   */
  async readFullGraph() {
    try {
      const response = await this._callMCP('mcp__memory__read_graph', {});
      return {
        entities: response?.entities || [],
        relations: response?.relations || [],
      };
    } catch (error) {
      console.error('[KnowledgeGraphAdapter] readFullGraph failed:', error.message);
      return { entities: [], relations: [] };
    }
  }

  /**
   * Normalize knowledge graph entity to MemoryRecord format
   * @param {Object} entity - Raw entity from knowledge graph
   * @returns {import('./base-adapter.cjs').MemoryRecord | null}
   */
  normalize(entity) {
    if (!entity) return null;

    // Combine observations into content
    const observations = entity.observations || [];
    const content = observations.join('\n');
    const summary = observations[0]?.slice(0, 100) || entity.name;

    // Map entity type to memory type
    const type = this._mapEntityType(entity.entityType);

    // Extract tags from entity type and observations
    const tags = this._extractTags(entity);

    return this._createBaseRecord({
      id: `kg:${entity.name}`,
      version: 1,
      type,
      content,
      summary,
      projectHash: null,  // Knowledge graph is cross-project
      tags,
      intent: 'general',
      sourceSessionId: 'knowledge-graph',
      sourceTimestamp: new Date().toISOString(),
      extractionConfidence: 0.8,  // Graph entries are curated
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: 1.0,  // Graph entries don't decay
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _source: 'knowledge-graph',
      _sourcePriority: this.priority,
      _entityName: entity.name,  // Preserve for updates
      _entityType: entity.entityType,
    });
  }

  /**
   * Map knowledge graph entity type to memory type
   * @private
   * @param {string} [entityType]
   * @returns {import('./base-adapter.cjs').MemoryType}
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
    };

    return mapping[lower] || 'learning';
  }

  /**
   * Extract tags from entity
   * @private
   * @param {Object} entity
   * @returns {string[]}
   */
  _extractTags(entity) {
    const tags = new Set();

    // Add entity type as tag
    if (entity.entityType) {
      tags.add(entity.entityType.toLowerCase());
    }

    // Extract keywords from name
    const nameWords = (entity.name || '')
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter(w => w.length > 2);

    for (const word of nameWords.slice(0, 3)) {
      tags.add(word);
    }

    // Extract keywords from observations
    const allText = (entity.observations || []).join(' ').toLowerCase();

    // Technology keywords
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

  /**
   * Generate cache key
   * @private
   */
  _getCacheKey(query, options) {
    return `${query}:${JSON.stringify(options)}`;
  }

  /**
   * Get from cache if valid
   * @private
   */
  _getFromCache(key) {
    const cached = this._cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this._cacheTTL) {
      this._cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cache entry
   * @private
   */
  _setCache(key, data) {
    this._cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // Clean old entries if cache is too large
    if (this._cache.size > 50) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this._cache.clear();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  KnowledgeGraphAdapter,
};
