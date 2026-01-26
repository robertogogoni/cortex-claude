/**
 * Cortex - Claude's Cognitive Layer - Pattern Tracker
 *
 * LADS Principle: Learnable
 * Tracks every decision for learning:
 * - Records decisions with context
 * - Resolves outcomes later
 * - Finds similar past decisions
 * - Calculates success rates
 * - Detects patterns (failure, context-dependent, temporal)
 */

'use strict';

const { generateId, getTimestamp, sleep } = require('../types.cjs');
const { JSONLStore } = require('../storage.cjs');
const { getLockManager } = require('../lock-manager.cjs');

// =============================================================================
// PATTERN TRACKER
// =============================================================================

class PatternTracker {
  /**
   * @param {Object} options
   * @param {string} options.decisionsPath - Path to decisions JSONL
   * @param {string} options.outcomesPath - Path to outcomes JSONL
   * @param {number} options.similarityThreshold - Min similarity for "similar" decisions
   */
  constructor(options = {}) {
    this.decisionsStore = new JSONLStore(
      options.decisionsPath || '~/.claude/memory/data/patterns/decisions.jsonl',
      { indexFn: r => r.id }
    );

    this.outcomesStore = new JSONLStore(
      options.outcomesPath || '~/.claude/memory/data/patterns/outcomes.jsonl',
      { indexFn: r => r.decisionId }
    );

    this.similarityThreshold = options.similarityThreshold || 0.7;
    this.lockManager = getLockManager();

    // In-memory cache for fast lookups
    this.decisionsByType = new Map();   // type -> decision[]
    this.decisionsBySession = new Map(); // sessionId -> decision[]
    this.resolvedDecisions = new Set();  // decision IDs with outcomes

    this.initialized = false;
  }

  /**
   * Initialize stores and caches
   * @returns {Promise<{success: boolean}>}
   */
  async initialize() {
    const [decisionsResult, outcomesResult] = await Promise.all([
      this.decisionsStore.load(),
      this.outcomesStore.load(),
    ]);

    // Build caches
    for (const decision of this.decisionsStore.getAll()) {
      this._addToCache(decision);
    }

    for (const outcome of this.outcomesStore.getAll()) {
      this.resolvedDecisions.add(outcome.decisionId);
    }

    this.initialized = true;

    return {
      success: decisionsResult.success && outcomesResult.success,
      decisions: decisionsResult.count,
      outcomes: this.resolvedDecisions.size,
    };
  }

  /**
   * Add decision to internal caches
   * @param {Object} decision
   */
  _addToCache(decision) {
    // By type
    if (!this.decisionsByType.has(decision.decisionType)) {
      this.decisionsByType.set(decision.decisionType, []);
    }
    this.decisionsByType.get(decision.decisionType).push(decision);

    // By session
    if (!this.decisionsBySession.has(decision.sessionId)) {
      this.decisionsBySession.set(decision.sessionId, []);
    }
    this.decisionsBySession.get(decision.sessionId).push(decision);
  }

  /**
   * Track a new decision
   * @param {Object} input
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async trackDecision(input) {
    const decision = {
      id: generateId(),
      timestamp: getTimestamp(),
      sessionId: input.sessionId,
      decisionType: input.decisionType,
      context: {
        projectHash: input.projectHash || null,
        intent: input.intent || null,
        tags: input.tags || [],
        metadata: input.metadata || {},
      },
      choice: input.choice,
      alternatives: input.alternatives || [],
      confidence: input.confidence || 0.5,
      outcome: { status: 'pending' },
      tags: input.tags || [],
    };

    // Check for similar past decisions
    const similar = this.findSimilarDecisions(decision.context, decision.decisionType);
    if (similar.length > 0) {
      decision.similarTo = similar.slice(0, 3).map(s => s.id);
      decision.historicalSuccessRate = this._calculateSuccessRate(similar);
    }

    // Persist (withLock wraps result in {success, result}, so unwrap it)
    const lockResult = await this.lockManager.withLock('patterns:decisions', async () => {
      return this.decisionsStore.append(decision);
    });

    // Unwrap the result from withLock wrapper
    const appendResult = lockResult.success ? lockResult.result : { success: false, error: lockResult.error };

    if (appendResult.success) {
      this._addToCache(decision);
    }

    return appendResult;
  }

  /**
   * Resolve outcome for a decision
   * @param {string} decisionId
   * @param {Object} outcome
   * @returns {Promise<{success: boolean}>}
   */
  async resolveOutcome(decisionId, outcome) {
    const decision = this.decisionsStore.get(decisionId);
    if (!decision) {
      return { success: false, error: 'Decision not found' };
    }

    if (this.resolvedDecisions.has(decisionId)) {
      return { success: false, error: 'Outcome already resolved' };
    }

    const outcomeRecord = {
      decisionId,
      timestamp: getTimestamp(),
      status: 'resolved',
      useful: outcome.useful, // true/false/null
      reason: outcome.reason || '',
      signals: outcome.signals || {},
      resolvedAt: getTimestamp(),
    };

    // Persist (withLock wraps result in {success, result}, so unwrap it)
    const lockResult = await this.lockManager.withLock('patterns:outcomes', async () => {
      return this.outcomesStore.append(outcomeRecord);
    });

    // Unwrap the result from withLock wrapper
    const appendResult = lockResult.success ? lockResult.result : { success: false, error: lockResult.error };

    if (appendResult.success) {
      this.resolvedDecisions.add(decisionId);

      // Update decision with resolved outcome
      await this.decisionsStore.update(decisionId, {
        outcome: outcomeRecord,
      });
    }

    return appendResult;
  }

  /**
   * Calculate similarity between two contexts
   * @param {Object} ctx1
   * @param {Object} ctx2
   * @returns {number} 0-1 similarity score
   */
  _calculateSimilarity(ctx1, ctx2) {
    let score = 0;
    let factors = 0;

    // Project match (high weight)
    if (ctx1.projectHash && ctx2.projectHash) {
      factors++;
      if (ctx1.projectHash === ctx2.projectHash) score += 1;
    }

    // Intent match
    if (ctx1.intent && ctx2.intent) {
      factors++;
      if (ctx1.intent === ctx2.intent) score += 1;
    }

    // Tag overlap (Jaccard similarity)
    if (ctx1.tags?.length && ctx2.tags?.length) {
      factors++;
      const set1 = new Set(ctx1.tags);
      const set2 = new Set(ctx2.tags);
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      score += intersection.size / union.size;
    }

    // Metadata key overlap
    const meta1Keys = Object.keys(ctx1.metadata || {});
    const meta2Keys = Object.keys(ctx2.metadata || {});
    if (meta1Keys.length && meta2Keys.length) {
      factors++;
      const intersection = meta1Keys.filter(k => meta2Keys.includes(k));
      score += intersection.length / Math.max(meta1Keys.length, meta2Keys.length);
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Find similar past decisions
   * @param {Object} context
   * @param {string} decisionType
   * @param {number} limit
   * @returns {Object[]}
   */
  findSimilarDecisions(context, decisionType, limit = 10) {
    const candidates = this.decisionsByType.get(decisionType) || [];

    return candidates
      .filter(d => this.resolvedDecisions.has(d.id)) // Only resolved
      .map(d => ({
        ...d,
        similarity: this._calculateSimilarity(context, d.context),
      }))
      .filter(d => d.similarity >= this.similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Calculate success rate for a set of decisions
   * @param {Object[]} decisions
   * @returns {number|null}
   */
  _calculateSuccessRate(decisions) {
    const resolved = decisions.filter(d => this.resolvedDecisions.has(d.id));
    if (resolved.length === 0) return null;

    const successful = resolved.filter(d => {
      const outcome = this.outcomesStore.get(d.id);
      return outcome?.useful === true;
    });

    return successful.length / resolved.length;
  }

  /**
   * Get success rate for a specific type and choice
   * @param {string} decisionType
   * @param {string} choice
   * @returns {{rate: number|null, samples: number}}
   */
  getSuccessRate(decisionType, choice) {
    const candidates = (this.decisionsByType.get(decisionType) || [])
      .filter(d => d.choice === choice && this.resolvedDecisions.has(d.id));

    if (candidates.length === 0) {
      return { rate: null, samples: 0 };
    }

    const rate = this._calculateSuccessRate(candidates);
    return { rate, samples: candidates.length };
  }

  /**
   * Detect patterns in decisions
   * @param {Object} options
   * @returns {Object[]}
   */
  detectPatterns(options = {}) {
    const patterns = [];
    const minSamples = options.minSamples || 5;
    const failureThreshold = options.failureThreshold || 0.6;

    // Analyze by decision type
    for (const [type, decisions] of this.decisionsByType) {
      const resolved = decisions.filter(d => this.resolvedDecisions.has(d.id));
      if (resolved.length < minSamples) continue;

      // Calculate overall success rate for this type
      const overallRate = this._calculateSuccessRate(resolved);

      // Group by choice
      const byChoice = new Map();
      for (const d of resolved) {
        if (!byChoice.has(d.choice)) {
          byChoice.set(d.choice, []);
        }
        byChoice.get(d.choice).push(d);
      }

      // Check for consistent failures
      for (const [choice, choiceDecisions] of byChoice) {
        if (choiceDecisions.length < 3) continue;

        const choiceRate = this._calculateSuccessRate(choiceDecisions);
        if (choiceRate !== null && choiceRate < (1 - failureThreshold)) {
          patterns.push({
            type: 'consistent_failure',
            decisionType: type,
            choice,
            failureRate: 1 - choiceRate,
            samples: choiceDecisions.length,
            suggestion: `Consider avoiding "${choice}" for ${type} decisions`,
          });
        }
      }

      // Check for context-dependent success
      const projectGroups = new Map();
      for (const d of resolved) {
        const key = d.context.projectHash || '__global__';
        if (!projectGroups.has(key)) {
          projectGroups.set(key, []);
        }
        projectGroups.get(key).push(d);
      }

      for (const [project, projectDecisions] of projectGroups) {
        if (projectDecisions.length < 3) continue;

        const projectRate = this._calculateSuccessRate(projectDecisions);
        if (projectRate !== null && Math.abs(projectRate - overallRate) > 0.2) {
          patterns.push({
            type: 'context_dependent',
            decisionType: type,
            context: { projectHash: project },
            overallRate,
            contextRate: projectRate,
            samples: projectDecisions.length,
            suggestion: project === '__global__'
              ? `Global ${type} decisions differ significantly from project-specific`
              : `Project ${project} has ${projectRate > overallRate ? 'better' : 'worse'} ${type} success rate`,
          });
        }
      }

      // Check for temporal trends (improving/declining)
      if (resolved.length >= 10) {
        const sorted = resolved.sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
        const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

        const firstRate = this._calculateSuccessRate(firstHalf);
        const secondRate = this._calculateSuccessRate(secondHalf);

        if (firstRate !== null && secondRate !== null) {
          const change = secondRate - firstRate;
          if (Math.abs(change) > 0.15) {
            patterns.push({
              type: 'temporal_trend',
              decisionType: type,
              direction: change > 0 ? 'improving' : 'declining',
              firstHalfRate: firstRate,
              secondHalfRate: secondRate,
              change,
              samples: resolved.length,
              suggestion: change > 0
                ? `${type} decisions are improving over time`
                : `${type} decisions are declining - review recent changes`,
            });
          }
        }
      }
    }

    return patterns;
  }

  /**
   * Get pending decisions (awaiting outcome)
   * @param {string} sessionId - Optional filter by session
   * @returns {Object[]}
   */
  getPendingDecisions(sessionId = null) {
    let decisions = this.decisionsStore.getAll();

    if (sessionId) {
      decisions = this.decisionsBySession.get(sessionId) || [];
    }

    return decisions.filter(d => !this.resolvedDecisions.has(d.id));
  }

  /**
   * Get decisions for a session
   * @param {string} sessionId
   * @returns {Object[]}
   */
  getSessionDecisions(sessionId) {
    return this.decisionsBySession.get(sessionId) || [];
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    const totalDecisions = this.decisionsStore.getAll().length;
    const resolvedCount = this.resolvedDecisions.size;
    const pendingCount = totalDecisions - resolvedCount;

    // Success rate by type
    const ratesByType = {};
    for (const [type, decisions] of this.decisionsByType) {
      const resolved = decisions.filter(d => this.resolvedDecisions.has(d.id));
      ratesByType[type] = {
        total: decisions.length,
        resolved: resolved.length,
        successRate: this._calculateSuccessRate(resolved),
      };
    }

    return {
      totalDecisions,
      resolvedCount,
      pendingCount,
      resolutionRate: totalDecisions > 0 ? resolvedCount / totalDecisions : null,
      byType: ratesByType,
      sessionCount: this.decisionsBySession.size,
    };
  }

  /**
   * Clean old decisions
   * @param {number} maxAgeDays
   * @returns {Promise<{removed: number}>}
   */
  async cleanup(maxAgeDays = 90) {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    const toRemove = this.decisionsStore.getAll()
      .filter(d => new Date(d.timestamp) < cutoff)
      .map(d => d.id);

    // Mark as deleted (soft delete for JSONL)
    for (const id of toRemove) {
      await this.decisionsStore.update(id, { status: 'deleted' });
    }

    // Compact stores
    await this.decisionsStore.compact({ removeDeleted: true });
    await this.outcomesStore.compact({ removeDeleted: true });

    // Rebuild caches
    this.decisionsByType.clear();
    this.decisionsBySession.clear();
    this.resolvedDecisions.clear();

    for (const decision of this.decisionsStore.getAll()) {
      this._addToCache(decision);
    }

    for (const outcome of this.outcomesStore.getAll()) {
      this.resolvedDecisions.add(outcome.decisionId);
    }

    return { removed: toRemove.length };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  PatternTracker,
};
