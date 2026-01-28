#!/usr/bin/env node
/**
 * Cortex Error System
 *
 * Provides structured error codes with helpful suggestions.
 * Each error includes:
 * - Code: Unique identifier (e.g., CORTEX_E001)
 * - Message: Human-readable description
 * - Suggestion: How to fix the issue
 */

'use strict';

// =============================================================================
// ERROR CODES
// =============================================================================

const ERROR_CODES = {
  // API Errors (E001-E099)
  CORTEX_E001: {
    code: 'CORTEX_E001',
    category: 'api',
    message: 'Anthropic API key not configured',
    suggestion: 'Set ANTHROPIC_API_KEY environment variable. Get a key at https://console.anthropic.com/',
  },
  CORTEX_E002: {
    code: 'CORTEX_E002',
    category: 'api',
    message: 'API rate limit exceeded',
    suggestion: 'Wait a few seconds and retry. Consider using query caching or reducing request frequency.',
  },
  CORTEX_E003: {
    code: 'CORTEX_E003',
    category: 'api',
    message: 'API authentication failed',
    suggestion: 'Check that your ANTHROPIC_API_KEY is valid and has not expired.',
  },
  CORTEX_E004: {
    code: 'CORTEX_E004',
    category: 'api',
    message: 'API timeout',
    suggestion: 'The request took too long. Try a simpler query or reduce the depth parameter.',
  },
  CORTEX_E005: {
    code: 'CORTEX_E005',
    category: 'api',
    message: 'API quota exceeded',
    suggestion: 'You have reached your API usage limit. Check your Anthropic console for usage details.',
  },

  // Memory Errors (E100-E199)
  CORTEX_E100: {
    code: 'CORTEX_E100',
    category: 'memory',
    message: 'Memory file not found',
    suggestion: 'Run `/cortex health` to check if Cortex is properly installed.',
  },
  CORTEX_E101: {
    code: 'CORTEX_E101',
    category: 'memory',
    message: 'Memory file corrupted',
    suggestion: 'The JSONL file has invalid entries. Run `/cortex consolidate` to repair.',
  },
  CORTEX_E102: {
    code: 'CORTEX_E102',
    category: 'memory',
    message: 'Memory write failed',
    suggestion: 'Check disk space and file permissions for ~/.claude/memory/data/',
  },
  CORTEX_E103: {
    code: 'CORTEX_E103',
    category: 'memory',
    message: 'Memory limit exceeded',
    suggestion: 'You have too many memories. Run `/cortex consolidate` to merge duplicates.',
  },
  CORTEX_E104: {
    code: 'CORTEX_E104',
    category: 'memory',
    message: 'No memories found',
    suggestion: 'No memories match your query. Try broader search terms or use `/cortex learn` to store new memories.',
  },

  // Tool Errors (E200-E299)
  CORTEX_E200: {
    code: 'CORTEX_E200',
    category: 'tool',
    message: 'Invalid tool arguments',
    suggestion: 'Check the tool parameters. Run `/cortex help` for usage examples.',
  },
  CORTEX_E201: {
    code: 'CORTEX_E201',
    category: 'tool',
    message: 'Tool execution timeout',
    suggestion: 'The operation took too long. Try with a smaller scope or simpler query.',
  },
  CORTEX_E202: {
    code: 'CORTEX_E202',
    category: 'tool',
    message: 'Unknown tool',
    suggestion: 'This tool does not exist. Run `/cortex help` to see available commands.',
  },
  CORTEX_E203: {
    code: 'CORTEX_E203',
    category: 'tool',
    message: 'Tool requires additional context',
    suggestion: 'Provide more specific information. For example, include the topic or context parameter.',
  },

  // Configuration Errors (E300-E399)
  CORTEX_E300: {
    code: 'CORTEX_E300',
    category: 'config',
    message: 'Configuration file not found',
    suggestion: 'Cortex config is missing. Run the installation script or create ~/.claude/memory/data/configs/current.json',
  },
  CORTEX_E301: {
    code: 'CORTEX_E301',
    category: 'config',
    message: 'Invalid configuration',
    suggestion: 'The configuration file has syntax errors. Check JSON validity.',
  },
  CORTEX_E302: {
    code: 'CORTEX_E302',
    category: 'config',
    message: 'MCP server not connected',
    suggestion: 'Cortex MCP server is not running. Check ~/.claude.json and restart Claude Code.',
  },

  // Rate Limit Errors (E310-E319)
  CORTEX_E310: {
    code: 'CORTEX_E310',
    category: 'rate-limit',
    message: 'Rate limit exceeded',
    suggestion: 'Too many calls in a short period. Wait a moment before retrying.',
  },
  CORTEX_E311: {
    code: 'CORTEX_E311',
    category: 'rate-limit',
    message: 'Hourly rate limit exceeded',
    suggestion: 'You have exceeded the hourly limit. Wait or use cortex__query for cached results.',
  },
  CORTEX_E312: {
    code: 'CORTEX_E312',
    category: 'rate-limit',
    message: 'Daily rate limit exceeded',
    suggestion: 'Daily limit reached. Consider using consolidate to reduce future queries.',
  },
  CORTEX_E313: {
    code: 'CORTEX_E313',
    category: 'rate-limit',
    message: 'Tool in cooldown',
    suggestion: 'This tool was rate-limited. Wait for the cooldown to expire.',
  },

  // Encryption Errors (E500-E509)
  CORTEX_E500: {
    code: 'CORTEX_E500',
    category: 'encryption',
    message: 'Encryption operation failed',
    suggestion: 'Check that CORTEX_ENCRYPTION_SECRET is set and valid.',
  },
  CORTEX_E501: {
    code: 'CORTEX_E501',
    category: 'encryption',
    message: 'Decryption failed',
    suggestion: 'The data may be corrupted or encrypted with a different key.',
  },
  CORTEX_E502: {
    code: 'CORTEX_E502',
    category: 'encryption',
    message: 'Encryption not configured',
    suggestion: 'Set CORTEX_ENCRYPTION_SECRET environment variable to enable encryption.',
  },

  // Quality Errors (E400-E499)
  CORTEX_E400: {
    code: 'CORTEX_E400',
    category: 'quality',
    message: 'Low quality insight rejected',
    suggestion: 'The insight is too vague or short. Provide more specific, actionable knowledge.',
  },
  CORTEX_E401: {
    code: 'CORTEX_E401',
    category: 'quality',
    message: 'Duplicate insight detected',
    suggestion: 'This insight already exists. Use `/cortex query` to find existing memories.',
  },
  CORTEX_E402: {
    code: 'CORTEX_E402',
    category: 'quality',
    message: 'Insight requires context',
    suggestion: 'Add context about when/where this insight applies for better retrieval.',
  },

  // System Errors (E900-E999)
  CORTEX_E900: {
    code: 'CORTEX_E900',
    category: 'system',
    message: 'Internal error',
    suggestion: 'An unexpected error occurred. Check the logs at ~/.claude/memory/logs/',
  },
  CORTEX_E901: {
    code: 'CORTEX_E901',
    category: 'system',
    message: 'Module not found',
    suggestion: 'A required Cortex module is missing. Reinstall with: cd ~/.claude/memory && npm install',
  },
  CORTEX_E902: {
    code: 'CORTEX_E902',
    category: 'system',
    message: 'Permission denied',
    suggestion: 'Check file permissions for ~/.claude/memory/ directory.',
  },
};

// =============================================================================
// ERROR CLASS
// =============================================================================

class CortexError extends Error {
  /**
   * @param {string} code - Error code (e.g., 'CORTEX_E001')
   * @param {Object} options
   * @param {string} options.details - Additional context
   * @param {Error} options.cause - Original error
   */
  constructor(code, options = {}) {
    const errorDef = ERROR_CODES[code];

    if (!errorDef) {
      super(`Unknown error: ${code}`);
      this.code = 'CORTEX_E900';
      this.category = 'system';
      this.suggestion = 'Check the error code and logs.';
    } else {
      super(errorDef.message);
      this.code = errorDef.code;
      this.category = errorDef.category;
      this.suggestion = errorDef.suggestion;
    }

    this.name = 'CortexError';
    this.details = options.details || null;
    this.cause = options.cause || null;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Format error for display
   * @returns {string}
   */
  toDisplayString() {
    const lines = [
      `❌ ${this.code}: ${this.message}`,
      '',
      `💡 **Suggestion:** ${this.suggestion}`,
    ];

    if (this.details) {
      lines.push('');
      lines.push(`📋 **Details:** ${this.details}`);
    }

    return lines.join('\n');
  }

  /**
   * Format error for JSON response
   * @returns {Object}
   */
  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      category: this.category,
      suggestion: this.suggestion,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

// =============================================================================
// ERROR HELPERS
// =============================================================================

/**
 * Create error from API response
 * @param {Error} apiError
 * @returns {CortexError}
 */
function fromAPIError(apiError) {
  const message = apiError.message || '';

  if (message.includes('401') || message.includes('unauthorized') || message.includes('authentication')) {
    return new CortexError('CORTEX_E003', { cause: apiError, details: message });
  }

  if (message.includes('429') || message.includes('rate limit')) {
    return new CortexError('CORTEX_E002', { cause: apiError, details: message });
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new CortexError('CORTEX_E004', { cause: apiError, details: message });
  }

  if (message.includes('quota') || message.includes('limit exceeded')) {
    return new CortexError('CORTEX_E005', { cause: apiError, details: message });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new CortexError('CORTEX_E001', { cause: apiError });
  }

  return new CortexError('CORTEX_E900', { cause: apiError, details: message });
}

/**
 * Create error from memory operation
 * @param {string} operation - What failed
 * @param {Error} error
 * @returns {CortexError}
 */
function fromMemoryError(operation, error) {
  const message = error.message || '';

  if (message.includes('ENOENT') || message.includes('not found')) {
    return new CortexError('CORTEX_E100', { cause: error, details: `${operation}: ${message}` });
  }

  if (message.includes('JSON') || message.includes('parse')) {
    return new CortexError('CORTEX_E101', { cause: error, details: `${operation}: ${message}` });
  }

  if (message.includes('EACCES') || message.includes('permission')) {
    return new CortexError('CORTEX_E902', { cause: error, details: `${operation}: ${message}` });
  }

  if (message.includes('ENOSPC') || message.includes('disk')) {
    return new CortexError('CORTEX_E102', { cause: error, details: `${operation}: ${message}` });
  }

  return new CortexError('CORTEX_E900', { cause: error, details: `${operation}: ${message}` });
}

/**
 * Wrap async function with error handling
 * @param {Function} fn
 * @returns {Function}
 */
function withErrorHandling(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof CortexError) {
        throw error;
      }

      // Try to categorize the error
      if (error.message?.includes('API') || error.message?.includes('fetch')) {
        throw fromAPIError(error);
      }

      throw new CortexError('CORTEX_E900', { cause: error, details: error.message });
    }
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ERROR_CODES,
  CortexError,
  fromAPIError,
  fromMemoryError,
  withErrorHandling,
};
