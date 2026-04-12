'use strict';

/**
 * Cortex - Claude's Cognitive Layer - Write Gate
 *
 * Prevents noise accumulation by filtering extractions through 5 criteria
 * inspired by total-recall:
 *
 * 1. Behavior change: Will this change behavior next time?
 * 2. Commitment: Is someone counting on this?
 * 3. Decision with rationale: Worth remembering the reasoning?
 * 4. Stable fact: Will this come up again?
 * 5. Explicit remember: Did the user say "remember this"?
 *
 * Scoring: Pass if explicitRemember is true, any single criterion > 0.5,
 * or total score across all criteria > 1.5. Minimum confidence of 0.4
 * required (unless explicit remember).
 */

class WriteGate {
  /**
   * @param {Object} options
   * @param {number} options.minConfidence - Minimum confidence to consider (default: 0.4)
   */
  constructor(options = {}) {
    this.minConfidence = options.minConfidence || 0.4;
  }

  /**
   * Determine whether a memory item should be persisted.
   *
   * @param {Object} item
   * @param {string} item.content - The memory content text
   * @param {string} item.type - Memory type (insight, skill, decision, etc.)
   * @param {number} item.confidence - Extraction confidence 0.0-1.0
   * @param {boolean} [item.explicitRemember] - Whether user explicitly asked to remember
   * @returns {boolean}
   */
  shouldPersist(item) {
    // Explicit remember always passes
    if (item.explicitRemember) return true;
    if (/\bremember\b[:\s]/i.test(item.content)) return true;
    if (/\bdon'?t forget\b/i.test(item.content)) return true;

    // Minimum confidence gate
    if ((item.confidence || 0) < this.minConfidence) return false;

    const scores = this._score(item);
    const maxScore = Math.max(...Object.values(scores));
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

    // Lowered from 0.5/1.5: original thresholds were too strict, filtering out
    // nearly all real-world extractions (e.g., "always add signal handlers" scored
    // only 0.2 total). A single keyword match (0.2) should be enough to pass when
    // the extraction engine's confidence threshold (0.7) already pre-filtered noise.
    return maxScore >= 0.2 || totalScore > 0.5;
  }

  /**
   * Score an item across all 5 criteria.
   *
   * @param {Object} item
   * @returns {Object} Scores keyed by criterion name, each 0.0-1.0
   */
  _score(item) {
    const content = (item.content || '').toLowerCase();
    return {
      behaviorChange: this._scoreBehaviorChange(content),
      commitment: this._scoreCommitment(content),
      decisionRationale: this._scoreDecisionRationale(content),
      stableFact: this._scoreStableFact(content),
      explicitRemember: this._scoreExplicitRemember(content),
    };
  }

  /**
   * Score criterion 1: Behavior change.
   * Will this change behavior next time?
   * Keywords: "always", "never", "before", "instead of", "use X for Y"
   *
   * @param {string} content - Lowercased content
   * @returns {number} 0.0-1.0
   */
  _scoreBehaviorChange(content) {
    const signals = [
      'always', 'never', 'before', 'instead of',
      'make sure to', 'don\'t', 'avoid', 'prefer',
      'use .+ for', 'validate .+ before',
    ];
    let score = 0;
    for (const signal of signals) {
      if (new RegExp(signal, 'i').test(content)) score += 0.2;
    }
    return Math.min(score, 1.0);
  }

  /**
   * Score criterion 2: Commitment.
   * Is someone counting on this?
   * Keywords: "promised", "committed", "deadline", "by Friday"
   *
   * @param {string} content - Lowercased content
   * @returns {number} 0.0-1.0
   */
  _scoreCommitment(content) {
    const signals = [
      'promised', 'committed', 'deadline', 'by friday',
      'by monday', 'by end of', 'need to', 'must',
      'will deliver', 'agreed to',
    ];
    let score = 0;
    for (const signal of signals) {
      if (content.includes(signal)) score += 0.25;
    }
    return Math.min(score, 1.0);
  }

  /**
   * Score criterion 3: Decision with rationale.
   * Worth remembering the reasoning?
   * Keywords: "chose X over Y", "because", "decided", "trade-off"
   *
   * @param {string} content - Lowercased content
   * @returns {number} 0.0-1.0
   */
  _scoreDecisionRationale(content) {
    const signals = [
      'chose', 'because', 'decided', 'reasoning',
      'trade-off', 'over', 'instead', 'rationale', 'opted for',
    ];
    let score = 0;
    for (const signal of signals) {
      if (content.includes(signal)) score += 0.2;
    }
    // Boost if has "X over Y because Z" pattern
    if (/chose .+ over .+ because/i.test(content)) score += 0.3;
    return Math.min(score, 1.0);
  }

  /**
   * Score criterion 4: Stable fact.
   * Will this come up again?
   * Keywords: "rate limit", "API", "endpoint", "configuration"
   *
   * @param {string} content - Lowercased content
   * @returns {number} 0.0-1.0
   */
  _scoreStableFact(content) {
    const signals = [
      'rate limit', 'api', 'endpoint', 'configuration',
      'the .+ is ', 'port', 'version', 'url', 'path',
      'per minute', 'per user', 'maximum',
    ];
    let score = 0;
    for (const signal of signals) {
      if (new RegExp(signal, 'i').test(content)) score += 0.2;
    }
    return Math.min(score, 1.0);
  }

  /**
   * Score criterion 5: Explicit remember.
   * Did the user say "remember this"?
   *
   * @param {string} content - Lowercased content
   * @returns {number} 0.0-1.0
   */
  _scoreExplicitRemember(content) {
    if (/\bremember\b/i.test(content)) return 0.8;
    if (/\bnote to self\b/i.test(content)) return 0.7;
    return 0;
  }
}

module.exports = { WriteGate };
