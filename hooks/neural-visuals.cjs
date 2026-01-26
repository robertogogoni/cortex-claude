#!/usr/bin/env node
/**
 * Cortex Neural Visuals System
 *
 * Dynamic neural-themed visual feedback with:
 * - 4 rotating themes (nodes, branches, waves, minimal)
 * - Pulsing animations simulating neural activity
 * - Color-matched palettes for each theme
 * - Phrase cycling during loading states
 *
 * @version 1.0.0
 */

'use strict';

// =============================================================================
// ANSI COLOR CODES
// =============================================================================

const COLORS = {
  // Reset
  reset: '\x1b[0m',

  // Styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
};

// Helper to colorize text
const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// =============================================================================
// NEURAL PHRASES
// =============================================================================

const NEURAL_PHRASES = [
  'synapses firing',
  'retrieving patterns',
  'connecting memories',
  'forming associations',
  'neural pathways active',
  'dendrites reaching',
  'axons transmitting',
  'cortex processing',
  'neurons awakening',
  'memory consolidating',
  'patterns emerging',
  'signals propagating',
];

// =============================================================================
// THEME DEFINITIONS
// =============================================================================

const THEMES = {
  // Theme A: Neural Network Nodes
  nodes: {
    name: 'Neural Nodes',
    colors: {
      primary: 'cyan',
      secondary: 'gray',
      accent: 'yellow',
      text: 'white',
    },
    // Pulse frames showing signal traveling through nodes
    pulseFrames: [
      { pattern: '●──○──○──○', active: 0 },
      { pattern: '○──●──○──○', active: 1 },
      { pattern: '○──○──●──○', active: 2 },
      { pattern: '○──○──○──●', active: 3 },
      { pattern: '○──○──●──○', active: 2 },
      { pattern: '○──●──○──○', active: 1 },
    ],
    header: (width) => {
      const w = width || 50;
      return [
        c('cyan', '○') + c('gray', '──') + c('cyan', '○') + c('gray', '──') + c('cyan', '○') + c('gray', '──') + c('cyan', '○') + c('gray', '──') + c('cyan', '○'),
        c('gray', '│') + '  ' + c('brightWhite', 'CORTEX') + c('gray', ' · Neural Memory System') + '  ' + c('gray', '│'),
        c('cyan', '○') + c('gray', '──') + c('cyan', '○') + c('gray', '──') + c('cyan', '○') + c('gray', '──') + c('cyan', '○') + c('gray', '──') + c('cyan', '○'),
      ];
    },
    sectionStart: (title, count) => {
      return c('cyan', '●') + c('gray', '──[') + c('yellow', ` ${title} `) + c('gray', `(${count})`) + c('gray', ']──');
    },
    sectionEnd: () => c('gray', '   └──○'),
    memoryBullet: () => c('cyan', '   ├─○ '),
    memoryLast: () => c('cyan', '   └─● '),
    footer: () => c('gray', '○──○──○──○──○'),
  },

  // Theme B: Synaptic Branches
  branches: {
    name: 'Synaptic Branches',
    colors: {
      primary: 'magenta',
      secondary: 'blue',
      accent: 'cyan',
      text: 'white',
    },
    pulseFrames: [
      { pattern: '╭──┬──┬──╮', active: 0 },
      { pattern: '├──┼──┼──┤', active: 1 },
      { pattern: '╰──┴──┴──╯', active: 2 },
      { pattern: '├──┼──┼──┤', active: 1 },
    ],
    header: (width) => {
      return [
        c('magenta', '    ╭─────────────────────────────────╮'),
        c('magenta', '╭───┤') + c('brightWhite', '         CORTEX v2.0.0          ') + c('magenta', '├───╮'),
        c('magenta', '│   ╰─────────────────────────────────╯   │'),
        c('magenta', '╰──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──╯'),
        c('blue', '   ╰──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──╯'),
      ];
    },
    sectionStart: (title, count) => {
      return c('magenta', '╭──┤ ') + c('cyan', title) + c('gray', ` (${count})`) + c('magenta', ' ├' + '─'.repeat(20));
    },
    sectionEnd: () => c('magenta', '╰──┴─────────────────────'),
    memoryBullet: () => c('blue', '│  ├─ '),
    memoryLast: () => c('blue', '│  ╰─ '),
    footer: () => c('magenta', '   ╰──┴──┴──╯'),
  },

  // Theme C: Brain Waves
  waves: {
    name: 'Brain Waves',
    colors: {
      primary: 'blue',
      secondary: 'cyan',
      accent: 'brightWhite',
      text: 'white',
    },
    pulseFrames: [
      { pattern: '∿∿∿≋≋≋∿∿∿', active: 0 },
      { pattern: '≋≋≋∿∿∿≋≋≋', active: 1 },
      { pattern: '∾∾∾≈≈≈∾∾∾', active: 2 },
      { pattern: '≈≈≈∾∾∾≈≈≈', active: 3 },
    ],
    header: (width) => {
      return [
        c('blue', '∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿'),
        c('cyan', '≋≋≋') + '  ' + c('brightWhite', 'CORTEX') + c('gray', ' · ') + c('cyan', 'Neural Memory System') + '  ' + c('cyan', '≋≋≋'),
        c('blue', '∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿'),
      ];
    },
    sectionStart: (title, count) => {
      return c('blue', '∿∿∿ ') + c('brightWhite', title) + c('gray', ` (${count})`) + c('blue', ' ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿');
    },
    sectionEnd: () => c('cyan', '≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋≋'),
    memoryBullet: () => c('cyan', '  ≋ '),
    memoryLast: () => c('blue', '  ∿ '),
    footer: () => c('blue', '∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿'),
  },

  // Theme D: Minimal Neural
  minimal: {
    name: 'Minimal Neural',
    colors: {
      primary: 'white',
      secondary: 'gray',
      accent: 'cyan',
      text: 'white',
    },
    pulseFrames: [
      { pattern: '· · ● · ·', active: 2 },
      { pattern: '· ● · · ·', active: 1 },
      { pattern: '● · · · ·', active: 0 },
      { pattern: '· ● · · ·', active: 1 },
      { pattern: '· · ● · ·', active: 2 },
      { pattern: '· · · ● ·', active: 3 },
      { pattern: '· · · · ●', active: 4 },
      { pattern: '· · · ● ·', active: 3 },
    ],
    header: (width) => {
      return [
        c('gray', '· · · · · · · · · · · · · · · · · · · · ·'),
        c('gray', '·') + '  ' + c('white', 'cortex') + c('gray', ' · ') + c('cyan', 'v2.0.0') + '  ' + c('gray', '·'),
        c('gray', '· · · · · · · · · · · · · · · · · · · · ·'),
      ];
    },
    sectionStart: (title, count) => {
      return c('gray', '· · ') + c('cyan', '─') + c('white', ` ${title}`) + c('gray', ` (${count})`) + c('cyan', ' ─') + c('gray', ' · ·');
    },
    sectionEnd: () => c('gray', '· · · · · · · · · ·'),
    memoryBullet: () => c('gray', '  · '),
    memoryLast: () => c('cyan', '  · '),
    footer: () => c('gray', '· · · · · · · · · · · · · · · · · · · · ·'),
  },
};

// Theme order for rotation
const THEME_ORDER = ['nodes', 'branches', 'waves', 'minimal'];

// =============================================================================
// THEME MANAGER
// =============================================================================

class ThemeManager {
  constructor() {
    this.themes = THEMES;
    this.themeOrder = THEME_ORDER;
    this.currentThemeIndex = this._loadThemeIndex();
  }

  /**
   * Load theme index from file or start fresh
   */
  _loadThemeIndex() {
    const fs = require('fs');
    const path = require('path');
    const stateFile = path.join(__dirname, '../data/theme-state.json');

    try {
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return (state.lastIndex + 1) % this.themeOrder.length;
      }
    } catch (e) {
      // Ignore errors, start fresh
    }
    return 0;
  }

  /**
   * Save current theme index
   */
  _saveThemeIndex() {
    const fs = require('fs');
    const path = require('path');
    const stateFile = path.join(__dirname, '../data/theme-state.json');

    try {
      fs.writeFileSync(stateFile, JSON.stringify({
        lastIndex: this.currentThemeIndex,
        lastTheme: this.themeOrder[this.currentThemeIndex],
        timestamp: new Date().toISOString(),
      }, null, 2));
    } catch (e) {
      // Ignore write errors
    }
  }

  /**
   * Get current theme (rotates each session)
   */
  getCurrentTheme() {
    const themeName = this.themeOrder[this.currentThemeIndex];
    this._saveThemeIndex();
    return this.themes[themeName];
  }

  /**
   * Get theme by name
   */
  getTheme(name) {
    return this.themes[name] || this.themes.nodes;
  }

  /**
   * Get all available themes
   */
  getAllThemes() {
    return this.themeOrder.map(name => ({
      name,
      ...this.themes[name],
    }));
  }
}

// =============================================================================
// NEURAL ANIMATOR
// =============================================================================

class NeuralAnimator {
  constructor(options = {}) {
    this.theme = options.theme || THEMES.nodes;
    this.frameIndex = 0;
    this.phraseIndex = 0;
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Get pulse frame with colors applied
   */
  _renderPulseFrame(frameIndex) {
    const frame = this.theme.pulseFrames[frameIndex % this.theme.pulseFrames.length];
    const colors = this.theme.colors;

    // Apply colors to the pattern
    let colored = frame.pattern;

    // Color the active node
    colored = colored.replace(/●/g, c(colors.accent, '●'));
    colored = colored.replace(/○/g, c(colors.primary, '○'));
    colored = colored.replace(/[─┬┴├┤┼╭╮╰╯│]/g, match => c(colors.secondary, match));
    colored = colored.replace(/[∿≋∾≈·]/g, match => c(colors.secondary, match));

    return colored;
  }

  /**
   * Get current phrase
   */
  _getCurrentPhrase() {
    return NEURAL_PHRASES[this.phraseIndex % NEURAL_PHRASES.length];
  }

  /**
   * Render a single animation frame
   */
  renderFrame() {
    const pulse = this._renderPulseFrame(this.frameIndex);
    const phrase = this._getCurrentPhrase();
    const colors = this.theme.colors;

    return `${pulse}  ${c(colors.secondary, phrase)}...`;
  }

  /**
   * Start animated loading display
   * @param {Function} onFrame - Callback for each frame
   * @param {number} interval - Frame interval in ms
   */
  start(onFrame, interval = 150) {
    if (this.isRunning) return;

    this.isRunning = true;
    this.frameIndex = 0;
    this.phraseIndex = 0;

    // Initial frame
    onFrame(this.renderFrame());

    this.intervalId = setInterval(() => {
      this.frameIndex++;

      // Change phrase every 4 frames
      if (this.frameIndex % 4 === 0) {
        this.phraseIndex++;
      }

      onFrame(this.renderFrame());
    }, interval);
  }

  /**
   * Stop animation
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }
}

// =============================================================================
// NEURAL PROGRESS DISPLAY
// =============================================================================

class NeuralProgressDisplay {
  constructor(options = {}) {
    this.themeManager = new ThemeManager();
    this.theme = options.theme
      ? this.themeManager.getTheme(options.theme)
      : this.themeManager.getCurrentTheme();
    this.animator = new NeuralAnimator({ theme: this.theme });
    this.verbose = options.verbose !== false;
    this.startTime = Date.now();
  }

  /**
   * Write to stderr
   */
  _write(text) {
    process.stderr.write(text);
  }

  /**
   * Clear current line and write
   */
  _overwrite(text) {
    process.stderr.write('\r\x1b[K' + text);
  }

  /**
   * Show header
   */
  showHeader() {
    const headerLines = this.theme.header();
    this._write('\n');
    for (const line of headerLines) {
      this._write(line + '\n');
    }
    this._write('\n');
  }

  /**
   * Start loading animation
   */
  startLoading() {
    this.animator.start((frame) => {
      this._overwrite('  ' + frame);
    }, 120);
  }

  /**
   * Stop loading animation
   */
  stopLoading() {
    this.animator.stop();
    this._overwrite('');
  }

  /**
   * Show section with memories
   */
  showSection(title, memories) {
    const count = memories.length;
    this._write(this.theme.sectionStart(title.toUpperCase(), count) + '\n');

    memories.forEach((memory, index) => {
      const isLast = index === memories.length - 1;
      const bullet = isLast ? this.theme.memoryLast() : this.theme.memoryBullet();
      const content = (memory.summary || memory.content || '').substring(0, 60);
      const truncated = content.length >= 60 ? content + '...' : content;

      this._write(bullet + c(this.theme.colors.text, truncated) + '\n');
    });

    this._write(this.theme.sectionEnd() + '\n\n');
  }

  /**
   * Show summary stats
   */
  showSummary(stats) {
    const duration = Date.now() - this.startTime;
    const colors = this.theme.colors;

    this._write(c(colors.secondary, '  ─────────────────────────────────\n'));
    this._write(`  ${c(colors.accent, stats.memoriesSelected || 0)} memories`);
    this._write(c(colors.secondary, ' · '));
    this._write(`${c(colors.primary, stats.estimatedTokens || 0)} tokens`);
    this._write(c(colors.secondary, ' · '));
    this._write(`${c(colors.secondary, duration + 'ms')}\n`);

    this._write('\n' + this.theme.footer() + '\n\n');
  }

  /**
   * Show error
   */
  showError(message) {
    this._write(c('red', `  ✗ Error: ${message}`) + '\n\n');
  }

  /**
   * Get current theme name
   */
  getThemeName() {
    return this.theme.name;
  }
}

// =============================================================================
// NEURAL FORMATTER (for injection output)
// =============================================================================

class NeuralFormatter {
  constructor(options = {}) {
    this.themeManager = new ThemeManager();
    this.theme = options.theme
      ? this.themeManager.getTheme(options.theme)
      : this.themeManager.getCurrentTheme();
    this.includeColors = options.includeColors !== false;
  }

  /**
   * Format memories for injection with neural styling
   */
  formatMemories(memories, context = {}, stats = {}) {
    if (memories.length === 0) {
      return this._formatEmpty(context);
    }

    const lines = [];
    const colors = this.theme.colors;

    // Header
    const headerLines = this.theme.header();
    lines.push(...headerLines);
    lines.push('');

    // Stats line
    const statsLine = `  ${memories.length} memories · ~${stats.estimatedTokens || 0} tokens`;
    lines.push(this.includeColors ? c(colors.secondary, statsLine) : statsLine);
    lines.push('');

    // Group by type
    const byType = this._groupByType(memories);

    for (const [type, typeMemories] of Object.entries(byType)) {
      lines.push(this.theme.sectionStart(type.toUpperCase(), typeMemories.length));

      typeMemories.forEach((memory, index) => {
        const isLast = index === typeMemories.length - 1;
        const bullet = isLast ? this.theme.memoryLast() : this.theme.memoryBullet();
        const content = (memory.summary || memory.content || '').substring(0, 200);
        const truncated = content.length >= 200 ? content + '...' : content;

        lines.push(bullet + truncated);

        if (memory.tags?.length) {
          const tagLine = '      ' + c(colors.secondary, 'tags: ') + memory.tags.slice(0, 5).join(', ');
          lines.push(tagLine);
        }
      });

      lines.push(this.theme.sectionEnd());
      lines.push('');
    }

    // Context footer
    if (context.projectName) {
      lines.push(c(colors.secondary, `  project: ${context.projectName}`));
    }
    if (context.gitBranch) {
      lines.push(c(colors.secondary, `  branch: ${context.gitBranch}`));
    }

    lines.push('');
    lines.push(this.theme.footer());

    return lines.join('\n');
  }

  /**
   * Format empty result
   */
  _formatEmpty(context) {
    const colors = this.theme.colors;
    const lines = this.theme.header();
    lines.push('');
    lines.push(c(colors.secondary, '  no relevant memories found'));
    lines.push('');
    lines.push(this.theme.footer());
    return lines.join('\n');
  }

  /**
   * Group memories by type
   */
  _groupByType(memories) {
    const byType = {};
    for (const memory of memories) {
      const type = memory.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(memory);
    }
    return byType;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Core classes
  ThemeManager,
  NeuralAnimator,
  NeuralProgressDisplay,
  NeuralFormatter,

  // Constants
  THEMES,
  THEME_ORDER,
  NEURAL_PHRASES,
  COLORS,

  // Helper
  colorize: c,
};
