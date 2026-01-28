#!/usr/bin/env node
/**
 * Cortex Audit Logger Module
 *
 * Provides comprehensive audit logging for all Cortex operations.
 * Logs are structured JSONL for easy analysis and debugging.
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Log levels with numeric priority
 */
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  AUDIT: 4, // Always logged, regardless of level
};

/**
 * Default log directory
 */
const DEFAULT_LOG_DIR = path.join(process.env.HOME, '.claude', 'memory', 'logs');

/**
 * Maximum log file size before rotation (10MB)
 */
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/**
 * Maximum number of rotated log files to keep
 */
const MAX_LOG_FILES = 5;

// =============================================================================
// AUDIT LOGGER CLASS
// =============================================================================

/**
 * Structured audit logger with rotation support
 */
class AuditLogger {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.logDir - Directory for log files
   * @param {string} options.logLevel - Minimum log level to record
   * @param {boolean} options.enabled - Whether logging is enabled
   * @param {boolean} options.consoleOutput - Also output to stderr
   */
  constructor(options = {}) {
    this.logDir = options.logDir || DEFAULT_LOG_DIR;
    this.logLevel = LOG_LEVELS[options.logLevel?.toUpperCase()] ?? LOG_LEVELS.INFO;
    this.enabled = options.enabled !== false;
    this.consoleOutput = options.consoleOutput || false;

    // Ensure log directory exists
    if (this.enabled) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch (error) {
        this.enabled = false;
        console.error(`[AuditLogger] Failed to create log directory: ${error.message}`);
      }
    }

    // Session ID for correlating logs
    this.sessionId = this._generateSessionId();
    this.startTime = Date.now();

    // Log rotation state
    this._lastRotationCheck = 0;
    this._rotationCheckInterval = 60000; // Check every minute
  }

  /**
   * Generate a unique session ID
   * @returns {string}
   * @private
   */
  _generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * Get the current log file path
   * @returns {string}
   * @private
   */
  _getLogFilePath() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `cortex-${date}.jsonl`);
  }

  /**
   * Check and perform log rotation if needed
   * @private
   */
  _checkRotation() {
    const now = Date.now();
    if (now - this._lastRotationCheck < this._rotationCheckInterval) {
      return;
    }
    this._lastRotationCheck = now;

    const logFile = this._getLogFilePath();
    try {
      if (!fs.existsSync(logFile)) return;

      const stats = fs.statSync(logFile);
      if (stats.size < MAX_LOG_SIZE) return;

      // Rotate: rename current file with timestamp
      const timestamp = Date.now();
      const rotatedPath = logFile.replace('.jsonl', `-${timestamp}.jsonl`);
      fs.renameSync(logFile, rotatedPath);

      // Clean up old rotated files
      this._cleanupOldLogs();
    } catch (error) {
      // Ignore rotation errors
    }
  }

  /**
   * Remove old rotated log files
   * @private
   */
  _cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('cortex-') && f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          time: fs.statSync(path.join(this.logDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time); // Newest first

      // Remove files beyond the limit
      files.slice(MAX_LOG_FILES).forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {
          // Ignore deletion errors
        }
      });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Write a log entry
   * @param {string} level - Log level
   * @param {string} event - Event type
   * @param {Object} data - Event data
   * @private
   */
  _write(level, event, data) {
    if (!this.enabled) return;
    if (LOG_LEVELS[level] < this.logLevel && level !== 'AUDIT') return;

    this._checkRotation();

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      sessionId: this.sessionId,
      event,
      ...data,
    };

    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(this._getLogFilePath(), line, 'utf8');
    } catch (error) {
      // Silently fail if we can't write
    }

    if (this.consoleOutput) {
      const emoji = level === 'ERROR' ? '❌' :
                    level === 'WARN' ? '⚠️' :
                    level === 'AUDIT' ? '📋' : 'ℹ️';
      process.stderr.write(`[Cortex] ${emoji} ${event}\n`);
    }
  }

  // ===========================================================================
  // PUBLIC LOGGING METHODS
  // ===========================================================================

  /**
   * Log a debug message
   * @param {string} event - Event description
   * @param {Object} data - Additional data
   */
  debug(event, data = {}) {
    this._write('DEBUG', event, data);
  }

  /**
   * Log an info message
   * @param {string} event - Event description
   * @param {Object} data - Additional data
   */
  info(event, data = {}) {
    this._write('INFO', event, data);
  }

  /**
   * Log a warning
   * @param {string} event - Event description
   * @param {Object} data - Additional data
   */
  warn(event, data = {}) {
    this._write('WARN', event, data);
  }

  /**
   * Log an error
   * @param {string} event - Event description
   * @param {Object} data - Additional data
   */
  error(event, data = {}) {
    this._write('ERROR', event, data);
  }

  // ===========================================================================
  // AUDIT-SPECIFIC METHODS
  // ===========================================================================

  /**
   * Log a tool call start
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Tool arguments (sanitized)
   * @returns {string} - Call ID for correlation
   */
  toolCallStart(toolName, args = {}) {
    const callId = `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Sanitize args: truncate long strings, remove sensitive data
    const sanitizedArgs = this._sanitizeArgs(args);

    this._write('AUDIT', 'tool_call_start', {
      callId,
      tool: toolName,
      args: sanitizedArgs,
    });

    return callId;
  }

  /**
   * Log a tool call completion
   * @param {string} callId - Call ID from toolCallStart
   * @param {boolean} success - Whether the call succeeded
   * @param {number} durationMs - Duration in milliseconds
   * @param {Object} metadata - Additional metadata
   */
  toolCallEnd(callId, success, durationMs, metadata = {}) {
    this._write('AUDIT', 'tool_call_end', {
      callId,
      success,
      durationMs,
      ...metadata,
    });
  }

  /**
   * Log a tool call error
   * @param {string} callId - Call ID from toolCallStart
   * @param {string} errorCode - Error code
   * @param {string} errorMessage - Error message
   * @param {number} durationMs - Duration in milliseconds
   */
  toolCallError(callId, errorCode, errorMessage, durationMs) {
    this._write('AUDIT', 'tool_call_error', {
      callId,
      errorCode,
      errorMessage,
      durationMs,
    });
  }

  /**
   * Log a rate limit event
   * @param {string} toolName - Tool that was limited
   * @param {string} reason - Why it was limited
   * @param {number} retryAfter - Seconds until retry allowed
   */
  rateLimitHit(toolName, reason, retryAfter) {
    this._write('AUDIT', 'rate_limit_hit', {
      tool: toolName,
      reason,
      retryAfter,
    });
  }

  /**
   * Log a validation failure
   * @param {string} toolName - Tool with validation failure
   * @param {string} field - Field that failed
   * @param {string} reason - Validation error
   */
  validationFailure(toolName, field, reason) {
    this._write('AUDIT', 'validation_failure', {
      tool: toolName,
      field,
      reason,
    });
  }

  /**
   * Log a resource access
   * @param {string} uri - Resource URI
   * @param {boolean} found - Whether resource was found
   */
  resourceAccess(uri, found) {
    this._write('AUDIT', 'resource_access', {
      uri,
      found,
    });
  }

  /**
   * Log a prompt retrieval
   * @param {string} promptName - Prompt name
   * @param {Object} args - Prompt arguments
   */
  promptAccess(promptName, args = {}) {
    this._write('AUDIT', 'prompt_access', {
      prompt: promptName,
      args: this._sanitizeArgs(args),
    });
  }

  /**
   * Log session start
   */
  sessionStart() {
    this._write('AUDIT', 'session_start', {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
    });
  }

  /**
   * Log session end
   */
  sessionEnd() {
    const duration = Date.now() - this.startTime;
    this._write('AUDIT', 'session_end', {
      durationMs: duration,
    });
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Sanitize arguments for logging (truncate, remove sensitive data)
   * @param {Object} args - Arguments to sanitize
   * @returns {Object} - Sanitized arguments
   * @private
   */
  _sanitizeArgs(args) {
    if (!args || typeof args !== 'object') return args;

    const sanitized = {};
    const maxLength = 200;

    for (const [key, value] of Object.entries(args)) {
      // Skip potentially sensitive fields
      if (['password', 'token', 'secret', 'key', 'credential'].some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      if (typeof value === 'string' && value.length > maxLength) {
        sanitized[key] = value.substring(0, maxLength) + `... (${value.length} chars)`;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.length > 10 ? `[Array: ${value.length} items]` : value;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get session statistics
   * @returns {Object}
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      startTime: new Date(this.startTime).toISOString(),
      uptime: Date.now() - this.startTime,
      logFile: this._getLogFilePath(),
      enabled: this.enabled,
      logLevel: Object.entries(LOG_LEVELS).find(([, v]) => v === this.logLevel)?.[0],
    };
  }

  /**
   * Disable logging
   */
  disable() {
    this.enabled = false;
  }

  /**
   * Enable logging
   */
  enable() {
    this.enabled = true;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  AuditLogger,
  LOG_LEVELS,
  DEFAULT_LOG_DIR,
};
