/**
 * Cortex - Claude's Cognitive Layer - Config Evolver
 *
 * LADS Principle: Self-improving
 * Evolves configuration based on patterns:
 * - Analyzes success patterns from PatternTracker
 * - Proposes safe configuration changes
 * - Applies changes with bounds checking
 * - Tracks evolution history
 */

'use strict';

const { generateId, getTimestamp, clamp } = require('../types.cjs');
const { getConfigManager } = require('../config.cjs');

// =============================================================================
// EVOLUTION RULES
// =============================================================================

/**
 * @typedef {Object} EvolutionRule
 * @property {string} name
 * @property {string} configPath
 * @property {string} description
 * @property {Function} condition - When to apply
 * @property {Function} calculate - How to calculate new value
 * @property {Object} bounds - Min/max values
 */

const EVOLUTION_RULES = [
  {
    name: 'threshold_adjustment',
    configPath: 'sessionStart.slots.maxTotal',
    description: 'Adjust max slots based on memory usage patterns',
    condition: (patterns, config) => {
      const slotPattern = patterns.find(p =>
        p.type === 'consistent_failure' && p.decisionType === 'slot_allocation'
      );
      return slotPattern && slotPattern.samples >= 10;
    },
    calculate: (patterns, currentValue, successRate) => {
      // If success rate is low, might need more slots
      if (successRate < 0.5) {
        return Math.min(currentValue + 1, 12);
      }
      // If very high success with current slots, might be able to reduce
      if (successRate > 0.9) {
        return Math.max(currentValue - 1, 4);
      }
      return currentValue;
    },
    bounds: { min: 4, max: 12 },
  },
  {
    name: 'injection_threshold',
    configPath: 'sessionEnd.extractionThreshold',
    description: 'Adjust extraction confidence threshold',
    condition: (patterns) => {
      const extractionPattern = patterns.find(p =>
        p.decisionType === 'extraction_decision'
      );
      return extractionPattern && extractionPattern.samples >= 20;
    },
    calculate: (patterns, currentValue, successRate) => {
      // If many extractions are failing, raise threshold
      if (successRate < 0.4) {
        return Math.min(currentValue + 0.05, 0.9);
      }
      // If extractions are very successful, maybe can lower threshold
      if (successRate > 0.85) {
        return Math.max(currentValue - 0.03, 0.5);
      }
      return currentValue;
    },
    bounds: { min: 0.5, max: 0.9 },
  },
  {
    name: 'source_priority',
    configPath: 'queryOrchestrator.sources',
    description: 'Adjust source priorities based on result quality',
    condition: (patterns) => {
      const sourcePattern = patterns.find(p =>
        p.decisionType === 'source_selection'
      );
      return sourcePattern && sourcePattern.samples >= 15;
    },
    calculate: (patterns, currentSources, sourceSuccessRates) => {
      // Adjust priorities based on success rates
      return currentSources.map(source => {
        const rate = sourceSuccessRates[source.name];
        if (rate !== undefined && rate !== null) {
          const adjustment = (rate - 0.5) * 0.1; // ±0.05 max
          return {
            ...source,
            priority: clamp(source.priority + adjustment, 0.1, 1.0),
          };
        }
        return source;
      });
    },
    bounds: { min: 0.1, max: 1.0 },
  },
  {
    name: 'relevance_weights',
    configPath: 'contextAnalyzer.weights',
    description: 'Adjust relevance scoring weights',
    condition: (patterns) => {
      const rankingPattern = patterns.find(p =>
        p.decisionType === 'relevance_scoring' || p.decisionType === 'memory_ranking'
      );
      return rankingPattern && rankingPattern.samples >= 25;
    },
    calculate: (patterns, currentWeights, weightSuccessRates) => {
      // Not implemented in base config, but would adjust weights here
      return currentWeights;
    },
    bounds: { min: 0.05, max: 0.4 },
  },
  {
    name: 'intent_boost',
    configPath: 'contextAnalyzer.intentBoosts',
    description: 'Boost successful intents',
    condition: (patterns) => {
      return patterns.some(p =>
        p.type === 'context_dependent' && p.decisionType === 'intent_classification'
      );
    },
    calculate: (patterns, currentBoosts, intentSuccessRates) => {
      const boosts = { ...currentBoosts };
      for (const [intent, rate] of Object.entries(intentSuccessRates || {})) {
        if (rate > 0.7) {
          boosts[intent] = (boosts[intent] || 0) + 0.05;
        } else if (rate < 0.3) {
          boosts[intent] = Math.max((boosts[intent] || 0) - 0.03, 0);
        }
      }
      return boosts;
    },
    bounds: { min: 0, max: 0.3 },
  },
];

// =============================================================================
// CONFIG EVOLVER
// =============================================================================

class ConfigEvolver {
  /**
   * @param {Object} options
   * @param {Object} options.patternTracker - PatternTracker instance
   * @param {boolean} options.enabled - Whether evolution is enabled
   * @param {number} options.minIntervalMs - Min time between evolutions
   * @param {number} options.minSamples - Min samples before evolving
   * @param {number} options.maxChangePercent - Max change per evolution
   */
  constructor(options = {}) {
    this.patternTracker = options.patternTracker;
    this.enabled = options.enabled !== false;
    this.minIntervalMs = options.minIntervalMs || 3600000; // 1 hour
    this.minSamples = options.minSamples || 20;
    this.maxChangePercent = options.maxChangePercent || 0.25;

    this.config = getConfigManager();
    this.lastEvolution = null;
    this.evolutionHistory = [];
    this.rules = [...EVOLUTION_RULES];
  }

  /**
   * Check if evolution can proceed
   * @returns {{canEvolve: boolean, reason: string}}
   */
  canEvolve() {
    if (!this.enabled) {
      return { canEvolve: false, reason: 'Evolution disabled' };
    }

    if (this.lastEvolution) {
      const elapsed = Date.now() - this.lastEvolution;
      if (elapsed < this.minIntervalMs) {
        return {
          canEvolve: false,
          reason: `Too soon since last evolution (${Math.round(elapsed / 60000)}m of ${Math.round(this.minIntervalMs / 60000)}m required)`,
        };
      }
    }

    return { canEvolve: true, reason: 'Ready for evolution' };
  }

  /**
   * Analyze patterns and propose changes
   * @returns {{proposals: Object[], reason: string}}
   */
  analyzeAndPropose() {
    const check = this.canEvolve();
    if (!check.canEvolve) {
      return { proposals: [], reason: check.reason };
    }

    if (!this.patternTracker) {
      return { proposals: [], reason: 'No pattern tracker available' };
    }

    // Get detected patterns
    const patterns = this.patternTracker.detectPatterns({
      minSamples: this.minSamples,
    });

    if (patterns.length === 0) {
      return { proposals: [], reason: 'No patterns detected' };
    }

    // Evaluate each rule
    const proposals = [];

    for (const rule of this.rules) {
      try {
        if (!rule.condition(patterns, this.config.getAll())) {
          continue;
        }

        const currentValue = this.config.get(rule.configPath);
        if (currentValue === undefined) continue;

        // Get success rate for this rule's decision type
        const relatedPatterns = patterns.filter(p =>
          p.decisionType && rule.description.toLowerCase().includes(p.decisionType.replace(/_/g, ' '))
        );

        const avgSuccessRate = relatedPatterns.length > 0
          ? relatedPatterns.reduce((sum, p) => sum + (p.contextRate || p.overallRate || 0.5), 0) / relatedPatterns.length
          : 0.5;

        const newValue = rule.calculate(patterns, currentValue, avgSuccessRate);

        // Check if change is within bounds
        if (newValue === currentValue) continue;

        // Calculate change percentage
        const numericCurrent = typeof currentValue === 'number' ? currentValue : 1;
        const numericNew = typeof newValue === 'number' ? newValue : 1;
        const changePercent = Math.abs(numericNew - numericCurrent) / numericCurrent;

        if (changePercent > this.maxChangePercent) {
          // Limit change to max percentage
          const direction = numericNew > numericCurrent ? 1 : -1;
          const limitedNew = numericCurrent + (numericCurrent * this.maxChangePercent * direction);

          proposals.push({
            rule: rule.name,
            configPath: rule.configPath,
            currentValue,
            proposedValue: typeof currentValue === 'number' ? limitedNew : newValue,
            originalProposal: newValue,
            limited: true,
            reason: `Based on ${relatedPatterns.length} patterns, success rate: ${(avgSuccessRate * 100).toFixed(1)}%`,
            confidence: Math.min(relatedPatterns.length / 10, 1) * avgSuccessRate,
          });
        } else {
          proposals.push({
            rule: rule.name,
            configPath: rule.configPath,
            currentValue,
            proposedValue: newValue,
            reason: `Based on ${relatedPatterns.length} patterns, success rate: ${(avgSuccessRate * 100).toFixed(1)}%`,
            confidence: Math.min(relatedPatterns.length / 10, 1) * avgSuccessRate,
          });
        }
      } catch (error) {
        console.error(`[ConfigEvolver] Rule ${rule.name} failed:`, error.message);
      }
    }

    return {
      proposals,
      reason: proposals.length > 0
        ? `${proposals.length} change(s) proposed based on ${patterns.length} patterns`
        : 'Patterns found but no changes applicable',
    };
  }

  /**
   * Apply proposed changes
   * @param {Object[]} proposals - From analyzeAndPropose()
   * @param {boolean} dryRun - If true, don't actually apply
   * @returns {{applied: Object[], skipped: Object[], reason: string}}
   */
  applyChanges(proposals, dryRun = false) {
    const applied = [];
    const skipped = [];

    for (const proposal of proposals) {
      // Validate bounds
      const rule = this.rules.find(r => r.name === proposal.rule);
      if (rule?.bounds) {
        const value = proposal.proposedValue;
        if (typeof value === 'number') {
          if (value < rule.bounds.min || value > rule.bounds.max) {
            skipped.push({
              ...proposal,
              skipReason: `Value ${value} outside bounds [${rule.bounds.min}, ${rule.bounds.max}]`,
            });
            continue;
          }
        }
      }

      if (dryRun) {
        applied.push({ ...proposal, dryRun: true });
        continue;
      }

      // Apply the change
      const result = this.config.set(
        proposal.configPath,
        proposal.proposedValue,
        `ConfigEvolver: ${proposal.rule} - ${proposal.reason}`
      );

      if (result.success) {
        applied.push(proposal);

        // Track in history
        this.evolutionHistory.push({
          id: generateId(),
          timestamp: getTimestamp(),
          rule: proposal.rule,
          configPath: proposal.configPath,
          oldValue: proposal.currentValue,
          newValue: proposal.proposedValue,
          reason: proposal.reason,
          confidence: proposal.confidence,
        });
      } else {
        skipped.push({
          ...proposal,
          skipReason: result.error,
        });
      }
    }

    if (applied.length > 0 && !dryRun) {
      this.lastEvolution = Date.now();
    }

    return {
      applied,
      skipped,
      reason: `Applied ${applied.length} change(s), skipped ${skipped.length}`,
    };
  }

  /**
   * Run full evolution cycle
   * @param {boolean} dryRun
   * @returns {Object}
   */
  evolve(dryRun = false) {
    const analysis = this.analyzeAndPropose();

    if (analysis.proposals.length === 0) {
      return {
        evolved: false,
        reason: analysis.reason,
        proposals: [],
        applied: [],
        skipped: [],
      };
    }

    const result = this.applyChanges(analysis.proposals, dryRun);

    return {
      evolved: result.applied.length > 0,
      reason: result.reason,
      proposals: analysis.proposals,
      ...result,
    };
  }

  /**
   * Rollback last evolution
   * @returns {{success: boolean, reason: string}}
   */
  rollbackLast() {
    if (this.evolutionHistory.length === 0) {
      return { success: false, reason: 'No evolution history' };
    }

    const last = this.evolutionHistory[this.evolutionHistory.length - 1];

    const result = this.config.set(
      last.configPath,
      last.oldValue,
      `ConfigEvolver rollback: reverting ${last.rule}`
    );

    if (result.success) {
      this.evolutionHistory.pop();
      return { success: true, reason: `Rolled back ${last.rule}` };
    }

    return { success: false, reason: result.error };
  }

  /**
   * Add custom evolution rule
   * @param {EvolutionRule} rule
   */
  addRule(rule) {
    if (!rule.name || !rule.configPath || !rule.condition || !rule.calculate) {
      throw new Error('Invalid rule: missing required fields');
    }
    this.rules.push(rule);
  }

  /**
   * Get evolution statistics
   * @returns {Object}
   */
  getStats() {
    return {
      enabled: this.enabled,
      lastEvolution: this.lastEvolution,
      timeSinceLastEvolution: this.lastEvolution
        ? Date.now() - this.lastEvolution
        : null,
      evolutionCount: this.evolutionHistory.length,
      ruleCount: this.rules.length,
      recentEvolutions: this.evolutionHistory.slice(-10),
    };
  }

  /**
   * Get evolution history
   * @param {number} limit
   * @returns {Object[]}
   */
  getHistory(limit = 50) {
    return this.evolutionHistory.slice(-limit);
  }

  /**
   * Enable/disable evolution
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ConfigEvolver,
  EVOLUTION_RULES,
};
