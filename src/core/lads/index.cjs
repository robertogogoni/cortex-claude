/**
 * Cortex - Claude's Cognitive Layer - LADS Index
 *
 * Entry point for LADS (Learnable, Adaptive, Documenting, Self-improving) components.
 * Exports all LADS modules and provides factory functions for creating
 * pre-wired component instances.
 */

'use strict';

const { PatternTracker } = require('./pattern-tracker.cjs');
const { OutcomeScorer, SIGNAL_TYPES } = require('./outcome-scorer.cjs');
const { ConfigEvolver, EVOLUTION_RULES } = require('./config-evolver.cjs');
const { DocsWriter } = require('./docs-writer.cjs');

// =============================================================================
// LADS CORE ORCHESTRATOR
// =============================================================================

class LADSCore {
  /**
   * Orchestrates all LADS components with proper wiring
   * @param {Object} options
   * @param {string} options.basePath - Base path for LADS data
   * @param {boolean} options.enabled - Master enable switch
   */
  constructor(options = {}) {
    this.basePath = options.basePath || '~/.claude/memory';
    this.enabled = options.enabled !== false;
    this.initialized = false;

    // Components (lazy-initialized)
    this._patternTracker = null;
    this._outcomeScorer = null;
    this._configEvolver = null;
    this._docsWriter = null;
  }

  /**
   * Get pattern tracker (lazy)
   * @returns {PatternTracker}
   */
  get patternTracker() {
    if (!this._patternTracker) {
      this._patternTracker = new PatternTracker({
        decisionsPath: `${this.basePath}/data/patterns/decisions.jsonl`,
        outcomesPath: `${this.basePath}/data/patterns/outcomes.jsonl`,
      });
    }
    return this._patternTracker;
  }

  /**
   * Get outcome scorer (lazy)
   * @returns {OutcomeScorer}
   */
  get outcomeScorer() {
    if (!this._outcomeScorer) {
      this._outcomeScorer = new OutcomeScorer({
        patternTracker: this.patternTracker,
      });
    }
    return this._outcomeScorer;
  }

  /**
   * Get config evolver (lazy)
   * @returns {ConfigEvolver}
   */
  get configEvolver() {
    if (!this._configEvolver) {
      this._configEvolver = new ConfigEvolver({
        patternTracker: this.patternTracker,
        enabled: this.enabled,
      });
    }
    return this._configEvolver;
  }

  /**
   * Get docs writer (lazy)
   * @returns {DocsWriter}
   */
  get docsWriter() {
    if (!this._docsWriter) {
      this._docsWriter = new DocsWriter({
        docsPath: `${this.basePath}/docs`,
        enabled: this.enabled,
      });
    }
    return this._docsWriter;
  }

  /**
   * Initialize all LADS components
   * @returns {Promise<{success: boolean, components: Object}>}
   */
  async initialize() {
    const results = {
      patternTracker: { success: false },
      outcomeScorer: { success: true }, // No async init needed
      configEvolver: { success: true }, // No async init needed
      docsWriter: { success: true }, // No async init needed
    };

    try {
      // Initialize pattern tracker (loads from disk)
      results.patternTracker = await this.patternTracker.initialize();

      this.initialized = true;

      // Log initialization
      this.docsWriter.logEvent('LADS Core initialized', {
        component: 'LADSCore',
        message: `Initialized with ${results.patternTracker.decisions || 0} decisions, ${results.patternTracker.outcomes || 0} outcomes`,
      });

      return {
        success: results.patternTracker.success,
        components: results,
      };
    } catch (error) {
      console.error('[LADSCore] Initialization failed:', error.message);
      return {
        success: false,
        error: error.message,
        components: results,
      };
    }
  }

  /**
   * Track a decision and return tracking ID
   * @param {Object} input - Decision input
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async trackDecision(input) {
    if (!this.enabled) {
      return { success: false, reason: 'LADS disabled' };
    }

    const result = await this.patternTracker.trackDecision(input);

    if (result.success) {
      // Register with outcome scorer for later resolution
      this.outcomeScorer.registerDecision(result.id);
    }

    return result;
  }

  /**
   * Collect signal for a decision
   * @param {string} decisionId
   * @param {string} signalType
   * @param {Object} signalData
   */
  collectSignal(decisionId, signalType, signalData) {
    if (!this.enabled) return;
    this.outcomeScorer.collectSignal(decisionId, signalType, signalData);
  }

  /**
   * Resolve decision outcome (auto or explicit)
   * @param {string} decisionId
   * @param {Object} explicitOutcome - Optional explicit outcome
   * @returns {Promise<{success: boolean}>}
   */
  async resolveDecision(decisionId, explicitOutcome = null) {
    if (!this.enabled) {
      return { success: false, reason: 'LADS disabled' };
    }

    let outcome;

    if (explicitOutcome) {
      outcome = explicitOutcome;
    } else {
      // Auto-determine from signals
      outcome = this.outcomeScorer.determineUsefulness(decisionId);
    }

    const result = await this.patternTracker.resolveOutcome(decisionId, outcome);

    if (result.success) {
      // Log to docs
      const decision = this.patternTracker.decisionsStore.get(decisionId);
      if (decision) {
        this.docsWriter.addDecision({
          id: decisionId,
          title: `${decision.decisionType}: ${decision.choice}`,
          decisionType: decision.decisionType,
          context: decision.context,
          choice: decision.choice,
          alternatives: decision.alternatives,
          confidence: decision.confidence,
          outcome,
        });
      }
    }

    return result;
  }

  /**
   * Run evolution cycle
   * @param {boolean} dryRun
   * @returns {Object}
   */
  evolve(dryRun = false) {
    if (!this.enabled) {
      return { evolved: false, reason: 'LADS disabled' };
    }

    const result = this.configEvolver.evolve(dryRun);

    // Log evolutions
    if (result.evolved && !dryRun) {
      for (const change of result.applied) {
        this.docsWriter.logEvolution({
          rule: change.rule,
          configPath: change.configPath,
          oldValue: change.currentValue,
          newValue: change.proposedValue,
          reason: change.reason,
          confidence: change.confidence,
        });
      }
    }

    return result;
  }

  /**
   * Get detected patterns
   * @param {Object} options
   * @returns {Object[]}
   */
  detectPatterns(options = {}) {
    return this.patternTracker.detectPatterns(options);
  }

  /**
   * Get LADS statistics
   * @returns {Object}
   */
  getStats() {
    return {
      enabled: this.enabled,
      initialized: this.initialized,
      patternTracker: this.patternTracker.getStats(),
      outcomeScorer: this.outcomeScorer.getStats(),
      configEvolver: this.configEvolver.getStats(),
      docsWriter: this.docsWriter.getStats(),
    };
  }

  /**
   * Enable/disable LADS
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.configEvolver.setEnabled(enabled);
    this.docsWriter.setEnabled(enabled);
  }

  /**
   * Cleanup old data
   * @param {number} maxAgeDays
   * @returns {Promise<Object>}
   */
  async cleanup(maxAgeDays = 90) {
    const result = await this.patternTracker.cleanup(maxAgeDays);

    this.docsWriter.logEvent('LADS cleanup completed', {
      component: 'LADSCore',
      message: `Removed ${result.removed} old decisions`,
    });

    return result;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let ladsInstance = null;

function getLADSCore(options) {
  if (!ladsInstance) {
    ladsInstance = new LADSCore(options);
  }
  return ladsInstance;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Main orchestrator
  LADSCore,
  getLADSCore,

  // Individual components
  PatternTracker,
  OutcomeScorer,
  ConfigEvolver,
  DocsWriter,

  // Constants
  SIGNAL_TYPES,
  EVOLUTION_RULES,
};
