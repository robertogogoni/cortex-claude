#!/usr/bin/env node
/**
 * Demo script for Cortex Neural Visuals
 *
 * Run this to see all 4 themes with pulsing animations
 *
 * Usage:
 *   node scripts/demo-neural-visuals.cjs           # Demo all themes
 *   node scripts/demo-neural-visuals.cjs nodes     # Demo specific theme
 *   node scripts/demo-neural-visuals.cjs --animate # Show animation only
 */

'use strict';

const {
  ThemeManager,
  NeuralAnimator,
  NeuralProgressDisplay,
  NeuralFormatter,
  THEMES,
  THEME_ORDER,
  colorize: c,
} = require('../hooks/neural-visuals.cjs');

// Sample memories for demo
const SAMPLE_MEMORIES = [
  {
    type: 'learning',
    content: 'Cortex uses dual-model architecture with Haiku for fast operations and Sonnet for deep reasoning',
    tags: ['architecture', 'haiku', 'sonnet'],
    relevanceScore: 0.95,
  },
  {
    type: 'learning',
    content: 'Auto-escalation formula: 0.4*complexity + 0.3*(1-confidence) + 0.3*task_type',
    tags: ['escalation', 'formula'],
    relevanceScore: 0.88,
  },
  {
    type: 'pattern',
    content: 'UserPromptSubmit hooks run before every prompt, ideal for memory injection',
    tags: ['hooks', 'injection'],
    relevanceScore: 0.82,
  },
  {
    type: 'pattern',
    content: 'Theme rotation persists state to theme-state.json for session continuity',
    tags: ['themes', 'persistence'],
    relevanceScore: 0.75,
  },
];

const SAMPLE_CONTEXT = {
  projectName: 'cortex',
  projectType: 'cognitive-layer',
  gitBranch: 'main',
};

const SAMPLE_STATS = {
  memoriesSelected: 4,
  estimatedTokens: 320,
};

// =============================================================================
// DEMO FUNCTIONS
// =============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demoTheme(themeName) {
  const theme = THEMES[themeName];
  if (!theme) {
    console.error(`Unknown theme: ${themeName}`);
    return;
  }

  console.log('\n' + '═'.repeat(50));
  console.log(c('brightWhite', `  THEME: ${theme.name.toUpperCase()}`));
  console.log('═'.repeat(50) + '\n');

  // Show header
  const headerLines = theme.header();
  for (const line of headerLines) {
    console.log(line);
  }
  console.log('');

  // Show pulse animation (brief)
  console.log(c('gray', '  Pulse animation:'));
  const animator = new NeuralAnimator({ theme });

  for (let i = 0; i < theme.pulseFrames.length * 2; i++) {
    process.stdout.write('\r  ' + animator.renderFrame());
    animator.frameIndex++;
    if (i % 4 === 3) animator.phraseIndex++;
    await sleep(150);
  }
  console.log('\n');

  // Show section formatting
  console.log(theme.sectionStart('LEARNINGS', 2));
  console.log(theme.memoryBullet() + 'First memory entry with important details...');
  console.log(theme.memoryLast() + 'Second memory entry showing patterns...');
  console.log(theme.sectionEnd());
  console.log('');

  // Show footer
  console.log(theme.footer());
  console.log('');
}

async function demoAllThemes() {
  console.log('\n');
  console.log(c('cyan', '╔══════════════════════════════════════════════════╗'));
  console.log(c('cyan', '║') + c('brightWhite', '      CORTEX NEURAL VISUALS DEMONSTRATION        ') + c('cyan', '║'));
  console.log(c('cyan', '╚══════════════════════════════════════════════════╝'));

  for (const themeName of THEME_ORDER) {
    await demoTheme(themeName);
    await sleep(500);
  }

  console.log('\n' + c('green', '✓ Demo complete! Themes rotate automatically each session.') + '\n');
}

async function demoAnimation(themeName = 'nodes') {
  const theme = THEMES[themeName] || THEMES.nodes;

  console.log('\n' + c('brightWhite', `  Neural Animation Demo (${theme.name})`));
  console.log(c('gray', '  Press Ctrl+C to stop\n'));

  const animator = new NeuralAnimator({ theme });

  let running = true;
  process.on('SIGINT', () => {
    running = false;
  });

  while (running) {
    process.stdout.write('\r  ' + animator.renderFrame() + '    ');
    animator.frameIndex++;
    if (animator.frameIndex % 4 === 0) animator.phraseIndex++;
    await sleep(120);
  }

  console.log('\n\n' + c('green', '✓ Animation stopped') + '\n');
}

async function demoFormatter(themeName = null) {
  console.log('\n' + c('brightWhite', '  Neural Formatter Output Demo') + '\n');

  const formatter = new NeuralFormatter({
    theme: themeName || undefined,
    includeColors: true,
  });

  const output = formatter.formatMemories(SAMPLE_MEMORIES, SAMPLE_CONTEXT, SAMPLE_STATS);
  console.log(output);
  console.log('');
}

async function demoProgress(themeName = null) {
  console.log('\n' + c('brightWhite', '  Neural Progress Display Demo') + '\n');

  const progress = new NeuralProgressDisplay({
    theme: themeName || undefined,
    verbose: true,
  });

  progress.showHeader();

  // Simulate loading
  progress.startLoading();
  await sleep(2000);
  progress.stopLoading();

  // Show sections
  const byType = {};
  for (const m of SAMPLE_MEMORIES) {
    const type = m.type || 'general';
    if (!byType[type]) byType[type] = [];
    byType[type].push(m);
  }

  for (const [type, memories] of Object.entries(byType)) {
    progress.showSection(type, memories);
  }

  progress.showSummary(SAMPLE_STATS);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Cortex Neural Visuals Demo

Usage:
  node scripts/demo-neural-visuals.cjs              Demo all themes
  node scripts/demo-neural-visuals.cjs <theme>      Demo specific theme
  node scripts/demo-neural-visuals.cjs --animate    Show animation only
  node scripts/demo-neural-visuals.cjs --formatter  Demo formatter output
  node scripts/demo-neural-visuals.cjs --progress   Demo progress display

Themes: ${THEME_ORDER.join(', ')}
`);
    return;
  }

  if (args.includes('--animate')) {
    const themeName = args.find(a => THEME_ORDER.includes(a));
    await demoAnimation(themeName);
    return;
  }

  if (args.includes('--formatter')) {
    const themeName = args.find(a => THEME_ORDER.includes(a));
    await demoFormatter(themeName);
    return;
  }

  if (args.includes('--progress')) {
    const themeName = args.find(a => THEME_ORDER.includes(a));
    await demoProgress(themeName);
    return;
  }

  const specificTheme = args.find(a => THEME_ORDER.includes(a));
  if (specificTheme) {
    await demoTheme(specificTheme);
    return;
  }

  await demoAllThemes();
}

main().catch(console.error);
