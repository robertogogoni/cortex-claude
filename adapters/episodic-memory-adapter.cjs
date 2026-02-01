/**
 * Cortex - Claude's Cognitive Layer - Episodic Memory Adapter
 *
 * Queries the Episodic Memory MCP server for cross-session learnings.
 * This adapter provides access to 233+ archived conversations with
 * semantic (vector) and text search capabilities.
 *
 * MCP Tool: mcp__plugin_episodic-memory_episodic-memory__search
 *
 * @version 1.1.0
 * @see Design: ../docs/design/memory-orchestrator.md#section-2.3.2
 */

'use strict';

const { BaseAdapter } = require('./base-adapter.cjs');

// =============================================================================
// EPISODIC MEMORY ADAPTER
// =============================================================================

/**
 * Adapter for Episodic Memory MCP server
 * Priority: 0.9 - Rich cross-session context, slightly slower than local
 */
class EpisodicMemoryAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {number} [config.maxResults=20] - Maximum results per query
   * @param {'vector' | 'text' | 'both'} [config.searchMode='both'] - Search mode
   * @param {Function} [config.mcpCaller] - Function to call MCP tools (for testing)
   */
  constructor(config = {}) {
    super({
      name: 'episodic-memory',
      priority: 0.9,  // High priority - rich context
      timeout: 3000,  // Network call, allow more time
      enabled: config.enabled !== false,
    });

    this.maxResults = config.maxResults || 20;
    this.searchMode = config.searchMode || 'both';
    this.mcpCaller = config.mcpCaller || null;

    // Only warn if adapter is enabled but mcpCaller is missing
    // (When disabled via config, the warning is unnecessary noise)
    if (this.enabled && !this.mcpCaller) {
      console.warn(
        '[EpisodicMemoryAdapter] No mcpCaller provided. ' +
        'Queries will fail until mcpCaller is set via setMcpCaller().'
      );
    }

    // Result cache with TTL
    this._cache = new Map();
    this._cacheTTL = 5 * 60 * 1000;  // 5 minutes
  }

  /**
   * Set the MCP caller function (allows late injection)
   * @param {Function} mcpCaller - Function to call MCP tools
   */
  setMcpCaller(mcpCaller) {
    if (typeof mcpCaller !== 'function') {
      throw new Error('mcpCaller must be a function');
    }
    this.mcpCaller = mcpCaller;
  }

  /**
   * Query episodic memory for relevant conversations
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
      const limit = options.limit || this.maxResults;

      const response = await this._callMCP({
        query: searchQuery,
        limit,
        mode: this.searchMode,
        response_format: 'json',
      });

      if (!response || !response.results) {
        return [];
      }

      // Transform to MemoryRecord format
      const records = response.results
        .map(r => this.normalize(r))
        .filter(r => r !== null);

      // Apply additional filters
      const filtered = this._applyQueryOptions(records, options);

      // Cache results
      this._setCache(cacheKey, filtered);

      return filtered;
    });
  }

  /**
   * Build search query from analysis context
   * @private
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @returns {string | string[]}
   */
  _buildSearchQuery(context) {
    const terms = [];

    // Add intent if available and confident
    if (context.intent && context.intentConfidence > 0.5) {
      terms.push(context.intent);
    }

    // Add top tags (limit to avoid too broad queries)
    if (context.tags?.length) {
      terms.push(...context.tags.slice(0, 3));
    }

    // Add project name for project-specific search
    if (context.projectName) {
      terms.push(context.projectName);
    }

    // Add domains if present
    if (context.domains?.length) {
      terms.push(...context.domains.slice(0, 2));
    }

    // Return as array for AND matching (more precise)
    // or single string if only one term
    if (terms.length === 0) {
      return 'recent';  // Fallback to recent memories
    }

    return terms.length > 1 ? terms : terms[0];
  }

  /**
   * Call the Episodic Memory MCP tool
   * @private
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async _callMCP(params) {
    // If a custom MCP caller is provided (for testing), use it
    if (this.mcpCaller) {
      return this.mcpCaller('mcp__plugin_episodic-memory_episodic-memory__search', params);
    }

    // In production, this adapter is called FROM Claude Code which has MCP access
    // The query orchestrator will need to provide the MCP caller
    throw new Error(
      'EpisodicMemoryAdapter requires mcpCaller to be set. ' +
      'The QueryOrchestrator should provide this during initialization.'
    );
  }

  /**
   * Check if Episodic Memory MCP is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      // Try a minimal query to check availability
      const response = await this._callMCP({
        query: 'test',
        limit: 1,
        mode: 'text',
      });
      return response !== null && response !== undefined;
    } catch (error) {
      console.error('[EpisodicMemoryAdapter] Availability check failed:', error.message);
      return false;
    }
  }

  /**
   * Normalize episodic search result to MemoryRecord format
   * @param {Object} raw - Raw search result from MCP
   * @returns {import('./base-adapter.cjs').MemoryRecord | null}
   */
  normalize(raw) {
    if (!raw) return null;

    // Extract project hash from file path if present
    const projectHash = this._extractProjectHash(raw.path || raw.file_path);

    // Determine memory type based on content analysis
    const type = this._inferType(raw.snippet || raw.content || '');

    // Extract tags from content
    const extractedTags = this._extractTags(raw.snippet || raw.content || '');

    return this._createBaseRecord({
      id: raw.path || raw.file_path || this._generateId(),
      version: 1,
      type,
      content: raw.snippet || raw.content || '',
      summary: (raw.snippet || raw.content || '').slice(0, 100),
      projectHash,
      tags: [...(raw.tags || []), ...extractedTags],
      intent: 'general',
      sourceSessionId: raw.session_id || this._extractSessionId(raw.path),
      sourceTimestamp: raw.date || raw.timestamp || new Date().toISOString(),
      extractionConfidence: raw.score || raw.relevance || 0.5,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: this._calculateDecay(raw.date || raw.timestamp),
      status: 'active',
      createdAt: raw.date || raw.timestamp || new Date().toISOString(),
      updatedAt: raw.date || raw.timestamp || new Date().toISOString(),
      _source: 'episodic-memory',
      _sourcePriority: this.priority,
      _originalScore: raw.score,  // Preserve original score for debugging
    });
  }

  /**
   * Extract project hash from file path
   * @private
   * @param {string} [path]
   * @returns {string | null}
   */
  _extractProjectHash(path) {
    if (!path) return null;

    // Path format: ~/.config/superpowers/conversation-archive/-home-rob-project/...
    const match = path.match(/conversation-archive\/([^/]+)\//);
    if (match) {
      // Convert path segment to hash
      return match[1].replace(/-/g, '/');
    }

    return null;
  }

  /**
   * Extract session ID from file path
   * @private
   * @param {string} [path]
   * @returns {string}
   */
  _extractSessionId(path) {
    if (!path) return 'unknown';

    // Extract filename without extension
    const match = path.match(/\/([^/]+)\.jsonl$/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Infer memory type from content
   * @private
   * @param {string} content
   * @returns {import('./base-adapter.cjs').MemoryType}
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
    if (lower.includes('don\'t') || lower.includes('avoid') || lower.includes('warning')) {
      return 'correction';
    }

    return 'learning';
  }

  /**
   * Extract tags from content
   * @private
   * @param {string} content
   * @returns {string[]}
   */
  _extractTags(content) {
    const tags = [];
    const lower = content.toLowerCase();

    // Technology tags
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

    // Limit to top 5 tags
    return tags.slice(0, 5);
  }

  /**
   * Calculate decay score based on date
   * @private
   * @param {string} [dateStr]
   * @returns {number} 0.0-1.0
   */
  _calculateDecay(dateStr) {
    if (!dateStr) return 0.5;

    const timestamp = new Date(dateStr).getTime();
    const age = Date.now() - timestamp;

    // Decay formula: exponential decay over 30 days
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const decay = Math.exp(-age / thirtyDays);

    return Math.max(0.1, Math.min(1.0, decay));
  }

  // ---------------------------------------------------------------------------
  // CACHE MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Generate cache key
   * @private
   */
  _getCacheKey(query, options) {
    const queryStr = Array.isArray(query) ? query.join(',') : query;
    return `${queryStr}:${JSON.stringify(options)}`;
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
    if (this._cache.size > 100) {
      // Find the oldest entry by timestamp (not insertion order)
      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this._cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this._cache.delete(oldestKey);
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this._cache.clear();
  }

  // ---------------------------------------------------------------------------
  // READ OPERATIONS (Full Conversation Access)
  // ---------------------------------------------------------------------------

  /**
   * Read a full conversation by path
   * Uses mcp__plugin_episodic-memory_episodic-memory__read
   * @param {string} conversationPath - Path to conversation file
   * @param {Object} [options]
   * @param {number} [options.startLine] - Start line for pagination
   * @param {number} [options.endLine] - End line for pagination
   * @returns {Promise<{success: boolean, content?: string, error?: string}>}
   */
  async read(conversationPath, options = {}) {
    try {
      const params = {
        path: conversationPath,
      };

      // Add pagination if specified
      if (options.startLine) {
        params.startLine = options.startLine;
      }
      if (options.endLine) {
        params.endLine = options.endLine;
      }

      const response = await this._callMCPRead(params);

      if (!response) {
        return { success: false, error: 'No response from MCP' };
      }

      return {
        success: true,
        content: response.content || response,
        path: conversationPath,
        startLine: options.startLine,
        endLine: options.endLine,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Show conversation details (alias for read with formatting info)
   * @param {string} conversationPath - Path to conversation file
   * @param {Object} [options]
   * @param {number} [options.startLine] - Start line
   * @param {number} [options.endLine] - End line
   * @param {boolean} [options.includeMetadata=true] - Include metadata
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async show(conversationPath, options = {}) {
    const result = await this.read(conversationPath, options);

    if (!result.success) {
      return result;
    }

    // Parse conversation content and extract metadata
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
   * Combines search + read for enriched results
   * @param {string | string[]} query - Search query
   * @param {Object} [options]
   * @param {number} [options.limit=5] - Number of results
   * @param {number} [options.contextLines=50] - Lines of context per result
   * @returns {Promise<Array<{record: MemoryRecord, context: string}>>}
   */
  async searchWithContext(query, options = {}) {
    const limit = options.limit || 5;
    const contextLines = options.contextLines || 50;

    // First, search for relevant conversations
    const context = { tags: Array.isArray(query) ? query : [query] };
    const searchResults = await this.query(context, { limit });

    // Then read context for each result
    const enrichedResults = [];

    for (const record of searchResults) {
      try {
        const readResult = await this.read(record.id, {
          endLine: contextLines,
        });

        enrichedResults.push({
          record,
          context: readResult.success ? readResult.content : null,
        });
      } catch {
        enrichedResults.push({
          record,
          context: null,
        });
      }
    }

    return enrichedResults;
  }

  /**
   * Call the Episodic Memory read MCP tool
   * @private
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async _callMCPRead(params) {
    if (this.mcpCaller) {
      return this.mcpCaller('mcp__plugin_episodic-memory_episodic-memory__read', params);
    }

    throw new Error(
      'EpisodicMemoryAdapter requires mcpCaller to be set. ' +
      'The QueryOrchestrator should provide this during initialization.'
    );
  }

  /**
   * Extract metadata from conversation content
   * @private
   * @param {string} content
   * @returns {Object}
   */
  _extractConversationMetadata(content) {
    if (!content) return {};

    const lines = content.split('\n');
    const metadata = {
      lineCount: lines.length,
      messageCount: 0,
      technologies: [],
      topics: [],
    };

    // Count messages (assuming JSONL format)
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.role || parsed.type) {
            metadata.messageCount++;
          }
        } catch {
          // Not JSON, just a text line
        }
      }
    }

    // Extract technologies mentioned
    const techPatterns = [
      'javascript', 'typescript', 'python', 'node', 'react',
      'git', 'docker', 'kubernetes', 'linux', 'bash',
      'claude', 'mcp', 'hook', 'plugin',
    ];

    const lowerContent = content.toLowerCase();
    for (const tech of techPatterns) {
      if (lowerContent.includes(tech)) {
        metadata.technologies.push(tech);
      }
    }

    return metadata;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  EpisodicMemoryAdapter,
};
