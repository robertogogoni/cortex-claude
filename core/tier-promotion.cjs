/**
 * Cortex - Claude's Cognitive Layer - Memory Tier Promotion
 *
 * Manages memory lifecycle across three tiers:
 * - Working memory: Very recent (< 24 hours), max 50 items
 * - Short-term memory: Recent (1-7 days), max 200 items
 * - Long-term memory: Permanent, quality-filtered
 *
 * Promotion Rules:
 * - Working -> Short-term: Age > 24h OR count > 50
 * - Short-term -> Long-term: Age > 7d AND high quality (usageSuccessRate > 0.6)
 * - Short-term -> Delete: Age > 7d AND low quality (usageSuccessRate < 0.3)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath, getTimestamp, generateId } = require('./types.cjs');
const { JSONLStore } = require('./storage.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_THRESHOLDS = {
  working: {
    maxAge: 24 * 60 * 60 * 1000,    // 24 hours in ms
    maxItems: 50,
  },
  shortTerm: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    maxItems: 200,
    promoteThreshold: 0.6,           // usageSuccessRate to promote to long-term
    deleteThreshold: 0.3,            // usageSuccessRate below which to delete
  },
};

const QUALITY_WEIGHTS = {
  extractionConfidence: 0.25,
  usageCount: 0.20,
  usageSuccessRate: 0.35,
  decayScore: 0.20,
};

// =============================================================================
// TIER PROMOTION CLASS
// =============================================================================

class TierPromotion {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {Object} options.thresholds - Custom thresholds (optional)
   * @param {boolean} options.verbose - Enable verbose logging
   */
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.verbose = options.verbose || false;

    // Initialize stores
    this.stores = {
      working: null,
      shortTerm: null,
      longTerm: null,
    };

    this.stats = {
      lastRun: null,
      totalPromotions: 0,
      totalDeletions: 0,
      totalErrors: 0,
    };
  }

  /**
   * Log message if verbose mode is enabled
   * @param {string} message
   * @param {string} level - 'info', 'warn', 'error'
   */
  _log(message, level = 'info') {
    if (this.verbose) {
      const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Initialize all three tier stores
   * @returns {Promise<{success: boolean, stores: Object}>}
   */
  async initialize() {
    const memoriesPath = path.join(this.basePath, 'data/memories');

    try {
      // Ensure directory exists
      if (!fs.existsSync(memoriesPath)) {
        fs.mkdirSync(memoriesPath, { recursive: true, mode: 0o700 });
      }

      this.stores.working = new JSONLStore(
        path.join(memoriesPath, 'working.jsonl'),
        { indexFn: r => r.id, autoCreate: true }
      );

      this.stores.shortTerm = new JSONLStore(
        path.join(memoriesPath, 'short-term.jsonl'),
        { indexFn: r => r.id, autoCreate: true }
      );

      this.stores.longTerm = new JSONLStore(
        path.join(memoriesPath, 'long-term.jsonl'),
        { indexFn: r => r.id, autoCreate: true }
      );

      // Load all stores
      const results = await Promise.all([
        this.stores.working.load(),
        this.stores.shortTerm.load(),
        this.stores.longTerm.load(),
      ]);

      return {
        success: results.every(r => r.success),
        stores: {
          working: results[0],
          shortTerm: results[1],
          longTerm: results[2],
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate quality score for a memory record
   * @param {Object} record - Memory record
   * @returns {number} - Quality score between 0 and 1
   */
  _calculateQuality(record) {
    // Normalize usage count (cap at 10 for scoring purposes)
    const normalizedUsageCount = Math.min(record.usageCount || 0, 10) / 10;

    // Calculate weighted score
    const score =
      (record.extractionConfidence || 0.5) * QUALITY_WEIGHTS.extractionConfidence +
      normalizedUsageCount * QUALITY_WEIGHTS.usageCount +
      (record.usageSuccessRate || 0.5) * QUALITY_WEIGHTS.usageSuccessRate +
      (record.decayScore || 1) * QUALITY_WEIGHTS.decayScore;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get age of a record in milliseconds
   * @param {Object} record
   * @returns {number}
   */
  _getAge(record) {
    const createdAt = new Date(record.createdAt || record.sourceTimestamp).getTime();
    return Date.now() - createdAt;
  }

  /**
   * Analyze what needs to be promoted/deleted without making changes
   * @returns {Promise<Object>}
   */
  async analyze() {
    if (!this.stores.working?.loaded) {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return { success: false, error: 'Failed to initialize stores' };
      }
    }

    const now = Date.now();
    const analysis = {
      working: {
        total: 0,
        toPromote: [],
        byAge: 0,
        byCount: 0,
      },
      shortTerm: {
        total: 0,
        toPromote: [],
        toDelete: [],
        byAge: 0,
        byCount: 0,
        byQuality: 0,
      },
      longTerm: {
        total: 0,
      },
    };

    // Analyze working memory
    const workingRecords = this.stores.working.getAll()
      .filter(r => r && r.status !== 'deleted');
    analysis.working.total = workingRecords.length;

    // Check age-based promotion
    for (const record of workingRecords) {
      const age = this._getAge(record);
      if (age > this.thresholds.working.maxAge) {
        analysis.working.toPromote.push({
          id: record.id,
          age: Math.round(age / (60 * 60 * 1000)), // hours
          reason: 'age',
          quality: this._calculateQuality(record),
        });
        analysis.working.byAge++;
      }
    }

    // Check count-based promotion (oldest first)
    if (workingRecords.length > this.thresholds.working.maxItems) {
      const excess = workingRecords.length - this.thresholds.working.maxItems;
      const sortedByAge = workingRecords
        .filter(r => !analysis.working.toPromote.find(p => p.id === r.id))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      for (let i = 0; i < excess && i < sortedByAge.length; i++) {
        const record = sortedByAge[i];
        analysis.working.toPromote.push({
          id: record.id,
          age: Math.round(this._getAge(record) / (60 * 60 * 1000)),
          reason: 'count',
          quality: this._calculateQuality(record),
        });
        analysis.working.byCount++;
      }
    }

    // Analyze short-term memory
    const shortTermRecords = this.stores.shortTerm.getAll()
      .filter(r => r && r.status !== 'deleted');
    analysis.shortTerm.total = shortTermRecords.length;

    for (const record of shortTermRecords) {
      const age = this._getAge(record);
      const quality = this._calculateQuality(record);
      const usageSuccessRate = record.usageSuccessRate || 0.5;

      if (age > this.thresholds.shortTerm.maxAge) {
        // Old enough to evaluate
        if (usageSuccessRate >= this.thresholds.shortTerm.promoteThreshold) {
          // High quality - promote to long-term
          analysis.shortTerm.toPromote.push({
            id: record.id,
            age: Math.round(age / (24 * 60 * 60 * 1000)), // days
            reason: 'quality',
            quality,
            usageSuccessRate,
          });
          analysis.shortTerm.byQuality++;
        } else if (usageSuccessRate < this.thresholds.shortTerm.deleteThreshold) {
          // Low quality - delete
          analysis.shortTerm.toDelete.push({
            id: record.id,
            age: Math.round(age / (24 * 60 * 60 * 1000)),
            reason: 'low_quality',
            quality,
            usageSuccessRate,
          });
        }
        analysis.shortTerm.byAge++;
      }
    }

    // Check count-based promotion (highest quality first)
    if (shortTermRecords.length > this.thresholds.shortTerm.maxItems) {
      const excess = shortTermRecords.length - this.thresholds.shortTerm.maxItems;
      const alreadyProcessed = new Set([
        ...analysis.shortTerm.toPromote.map(p => p.id),
        ...analysis.shortTerm.toDelete.map(p => p.id),
      ]);

      const sortedByQuality = shortTermRecords
        .filter(r => !alreadyProcessed.has(r.id))
        .map(r => ({ record: r, quality: this._calculateQuality(r) }))
        .sort((a, b) => b.quality - a.quality);

      for (let i = 0; i < excess && i < sortedByQuality.length; i++) {
        const { record, quality } = sortedByQuality[i];
        analysis.shortTerm.toPromote.push({
          id: record.id,
          age: Math.round(this._getAge(record) / (24 * 60 * 60 * 1000)),
          reason: 'count',
          quality,
          usageSuccessRate: record.usageSuccessRate || 0.5,
        });
        analysis.shortTerm.byCount++;
      }
    }

    // Long-term stats
    analysis.longTerm.total = this.stores.longTerm.getAll()
      .filter(r => r && r.status !== 'deleted').length;

    return { success: true, analysis };
  }

  /**
   * Execute tier promotion
   * @param {Object} options
   * @param {boolean} options.dryRun - If true, only analyze without making changes
   * @returns {Promise<Object>}
   */
  async promote(options = {}) {
    const dryRun = options.dryRun !== false; // Default to dry run for safety

    const analysisResult = await this.analyze();
    if (!analysisResult.success) {
      return analysisResult;
    }

    const { analysis } = analysisResult;
    const results = {
      dryRun,
      timestamp: getTimestamp(),
      promoted: {
        workingToShortTerm: [],
        shortTermToLongTerm: [],
      },
      deleted: [],
      errors: [],
      stats: {
        workingBefore: analysis.working.total,
        shortTermBefore: analysis.shortTerm.total,
        longTermBefore: analysis.longTerm.total,
        workingAfter: analysis.working.total,
        shortTermAfter: analysis.shortTerm.total,
        longTermAfter: analysis.longTerm.total,
      },
    };

    if (dryRun) {
      // Just return what would happen
      results.promoted.workingToShortTerm = analysis.working.toPromote;
      results.promoted.shortTermToLongTerm = analysis.shortTerm.toPromote;
      results.deleted = analysis.shortTerm.toDelete;

      // Calculate projected stats
      results.stats.workingAfter -= analysis.working.toPromote.length;
      results.stats.shortTermAfter += analysis.working.toPromote.length;
      results.stats.shortTermAfter -= (analysis.shortTerm.toPromote.length + analysis.shortTerm.toDelete.length);
      results.stats.longTermAfter += analysis.shortTerm.toPromote.length;

      return { success: true, results };
    }

    // Execute promotions
    try {
      // 1. Promote working -> short-term
      for (const item of analysis.working.toPromote) {
        try {
          const record = this.stores.working.get(item.id);
          if (record) {
            // Add to short-term
            const promotedRecord = {
              ...record,
              _promotedFrom: 'working',
              _promotedAt: getTimestamp(),
              updatedAt: getTimestamp(),
            };
            await this.stores.shortTerm.append(promotedRecord);

            // Mark as deleted in working (soft delete for safety)
            await this.stores.working.update(item.id, {
              status: 'deleted',
              _deletedReason: 'promoted_to_short_term',
            });

            results.promoted.workingToShortTerm.push(item);
            this._log(`Promoted ${item.id} from working to short-term`);
          }
        } catch (error) {
          results.errors.push({ id: item.id, operation: 'promote_working', error: error.message });
        }
      }

      // 2. Promote short-term -> long-term
      for (const item of analysis.shortTerm.toPromote) {
        try {
          const record = this.stores.shortTerm.get(item.id);
          if (record) {
            // Add to long-term
            const promotedRecord = {
              ...record,
              _promotedFrom: 'short_term',
              _promotedAt: getTimestamp(),
              updatedAt: getTimestamp(),
            };
            await this.stores.longTerm.append(promotedRecord);

            // Mark as deleted in short-term
            await this.stores.shortTerm.update(item.id, {
              status: 'deleted',
              _deletedReason: 'promoted_to_long_term',
            });

            results.promoted.shortTermToLongTerm.push(item);
            this._log(`Promoted ${item.id} from short-term to long-term`);
          }
        } catch (error) {
          results.errors.push({ id: item.id, operation: 'promote_short_term', error: error.message });
        }
      }

      // 3. Delete low-quality short-term memories
      for (const item of analysis.shortTerm.toDelete) {
        try {
          await this.stores.shortTerm.update(item.id, {
            status: 'deleted',
            _deletedReason: 'low_quality',
          });

          results.deleted.push(item);
          this._log(`Deleted ${item.id} from short-term (low quality)`);
        } catch (error) {
          results.errors.push({ id: item.id, operation: 'delete', error: error.message });
        }
      }

      // 4. Compact stores to remove deleted records
      await this.stores.working.compact({ removeDeleted: true });
      await this.stores.shortTerm.compact({ removeDeleted: true });

      // Update final stats
      results.stats.workingAfter = this.stores.working.getAll()
        .filter(r => r && r.status !== 'deleted').length;
      results.stats.shortTermAfter = this.stores.shortTerm.getAll()
        .filter(r => r && r.status !== 'deleted').length;
      results.stats.longTermAfter = this.stores.longTerm.getAll()
        .filter(r => r && r.status !== 'deleted').length;

      // Update class stats
      this.stats.lastRun = getTimestamp();
      this.stats.totalPromotions += results.promoted.workingToShortTerm.length +
                                    results.promoted.shortTermToLongTerm.length;
      this.stats.totalDeletions += results.deleted.length;
      this.stats.totalErrors += results.errors.length;

      return { success: true, results };

    } catch (error) {
      return { success: false, error: error.message, results };
    }
  }

  /**
   * Get summary statistics
   * @returns {Object}
   */
  getSummary() {
    const working = this.stores.working?.getAll().filter(r => r && r.status !== 'deleted') || [];
    const shortTerm = this.stores.shortTerm?.getAll().filter(r => r && r.status !== 'deleted') || [];
    const longTerm = this.stores.longTerm?.getAll().filter(r => r && r.status !== 'deleted') || [];

    return {
      tiers: {
        working: {
          count: working.length,
          maxItems: this.thresholds.working.maxItems,
          capacityUsed: `${Math.round(working.length / this.thresholds.working.maxItems * 100)}%`,
        },
        shortTerm: {
          count: shortTerm.length,
          maxItems: this.thresholds.shortTerm.maxItems,
          capacityUsed: `${Math.round(shortTerm.length / this.thresholds.shortTerm.maxItems * 100)}%`,
        },
        longTerm: {
          count: longTerm.length,
          description: 'Unlimited, quality-filtered',
        },
      },
      thresholds: this.thresholds,
      runStats: this.stats,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  TierPromotion,
  DEFAULT_THRESHOLDS,
  QUALITY_WEIGHTS,
};
