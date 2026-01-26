/**
 * Claude Memory Orchestrator - Query Orchestrator
 *
 * Coordinates memory retrieval from multiple sources:
 * - Working memory (recent, high-priority)
 * - Long-term memory (persistent learnings)
 * - Skill memory (extracted skills)
 * - Project memory (project-specific)
 *
 * Applies deduplication, ranking, and token budgeting.
 */

'use strict';

const path = require('path');
const { expandPath } = require('../core/types.cjs');
const { JSONLStore } = require('../core/storage.cjs');
const { ContextAnalyzer } = require('./context-analyzer.cjs');

// =============================================================================
// MEMORY SOURCES
// =============================================================================

/**
 * Memory source configuration
 */
const MEMORY_SOURCES = {
  working: {
    name: 'Working Memory',
    priority: 1.0,
    path: 'data/memories/working.jsonl',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    description: 'Recent, high-priority memories from current session',
  },
  shortTerm: {
    name: 'Short-Term Memory',
    priority: 0.9,
    path: 'data/memories/short-term.jsonl',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    description: 'Memories from recent sessions',
  },
  longTerm: {
    name: 'Long-Term Memory',
    priority: 0.7,
    path: 'data/memories/long-term.jsonl',
    maxAge: null, // No expiry
    description: 'Consolidated permanent memories',
  },
  skills: {
    name: 'Skill Memory',
    priority: 0.8,
    path: 'data/skills/index.jsonl',
    maxAge: null,
    description: 'Extracted procedural knowledge',
  },
  project: {
    name: 'Project Memory',
    priority: 0.85,
    pathPattern: 'data/projects/{hash}.jsonl',
    maxAge: null,
    description: 'Project-specific memories',
  },
};

// =============================================================================
// QUERY ORCHESTRATOR
// =============================================================================

class QueryOrchestrator {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {Object} options.tokenBudget - Token limits per category
   * @param {Object} options.sourceWeights - Custom source weights
   */
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');
    this.tokenBudget = {
      total: options.tokenBudget?.total || 2000,
      perSource: options.tokenBudget?.perSource || 500,
      perMemory: options.tokenBudget?.perMemory || 200,
      ...options.tokenBudget,
    };
    this.sourceWeights = {
      ...Object.fromEntries(
        Object.entries(MEMORY_SOURCES).map(([k, v]) => [k, v.priority])
      ),
      ...options.sourceWeights,
    };

    this.contextAnalyzer = new ContextAnalyzer({
      workingDir: options.workingDir || process.cwd(),
      weights: options.contextWeights,
    });

    // Source stores (lazy-loaded)
    this._stores = {};
  }

  /**
   * Get or create a store for a source
   * @param {string} sourceName
   * @param {string} projectHash - Required for project source
   * @returns {JSONLStore|null}
   */
  _getStore(sourceName, projectHash = null) {
    const source = MEMORY_SOURCES[sourceName];
    if (!source) return null;

    let storePath;
    if (sourceName === 'project') {
      if (!projectHash) return null;
      storePath = source.pathPattern.replace('{hash}', projectHash);
    } else {
      storePath = source.path;
    }

    const fullPath = path.join(this.basePath, storePath);
    const cacheKey = fullPath;

    if (!this._stores[cacheKey]) {
      this._stores[cacheKey] = new JSONLStore(fullPath, {
        indexFn: r => r.id,
      });
    }

    return this._stores[cacheKey];
  }

  /**
   * Query memories from a single source
   * @param {string} sourceName
   * @param {Object} context
   * @param {Object} options
   * @returns {Promise<Object[]>}
   */
  async _querySource(sourceName, context, options = {}) {
    const source = MEMORY_SOURCES[sourceName];
    if (!source) return [];

    const store = this._getStore(sourceName, context.projectHash);
    if (!store) return [];

    try {
      // Load if not already loaded
      if (!store.loaded) {
        await store.load();
      }

      let memories = store.getAll();

      // Filter by max age if applicable
      if (source.maxAge) {
        const cutoff = Date.now() - source.maxAge;
        memories = memories.filter(m => {
          const ts = new Date(m.timestamp || m.createdAt || 0).getTime();
          return ts >= cutoff;
        });
      }

      // Filter by type if specified
      if (options.types?.length) {
        memories = memories.filter(m => options.types.includes(m.type));
      }

      // Add source metadata
      return memories.map(m => ({
        ...m,
        _source: sourceName,
        _sourcePriority: this.sourceWeights[sourceName] || source.priority,
      }));
    } catch (error) {
      console.error(`[QueryOrchestrator] Failed to query ${sourceName}:`, error.message);
      return [];
    }
  }

  /**
   * Query all relevant memories
   * @param {Object} input
   * @param {string} input.prompt - Optional user prompt for context
   * @param {string[]} input.recentFiles - Recently accessed files
   * @param {string[]} input.sources - Specific sources to query (default: all)
   * @param {string[]} input.types - Memory types to include
   * @returns {Promise<Object>}
   */
  async query(input = {}) {
    // Analyze context
    const context = this.contextAnalyzer.analyze({
      prompt: input.prompt,
      recentFiles: input.recentFiles,
    });

    // Determine which sources to query
    const sourcesToQuery = input.sources || Object.keys(MEMORY_SOURCES);

    // Query all sources in parallel
    const sourceResults = await Promise.all(
      sourcesToQuery.map(source =>
        this._querySource(source, context, { types: input.types })
      )
    );

    // Flatten and deduplicate
    const allMemories = this._deduplicateMemories(sourceResults.flat());

    // Rank by relevance
    const rankedMemories = this.contextAnalyzer.rankMemories(allMemories, context);

    // Apply token budget
    const selectedMemories = this._applyTokenBudget(rankedMemories);

    return {
      context,
      memories: selectedMemories,
      stats: {
        totalQueried: allMemories.length,
        totalSelected: selectedMemories.length,
        bySource: this._countBySource(selectedMemories),
        estimatedTokens: this._estimateTokens(selectedMemories),
      },
    };
  }

  /**
   * Deduplicate memories based on content similarity
   * @param {Object[]} memories
   * @returns {Object[]}
   */
  _deduplicateMemories(memories) {
    const seen = new Map(); // content hash -> memory

    for (const memory of memories) {
      // Create a simple content hash
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
   * @param {Object[]} memories - Ranked memories
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
      timestamp: memory.timestamp,
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

  /**
   * Format memories for injection
   * @param {Object[]} memories
   * @param {Object} options
   * @returns {string}
   */
  formatForInjection(memories, options = {}) {
    if (memories.length === 0) {
      return '';
    }

    const format = options.format || 'xml';

    if (format === 'xml') {
      return this._formatAsXML(memories);
    } else if (format === 'markdown') {
      return this._formatAsMarkdown(memories);
    } else {
      return this._formatAsPlain(memories);
    }
  }

  /**
   * Format memories as XML
   * @param {Object[]} memories
   * @returns {string}
   */
  _formatAsXML(memories) {
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
        lines.push(`    <memory relevance="${(memory.relevanceScore * 100).toFixed(0)}%">`);
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
   * @returns {string}
   */
  _formatAsMarkdown(memories) {
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
        const relevance = (memory.relevanceScore * 100).toFixed(0);
        lines.push(`- **[${relevance}% relevant]** ${memory.summary || memory.content}`);
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
   * @returns {string}
   */
  _formatAsPlain(memories) {
    return memories
      .map(m => `[${m.type || 'memory'}] ${m.summary || m.content}`)
      .join('\n');
  }

  /**
   * Escape XML special characters
   * @param {string} str
   * @returns {string}
   */
  _escapeXML(str) {
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

  /**
   * Get statistics about memory sources
   * @returns {Promise<Object>}
   */
  async getSourceStats() {
    const stats = {};

    for (const [name, source] of Object.entries(MEMORY_SOURCES)) {
      if (name === 'project') continue; // Skip project (requires hash)

      const store = this._getStore(name);
      if (!store) continue;

      try {
        if (!store.loaded) {
          await store.load();
        }
        stats[name] = {
          name: source.name,
          count: store.getAll().length,
          priority: source.priority,
        };
      } catch {
        stats[name] = {
          name: source.name,
          count: 0,
          priority: source.priority,
          error: true,
        };
      }
    }

    return stats;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  QueryOrchestrator,
  MEMORY_SOURCES,
};
