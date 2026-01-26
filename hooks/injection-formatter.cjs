#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - UX Formatter
 *
 * Neural-inspired visual output for Claude sessions with:
 * - 4 rotating themes (nodes, branches, waves, minimal)
 * - Pulsing animations during loading
 * - Color-matched palettes
 *
 * @version 2.1.0
 */

'use strict';

// Import neural visuals system
let NeuralProgressDisplay, NeuralFormatter, NeuralAnimator, ThemeManager;
try {
  ({
    NeuralProgressDisplay,
    NeuralFormatter,
    NeuralAnimator,
    ThemeManager,
  } = require('./neural-visuals.cjs'));
} catch (e) {
  // Neural visuals not available, will use fallback
  NeuralProgressDisplay = null;
  NeuralFormatter = null;
}

// =============================================================================
// CORTEX VISUAL IDENTITY
// =============================================================================

const VERSION = '2.1.0';

// Minimal markers - no emojis, clean text
const MARKERS = {
  // Memory types
  learning: 'learn',
  pattern: 'pattern',
  skill: 'skill',
  correction: 'fix',
  preference: 'pref',
  general: 'memo',

  // Sources (short codes)
  jsonl: 'local',
  'episodic-memory': 'episodic',
  'knowledge-graph': 'graph',
  claudemd: 'claude.md',
  unknown: '?',

  // Status
  success: 'ok',
  warning: '!',
  error: 'err',
  loading: '...',
  ready: 'ready',
};

// Keep ICONS as alias for backward compatibility
const ICONS = MARKERS;

const TYPE_LABELS = {
  learning: 'LEARNINGS',
  pattern: 'PATTERNS',
  skill: 'SKILLS',
  correction: 'CORRECTIONS',
  preference: 'PREFERENCES',
  general: 'GENERAL',
};

const SOURCE_LABELS = {
  jsonl: 'local',
  'jsonl:working': 'working',
  'jsonl:short-term': 'short-term',
  'jsonl:long-term': 'long-term',
  'episodic-memory': 'episodic',
  'knowledge-graph': 'graph',
  claudemd: 'claude.md',
};

// =============================================================================
// PROGRESS DISPLAY (stderr)
// =============================================================================

/**
 * Rich progress display for session start
 * Supports both minimal ASCII and neural animated modes
 */
class ProgressDisplay {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.startTime = Date.now();
    this.steps = [];
    this.useNeural = options.neural !== false && NeuralProgressDisplay;
    this.theme = options.theme || null;

    // If neural mode available, create neural display
    if (this.useNeural) {
      this.neuralDisplay = new NeuralProgressDisplay({
        theme: this.theme,
        verbose: this.verbose,
      });
    }
  }

  /**
   * Show initialization message
   */
  init() {
    if (this.useNeural && this.neuralDisplay) {
      this.neuralDisplay.showHeader();
      return;
    }

    // Fallback minimal style
    this._write('\n');
    this._write('  cortex v2.1.0\n');
    this._write('  -------------\n');
  }

  /**
   * Start loading animation (neural mode only)
   */
  startLoading() {
    if (this.useNeural && this.neuralDisplay) {
      this.neuralDisplay.startLoading();
    }
  }

  /**
   * Stop loading animation (neural mode only)
   */
  stopLoading() {
    if (this.useNeural && this.neuralDisplay) {
      this.neuralDisplay.stopLoading();
    }
  }

  /**
   * Show step progress
   * @param {string} step
   * @param {string} status
   */
  step(step, status = 'loading') {
    const icon = ICONS[status] || ICONS.loading;
    this._write(`  ${icon} ${step}\n`);
    this.steps.push({ step, status, time: Date.now() });
  }

  /**
   * Show source query progress
   * @param {string} source
   * @param {number} found
   * @param {number} duration
   */
  sourceResult(source, found, duration) {
    const icon = ICONS[source.split(':')[0]] || ICONS.unknown;
    const label = SOURCE_LABELS[source] || source;
    const countStr = found > 0 ? `${found} found` : 'none';
    this._write(`    ${icon} ${label}: ${countStr} (${duration}ms)\n`);
  }

  /**
   * Show final summary
   * @param {Object} stats
   */
  summary(stats) {
    // Use neural display if available
    if (this.useNeural && this.neuralDisplay) {
      this.neuralDisplay.showSummary(stats);
      return;
    }

    // Fallback minimal style
    const duration = Date.now() - this.startTime;
    const selected = stats.memoriesSelected || 0;
    const tokens = stats.estimatedTokens || 0;

    this._write('\n');

    if (selected > 0) {
      this._write(`  loaded: ${selected} memories, ${tokens} tokens\n`);

      // Show breakdown by source
      if (stats.bySource && Object.keys(stats.bySource).length > 0) {
        const sources = Object.entries(stats.bySource)
          .filter(([, count]) => count > 0)
          .map(([source, count]) => `${SOURCE_LABELS[source] || source}:${count}`)
          .join(' | ');
        this._write(`  sources: ${sources}\n`);
      }

      // Show breakdown by type
      if (stats.byType && Object.keys(stats.byType).length > 0) {
        const types = Object.entries(stats.byType)
          .filter(([, count]) => count > 0)
          .map(([type, count]) => `${type}:${count}`)
          .join(' | ');
        this._write(`  types: ${types}\n`);
      }
    } else {
      this._write('  ready (no relevant memories)\n');
    }

    this._write(`  time: ${duration}ms\n`);
    this._write('\n');
  }

  /**
   * Show error
   * @param {string} message
   */
  error(message) {
    this._write(`\n  error: ${message}\n\n`);
  }

  /**
   * Write to stderr
   * @param {string} text
   */
  _write(text) {
    process.stderr.write(text);
  }
}

// =============================================================================
// INJECTION FORMATTER
// =============================================================================

/**
 * Format memories for injection into Claude context
 */
class InjectionFormatter {
  /**
   * @param {Object} options
   * @param {string} options.format - 'neural', 'rich', 'compact', 'xml', 'markdown'
   * @param {string} options.theme - Neural theme name (nodes, branches, waves, minimal)
   * @param {boolean} options.includeSourceInfo - Include source attribution
   * @param {boolean} options.includeRelevance - Include relevance scores
   */
  constructor(options = {}) {
    this.formatType = options.format || 'neural';
    this.theme = options.theme || null;
    this.includeSourceInfo = options.includeSourceInfo !== false;
    this.includeRelevance = options.includeRelevance !== false;

    // Create neural formatter if available and requested
    if (this.formatType === 'neural' && NeuralFormatter) {
      this.neuralFormatter = new NeuralFormatter({
        theme: this.theme,
        includeColors: true,
      });
    }
  }

  /**
   * Format memories for injection
   * @param {Object[]} memories
   * @param {Object} context - Session context
   * @param {Object} stats - Query statistics
   * @returns {string}
   */
  formatMemories(memories, context = {}, stats = {}) {
    if (memories.length === 0) {
      return this._formatEmpty(context);
    }

    switch (this.formatType) {
      case 'neural':
        if (this.neuralFormatter) {
          return this.neuralFormatter.formatMemories(memories, context, stats);
        }
        // Fall through to rich if neural not available
      case 'rich':
        return this._formatRich(memories, context, stats);
      case 'compact':
        return this._formatCompact(memories, context, stats);
      case 'xml':
        return this._formatXML(memories, context, stats);
      case 'markdown':
        return this._formatMarkdown(memories, context, stats);
      default:
        return this._formatRich(memories, context, stats);
    }
  }

  /**
   * Format empty result
   * @param {Object} context
   * @returns {string}
   */
  _formatEmpty(context) {
    const lines = ['<cortex-session>'];
    lines.push('  <status>ready</status>');
    lines.push('  <memories count="0" />');

    if (context.projectName) {
      lines.push(`  <project name="${this._escape(context.projectName)}" />`);
    }

    lines.push('</cortex-session>');
    return lines.join('\n');
  }

  /**
   * Rich format with visual hierarchy (ASCII-only for alignment)
   * @param {Object[]} memories
   * @param {Object} context
   * @param {Object} stats
   * @returns {string}
   */
  _formatRich(memories, context, stats) {
    const W = 65; // Fixed box width
    const lines = [];

    // Header
    lines.push('+' + '='.repeat(W) + '+');
    lines.push('|' + '     CORTEX v2.0.0 - Relevant Memories for This Session'.padEnd(W) + '|');
    lines.push('+' + '='.repeat(W) + '+');

    // Stats summary
    const statsLine = '  ' + this._buildStatsLine(memories, stats);
    lines.push('|' + statsLine.padEnd(W) + '|');
    lines.push('+' + '='.repeat(W) + '+');
    lines.push('');

    // Group memories by type
    const byType = this._groupByType(memories);

    for (const [type, typeMemories] of Object.entries(byType)) {
      const icon = ICONS[type] || ICONS.general;
      const label = TYPE_LABELS[type] || type;

      const sectionHeader = `-- ${icon} ${label.toUpperCase()} (${typeMemories.length}) `;
      lines.push('+' + sectionHeader + '-'.repeat(W - sectionHeader.length) + '+');
      lines.push('|' + ' '.repeat(W) + '|');

      for (const memory of typeMemories) {
        const formattedMemory = this._formatSingleMemory(memory, 'rich');
        for (const line of formattedMemory.split('\n')) {
          const trimmedLine = '  ' + line;
          // Wrap long lines
          if (trimmedLine.length <= W) {
            lines.push('|' + trimmedLine.padEnd(W) + '|');
          } else {
            lines.push('|' + trimmedLine.substring(0, W - 3) + '...|');
          }
        }
        lines.push('|' + ' '.repeat(W) + '|');
      }

      lines.push('+' + '-'.repeat(W) + '+');
      lines.push('');
    }

    // Footer with context
    if (context.projectName || context.domains?.length || context.tags?.length) {
      lines.push('+-- Session Context ' + '-'.repeat(W - 19) + '+');

      if (context.projectName) {
        const projLine = `  Project: ${context.projectName} (${context.projectType || 'unknown'})`;
        lines.push('|' + projLine.padEnd(W) + '|');
      }

      if (context.gitBranch) {
        const gitLine = `  Git Branch: ${context.gitBranch}`;
        lines.push('|' + gitLine.padEnd(W) + '|');
      }

      if (context.domains?.length) {
        const domLine = `  Domains: ${context.domains.join(', ')}`;
        lines.push('|' + domLine.padEnd(W) + '|');
      }

      if (context.tags?.length) {
        const tagLine = `  Tags: ${context.tags.slice(0, 8).join(', ')}`;
        lines.push('|' + tagLine.padEnd(W) + '|');
      }

      lines.push('+' + '-'.repeat(W) + '+');
    }

    return lines.join('\n');
  }

  /**
   * Compact format (less visual, more content)
   * @param {Object[]} memories
   * @param {Object} context
   * @param {Object} stats
   * @returns {string}
   */
  _formatCompact(memories, context, stats) {
    const lines = [];

    lines.push('<cortex-memories>');
    lines.push(`<!-- Cortex v2.0.0 | ${memories.length} memories | ${stats.estimatedTokens || 0} tokens -->`);
    lines.push('');

    const byType = this._groupByType(memories);

    for (const [type, typeMemories] of Object.entries(byType)) {
      lines.push(`## ${TYPE_LABELS[type] || type}`);

      for (const memory of typeMemories) {
        const source = memory._source ? ` [${SOURCE_LABELS[memory._source] || memory._source}]` : '';
        const content = memory.summary || memory.content || '';
        lines.push(`- ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}${source}`);
      }

      lines.push('');
    }

    lines.push('</cortex-memories>');
    return lines.join('\n');
  }

  /**
   * XML format (best for Claude parsing)
   * @param {Object[]} memories
   * @param {Object} context
   * @param {Object} stats
   * @returns {string}
   */
  _formatXML(memories, context, stats) {
    const lines = [];

    lines.push('<cortex-session version="2.0.0">');
    lines.push(`  <stats memories="${memories.length}" tokens="${stats.estimatedTokens || 0}" />`);

    // Context
    if (context.projectName) {
      lines.push('  <context>');
      lines.push(`    <project name="${this._escape(context.projectName)}" type="${context.projectType || ''}" />`);
      if (context.gitBranch) {
        lines.push(`    <git branch="${this._escape(context.gitBranch)}" />`);
      }
      if (context.domains?.length) {
        lines.push(`    <domains>${context.domains.join(', ')}</domains>`);
      }
      lines.push('  </context>');
    }

    // Memories by type
    lines.push('  <memories>');

    const byType = this._groupByType(memories);

    for (const [type, typeMemories] of Object.entries(byType)) {
      lines.push(`    <${type}-memories count="${typeMemories.length}">`);

      for (const memory of typeMemories) {
        const attrs = [];

        if (this.includeRelevance && memory.relevanceScore) {
          attrs.push(`relevance="${(memory.relevanceScore * 100).toFixed(0)}%"`);
        }

        if (this.includeSourceInfo && memory._source) {
          attrs.push(`source="${memory._source}"`);
        }

        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

        lines.push(`      <memory${attrStr}>`);

        if (memory.summary) {
          lines.push(`        <summary>${this._escape(memory.summary)}</summary>`);
        }

        if (memory.content && memory.content !== memory.summary) {
          lines.push(`        <content>${this._escape(memory.content)}</content>`);
        }

        if (memory.tags?.length) {
          lines.push(`        <tags>${memory.tags.join(', ')}</tags>`);
        }

        lines.push('      </memory>');
      }

      lines.push(`    </${type}-memories>`);
    }

    lines.push('  </memories>');
    lines.push('</cortex-session>');

    return lines.join('\n');
  }

  /**
   * Markdown format
   * @param {Object[]} memories
   * @param {Object} context
   * @param {Object} stats
   * @returns {string}
   */
  _formatMarkdown(memories, context, stats) {
    const lines = [];

    lines.push('# Cortex Session Memory');
    lines.push('');
    lines.push(`> ${memories.length} memories loaded | ~${stats.estimatedTokens || 0} tokens`);
    lines.push('');

    const byType = this._groupByType(memories);

    for (const [type, typeMemories] of Object.entries(byType)) {
      const icon = ICONS[type] || ICONS.general;
      const label = TYPE_LABELS[type] || type;

      lines.push(`## ${icon} ${label} (${typeMemories.length})`);
      lines.push('');

      for (const memory of typeMemories) {
        const source = memory._source ? `*[${SOURCE_LABELS[memory._source] || memory._source}]*` : '';
        const relevance = memory.relevanceScore ? `(${(memory.relevanceScore * 100).toFixed(0)}%)` : '';

        lines.push(`### ${source} ${relevance}`);

        if (memory.summary) {
          lines.push(memory.summary);
        }

        if (memory.content && memory.content !== memory.summary) {
          lines.push('');
          lines.push('```');
          lines.push(memory.content);
          lines.push('```');
        }

        if (memory.tags?.length) {
          lines.push('');
          lines.push(`Tags: \`${memory.tags.join('`, `')}\``);
        }

        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single memory entry
   * @param {Object} memory
   * @param {string} style
   * @returns {string}
   */
  _formatSingleMemory(memory, style = 'rich') {
    const lines = [];

    // Relevance indicator
    if (this.includeRelevance && memory.relevanceScore) {
      const pct = (memory.relevanceScore * 100).toFixed(0);
      const bar = this._relevanceBar(memory.relevanceScore);
      lines.push(`${bar} ${pct}%`);
    }

    // Content
    const content = memory.summary || memory.content || '';
    const maxLen = style === 'rich' ? 300 : 150;
    const truncated = content.length > maxLen ? content.substring(0, maxLen) + '...' : content;
    lines.push(truncated);

    // Source attribution
    if (this.includeSourceInfo && memory._source) {
      const sourceLabel = SOURCE_LABELS[memory._source] || memory._source;
      lines.push(`     from: ${sourceLabel}`);
    }

    // Tags
    if (memory.tags?.length && style === 'rich') {
      lines.push(`     tags: ${memory.tags.slice(0, 5).join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Build stats summary line
   * @param {Object[]} memories
   * @param {Object} stats
   * @returns {string}
   */
  _buildStatsLine(memories, stats) {
    const parts = [];

    parts.push(`${memories.length} memories`);

    if (stats.estimatedTokens) {
      parts.push(`~${stats.estimatedTokens} tokens`);
    }

    // Count unique sources
    const sources = new Set(memories.map(m => m._source?.split(':')[0]).filter(Boolean));
    if (sources.size > 0) {
      parts.push(`from ${sources.size} source${sources.size > 1 ? 's' : ''}`);
    }

    return parts.join(' | ');
  }

  /**
   * Group memories by type
   * @param {Object[]} memories
   * @returns {Object}
   */
  _groupByType(memories) {
    const byType = {};

    for (const memory of memories) {
      const type = memory.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(memory);
    }

    // Sort by priority: skill > pattern > learning > correction > preference > general
    const priority = ['skill', 'pattern', 'learning', 'correction', 'preference', 'general'];
    const sorted = {};

    for (const type of priority) {
      if (byType[type]) {
        sorted[type] = byType[type];
      }
    }

    // Add any remaining types
    for (const type of Object.keys(byType)) {
      if (!sorted[type]) {
        sorted[type] = byType[type];
      }
    }

    return sorted;
  }

  /**
   * Create a visual relevance bar (ASCII only for alignment)
   * @param {number} score - 0-1
   * @returns {string}
   */
  _relevanceBar(score) {
    const filled = Math.round(score * 5);
    const empty = 5 - filled;
    return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
  }

  /**
   * Escape special characters for XML
   * @param {string} str
   * @returns {string}
   */
  _escape(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Core classes
  ProgressDisplay,
  InjectionFormatter,

  // Neural visuals (re-exported for convenience)
  NeuralProgressDisplay,
  NeuralFormatter,
  NeuralAnimator,
  ThemeManager,

  // Constants
  ICONS,
  TYPE_LABELS,
  SOURCE_LABELS,
  VERSION,
};
