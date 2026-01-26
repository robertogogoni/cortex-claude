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
 * @version 2.0.0
 *
 * v2.0.0 - Added:
 *   - 100+ funny brain/memory/neural phrases
 *   - Claude-like color pulsation (breathing effect)
 *   - Phrase shuffling for variety each session
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
  normal: '\x1b[22m', // Remove bold/dim

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

  // Bright foreground colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
};

// =============================================================================
// COLOR PULSATION SYSTEM (Claude-like breathing effect)
// =============================================================================

/**
 * Creates pulsating color effect by cycling through brightness levels
 * States: dim → normal → bright → normal → (repeat)
 */
const PULSE_STATES = ['dim', 'normal', 'bright', 'normal'];

/**
 * Get color with pulsation applied
 * @param {string} baseColor - Base color name (e.g., 'cyan')
 * @param {number} pulseIndex - Current pulse frame (0-3)
 * @returns {string} ANSI escape sequence with pulsation
 */
function getPulsedColor(baseColor, pulseIndex) {
  const state = PULSE_STATES[pulseIndex % PULSE_STATES.length];
  const colorCode = COLORS[baseColor] || COLORS.cyan;

  switch (state) {
    case 'dim':
      return COLORS.dim + colorCode;
    case 'bright':
      // Use bright variant if available, otherwise bold
      const brightKey = 'bright' + baseColor.charAt(0).toUpperCase() + baseColor.slice(1);
      return COLORS[brightKey] || (COLORS.bold + colorCode);
    default:
      return colorCode;
  }
}

// Helper to colorize text
const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// =============================================================================
// NEURAL PHRASES
// =============================================================================

const NEURAL_PHRASES = [
  // === Core Neural Made-Up Words ===
  'synapsifying',
  'neuralizing',
  'dendritifying',
  'axonulating',
  'cortexicating',
  'cerebrumbling',
  'hippocampusing',
  'thalamogrifying',
  'maborifying',
  'cognitating',
  'mentalizating',
  'intelligenating',

  // === Memory-Themed Made-Up Words ===
  'rememorizating',
  'memorphosing',
  'recollectifying',
  'remindulating',
  'unforgettifying',
  'nostalgifying',
  'flashbackulating',
  'déjà-viewing',
  'amnesiating',
  'forgetamajig',

  // === Brain Activity Words ===
  'brainulating',
  'thoughticating',
  'ponderificating',
  'contemplorizing',
  'meditationizing',
  'ruminimagining',
  'deliberatifying',
  'speculatronics',
  'hypothesifying',
  'theoremulating',

  // === Neural Network Jargon ===
  'backpropagulating',
  'gradient-descending',
  'overfittinating',
  'embeddingizing',
  'tokenomifying',
  'attentionating',
  'transformerizing',
  'vectorspacifying',
  'weightadjusting',
  'biasmitigating',

  // === Silly Brain Words ===
  'brainstormulating',
  'mindmeldifying',
  'thinkamabobbing',
  'nogginfogging',
  'skullduggering',
  'craniuminating',
  'greymattering',
  'wrinkledeepening',
  'noodlescratching',
  'headscratchtastic',

  // === Technical-Sounding Nonsense ===
  'cognomorphing',
  'neurofluxing',
  'synaptogenesizing',
  'dendriticulating',
  'myelinopolishing',
  'neurotransmitting',
  'dopaminergizing',
  'serotoninifying',
  'endorphinating',
  'acetylcholinating',

  // === Memory Palace Words ===
  'palacetraveling',
  'locimethodizing',
  'mnemonicizing',
  'memorypalacing',
  'spatialrecalling',
  'mentalwandering',
  'thoughtmapping',
  'mindpalaceifying',
  'associationating',
  'linkagesysteming',

  // === Forgetfulness Words ===
  'wherewasiing',
  'tipoftonguing',
  'blankmomenting',
  'brainfartifying',
  'seniormomentizing',
  'oopsiforgotting',
  'waitwhatting',
  'ummmletmethinking',
  'holdonasecondizing',
  'itllcometomeing',

  // === Computer-Brain Fusion ===
  'RAMexpanding',
  'cacherefreshing',
  'bufferoverflowing',
  'stackunwinding',
  'heapdefragmenting',
  'garbagecollecting',
  'memleakpatching',
  'contextloading',
  'registershuffling',
  'bitfliprecovering',

  // === Quantum Brain Words ===
  'quantumthinking',
  'superpositionating',
  'entanglementizing',
  'wavefunctionizing',
  'probabilitating',
  'uncertaintifying',
  'schrodingerizing',
  'coherencemaintaining',
  'decoherencefighting',
  'qubitmultiplying',

  // === Cortex-Specific Words ===
  'cortexifying',
  'memorybanking',
  'knowledgegraphing',
  'semanticscanning',
  'episodicrecalling',
  'proceduralloading',
  'workingmemorying',
  'longtermpotentiating',
  'neuralplasticizing',
  'synapticpruning',

  // === Extra Whimsical ===
  'thinkothonking',
  'brainzapping',
  'ideasplosioning',
  'eureka-ing',
  'lightbulbmoment',
  'ahaerupting',
  'epiphanizing',
  'revelationating',
  'insightbursting',
  'wisdomdownloading',
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
    this.pulseColorIndex = 0; // For color pulsation effect
    this.intervalId = null;
    this.isRunning = false;
    this.shuffledPhrases = this._shufflePhrases(); // Randomize phrases each session
  }

  /**
   * Shuffle phrases for variety (Fisher-Yates shuffle)
   */
  _shufflePhrases() {
    const phrases = [...NEURAL_PHRASES];
    for (let i = phrases.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [phrases[i], phrases[j]] = [phrases[j], phrases[i]];
    }
    return phrases;
  }

  /**
   * Get pulse frame with colors and pulsation applied
   */
  _renderPulseFrame(frameIndex) {
    const frame = this.theme.pulseFrames[frameIndex % this.theme.pulseFrames.length];
    const colors = this.theme.colors;

    // Apply colors to the pattern with pulsation on active elements
    let colored = frame.pattern;
    const pulsedAccent = getPulsedColor(colors.accent, this.pulseColorIndex);
    const pulsedPrimary = getPulsedColor(colors.primary, this.pulseColorIndex);

    // Color the active node with pulsation
    colored = colored.replace(/●/g, pulsedAccent + '●' + COLORS.reset);
    colored = colored.replace(/○/g, pulsedPrimary + '○' + COLORS.reset);
    colored = colored.replace(/[─┬┴├┤┼╭╮╰╯│]/g, match => c(colors.secondary, match));
    colored = colored.replace(/[∿≋∾≈·]/g, match => c(colors.secondary, match));

    return colored;
  }

  /**
   * Get current phrase with pulsating color
   */
  _getCurrentPhrase() {
    return this.shuffledPhrases[this.phraseIndex % this.shuffledPhrases.length];
  }

  /**
   * Render a single animation frame with Claude-like color pulsation
   */
  renderFrame() {
    const pulse = this._renderPulseFrame(this.frameIndex);
    const phrase = this._getCurrentPhrase();
    const colors = this.theme.colors;

    // Apply pulsation to the phrase text (Claude-like breathing effect)
    const pulsedPhrase = getPulsedColor(colors.primary, this.pulseColorIndex) + phrase + COLORS.reset;
    const dots = getPulsedColor(colors.secondary, this.pulseColorIndex) + '...' + COLORS.reset;

    return `${pulse}  ${pulsedPhrase}${dots}`;
  }

  /**
   * Start animated loading display with color pulsation
   * @param {Function} onFrame - Callback for each frame
   * @param {number} interval - Frame interval in ms
   */
  start(onFrame, interval = 120) {
    if (this.isRunning) return;

    this.isRunning = true;
    this.frameIndex = 0;
    this.phraseIndex = 0;
    this.pulseColorIndex = 0;

    // Initial frame
    onFrame(this.renderFrame());

    this.intervalId = setInterval(() => {
      this.frameIndex++;
      this.pulseColorIndex++; // Advance color pulsation every frame

      // Change phrase every 6 frames (slightly slower for readability with more phrases)
      if (this.frameIndex % 6 === 0) {
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
  PULSE_STATES,

  // Helpers
  colorize: c,
  getPulsedColor,
};
