#!/usr/bin/env node
/**
 * Cortex - Onboarding System
 *
 * Handles first-run detection and guided setup for new users.
 * Shows welcome messages and helps users understand Cortex capabilities.
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONSTANTS
// =============================================================================

const ONBOARDING_MESSAGES = {
  welcome: `
╭─────────────────────────────────────────────────────────────────────╮
│                                                                     │
│  🧠 Welcome to CORTEX - Claude's Cognitive Layer                    │
│                                                                     │
│  Cortex gives Claude persistent memory across sessions.             │
│  Here's what you can do:                                            │
│                                                                     │
│  📚 Automatic Context Injection                                     │
│     Relevant memories are loaded at session start                   │
│                                                                     │
│  🔍 Query Memories                                                  │
│     Use \`cortex__query\` to search your memory bank                 │
│                                                                     │
│  💡 Learn New Things                                                │
│     Use \`cortex__learn\` to store insights and patterns            │
│                                                                     │
│  🤔 Deep Reflection                                                 │
│     Use \`cortex__reflect\` for meta-cognitive analysis             │
│                                                                     │
│  📊 Cost-Efficient Design                                           │
│     Haiku for fast queries (~$0.25/1M tokens)                       │
│     Sonnet for deep thinking (~$3/1M tokens)                        │
│                                                                     │
│  Tip: Run \`/cortex help\` for full documentation                    │
│                                                                     │
╰─────────────────────────────────────────────────────────────────────╯
`,

  quickTips: `
┌─ Quick Tips ─────────────────────────────────────────────────────────┐
│                                                                      │
│  • Cortex learns from your sessions automatically                    │
│  • Use \`cortex__recall\` to find specific memories by context        │
│  • Run \`cortex__consolidate\` weekly to clean up duplicates          │
│  • Check \`/cortex stats\` to monitor API usage                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
`,

  returning: `
┌─ 🧠 Cortex Ready ───────────────────────────────────────────────────┐
│                                                                      │
│  Memory system initialized. Run \`/cortex help\` for commands.        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
`,
};

// =============================================================================
// ONBOARDING CLASS
// =============================================================================

class OnboardingManager {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for Cortex data
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');
    this.stateFile = path.join(this.basePath, 'data', 'onboarding-state.json');
    this.state = this._loadState();
  }

  /**
   * Load onboarding state from file
   * @returns {Object}
   */
  _loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      }
    } catch (error) {
      // Ignore read errors, start fresh
    }

    return {
      firstRunCompleted: false,
      welcomeShown: false,
      tipsShown: false,
      sessionCount: 0,
      firstRunDate: null,
      lastSessionDate: null,
      version: '1.0.0',
    };
  }

  /**
   * Save onboarding state to file
   */
  _saveState() {
    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (error) {
      // Ignore write errors
      console.error('[Onboarding] Failed to save state:', error.message);
    }
  }

  /**
   * Check if this is the first run
   * @returns {boolean}
   */
  isFirstRun() {
    return !this.state.firstRunCompleted;
  }

  /**
   * Check if we should show tips (every 10 sessions after first run)
   * @returns {boolean}
   */
  shouldShowTips() {
    return this.state.sessionCount > 0 &&
           this.state.sessionCount % 10 === 0 &&
           !this.state.tipsShown;
  }

  /**
   * Check if returning after a long break (>7 days)
   * @returns {boolean}
   */
  isReturningAfterBreak() {
    if (!this.state.lastSessionDate) return false;

    const lastSession = new Date(this.state.lastSessionDate);
    const daysSinceLastSession = (Date.now() - lastSession.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceLastSession > 7;
  }

  /**
   * Get the appropriate onboarding message for this session
   * @returns {{ type: string, message: string } | null}
   */
  getOnboardingMessage() {
    if (this.isFirstRun()) {
      return {
        type: 'welcome',
        message: ONBOARDING_MESSAGES.welcome,
      };
    }

    if (this.shouldShowTips()) {
      return {
        type: 'tips',
        message: ONBOARDING_MESSAGES.quickTips,
      };
    }

    if (this.isReturningAfterBreak()) {
      return {
        type: 'returning',
        message: ONBOARDING_MESSAGES.returning,
      };
    }

    return null;
  }

  /**
   * Mark onboarding as complete and update session count
   */
  completeOnboarding() {
    const now = new Date().toISOString();

    if (!this.state.firstRunCompleted) {
      this.state.firstRunCompleted = true;
      this.state.firstRunDate = now;
      this.state.welcomeShown = true;
    }

    this.state.sessionCount++;
    this.state.lastSessionDate = now;

    // Reset tips shown flag after showing
    if (this.state.sessionCount % 10 === 0) {
      this.state.tipsShown = false;
    }

    this._saveState();
  }

  /**
   * Mark tips as shown for this cycle
   */
  markTipsShown() {
    this.state.tipsShown = true;
    this._saveState();
  }

  /**
   * Get session statistics
   * @returns {Object}
   */
  getStats() {
    return {
      sessionCount: this.state.sessionCount,
      firstRunDate: this.state.firstRunDate,
      lastSessionDate: this.state.lastSessionDate,
      daysSinceFirstRun: this.state.firstRunDate
        ? Math.floor((Date.now() - new Date(this.state.firstRunDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0,
    };
  }

  /**
   * Reset onboarding state (for testing)
   */
  reset() {
    this.state = {
      firstRunCompleted: false,
      welcomeShown: false,
      tipsShown: false,
      sessionCount: 0,
      firstRunDate: null,
      lastSessionDate: null,
      version: '1.0.0',
    };
    this._saveState();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  OnboardingManager,
  ONBOARDING_MESSAGES,
};

// CLI usage for testing
if (require.main === module) {
  const onboarding = new OnboardingManager();

  console.log('=== Onboarding State ===');
  console.log('Is first run:', onboarding.isFirstRun());
  console.log('Should show tips:', onboarding.shouldShowTips());
  console.log('Returning after break:', onboarding.isReturningAfterBreak());
  console.log('Stats:', onboarding.getStats());

  const message = onboarding.getOnboardingMessage();
  if (message) {
    console.log('\n=== Message to Show ===');
    console.log('Type:', message.type);
    console.log(message.message);
  } else {
    console.log('\nNo onboarding message to show.');
  }

  // Uncomment to test:
  // onboarding.reset();
  // console.log('\nReset complete. Run again to see first-run message.');
}
