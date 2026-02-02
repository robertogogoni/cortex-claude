/**
 * Cortex - Claude's Cognitive Layer - Query Orchestrator (v1.1.0)
 *
 * Coordinates memory retrieval from MULTIPLE sources via Adapter Pattern:
 * - JSONL Local: Working, short-term, long-term, skills (always available)
 * - Episodic Memory MCP: 233+ archived conversations with semantic search
 * - Knowledge Graph MCP: Structured entities and relations
 * - CLAUDE.md Files: User-curated knowledge and solutions
 *
 * Applies deduplication, ranking, and token budgeting across all sources.
 *
 * @version 1.1.0
 * @see Design: ../docs/design/memory-orchestrator.md
 */

'use strict';

const { expandPath } = require('../core/types.cjs');
const { ContextAnalyzer } = require('./context-analyzer.cjs');
const { createDefaultRegistry, AdapterRegistry } = require('../adapters/index.cjs');

// =============================================================================
// QUERY ORCHESTRATOR (v1.1.0 - Adapter Pattern)
// =============================================================================

class QueryOrchestrator {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {Object} options.tokenBudget - Token limits per category
   * @param {Object} options.adapterConfig - Configuration for adapters
   * @param {Function} options.mcpCaller - Function to call MCP tools (required for MCP adapters)
   * @param {Object} options.semantic - Semantic analysis options
   * @param {boolean} options.semantic.enabled - Enable Haiku-powered semantic analysis
   * @param {boolean} options.semantic.useHaiku - Use Haiku API (default: true)
   * @param {boolean} options.semantic.useCache - Enable semantic cache (default: true)
   * @param {boolean} options.semantic.useAdaptation - Enable auto-learning (default: true)
   */
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');

    this.tokenBudget = {
      total: options.tokenBudget?.total || 2000,
      perSource: options.tokenBudget?.perSource || 500,
      perMemory: options.tokenBudget?.perMemory || 200,
      ...options.tokenBudget,
    };

    // Semantic analysis options
    this._semanticEnabled = options.semantic?.enabled === true;

    this.contextAnalyzer = new ContextAnalyzer({
      workingDir: options.workingDir || process.cwd(),
      weights: options.contextWeights,
      semantic: this._semanticEnabled ? {
        enabled: true,
        useHaiku: options.semantic?.useHaiku !== false,
        useCache: options.semantic?.useCache !== false,
        useAdaptation: options.semantic?.useAdaptation !== false,
      } : undefined,
    });

    // Initialize adapter registry with all memory sources
    this.registry = createDefaultRegistry({
      basePath: this.basePath,
      mcpCaller: options.mcpCaller,
      adapters: options.adapterConfig,
    });

    // Store MCP caller for later injection
    this._mcpCaller = options.mcpCaller || null;
  }

  /**
   * Set or update the MCP caller function
   * Call this when MCP tools become available (e.g., during hook execution)
   * @param {Function} caller - Function that calls MCP tools
   */
  setMcpCaller(caller) {
    this._mcpCaller = caller;
    this.registry.setMcpCaller(caller);
  }

  /**
   * Query all relevant memories from ALL sources
   * @param {Object} input
   * @param {string} input.prompt - Optional user prompt for context
   * @param {string[]} input.recentFiles - Recently accessed files
   * @param {string[]} input.types - Memory types to include
   * @param {string[]} input.adapters - Specific adapters to query (default: all enabled)
   * @param {boolean} input.useSemantic - Override semantic analysis setting for this query
   * @param {boolean} input.forceSemanticApi - Bypass semantic cache
   * @returns {Promise<Object>}
   */
  async query(input = {}) {
    // Determine if semantic analysis should be used
    const useSemantic = input.useSemantic ?? this._semanticEnabled;

    // Analyze context from prompt and environment
    // Use async semantic analysis when enabled
    let context;
    if (useSemantic) {
      context = await this.contextAnalyzer.analyzeWithSemantic({
        prompt: input.prompt,
        recentFiles: input.recentFiles,
        forceApi: input.forceSemanticApi,
      });
    } else {
      context = this.contextAnalyzer.analyze({
        prompt: input.prompt,
        recentFiles: input.recentFiles,
      });
    }

    // Build query options for adapters
    // IMPORTANT: Don't pass user's limit to adapters - that would cut off results
    // BEFORE context-aware ranking. Instead, fetch more candidates and let
    // ranking + token budget select the most relevant ones.
    const queryOptions = {
      types: input.types,
      limit: 500,  // Internal limit per adapter - enough candidates for ranking
    };

    // Store user's desired final limit (for potential future use after ranking)
    const finalLimit = input.limit || 100;

    // If specific adapters requested, temporarily disable others
    let originalStates = null;
    if (input.adapters?.length) {
      originalStates = this._setEnabledAdapters(input.adapters);
    }

    try {
      // Query all enabled adapters in parallel
      const { results: allMemories, stats: adapterStats } = await this.registry.queryAll(
        context,
        queryOptions
      );

      // Deduplicate memories (same content may come from multiple sources)
      const dedupedMemories = this._deduplicateMemories(allMemories);

      // Rank by relevance using context analyzer
      const rankedMemories = this.contextAnalyzer.rankMemories(dedupedMemories, context);

      // Apply token budget
      const selectedMemories = this._applyTokenBudget(rankedMemories);

      // Optionally limit by semantic complexity
      let finalMemories = selectedMemories;
      if (context._memoryLimit && selectedMemories.length > context._memoryLimit) {
        finalMemories = selectedMemories.slice(0, context._memoryLimit);
      }

      // Track usage for returned memories (fire-and-forget, non-blocking)
      this._trackUsage(finalMemories).catch(err => {
        // Silently ignore tracking errors - don't break queries
        if (this.registry._verbose) {
          console.error('[QueryOrchestrator] Usage tracking error:', err.message);
        }
      });

      return {
        context,
        memories: finalMemories,
        stats: {
          totalQueried: allMemories.length,
          totalDeduplicated: dedupedMemories.length,
          totalSelected: finalMemories.length,
          bySource: this._countBySource(finalMemories),
          byAdapter: adapterStats,
          estimatedTokens: this._estimateTokens(finalMemories),
          // Semantic analysis stats
          semantic: useSemantic ? {
            enabled: true,
            complexity: context._complexity,
            matchStrategy: context._matchStrategy,
            memoryLimit: context._memoryLimit,
            source: context._semanticSource,
            cached: context._semanticCached,
          } : { enabled: false },
        },
      };
    } finally {
      // Restore original adapter states if we modified them
      if (originalStates) {
        this._restoreAdapterStates(originalStates);
      }
    }
  }

  /**
   * Track usage for queried memories
   * Updates usageCount and lastUsed for writable adapters
   * @private
   * @param {Object[]} memories
   */
  async _trackUsage(memories) {
    const now = new Date().toISOString();
    const updatesByAdapter = new Map();

    // Group memories by their source adapter
    for (const memory of memories) {
      const source = memory._source;
      if (!source || !memory.id) continue;

      if (!updatesByAdapter.has(source)) {
        updatesByAdapter.set(source, []);
      }
      updatesByAdapter.get(source).push(memory);
    }

    // Update each adapter's memories
    for (const [adapterName, adapterMemories] of updatesByAdapter) {
      const adapter = this.registry.get(adapterName);
      if (!adapter?.supportsWrite()) continue;

      for (const memory of adapterMemories) {
        try {
          await adapter.update(memory.id, {
            usageCount: (memory.usageCount || 0) + 1,
            lastUsed: now,
            updatedAt: now,
          });
        } catch {
          // Silently ignore individual update failures
        }
      }
    }
  }

  /**
   * Temporarily enable only specific adapters
   * @private
   * @param {string[]} adapterNames
   * @returns {Map<string, boolean>} Original states
   */
  _setEnabledAdapters(adapterNames) {
    const originalStates = new Map();
    const requested = new Set(adapterNames.map(n => n.toLowerCase()));

    for (const adapter of this.registry.getAll()) {
      originalStates.set(adapter.name, adapter.enabled);
      adapter.enabled = requested.has(adapter.name.toLowerCase());
    }

    return originalStates;
  }

  /**
   * Restore adapter enabled states
   * @private
   * @param {Map<string, boolean>} states
   */
  _restoreAdapterStates(states) {
    for (const [name, enabled] of states) {
      this.registry.setEnabled(name, enabled);
    }
  }

  /**
   * Deduplicate memories based on content similarity
   * Keeps the memory with highest source priority when duplicates found
   * @param {Object[]} memories
   * @returns {Object[]}
   */
  _deduplicateMemories(memories) {
    const seen = new Map(); // content hash -> memory

    for (const memory of memories) {
      // Create a content key for comparison
      const contentKey = this._getContentKey(memory);

      if (!seen.has(contentKey)) {
        seen.set(contentKey, memory);
      } else {
        // Keep the one with higher source priority
        const existing = seen.get(contentKey);
        if ((memory._sourcePriority || 0) > (existing._sourcePriority || 0)) {
          seen.set(contentKey, memory);
        }
      }
    }

    return [...seen.values()];
  }

  /**
   * Generate a content key for deduplication
   * @param {Object} memory
   * @returns {string}
   */
  _getContentKey(memory) {
    // Use summary or content, truncated for comparison
    const content = (memory.summary || memory.content || '').slice(0, 200);
    return `${memory.type || 'unknown'}:${content}`;
  }

  /**
   * Apply token budget to select final memories
   * @param {Object[]} memories - Ranked memories (highest relevance first)
   * @returns {Object[]}
   */
  _applyTokenBudget(memories) {
    const selected = [];
    let totalTokens = 0;
    const tokensBySource = {};

    for (const memory of memories) {
      const memoryTokens = this._estimateMemoryTokens(memory);
      const source = memory._source || 'unknown';

      // Check per-memory limit
      if (memoryTokens > this.tokenBudget.perMemory) {
        continue; // Skip overly large memories
      }

      // Check per-source limit
      const sourceTokens = tokensBySource[source] || 0;
      if (sourceTokens + memoryTokens > this.tokenBudget.perSource) {
        continue;
      }

      // Check total limit
      if (totalTokens + memoryTokens > this.tokenBudget.total) {
        break; // Stop adding memories
      }

      selected.push(memory);
      totalTokens += memoryTokens;
      tokensBySource[source] = sourceTokens + memoryTokens;
    }

    return selected;
  }

  /**
   * Estimate tokens for a single memory
   * @param {Object} memory
   * @returns {number}
   */
  _estimateMemoryTokens(memory) {
    // Rough estimation: ~4 characters per token
    const content = memory.summary || memory.content || '';
    const metadata = JSON.stringify({
      type: memory.type,
      tags: memory.tags,
      timestamp: memory.sourceTimestamp || memory.timestamp,
    });
    return Math.ceil((content.length + metadata.length) / 4);
  }

  /**
   * Estimate total tokens for memories
   * @param {Object[]} memories
   * @returns {number}
   */
  _estimateTokens(memories) {
    return memories.reduce((sum, m) => sum + this._estimateMemoryTokens(m), 0);
  }

  /**
   * Count memories by source
   * @param {Object[]} memories
   * @returns {Object}
   */
  _countBySource(memories) {
    const counts = {};
    for (const memory of memories) {
      const source = memory._source || 'unknown';
      counts[source] = (counts[source] || 0) + 1;
    }
    return counts;
  }

  // ===========================================================================
  // FORMATTING METHODS
  // ===========================================================================

  /**
   * Format memories for injection into Claude's context
   * @param {Object[]} memories
   * @param {Object} options
   * @param {string} options.format - 'xml', 'markdown', or 'plain'
   * @param {boolean} options.includeSourceInfo - Include source attribution
   * @returns {string}
   */
  formatForInjection(memories, options = {}) {
    if (memories.length === 0) {
      return '';
    }

    const format = options.format || 'xml';

    switch (format) {
      case 'xml':
        return this._formatAsXML(memories, options);
      case 'markdown':
        return this._formatAsMarkdown(memories, options);
      default:
        return this._formatAsPlain(memories, options);
    }
  }

  /**
   * Format memories as XML (default, best for Claude)
   * @param {Object[]} memories
   * @param {Object} options
   * @returns {string}
   */
  _formatAsXML(memories, options = {}) {
    const lines = ['<relevant-memories>'];

    // Group by type
    const byType = {};
    for (const memory of memories) {
      const type = memory.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(memory);
    }

    for (const [type, typeMemories] of Object.entries(byType)) {
      lines.push(`  <${type}-memories>`);
      for (const memory of typeMemories) {
        const relevance = memory.relevanceScore
          ? `relevance="${(memory.relevanceScore * 100).toFixed(0)}%"`
          : '';
        const source = options.includeSourceInfo && memory._source
          ? ` source="${memory._source}"`
          : '';

        lines.push(`    <memory ${relevance}${source}>`);
        if (memory.summary) {
          lines.push(`      <summary>${this._escapeXML(memory.summary)}</summary>`);
        }
        if (memory.content && memory.content !== memory.summary) {
          lines.push(`      <content>${this._escapeXML(memory.content)}</content>`);
        }
        if (memory.tags?.length) {
          lines.push(`      <tags>${memory.tags.join(', ')}</tags>`);
        }
        lines.push(`    </memory>`);
      }
      lines.push(`  </${type}-memories>`);
    }

    lines.push('</relevant-memories>');
    return lines.join('\n');
  }

  /**
   * Format memories as Markdown
   * @param {Object[]} memories
   * @param {Object} options
   * @returns {string}
   */
  _formatAsMarkdown(memories, options = {}) {
    const lines = ['## Relevant Memories\n'];

    // Group by type
    const byType = {};
    for (const memory of memories) {
      const type = memory.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(memory);
    }

    for (const [type, typeMemories] of Object.entries(byType)) {
      lines.push(`### ${this._titleCase(type)}\n`);
      for (const memory of typeMemories) {
        const relevance = memory.relevanceScore
          ? `**[${(memory.relevanceScore * 100).toFixed(0)}%]**`
          : '';
        const source = options.includeSourceInfo && memory._source
          ? ` *(from ${memory._source})*`
          : '';

        lines.push(`- ${relevance} ${memory.summary || memory.content}${source}`);
        if (memory.tags?.length) {
          lines.push(`  - Tags: ${memory.tags.join(', ')}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format memories as plain text
   * @param {Object[]} memories
   * @param {Object} options
   * @returns {string}
   */
  _formatAsPlain(memories, options = {}) {
    return memories
      .map(m => {
        const source = options.includeSourceInfo && m._source
          ? ` (${m._source})`
          : '';
        return `[${m.type || 'memory'}]${source} ${m.summary || m.content}`;
      })
      .join('\n');
  }

  /**
   * Escape XML special characters
   * @param {string} str
   * @returns {string}
   */
  _escapeXML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert string to title case
   * @param {string} str
   * @returns {string}
   */
  _titleCase(str) {
    return str
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // ===========================================================================
  // STATISTICS AND DIAGNOSTICS
  // ===========================================================================

  /**
   * Get statistics about all memory sources/adapters
   * @returns {Promise<Object>}
   */
  async getSourceStats() {
    return await this.registry.getAllStats();
  }

  /**
   * Get detailed adapter information
   * @returns {Object[]}
   */
  getAdapterInfo() {
    return this.registry.getAll().map(adapter => ({
      name: adapter.name,
      priority: adapter.priority,
      timeout: adapter.timeout,
      enabled: adapter.enabled,
    }));
  }

  /**
   * Enable or disable a specific adapter
   * @param {string} name - Adapter name
   * @param {boolean} enabled
   */
  setAdapterEnabled(name, enabled) {
    this.registry.setEnabled(name, enabled);
  }

  /**
   * Clear all caches across all adapters
   */
  clearAllCaches() {
    this.registry.clearAllCaches();
    this.contextAnalyzer.clearCache();
  }

  /**
   * Record feedback for auto-learning
   * Call this when user selects/uses a memory from results
   * @param {string} query - Original query
   * @param {Object} selectedMemory - Memory the user found useful
   * @param {Object} context - Query context (from query result)
   */
  recordFeedback(query, selectedMemory, context) {
    this.contextAnalyzer.recordFeedback(query, selectedMemory, context);
  }

  /**
   * Get semantic analysis statistics
   * @returns {Object|null}
   */
  getSemanticStats() {
    return this.contextAnalyzer.getSemanticStats();
  }

  /**
   * Check if semantic analysis is enabled
   * @returns {boolean}
   */
  isSemanticEnabled() {
    return this._semanticEnabled;
  }

  /**
   * Get a specific adapter by name
   * @param {string} name
   * @returns {BaseAdapter|null}
   */
  getAdapter(name) {
    return this.registry.get(name);
  }
}

// =============================================================================
// MEMORY SOURCE DEFINITIONS
// =============================================================================

/**
 * Available memory sources with their paths and descriptions
 */
const MEMORY_SOURCES = {
  working: {
    path: 'data/memories/working.jsonl',
    description: 'Current session context and active tasks',
    ttl: 'session',
  },
  shortTerm: {
    path: 'data/memories/short-term.jsonl',
    description: 'Recent session history (last 7 days)',
    ttl: '7d',
  },
  longTerm: {
    path: 'data/memories/long-term.jsonl',
    description: 'Consolidated insights and patterns',
    ttl: 'permanent',
  },
  skills: {
    path: 'data/skills/index.jsonl',
    description: 'Learned skills and capabilities',
    ttl: 'permanent',
  },
  project: {
    path: 'data/projects/',
    description: 'Project-specific memories by hash',
    ttl: 'permanent',
  },
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  QueryOrchestrator,
  MEMORY_SOURCES,
};
