/**
 * Cortex - Claude's Cognitive Layer - Error Handler
 *
 * Comprehensive error handling with:
 * - Circuit breaker pattern (prevent cascade failures)
 * - Retry with exponential backoff
 * - Graceful degradation levels
 * - Error logging and telemetry
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ERROR_CODES, getTimestamp, sleep, expandPath } = require('./types.cjs');

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

/**
 * @typedef {'closed' | 'open' | 'half-open'} CircuitState
 */

class CircuitBreaker {
  /**
   * @param {string|Object} nameOrOptions - Identifier for this circuit OR options object
   * @param {Object} options
   * @param {number} options.threshold - Failures before opening
   * @param {number} options.resetTimeout - Time before trying again (alias for resetTimeoutMs)
   * @param {number} options.resetTimeoutMs - Time before trying again
   * @param {number} options.halfOpenRequests - Requests to try in half-open
   */
  constructor(nameOrOptions, options = {}) {
    // Support both CircuitBreaker('name', {opts}) and CircuitBreaker({opts})
    if (typeof nameOrOptions === 'object') {
      options = nameOrOptions;
      this.name = options.name || 'default';
    } else {
      this.name = nameOrOptions || 'default';
    }

    this.threshold = options.threshold || 5;
    // Support both resetTimeout and resetTimeoutMs
    this.resetTimeoutMs = options.resetTimeoutMs || options.resetTimeout || 30000;
    this.halfOpenRequests = options.halfOpenRequests || 3;

    /** @type {CircuitState} */
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();

    // Stats
    this.stats = {
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      timesOpened: 0,
      lastError: null,
    };
  }

  /**
   * Check if request should be allowed
   * @returns {boolean}
   */
  canExecute() {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if enough time has passed to try again
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.resetTimeoutMs) {
        this._transition('half-open');
        return true;
      }
      return false;
    }

    // Half-open: allow limited requests
    return this.successes < this.halfOpenRequests;
  }

  /**
   * Record a successful execution
   */
  recordSuccess() {
    this.stats.totalCalls++;
    this.stats.totalSuccesses++;
    this.successes++;

    if (this.state === 'half-open') {
      if (this.successes >= this.halfOpenRequests) {
        this._transition('closed');
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  /**
   * Record a failed execution
   * @param {Error|string} error
   */
  recordFailure(error) {
    this.stats.totalCalls++;
    this.stats.totalFailures++;
    this.stats.lastError = error?.message || String(error);
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'closed') {
      if (this.failures >= this.threshold) {
        this._transition('open');
      }
    } else if (this.state === 'half-open') {
      // Any failure in half-open goes back to open
      this._transition('open');
    }
  }

  /**
   * Transition to a new state
   * @param {CircuitState} newState
   */
  _transition(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'open') {
      this.stats.timesOpened++;
    }

    if (newState === 'closed' || newState === 'half-open') {
      this.failures = 0;
      this.successes = 0;
    }

    // Could emit event here for monitoring
    console.log(`[CircuitBreaker:${this.name}] ${oldState} → ${newState}`);
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn
   * @returns {Promise<{success: boolean, result?: any, error?: string, blocked?: boolean}>}
   */
  async execute(fn) {
    if (!this.canExecute()) {
      return {
        success: false,
        blocked: true,
        error: `Circuit breaker ${this.name} is open`,
        state: this.state,
      };
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return { success: true, result };
    } catch (error) {
      this.recordFailure(error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get circuit breaker status
   * @returns {Object}
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      timeSinceLastChange: Date.now() - this.lastStateChange,
      stats: { ...this.stats },
    };
  }

  /**
   * Manually reset the circuit
   */
  reset() {
    this._transition('closed');
  }
}

// =============================================================================
// RETRY HANDLER
// =============================================================================

class RetryHandler {
  /**
   * @param {Object} options
   * @param {number} options.maxAttempts - Max attempts (alias: maxRetries)
   * @param {number} options.maxRetries - Alias for maxAttempts
   * @param {number} options.initialDelayMs - Initial delay (alias: baseDelayMs)
   * @param {number} options.baseDelayMs - Alias for initialDelayMs
   * @param {number} options.maxDelayMs
   * @param {number} options.backoffMultiplier
   */
  constructor(options = {}) {
    // Support both maxAttempts and maxRetries (alias)
    this.maxAttempts = options.maxAttempts || options.maxRetries || 3;
    // Support both initialDelayMs and baseDelayMs (alias)
    this.initialDelayMs = options.initialDelayMs || options.baseDelayMs || 100;
    this.maxDelayMs = options.maxDelayMs || 5000;
    this.backoffMultiplier = options.backoffMultiplier || 2;
  }

  /**
   * Calculate delay for attempt number
   * @param {number} attempt
   * @returns {number}
   */
  getDelay(attempt) {
    const delay = this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.maxDelayMs);
  }

  /**
   * Execute function with retry logic
   * @param {Function} fn
   * @param {Object} options
   * @param {Function} options.shouldRetry - Check if error is retryable
   * @param {Function} options.onRetry - Called before each retry
   * @returns {Promise<{success: boolean, result?: any, attempts: number, errors: string[]}>}
   */
  async execute(fn, options = {}) {
    const shouldRetry = options.shouldRetry || (() => true);
    const onRetry = options.onRetry || (() => {});
    const errors = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const result = await fn();
        return { success: true, result, attempts: attempt, errors };
      } catch (error) {
        errors.push(error.message);

        if (attempt === this.maxAttempts) {
          return { success: false, attempts: attempt, errors };
        }

        if (!shouldRetry(error)) {
          return { success: false, attempts: attempt, errors, nonRetryable: true };
        }

        const delay = this.getDelay(attempt);
        await onRetry({ attempt, error, nextDelay: delay });
        await sleep(delay);
      }
    }

    return { success: false, attempts: this.maxAttempts, errors };
  }
}

// =============================================================================
// GRACEFUL DEGRADATION
// =============================================================================

/**
 * @typedef {'Full' | 'Degraded' | 'Minimal' | 'Emergency'} DegradationLevel
 */

class GracefulDegradationManager {
  /**
   * @param {Object} options
   * @param {Function} options.onLevelChange - Called when level changes
   */
  constructor(options = {}) {
    this.onLevelChange = options.onLevelChange || (() => {});

    /** @type {DegradationLevel} */
    this.currentLevel = 'Full';
    this.levelHistory = [];
    this.capabilities = this._getCapabilities('Full');

    // Component health tracking
    this.componentHealth = new Map();
  }

  /**
   * Get capabilities for a degradation level
   * @param {DegradationLevel} level
   * @returns {Object}
   */
  _getCapabilities(level) {
    const capabilities = {
      Full: {
        aiClassification: true,
        episodicMemory: true,
        knowledgeGraph: true,
        localMemory: true,
        patternTracking: true,
        configEvolution: true,
        caching: true,
        writeOperations: true,
      },
      Degraded: {
        aiClassification: false, // Disable AI classification
        episodicMemory: true,
        knowledgeGraph: true,
        localMemory: true,
        patternTracking: true,
        configEvolution: false, // Disable auto-evolution
        caching: true,
        writeOperations: true,
      },
      Minimal: {
        aiClassification: false,
        episodicMemory: false, // External MCP disabled
        knowledgeGraph: false,
        localMemory: true,
        patternTracking: false,
        configEvolution: false,
        caching: true,
        writeOperations: true,
      },
      Emergency: {
        aiClassification: false,
        episodicMemory: false,
        knowledgeGraph: false,
        localMemory: true,
        patternTracking: false,
        configEvolution: false,
        caching: true,
        writeOperations: false, // Read-only mode
      },
    };

    return capabilities[level];
  }

  /**
   * Report component health
   * @param {string} component
   * @param {boolean} healthy
   * @param {string} reason
   */
  reportHealth(component, healthy, reason = '') {
    this.componentHealth.set(component, {
      healthy,
      reason,
      lastUpdated: Date.now(),
    });

    // Evaluate if degradation level should change
    this._evaluateLevel();
  }

  /**
   * Evaluate and potentially change degradation level
   */
  _evaluateLevel() {
    const health = Object.fromEntries(this.componentHealth);

    // Count unhealthy components
    let unhealthyCount = 0;
    let criticalUnhealthy = false;

    for (const [component, status] of this.componentHealth) {
      if (!status.healthy) {
        unhealthyCount++;
        if (component === 'storage' || component === 'config') {
          criticalUnhealthy = true;
        }
      }
    }

    // Determine appropriate level
    let newLevel = 'Full';

    if (criticalUnhealthy) {
      newLevel = 'Emergency';
    } else if (unhealthyCount >= 3) {
      newLevel = 'Minimal';
    } else if (unhealthyCount >= 1) {
      newLevel = 'Degraded';
    }

    if (newLevel !== this.currentLevel) {
      this._setLevel(newLevel);
    }
  }

  /**
   * Set degradation level
   * @param {DegradationLevel} level
   */
  _setLevel(level) {
    const oldLevel = this.currentLevel;
    this.currentLevel = level;
    this.capabilities = this._getCapabilities(level);

    this.levelHistory.push({
      from: oldLevel,
      to: level,
      timestamp: getTimestamp(),
      componentHealth: Object.fromEntries(this.componentHealth),
    });

    // Keep only last 100 history entries
    if (this.levelHistory.length > 100) {
      this.levelHistory = this.levelHistory.slice(-100);
    }

    this.onLevelChange(oldLevel, level, this.capabilities);
    console.log(`[Degradation] ${oldLevel} → ${level}`);
  }

  /**
   * Check if a capability is available
   * @param {string} capability
   * @returns {boolean}
   */
  hasCapability(capability) {
    return this.capabilities[capability] === true;
  }

  /**
   * Alias for hasCapability (test compatibility)
   * @param {string} capability
   * @returns {boolean}
   */
  isCapabilityEnabled(capability) {
    return this.hasCapability(capability);
  }

  /**
   * Get set of unhealthy components (test compatibility)
   * @returns {Set<string>}
   */
  get unhealthyComponents() {
    const unhealthy = new Set();
    for (const [component, status] of this.componentHealth) {
      if (!status.healthy) {
        unhealthy.add(component);
      }
    }
    return unhealthy;
  }

  /**
   * Force a specific degradation level
   * @param {DegradationLevel} level
   */
  forceLevel(level) {
    this._setLevel(level);
  }

  /**
   * Get current status
   * @returns {Object}
   */
  getStatus() {
    return {
      level: this.currentLevel,
      capabilities: { ...this.capabilities },
      componentHealth: Object.fromEntries(this.componentHealth),
      historyLength: this.levelHistory.length,
    };
  }
}

// =============================================================================
// ERROR LOGGER
// =============================================================================

class ErrorLogger {
  /**
   * @param {string} logDir
   */
  constructor(logDir = '~/.claude/memory/logs') {
    this.logDir = expandPath(logDir);

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Get log file path for current date
   * @returns {string}
   */
  _getLogPath() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `errors-${date}.jsonl`);
  }

  /**
   * Log an error
   * @param {Object} error
   */
  log(error) {
    const entry = {
      timestamp: getTimestamp(),
      pid: process.pid,
      ...error,
    };

    const logPath = this._getLogPath();
    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(logPath, line, { mode: 0o600 });
    } catch (e) {
      // Can't log? Write to stderr
      console.error('[ErrorLogger] Failed to write log:', e.message);
      console.error('[ErrorLogger] Original error:', entry);
    }
  }

  /**
   * Read recent errors
   * @param {number} limit
   * @returns {Object[]}
   */
  readRecent(limit = 50) {
    const logPath = this._getLogPath();

    if (!fs.existsSync(logPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const errors = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      return errors.slice(-limit);
    } catch (e) {
      return [];
    }
  }

  /**
   * Clean old log files
   * @param {number} keepDays
   */
  cleanup(keepDays = 7) {
    const cutoff = Date.now() - (keepDays * 24 * 60 * 60 * 1000);

    try {
      const files = fs.readdirSync(this.logDir);

      for (const file of files) {
        if (!file.startsWith('errors-')) continue;

        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);

        if (stat.mtime.getTime() < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// =============================================================================
// UNIFIED ERROR HANDLER
// =============================================================================

class ErrorHandler {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.config = {
      circuitBreaker: options.circuitBreaker || { threshold: 5, resetTimeoutMs: 30000 },
      retry: options.retry || { maxAttempts: 3, initialDelayMs: 100 },
    };

    // Circuit breakers by component
    this.circuits = new Map();

    // Retry handler
    this.retryHandler = new RetryHandler(this.config.retry);

    // Graceful degradation
    this.degradation = new GracefulDegradationManager({
      onLevelChange: (from, to, caps) => {
        this.logger.log({
          type: 'degradation_change',
          from,
          to,
          capabilities: caps,
        });
      },
    });

    // Error logger
    this.logger = new ErrorLogger(options.logDir);
  }

  /**
   * Get or create circuit breaker for a component
   * @param {string} component
   * @returns {CircuitBreaker}
   */
  getCircuit(component) {
    if (!this.circuits.has(component)) {
      this.circuits.set(component, new CircuitBreaker(component, this.config.circuitBreaker));
    }
    return this.circuits.get(component);
  }

  /**
   * Handle an error
   * @param {Error|string} error
   * @param {Object} context
   * @returns {Object}
   */
  handleError(error, context = {}) {
    const errorInfo = {
      message: error?.message || String(error),
      stack: error?.stack,
      code: context.code || 'UNKNOWN',
      component: context.component || 'unknown',
      operation: context.operation || 'unknown',
      context,
    };

    // Log error
    this.logger.log(errorInfo);

    // Update circuit breaker if component specified
    if (context.component) {
      const circuit = this.getCircuit(context.component);
      circuit.recordFailure(error);

      // Report health to degradation manager
      if (circuit.state === 'open') {
        this.degradation.reportHealth(context.component, false, errorInfo.message);
      }
    }

    // Return recovery suggestion
    return {
      logged: true,
      code: errorInfo.code,
      recoverable: ERROR_CODES[errorInfo.code]?.recoverable ?? true,
      suggestion: this._getSuggestion(errorInfo),
    };
  }

  /**
   * Get recovery suggestion for an error
   * @param {Object} errorInfo
   * @returns {string}
   */
  _getSuggestion(errorInfo) {
    const code = errorInfo.code;

    const suggestions = {
      STORAGE_READ_FAILED: 'Check file permissions and disk space',
      STORAGE_WRITE_FAILED: 'Check file permissions and disk space',
      STORAGE_CORRUPTED: 'Restore from backup or run repair',
      QUERY_TIMEOUT: 'Reduce query scope or increase timeout',
      CONFIG_INVALID: 'Check configuration syntax',
      NETWORK_TIMEOUT: 'Check network connection',
      API_RATE_LIMITED: 'Wait before retrying',
      LOCK_TIMEOUT: 'Wait for other operations to complete',
    };

    return suggestions[code] || 'Check logs for details';
  }

  /**
   * Report successful operation
   * @param {string} component
   */
  reportSuccess(component) {
    const circuit = this.circuits.get(component);
    if (circuit) {
      circuit.recordSuccess();

      // Report health to degradation manager
      if (circuit.state === 'closed') {
        this.degradation.reportHealth(component, true);
      }
    }
  }

  /**
   * Execute with full error handling
   * @param {string} component
   * @param {Function} fn
   * @param {Object} options
   * @returns {Promise<{success: boolean, result?: any, error?: Object}>}
   */
  async execute(component, fn, options = {}) {
    const circuit = this.getCircuit(component);

    // Check circuit breaker
    if (!circuit.canExecute()) {
      return {
        success: false,
        error: {
          code: 'CIRCUIT_OPEN',
          message: `Circuit breaker for ${component} is open`,
        },
        blocked: true,
      };
    }

    // Check capability
    if (options.capability && !this.degradation.hasCapability(options.capability)) {
      return {
        success: false,
        error: {
          code: 'CAPABILITY_DISABLED',
          message: `Capability ${options.capability} is disabled in ${this.degradation.currentLevel} mode`,
        },
        degraded: true,
      };
    }

    // Execute with retry
    const result = await this.retryHandler.execute(fn, {
      shouldRetry: options.shouldRetry,
      onRetry: ({ attempt, error, nextDelay }) => {
        this.logger.log({
          type: 'retry',
          component,
          attempt,
          error: error.message,
          nextDelayMs: nextDelay,
        });
      },
    });

    if (result.success) {
      circuit.recordSuccess();
      this.degradation.reportHealth(component, true);
      return { success: true, result: result.result };
    } else {
      circuit.recordFailure(new Error(result.errors[result.errors.length - 1]));
      this.degradation.reportHealth(component, false, result.errors[result.errors.length - 1]);

      return {
        success: false,
        error: {
          message: result.errors[result.errors.length - 1],
          attempts: result.attempts,
          allErrors: result.errors,
        },
      };
    }
  }

  /**
   * Get overall system status
   * @returns {Object}
   */
  getStatus() {
    const circuitStatuses = {};
    for (const [name, circuit] of this.circuits) {
      circuitStatuses[name] = circuit.getStatus();
    }

    return {
      degradation: this.degradation.getStatus(),
      circuits: circuitStatuses,
      recentErrors: this.logger.readRecent(10),
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let instance = null;

function getErrorHandler(options) {
  if (!instance) {
    instance = new ErrorHandler(options);
  }
  return instance;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  CircuitBreaker,
  RetryHandler,
  GracefulDegradationManager,
  ErrorLogger,
  ErrorHandler,
  getErrorHandler,
};
