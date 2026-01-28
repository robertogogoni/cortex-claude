#!/usr/bin/env node
/**
 * Cortex Rate Limiter Module
 *
 * Prevents runaway API costs by limiting tool call frequency.
 * Uses sliding window algorithm for smooth rate limiting.
 *
 * @version 1.0.0
 */

'use strict';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default rate limits per tool (calls per minute)
 * Haiku tools: Higher limits (cheap, fast)
 * Sonnet tools: Lower limits (expensive, slow)
 */
const DEFAULT_LIMITS = {
  // Haiku-powered (fast, cheap ~$0.25/1M tokens)
  'cortex__query': { perMinute: 30, perHour: 300, perDay: 1000 },
  'cortex__recall': { perMinute: 30, perHour: 300, perDay: 1000 },

  // Sonnet-powered (slow, expensive ~$3/1M tokens)
  'cortex__reflect': { perMinute: 10, perHour: 60, perDay: 200 },
  'cortex__infer': { perMinute: 10, perHour: 60, perDay: 200 },
  'cortex__learn': { perMinute: 15, perHour: 100, perDay: 300 },
  'cortex__consolidate': { perMinute: 5, perHour: 20, perDay: 50 },
};

/**
 * Burst allowance multiplier (allows temporary spikes)
 */
const BURST_MULTIPLIER = 1.5;

/**
 * Cooldown period after hitting limits (ms)
 */
const COOLDOWN_MS = 60000; // 1 minute

// =============================================================================
// RATE LIMITER CLASS
// =============================================================================

/**
 * Sliding window rate limiter with per-tool tracking
 */
class RateLimiter {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.limits - Override default limits per tool
   * @param {boolean} options.enabled - Whether rate limiting is enabled
   * @param {Function} options.onLimitReached - Callback when limit is reached
   */
  constructor(options = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.enabled = options.enabled !== false;
    this.onLimitReached = options.onLimitReached || null;

    // Sliding window storage: tool -> [timestamp, timestamp, ...]
    this.windows = new Map();

    // Cooldown tracking: tool -> cooldown end timestamp
    this.cooldowns = new Map();

    // Usage statistics
    this.stats = {
      totalCalls: 0,
      limitedCalls: 0,
      callsByTool: {},
      lastReset: Date.now(),
    };
  }

  /**
   * Check if a tool call is allowed
   * @param {string} toolName - Name of the tool
   * @returns {{allowed: boolean, reason?: string, retryAfter?: number}}
   */
  check(toolName) {
    if (!this.enabled) {
      return { allowed: true };
    }

    const now = Date.now();
    const limits = this.limits[toolName];

    // Unknown tool - allow but log
    if (!limits) {
      return { allowed: true };
    }

    // Check cooldown first
    const cooldownEnd = this.cooldowns.get(toolName);
    if (cooldownEnd && now < cooldownEnd) {
      const retryAfter = Math.ceil((cooldownEnd - now) / 1000);
      return {
        allowed: false,
        reason: `Tool ${toolName} is in cooldown`,
        retryAfter,
      };
    }

    // Get or create window for this tool
    if (!this.windows.has(toolName)) {
      this.windows.set(toolName, []);
    }
    const window = this.windows.get(toolName);

    // Clean old entries (older than 24 hours)
    const oneDayAgo = now - 86400000;
    const oneHourAgo = now - 3600000;
    const oneMinuteAgo = now - 60000;

    // Filter to keep only relevant timestamps
    const filtered = window.filter(ts => ts > oneDayAgo);
    this.windows.set(toolName, filtered);

    // Count calls in each window
    const callsLastMinute = filtered.filter(ts => ts > oneMinuteAgo).length;
    const callsLastHour = filtered.filter(ts => ts > oneHourAgo).length;
    const callsLastDay = filtered.length;

    // Check against limits (with burst allowance for per-minute)
    const burstLimit = Math.floor(limits.perMinute * BURST_MULTIPLIER);

    if (callsLastMinute >= burstLimit) {
      this._triggerCooldown(toolName);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${callsLastMinute}/${limits.perMinute} calls/minute`,
        retryAfter: 60,
      };
    }

    if (callsLastHour >= limits.perHour) {
      return {
        allowed: false,
        reason: `Hourly limit exceeded: ${callsLastHour}/${limits.perHour} calls/hour`,
        retryAfter: 3600 - Math.floor((now - oneHourAgo) / 1000),
      };
    }

    if (callsLastDay >= limits.perDay) {
      return {
        allowed: false,
        reason: `Daily limit exceeded: ${callsLastDay}/${limits.perDay} calls/day`,
        retryAfter: 86400 - Math.floor((now - oneDayAgo) / 1000),
      };
    }

    return { allowed: true };
  }

  /**
   * Record a tool call
   * @param {string} toolName - Name of the tool
   */
  record(toolName) {
    if (!this.enabled) return;

    const now = Date.now();

    // Initialize window if needed
    if (!this.windows.has(toolName)) {
      this.windows.set(toolName, []);
    }

    // Record the call
    this.windows.get(toolName).push(now);

    // Update stats
    this.stats.totalCalls++;
    this.stats.callsByTool[toolName] = (this.stats.callsByTool[toolName] || 0) + 1;
  }

  /**
   * Trigger cooldown for a tool
   * @param {string} toolName - Name of the tool
   * @private
   */
  _triggerCooldown(toolName) {
    const cooldownEnd = Date.now() + COOLDOWN_MS;
    this.cooldowns.set(toolName, cooldownEnd);
    this.stats.limitedCalls++;

    if (this.onLimitReached) {
      this.onLimitReached(toolName, {
        cooldownEnd,
        stats: this.getStats(toolName),
      });
    }
  }

  /**
   * Get usage statistics for a tool (or all tools)
   * @param {string} [toolName] - Optional tool name
   * @returns {Object} Statistics
   */
  getStats(toolName) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    if (toolName) {
      const window = this.windows.get(toolName) || [];
      const limits = this.limits[toolName] || DEFAULT_LIMITS['cortex__query'];

      return {
        tool: toolName,
        limits,
        usage: {
          lastMinute: window.filter(ts => ts > oneMinuteAgo).length,
          lastHour: window.filter(ts => ts > oneHourAgo).length,
          lastDay: window.filter(ts => ts > oneDayAgo).length,
        },
        cooldown: this.cooldowns.get(toolName) || null,
        totalCalls: this.stats.callsByTool[toolName] || 0,
      };
    }

    // All tools stats
    const toolStats = {};
    for (const tool of Object.keys(this.limits)) {
      toolStats[tool] = this.getStats(tool);
    }

    return {
      enabled: this.enabled,
      totalCalls: this.stats.totalCalls,
      limitedCalls: this.stats.limitedCalls,
      uptime: now - this.stats.lastReset,
      tools: toolStats,
    };
  }

  /**
   * Reset all rate limit windows
   */
  reset() {
    this.windows.clear();
    this.cooldowns.clear();
    this.stats = {
      totalCalls: 0,
      limitedCalls: 0,
      callsByTool: {},
      lastReset: Date.now(),
    };
  }

  /**
   * Temporarily disable rate limiting
   */
  disable() {
    this.enabled = false;
  }

  /**
   * Re-enable rate limiting
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Update limits for a specific tool
   * @param {string} toolName - Tool name
   * @param {Object} limits - New limits {perMinute, perHour, perDay}
   */
  setLimits(toolName, limits) {
    this.limits[toolName] = { ...this.limits[toolName], ...limits };
  }
}

// =============================================================================
// RATE LIMIT ERROR CLASS
// =============================================================================

/**
 * Custom error for rate limit violations
 */
class RateLimitError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} retryAfter - Seconds until retry is allowed
   * @param {string} [code='CORTEX_E310'] - Error code
   */
  constructor(message, retryAfter, code = 'CORTEX_E310') {
    super(message);
    this.name = 'RateLimitError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  RateLimiter,
  RateLimitError,
  DEFAULT_LIMITS,
  BURST_MULTIPLIER,
  COOLDOWN_MS,
};
