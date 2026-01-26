/**
 * Cortex - Claude's Cognitive Layer - Adapter Registry
 *
 * Central registry for all memory adapters. Manages adapter lifecycle,
 * coordinates parallel queries, and provides factory functions.
 *
 * @version 1.1.0
 * @see Design: ~/.claude/dev/skill-activator/docs/plans/2026-01-26-claude-memory-orchestrator-design.md#section-2.4
 */

'use strict';

const { BaseAdapter } = require('./base-adapter.cjs');
const { JSONLAdapter } = require('./jsonl-adapter.cjs');
const { EpisodicMemoryAdapter } = require('./episodic-memory-adapter.cjs');
const { KnowledgeGraphAdapter } = require('./knowledge-graph-adapter.cjs');
const { ClaudeMdAdapter } = require('./claudemd-adapter.cjs');
const { expandPath } = require('../core/types.cjs');

// =============================================================================
// ADAPTER REGISTRY
// =============================================================================

/**
 * Central registry for all memory adapters
 */
class AdapterRegistry {
  /**
   * @param {Object} options
   * @param {boolean} options.verbose - Log adapter errors to console (default: false)
   */
  constructor(options = {}) {
    /** @type {Map<string, BaseAdapter>} */
    this._adapters = new Map();

    /** @type {Function|null} MCP caller function */
    this._mcpCaller = null;

    /** @type {boolean} Whether to log errors to console */
    this._verbose = options.verbose || false;
  }

  /**
   * Set verbose mode
   * @param {boolean} verbose
   */
  setVerbose(verbose) {
    this._verbose = verbose;
  }

  /**
   * Set the MCP caller function
   * This is called by the QueryOrchestrator when it has access to MCP tools
   * @param {Function} caller - Function that calls MCP tools
   */
  setMcpCaller(caller) {
    this._mcpCaller = caller;

    // Update all MCP-based adapters
    for (const adapter of this._adapters.values()) {
      if (adapter.mcpCaller !== undefined) {
        adapter.mcpCaller = caller;
      }
    }
  }

  /**
   * Register an adapter
   * @param {BaseAdapter} adapter
   */
  register(adapter) {
    if (!(adapter instanceof BaseAdapter)) {
      throw new Error('Adapter must extend BaseAdapter');
    }

    // Set MCP caller if we have one
    if (this._mcpCaller && adapter.mcpCaller !== undefined) {
      adapter.mcpCaller = this._mcpCaller;
    }

    this._adapters.set(adapter.name, adapter);
  }

  /**
   * Unregister an adapter
   * @param {string} name
   */
  unregister(name) {
    this._adapters.delete(name);
  }

  /**
   * Get an adapter by name
   * @param {string} name
   * @returns {BaseAdapter|null}
   */
  get(name) {
    return this._adapters.get(name) || null;
  }

  /**
   * Get all registered adapters
   * @returns {BaseAdapter[]}
   */
  getAll() {
    return Array.from(this._adapters.values());
  }

  /**
   * Get all enabled adapters, sorted by priority (highest first)
   * @returns {BaseAdapter[]}
   */
  getEnabled() {
    return this.getAll()
      .filter(a => a.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Enable or disable an adapter
   * @param {string} name
   * @param {boolean} enabled
   */
  setEnabled(name, enabled) {
    const adapter = this._adapters.get(name);
    if (adapter) {
      adapter.enabled = enabled;
    }
  }

  /**
   * Query all enabled adapters in parallel with graceful degradation
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<{results: import('./base-adapter.cjs').MemoryRecord[], stats: Record<string, import('./base-adapter.cjs').AdapterStats>}>}
   */
  async queryAll(context, options = {}) {
    const enabledAdapters = this.getEnabled();
    const stats = {};

    // Query all adapters in parallel with individual timeouts
    const promises = enabledAdapters.map(async adapter => {
      const startTime = Date.now();

      try {
        // Race between query and timeout
        const results = await Promise.race([
          adapter.query(context, options),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), adapter.timeout)
          ),
        ]);

        stats[adapter.name] = {
          name: adapter.name,
          available: true,
          totalRecords: results.length,
          lastQueryTime: Date.now() - startTime,
          cacheHitRate: adapter._calculateCacheHitRate?.() || 0,
          errorCount: 0,
        };

        return results;
      } catch (error) {
        // Log error only in verbose mode (graceful degradation)
        if (this._verbose) {
          console.error(`[AdapterRegistry] ${adapter.name} failed:`, error.message);
        }

        stats[adapter.name] = {
          name: adapter.name,
          available: false,
          totalRecords: 0,
          lastQueryTime: Date.now() - startTime,
          cacheHitRate: 0,
          errorCount: 1,
          error: error.message,
        };

        return [];  // Return empty array to not break Promise.all
      }
    });

    const resultsArrays = await Promise.all(promises);
    const allResults = resultsArrays.flat();

    return {
      results: allResults,
      stats,
    };
  }

  /**
   * Get statistics for all adapters
   * @returns {Promise<Record<string, import('./base-adapter.cjs').AdapterStats>>}
   */
  async getAllStats() {
    const stats = {};

    for (const adapter of this._adapters.values()) {
      try {
        stats[adapter.name] = await adapter.getStats();
      } catch (error) {
        stats[adapter.name] = {
          name: adapter.name,
          available: false,
          totalRecords: 0,
          lastQueryTime: 0,
          cacheHitRate: 0,
          errorCount: 1,
          error: error.message,
        };
      }
    }

    return stats;
  }

  /**
   * Clear caches for all adapters
   */
  clearAllCaches() {
    for (const adapter of this._adapters.values()) {
      if (typeof adapter.clearCache === 'function') {
        adapter.clearCache();
      }
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create and configure the default adapter registry
 * @param {Object} config - Configuration options
 * @param {string} [config.basePath] - Base path for memory storage
 * @param {Object} [config.adapters] - Adapter-specific configuration
 * @param {Function} [config.mcpCaller] - MCP caller function
 * @returns {AdapterRegistry}
 */
function createDefaultRegistry(config = {}) {
  const registry = new AdapterRegistry({
    verbose: config.verbose || false,
  });
  const basePath = expandPath(config.basePath || '~/.claude/memory');

  // Set MCP caller if provided
  if (config.mcpCaller) {
    registry.setMcpCaller(config.mcpCaller);
  }

  // 1. JSONL Adapter (always enabled - local storage)
  registry.register(new JSONLAdapter({
    basePath,
    sources: config.adapters?.jsonl?.sources || [
      { name: 'working', path: 'data/memories/working.jsonl', maxAge: 24 * 60 * 60 * 1000 },
      { name: 'short-term', path: 'data/memories/short-term.jsonl', maxAge: 7 * 24 * 60 * 60 * 1000 },
      { name: 'long-term', path: 'data/memories/long-term.jsonl' },
      { name: 'skills', path: 'data/skills/index.jsonl' },
    ],
  }));

  // 2. Episodic Memory Adapter (MCP-based)
  const episodicConfig = config.adapters?.episodicMemory || {};
  registry.register(new EpisodicMemoryAdapter({
    enabled: episodicConfig.enabled !== false,  // Enabled by default
    maxResults: episodicConfig.maxResults || 20,
    searchMode: episodicConfig.searchMode || 'both',
    mcpCaller: config.mcpCaller,
  }));

  // 3. Knowledge Graph Adapter (MCP-based)
  const kgConfig = config.adapters?.knowledgeGraph || {};
  registry.register(new KnowledgeGraphAdapter({
    enabled: kgConfig.enabled !== false,  // Enabled by default
    maxResults: kgConfig.maxResults || 50,
    mcpCaller: config.mcpCaller,
  }));

  // 4. CLAUDE.md Adapter (file-based)
  const claudeMdConfig = config.adapters?.claudeMd || {};
  registry.register(new ClaudeMdAdapter({
    enabled: claudeMdConfig.enabled !== false,  // Enabled by default
    paths: claudeMdConfig.paths || [
      '~/.claude/CLAUDE.md',
      '~/claude-cross-machine-sync/CLAUDE.md',
      '.claude/CLAUDE.md',
      './CLAUDE.md',
    ],
    cacheTimeout: claudeMdConfig.cacheTimeout || 60000,
  }));

  return registry;
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

// Re-export all adapter classes
module.exports = {
  // Registry
  AdapterRegistry,
  createDefaultRegistry,

  // Base class
  BaseAdapter,

  // Adapter implementations
  JSONLAdapter,
  EpisodicMemoryAdapter,
  KnowledgeGraphAdapter,
  ClaudeMdAdapter,
};
