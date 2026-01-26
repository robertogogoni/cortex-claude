/**
 * Cortex - Claude's Cognitive Layer - Type Definitions
 *
 * All shared types and constants for Cortex.
 * Using JSDoc for TypeScript-like documentation in CommonJS.
 */

'use strict';

// =============================================================================
// MEMORY TYPES
// =============================================================================

/**
 * @typedef {'learning' | 'pattern' | 'skill' | 'correction' | 'preference'} MemoryType
 */

/**
 * @typedef {'active' | 'archived' | 'deleted'} MemoryStatus
 */

/**
 * @typedef {Object} MemoryRecord
 * @property {string} id - UUID
 * @property {number} version - Schema version
 * @property {MemoryType} type
 * @property {string} content - Full content
 * @property {string} summary - Brief summary (< 100 chars)
 * @property {string|null} projectHash - null = global
 * @property {string[]} tags - Searchable tags
 * @property {string} intent - Original intent category
 * @property {string} sourceSessionId
 * @property {string} sourceTimestamp - ISO 8601
 * @property {number} extractionConfidence - 0.0-1.0
 * @property {number} usageCount
 * @property {number} usageSuccessRate - 0.0-1.0
 * @property {string|null} lastUsed
 * @property {number} decayScore - 0.0-1.0, decreases over time
 * @property {MemoryStatus} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

// =============================================================================
// LADS TYPES
// =============================================================================

/**
 * @typedef {'memory_selection' | 'memory_ranking' | 'intent_classification' |
 *           'extraction_decision' | 'skill_creation' | 'source_selection' |
 *           'relevance_scoring' | 'slot_allocation' | 'config_change' |
 *           'deduplication' | 'archival'} DecisionType
 */

/**
 * @typedef {Object} DecisionContext
 * @property {string} sessionId
 * @property {string} projectHash
 * @property {string} intent
 * @property {string[]} tags
 * @property {Object} metadata
 */

/**
 * @typedef {Object} PendingOutcome
 * @property {'pending'} status
 */

/**
 * @typedef {Object} ResolvedOutcome
 * @property {'resolved'} status
 * @property {boolean|null} useful - true/false/unknown
 * @property {string} reason
 * @property {string} resolvedAt
 * @property {Object} signals
 */

/**
 * @typedef {Object} TrackedDecision
 * @property {string} id
 * @property {string} timestamp
 * @property {string} sessionId
 * @property {DecisionType} decisionType
 * @property {DecisionContext} context
 * @property {string} choice
 * @property {string[]} alternatives
 * @property {number} confidence
 * @property {PendingOutcome | ResolvedOutcome} outcome
 * @property {string[]} tags
 */

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * @typedef {'warning' | 'error' | 'critical'} ErrorSeverity
 */

/**
 * @typedef {Object} ErrorDefinition
 * @property {string} code
 * @property {ErrorSeverity} severity
 * @property {boolean} recoverable
 * @property {string} message
 */

const ERROR_CODES = {
  // Storage errors
  STORAGE_READ_FAILED: { code: 'STORAGE_READ_FAILED', severity: 'error', recoverable: true, message: 'Failed to read from storage' },
  STORAGE_WRITE_FAILED: { code: 'STORAGE_WRITE_FAILED', severity: 'error', recoverable: true, message: 'Failed to write to storage' },
  STORAGE_CORRUPTED: { code: 'STORAGE_CORRUPTED', severity: 'critical', recoverable: false, message: 'Storage file is corrupted' },

  // Query errors
  QUERY_TIMEOUT: { code: 'QUERY_TIMEOUT', severity: 'warning', recoverable: true, message: 'Query timed out' },
  QUERY_FAILED: { code: 'QUERY_FAILED', severity: 'error', recoverable: true, message: 'Query execution failed' },

  // Config errors
  CONFIG_INVALID: { code: 'CONFIG_INVALID', severity: 'error', recoverable: false, message: 'Configuration is invalid' },
  CONFIG_MISSING: { code: 'CONFIG_MISSING', severity: 'warning', recoverable: true, message: 'Configuration file missing' },

  // Network errors
  NETWORK_TIMEOUT: { code: 'NETWORK_TIMEOUT', severity: 'warning', recoverable: true, message: 'Network request timed out' },
  API_RATE_LIMITED: { code: 'API_RATE_LIMITED', severity: 'warning', recoverable: true, message: 'API rate limit exceeded' },

  // Lock errors
  LOCK_TIMEOUT: { code: 'LOCK_TIMEOUT', severity: 'warning', recoverable: true, message: 'Failed to acquire lock' },
  LOCK_CONFLICT: { code: 'LOCK_CONFLICT', severity: 'warning', recoverable: true, message: 'Lock conflict detected' },

  // Extraction errors
  EXTRACTION_FAILED: { code: 'EXTRACTION_FAILED', severity: 'warning', recoverable: true, message: 'Memory extraction failed' },
  SENSITIVE_DATA: { code: 'SENSITIVE_DATA', severity: 'error', recoverable: true, message: 'Sensitive data detected' },
};

// =============================================================================
// CONFIG TYPES
// =============================================================================

/**
 * @typedef {Object} SlotConfig
 * @property {number} maxTotal - Default: 8
 * @property {number} maxTokens - Default: 2000
 * @property {Object} perCategory
 * @property {number} perCategory.solution - Default: 3
 * @property {number} perCategory.pattern - Default: 2
 * @property {number} perCategory.preference - Default: 2
 * @property {number} perCategory.skill - Default: 1
 */

/**
 * @typedef {Object} SourceConfig
 * @property {string} name
 * @property {number} priority - 0.0-1.0
 * @property {number} timeout - ms
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} MasterConfig
 * @property {string} version
 * @property {Object} sessionStart
 * @property {Object} sessionEnd
 * @property {Object} queryOrchestrator
 * @property {Object} contextAnalyzer
 * @property {Object} ladsCore
 * @property {Object} storage
 */

const DEFAULT_CONFIG = {
  version: '1.0',

  sessionStart: {
    enabled: true,
    timeoutMs: 2000,
    caching: { enabled: true, ttlMs: 3600000 }, // 1 hour
    slots: {
      maxTotal: 8,
      maxTokens: 2000,
      perCategory: {
        solution: 3,
        pattern: 2,
        preference: 2,
        skill: 1,
      },
    },
  },

  sessionEnd: {
    enabled: true,
    minSessionLength: 3,
    extractionThreshold: 0.7,
    confirmUncertain: false,
  },

  queryOrchestrator: {
    defaultTimeout: 500,
    parallelism: 4,
    sources: [
      { name: 'memory-store', priority: 1.0, timeout: 100, enabled: true },
      { name: 'episodic-memory', priority: 0.9, timeout: 300, enabled: true },
      { name: 'knowledge-graph', priority: 0.8, timeout: 200, enabled: true },
      { name: 'pattern-store', priority: 0.7, timeout: 50, enabled: true },
    ],
  },

  contextAnalyzer: {
    useAI: true,
    aiModel: 'claude-3-haiku-20240307',
    minConfidence: 0.3,
  },

  ladsCore: {
    evolution: {
      enabled: true,
      minIntervalMs: 3600000, // 1 hour
      minSamples: 20,
      maxChangePercent: 0.25,
    },
    patterns: {
      detectionEnabled: true,
      failureThreshold: 0.6,
    },
    documentation: {
      enabled: true,
      changelogPath: 'docs/changelog.md',
    },
  },

  storage: {
    basePath: '~/.claude/memory',
    maxSizeMB: 100,
    retentionDays: 365,
  },

  errorHandling: {
    circuitBreaker: {
      threshold: 5,
      resetTimeoutMs: 30000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    },
  },
};

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * @typedef {'closed' | 'open' | 'half-open'} CircuitState
 */

/**
 * @typedef {'Full' | 'Degraded' | 'Minimal' | 'Emergency'} DegradationLevel
 */

/**
 * @typedef {Object} OperationResult
 * @property {boolean} success
 * @property {*} [data]
 * @property {ErrorDefinition} [error]
 * @property {number} durationMs
 */

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ERROR_CODES,
  DEFAULT_CONFIG,

  // Helper functions
  generateId: () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  },

  generateSessionId: () => {
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  },

  getTimestamp: () => new Date().toISOString(),

  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),

  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  expandPath: (path) => {
    if (path.startsWith('~')) {
      return path.replace('~', process.env.HOME || process.env.USERPROFILE || '');
    }
    return path;
  },
};
