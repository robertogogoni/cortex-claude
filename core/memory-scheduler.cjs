/**
 * Cortex - Claude's Cognitive Layer - Memory Scheduler
 *
 * Automatically runs memory maintenance tasks:
 * - Tier promotion (working -> short-term -> long-term)
 * - Decay score updates
 * - Compaction of deleted records
 *
 * @version 1.0.0
 * @see Design: ../docs/feature-gap-analysis-2026-02-02.md
 */

'use strict';

const { TierPromotion } = require('./tier-promotion.cjs');
const { expandPath } = require('./types.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_OPTIONS = {
  promotionInterval: 60 * 60 * 1000,  // 1 hour
  decayInterval: 6 * 60 * 60 * 1000,  // 6 hours
  verbose: false,
};

// =============================================================================
// MEMORY SCHEDULER
// =============================================================================

/**
 * Scheduler for automatic memory maintenance tasks
 */
class MemoryScheduler {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {number} options.promotionInterval - Interval for tier promotion (ms)
   * @param {number} options.decayInterval - Interval for decay updates (ms)
   * @param {boolean} options.verbose - Enable verbose logging
   * @param {Object} options.thresholds - Custom tier promotion thresholds
   */
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');
    this.promotionInterval = options.promotionInterval || DEFAULT_OPTIONS.promotionInterval;
    this.decayInterval = options.decayInterval || DEFAULT_OPTIONS.decayInterval;
    this.verbose = options.verbose || DEFAULT_OPTIONS.verbose;

    // Initialize tier promotion
    this.tierPromotion = new TierPromotion({
      basePath: this.basePath,
      thresholds: options.thresholds,
      verbose: this.verbose,
    });

    // Interval IDs
    this._promotionIntervalId = null;
    this._decayIntervalId = null;

    // Stats
    this.stats = {
      startedAt: null,
      promotionRuns: 0,
      decayRuns: 0,
      totalPromoted: 0,
      totalDeleted: 0,
      lastPromotionRun: null,
      lastDecayRun: null,
      errors: [],
    };
  }

  /**
   * Log a message if verbose mode is enabled
   * @param {string} message
   * @param {string} level
   */
  _log(message, level = 'info') {
    if (this.verbose) {
      const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
      console.log(`[MemoryScheduler] ${prefix} ${message}`);
    }
  }

  /**
   * Start the scheduler
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async start() {
    if (this._promotionIntervalId) {
      return { success: false, message: 'Scheduler already running' };
    }

    // Initialize tier promotion stores
    const initResult = await this.tierPromotion.initialize();
    if (!initResult.success) {
      return { success: false, message: `Failed to initialize: ${initResult.error}` };
    }

    this.stats.startedAt = new Date().toISOString();

    // Start promotion interval
    this._promotionIntervalId = setInterval(async () => {
      await this._runPromotion();
    }, this.promotionInterval);

    // Start decay interval
    this._decayIntervalId = setInterval(async () => {
      await this._runDecayUpdate();
    }, this.decayInterval);

    // Run initial promotion immediately
    await this._runPromotion();

    this._log(`Started with promotion interval: ${this.promotionInterval / 1000}s, decay interval: ${this.decayInterval / 1000}s`);

    return { success: true, message: 'Scheduler started' };
  }

  /**
   * Stop the scheduler
   * @returns {{success: boolean, message: string}}
   */
  stop() {
    if (!this._promotionIntervalId) {
      return { success: false, message: 'Scheduler not running' };
    }

    clearInterval(this._promotionIntervalId);
    clearInterval(this._decayIntervalId);

    this._promotionIntervalId = null;
    this._decayIntervalId = null;

    this._log('Stopped');

    return { success: true, message: 'Scheduler stopped' };
  }

  /**
   * Check if scheduler is running
   * @returns {boolean}
   */
  isRunning() {
    return this._promotionIntervalId !== null;
  }

  /**
   * Run tier promotion
   * @private
   */
  async _runPromotion() {
    this.stats.promotionRuns++;
    this.stats.lastPromotionRun = new Date().toISOString();

    try {
      const result = await this.tierPromotion.promote({ dryRun: false });

      if (result.success) {
        const promoted = result.results.promoted.workingToShortTerm.length +
                        result.results.promoted.shortTermToLongTerm.length;
        const deleted = result.results.deleted.length;

        this.stats.totalPromoted += promoted;
        this.stats.totalDeleted += deleted;

        if (promoted > 0 || deleted > 0) {
          this._log(`Promotion complete: ${promoted} promoted, ${deleted} deleted`);
        }
      } else {
        this._recordError('promotion', result.error);
      }
    } catch (error) {
      this._recordError('promotion', error.message);
    }
  }

  /**
   * Update decay scores for all memories
   * @private
   */
  async _runDecayUpdate() {
    this.stats.decayRuns++;
    this.stats.lastDecayRun = new Date().toISOString();

    try {
      // Get all memories and update decay scores
      const stores = this.tierPromotion.stores;
      const now = Date.now();

      for (const [tierName, store] of Object.entries(stores)) {
        if (!store?.loaded) continue;

        const memories = store.getAll().filter(m => m && m.status !== 'deleted');

        for (const memory of memories) {
          const age = now - new Date(memory.createdAt || memory.sourceTimestamp).getTime();
          const daysSinceCreation = age / (24 * 60 * 60 * 1000);

          // Decay formula: score = e^(-lambda * days) where lambda controls decay rate
          // Lambda = 0.05 means ~5% decay per day
          const lambda = tierName === 'working' ? 0.1 : tierName === 'shortTerm' ? 0.05 : 0.01;
          const newDecayScore = Math.exp(-lambda * daysSinceCreation);

          // Only update if decay has changed significantly
          if (Math.abs((memory.decayScore || 1) - newDecayScore) > 0.01) {
            await store.update(memory.id, {
              decayScore: Math.round(newDecayScore * 1000) / 1000,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      this._log('Decay scores updated');
    } catch (error) {
      this._recordError('decay', error.message);
    }
  }

  /**
   * Record an error
   * @private
   * @param {string} operation
   * @param {string} message
   */
  _recordError(operation, message) {
    this.stats.errors.push({
      timestamp: new Date().toISOString(),
      operation,
      message,
    });

    // Keep only last 10 errors
    if (this.stats.errors.length > 10) {
      this.stats.errors.shift();
    }

    this._log(`${operation} failed: ${message}`, 'error');
  }

  /**
   * Get scheduler statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning(),
      uptimeMs: this.stats.startedAt
        ? Date.now() - new Date(this.stats.startedAt).getTime()
        : 0,
      tierSummary: this.isRunning() ? this.tierPromotion.getSummary() : null,
    };
  }

  /**
   * Manually trigger a promotion run
   * @param {Object} options
   * @param {boolean} options.dryRun - Preview without making changes
   * @returns {Promise<Object>}
   */
  async triggerPromotion(options = {}) {
    if (!this.isRunning()) {
      // Initialize if not running
      const initResult = await this.tierPromotion.initialize();
      if (!initResult.success) {
        return { success: false, error: initResult.error };
      }
    }

    return this.tierPromotion.promote(options);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  MemoryScheduler,
  DEFAULT_OPTIONS,
};
