/**
 * Claude Memory Orchestrator - Outcome Scorer
 *
 * LADS Principle: Adaptive
 * Collects signals and determines if decisions were useful:
 * - Usage signal collection (was memory referenced?)
 * - Feedback signal collection (positive/negative language)
 * - Conversation signal collection (errors, completions)
 * - Temporal signal collection (time to resolution)
 */

'use strict';

const { generateId, getTimestamp } = require('../types.cjs');

// =============================================================================
// SIGNAL COLLECTORS
// =============================================================================

class UsageSignalCollector {
  /**
   * Collects signals about whether injected memories were used
   */
  constructor() {
    this.trackedMemories = new Map(); // memoryId -> { injectedAt, referenced: boolean }
  }

  /**
   * Track a memory injection
   * @param {string} memoryId
   * @param {string} sessionId
   */
  trackInjection(memoryId, sessionId) {
    this.trackedMemories.set(memoryId, {
      injectedAt: Date.now(),
      sessionId,
      referenced: false,
      referenceCount: 0,
      firstReference: null,
    });
  }

  /**
   * Mark a memory as referenced
   * @param {string} memoryId
   */
  markReferenced(memoryId) {
    const tracking = this.trackedMemories.get(memoryId);
    if (tracking) {
      tracking.referenced = true;
      tracking.referenceCount++;
      if (!tracking.firstReference) {
        tracking.firstReference = Date.now();
      }
    }
  }

  /**
   * Get usage signal for a memory
   * @param {string} memoryId
   * @returns {Object|null}
   */
  getSignal(memoryId) {
    const tracking = this.trackedMemories.get(memoryId);
    if (!tracking) return null;

    return {
      type: 'usage',
      memoryId,
      referenced: tracking.referenced,
      referenceCount: tracking.referenceCount,
      timeToFirstReference: tracking.firstReference
        ? tracking.firstReference - tracking.injectedAt
        : null,
    };
  }

  /**
   * Clean old tracking data
   * @param {number} maxAgeMs
   */
  cleanup(maxAgeMs = 86400000) { // 24 hours
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, tracking] of this.trackedMemories) {
      if (tracking.injectedAt < cutoff) {
        this.trackedMemories.delete(id);
      }
    }
  }
}

class FeedbackSignalCollector {
  /**
   * Collects explicit and implicit feedback signals
   */
  constructor() {
    // Patterns for implicit feedback detection
    this.positivePatterns = [
      /\b(thanks|thank you|perfect|great|excellent|awesome|works|worked|helpful|exactly)\b/i,
      /\b(that('s| is) (right|correct|what i (need|want)ed))\b/i,
      /\b(solved|fixed|done|complete)\b/i,
      /👍|✓|✔|🎉|💯/,
    ];

    this.negativePatterns = [
      /\b(wrong|incorrect|no|not what|doesn't work|didn't work|broken)\b/i,
      /\b(that('s| is) (wrong|not right|incorrect))\b/i,
      /\b(actually|let me clarify|i meant)\b/i,
      /👎|✗|❌|🚫/,
    ];

    this.correctionPatterns = [
      /\b(actually|instead|not .* but|i meant|let me clarify)\b/i,
      /\b(should be|change .* to|replace .* with)\b/i,
    ];
  }

  /**
   * Analyze text for feedback signals
   * @param {string} text
   * @returns {Object}
   */
  analyzeText(text) {
    const signals = {
      type: 'feedback',
      positive: false,
      negative: false,
      correction: false,
      confidence: 0,
      matchedPatterns: [],
    };

    for (const pattern of this.positivePatterns) {
      if (pattern.test(text)) {
        signals.positive = true;
        signals.matchedPatterns.push({ type: 'positive', pattern: pattern.source });
      }
    }

    for (const pattern of this.negativePatterns) {
      if (pattern.test(text)) {
        signals.negative = true;
        signals.matchedPatterns.push({ type: 'negative', pattern: pattern.source });
      }
    }

    for (const pattern of this.correctionPatterns) {
      if (pattern.test(text)) {
        signals.correction = true;
        signals.matchedPatterns.push({ type: 'correction', pattern: pattern.source });
      }
    }

    // Calculate confidence
    if (signals.positive && !signals.negative) {
      signals.confidence = 0.8;
    } else if (signals.negative && !signals.positive) {
      signals.confidence = 0.8;
    } else if (signals.positive && signals.negative) {
      signals.confidence = 0.3; // Mixed signals
    } else if (signals.correction) {
      signals.confidence = 0.6;
    }

    return signals;
  }

  /**
   * Record explicit feedback command
   * @param {'good' | 'bad'} type
   * @param {string} reason
   * @returns {Object}
   */
  recordExplicit(type, reason = '') {
    return {
      type: 'feedback',
      explicit: true,
      positive: type === 'good',
      negative: type === 'bad',
      reason,
      confidence: 1.0,
    };
  }
}

class ConversationSignalCollector {
  /**
   * Collects signals from conversation flow
   */
  constructor() {
    this.sessionData = new Map(); // sessionId -> { errors, completions, turns }
  }

  /**
   * Start tracking a session
   * @param {string} sessionId
   */
  startSession(sessionId) {
    this.sessionData.set(sessionId, {
      startTime: Date.now(),
      errors: [],
      completions: [],
      turns: 0,
      lastActivity: Date.now(),
    });
  }

  /**
   * Record an error in the session
   * @param {string} sessionId
   * @param {Object} error
   */
  recordError(sessionId, error) {
    const data = this.sessionData.get(sessionId);
    if (data) {
      data.errors.push({
        timestamp: Date.now(),
        message: error.message || String(error),
        type: error.type || 'unknown',
      });
      data.lastActivity = Date.now();
    }
  }

  /**
   * Record a task completion
   * @param {string} sessionId
   * @param {Object} completion
   */
  recordCompletion(sessionId, completion) {
    const data = this.sessionData.get(sessionId);
    if (data) {
      data.completions.push({
        timestamp: Date.now(),
        task: completion.task || 'unknown',
        success: completion.success ?? true,
      });
      data.lastActivity = Date.now();
    }
  }

  /**
   * Increment turn count
   * @param {string} sessionId
   */
  recordTurn(sessionId) {
    const data = this.sessionData.get(sessionId);
    if (data) {
      data.turns++;
      data.lastActivity = Date.now();
    }
  }

  /**
   * Get conversation signal for session
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getSignal(sessionId) {
    const data = this.sessionData.get(sessionId);
    if (!data) return null;

    const errorCount = data.errors.length;
    const completionCount = data.completions.length;
    const successfulCompletions = data.completions.filter(c => c.success).length;

    return {
      type: 'conversation',
      sessionId,
      errorCount,
      completionCount,
      successRate: completionCount > 0 ? successfulCompletions / completionCount : null,
      turnCount: data.turns,
      duration: Date.now() - data.startTime,
      lastActivity: data.lastActivity,
    };
  }

  /**
   * Clean old session data
   * @param {number} maxAgeMs
   */
  cleanup(maxAgeMs = 86400000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, data] of this.sessionData) {
      if (data.lastActivity < cutoff) {
        this.sessionData.delete(id);
      }
    }
  }
}

class TemporalSignalCollector {
  /**
   * Collects time-based signals
   */
  constructor() {
    this.taskTimings = new Map(); // taskId -> { startTime, endTime, checkpoints }
  }

  /**
   * Start timing a task
   * @param {string} taskId
   */
  startTask(taskId) {
    this.taskTimings.set(taskId, {
      startTime: Date.now(),
      endTime: null,
      checkpoints: [],
    });
  }

  /**
   * Add a checkpoint
   * @param {string} taskId
   * @param {string} label
   */
  checkpoint(taskId, label) {
    const timing = this.taskTimings.get(taskId);
    if (timing) {
      timing.checkpoints.push({
        label,
        timestamp: Date.now(),
        elapsed: Date.now() - timing.startTime,
      });
    }
  }

  /**
   * End timing a task
   * @param {string} taskId
   */
  endTask(taskId) {
    const timing = this.taskTimings.get(taskId);
    if (timing) {
      timing.endTime = Date.now();
    }
  }

  /**
   * Get temporal signal for task
   * @param {string} taskId
   * @returns {Object|null}
   */
  getSignal(taskId) {
    const timing = this.taskTimings.get(taskId);
    if (!timing) return null;

    const duration = (timing.endTime || Date.now()) - timing.startTime;

    return {
      type: 'temporal',
      taskId,
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration,
      completed: timing.endTime !== null,
      checkpointCount: timing.checkpoints.length,
      checkpoints: timing.checkpoints,
    };
  }

  /**
   * Clean old timing data
   * @param {number} maxAgeMs
   */
  cleanup(maxAgeMs = 3600000) { // 1 hour
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, timing] of this.taskTimings) {
      if (timing.startTime < cutoff) {
        this.taskTimings.delete(id);
      }
    }
  }
}

// =============================================================================
// SIGNAL TYPES (for external use)
// =============================================================================

const SIGNAL_TYPES = {
  USAGE: 'usage',
  FEEDBACK: 'feedback',
  CONVERSATION: 'conversation',
  TEMPORAL: 'temporal',
  INJECTION: 'injection',
};

// =============================================================================
// OUTCOME SCORER
// =============================================================================

class OutcomeScorer {
  /**
   * @param {Object} options
   * @param {Object} options.patternTracker - PatternTracker instance
   */
  constructor(options = {}) {
    this.patternTracker = options.patternTracker;

    // Initialize collectors
    this.usageCollector = new UsageSignalCollector();
    this.feedbackCollector = new FeedbackSignalCollector();
    this.conversationCollector = new ConversationSignalCollector();
    this.temporalCollector = new TemporalSignalCollector();

    // Pending assessments
    this.pendingAssessments = new Map(); // decisionId -> { signals, deadline }

    // Stats
    this.totalSignals = 0;
  }

  /**
   * Start tracking for a decision
   * @param {string} decisionId
   * @param {Object} context
   */
  startTracking(decisionId, context = {}) {
    this.pendingAssessments.set(decisionId, {
      startTime: Date.now(),
      signals: [],
      context,
      deadline: Date.now() + (context.timeoutMs || 300000), // 5 min default
    });

    // Start conversation tracking if session provided
    if (context.sessionId) {
      this.conversationCollector.startSession(context.sessionId);
    }

    // Start task timing if task provided
    if (context.taskId) {
      this.temporalCollector.startTask(context.taskId);
    }
  }

  /**
   * Alias for startTracking (for test compatibility)
   * @param {string} decisionId
   */
  registerDecision(decisionId) {
    this.startTracking(decisionId, {});
  }

  /**
   * Collect a signal for a decision (alias for addSignal with type/data pattern)
   * @param {string} decisionId
   * @param {string} signalType
   * @param {Object} signalData
   */
  collectSignal(decisionId, signalType, signalData) {
    this.addSignal(decisionId, {
      type: signalType,
      ...signalData,
    });
    this.totalSignals++;
  }

  /**
   * Record explicit feedback (alias for recordExplicitFeedback)
   * @param {string} decisionId
   * @param {boolean} positive
   * @param {string} reason
   */
  recordFeedback(decisionId, positive, reason) {
    const type = positive ? 'good' : 'bad';
    const signal = this.feedbackCollector.recordExplicit(type, reason);
    // Set type to 'explicit_feedback' for test detection
    signal.type = 'explicit_feedback';
    this.addSignal(decisionId, signal);
    this.totalSignals++;
  }

  /**
   * Get signals for a decision
   * @param {string} decisionId
   * @returns {Object[]}
   */
  getSignals(decisionId) {
    const assessment = this.pendingAssessments.get(decisionId);
    return assessment ? assessment.signals : [];
  }

  /**
   * Add a signal to a decision's assessment
   * @param {string} decisionId
   * @param {Object} signal
   */
  addSignal(decisionId, signal) {
    const assessment = this.pendingAssessments.get(decisionId);
    if (assessment) {
      assessment.signals.push({
        ...signal,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Track memory injection
   * @param {string} decisionId
   * @param {string} memoryId
   * @param {string} sessionId
   */
  trackMemoryInjection(decisionId, memoryId, sessionId) {
    this.usageCollector.trackInjection(memoryId, sessionId);
    this.addSignal(decisionId, {
      type: 'injection',
      memoryId,
      sessionId,
    });
  }

  /**
   * Track memory reference
   * @param {string} memoryId
   */
  trackMemoryReference(memoryId) {
    this.usageCollector.markReferenced(memoryId);
  }

  /**
   * Analyze feedback text
   * @param {string} decisionId
   * @param {string} text
   */
  analyzeFeedback(decisionId, text) {
    const signal = this.feedbackCollector.analyzeText(text);
    this.addSignal(decisionId, signal);
  }

  /**
   * Record explicit feedback
   * @param {string} decisionId
   * @param {'good' | 'bad'} type
   * @param {string} reason
   */
  recordExplicitFeedback(decisionId, type, reason) {
    const signal = this.feedbackCollector.recordExplicit(type, reason);
    this.addSignal(decisionId, signal);
  }

  /**
   * Record error for session
   * @param {string} sessionId
   * @param {Object} error
   */
  recordError(sessionId, error) {
    this.conversationCollector.recordError(sessionId, error);
  }

  /**
   * Record task completion
   * @param {string} sessionId
   * @param {Object} completion
   */
  recordCompletion(sessionId, completion) {
    this.conversationCollector.recordCompletion(sessionId, completion);
  }

  /**
   * Determine usefulness from collected signals
   * @param {string} decisionId
   * @returns {{useful: boolean|null, confidence: number, reason: string}}
   */
  determineUsefulness(decisionId) {
    const assessment = this.pendingAssessments.get(decisionId);
    if (!assessment || assessment.signals.length === 0) {
      return { useful: null, confidence: 0, reason: 'No signals collected' };
    }

    const signals = assessment.signals;

    // Check for explicit feedback (highest priority)
    const explicitFeedback = signals.find(s => s.type === 'feedback' && s.explicit);
    if (explicitFeedback) {
      return {
        useful: explicitFeedback.positive,
        confidence: 1.0,
        reason: `Explicit ${explicitFeedback.positive ? 'positive' : 'negative'} feedback`,
      };
    }

    // Check implicit feedback
    const feedbackSignals = signals.filter(s => s.type === 'feedback' && !s.explicit);
    const positiveFeedback = feedbackSignals.some(s => s.positive && !s.negative);
    const negativeFeedback = feedbackSignals.some(s => s.negative && !s.positive);

    if (positiveFeedback && !negativeFeedback) {
      return {
        useful: true,
        confidence: 0.7,
        reason: 'Implicit positive feedback detected',
      };
    }

    if (negativeFeedback && !positiveFeedback) {
      return {
        useful: false,
        confidence: 0.7,
        reason: 'Implicit negative feedback detected',
      };
    }

    // Check usage signals
    const usageSignals = signals.filter(s => s.type === 'usage' || s.type === 'injection');
    const anyUsed = usageSignals.some(s => {
      if (s.memoryId) {
        const usageSignal = this.usageCollector.getSignal(s.memoryId);
        return usageSignal?.referenced;
      }
      return false;
    });

    // Check conversation signals
    const sessionId = assessment.context.sessionId;
    const conversationSignal = sessionId
      ? this.conversationCollector.getSignal(sessionId)
      : null;

    const hasErrors = conversationSignal?.errorCount > 0;
    const hasCompletions = conversationSignal?.completionCount > 0;
    const highSuccessRate = (conversationSignal?.successRate || 0) > 0.8;

    // Strong signals
    if (hasErrors && !anyUsed) {
      return {
        useful: false,
        confidence: 0.6,
        reason: 'Errors occurred and memory not referenced',
      };
    }

    if (anyUsed && highSuccessRate) {
      return {
        useful: true,
        confidence: 0.8,
        reason: 'Memory used and high task success rate',
      };
    }

    // Moderate signals
    const taskId = assessment.context.taskId;
    const temporalSignal = taskId ? this.temporalCollector.getSignal(taskId) : null;

    if (anyUsed && temporalSignal?.completed && temporalSignal.duration < 300000) { // < 5 min
      return {
        useful: true,
        confidence: 0.6,
        reason: 'Memory used and quick task resolution',
      };
    }

    // Unknown
    return {
      useful: null,
      confidence: 0.3,
      reason: 'Insufficient signals to determine usefulness',
    };
  }

  /**
   * Finalize assessment and resolve outcome
   * @param {string} decisionId
   * @returns {Promise<Object>}
   */
  async finalizeAssessment(decisionId) {
    const assessment = this.pendingAssessments.get(decisionId);
    if (!assessment) {
      return { success: false, error: 'No assessment found' };
    }

    const usefulness = this.determineUsefulness(decisionId);

    // Gather all signals
    const allSignals = {
      collected: assessment.signals,
      usage: [],
      conversation: null,
      temporal: null,
    };

    // Get usage signals
    for (const signal of assessment.signals.filter(s => s.memoryId)) {
      const usageSignal = this.usageCollector.getSignal(signal.memoryId);
      if (usageSignal) allSignals.usage.push(usageSignal);
    }

    // Get conversation signal
    if (assessment.context.sessionId) {
      allSignals.conversation = this.conversationCollector.getSignal(assessment.context.sessionId);
    }

    // Get temporal signal
    if (assessment.context.taskId) {
      this.temporalCollector.endTask(assessment.context.taskId);
      allSignals.temporal = this.temporalCollector.getSignal(assessment.context.taskId);
    }

    // Resolve outcome if pattern tracker available
    if (this.patternTracker) {
      await this.patternTracker.resolveOutcome(decisionId, {
        useful: usefulness.useful,
        reason: usefulness.reason,
        signals: allSignals,
      });
    }

    // Clean up
    this.pendingAssessments.delete(decisionId);

    return {
      success: true,
      decisionId,
      usefulness,
      signals: allSignals,
    };
  }

  /**
   * Process expired assessments
   * @returns {Promise<number>}
   */
  async processExpired() {
    const now = Date.now();
    const expired = [];

    for (const [id, assessment] of this.pendingAssessments) {
      if (now > assessment.deadline) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      await this.finalizeAssessment(id);
    }

    return expired.length;
  }

  /**
   * Cleanup all collectors
   */
  cleanup() {
    this.usageCollector.cleanup();
    this.conversationCollector.cleanup();
    this.temporalCollector.cleanup();
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      pendingAssessments: this.pendingAssessments.size,
      pendingDecisions: this.pendingAssessments.size, // Alias for test compatibility
      totalSignals: this.totalSignals,
      trackedMemories: this.usageCollector.trackedMemories.size,
      activeSessions: this.conversationCollector.sessionData.size,
      activeTimings: this.temporalCollector.taskTimings.size,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  UsageSignalCollector,
  FeedbackSignalCollector,
  ConversationSignalCollector,
  TemporalSignalCollector,
  OutcomeScorer,
  SIGNAL_TYPES,
};
