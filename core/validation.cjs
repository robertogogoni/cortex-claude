#!/usr/bin/env node
/**
 * Cortex Input Validation Module
 *
 * Provides input validation and sanitization for MCP tool inputs.
 * Prevents injection attacks and ensures data integrity.
 *
 * @version 1.0.0
 */

'use strict';

// =============================================================================
// CONSTANTS
// =============================================================================

// Maximum string lengths by field type
const MAX_LENGTHS = {
  query: 10000,        // Search queries
  insight: 50000,      // Learnings/insights can be longer
  context: 5000,       // Context descriptions
  topic: 1000,         // Topic strings
  tag: 100,            // Individual tags
  type: 50,            // Type identifiers
  id: 100,             // IDs
  default: 10000,      // Default max length
};

// Allowed characters for different field types
const PATTERNS = {
  // Safe text: letters, numbers, common punctuation
  safeText: /^[\p{L}\p{N}\p{P}\p{Z}\n\r]+$/u,
  // Identifiers: alphanumeric, underscore, hyphen
  identifier: /^[a-zA-Z0-9_-]+$/,
  // Type names: lowercase letters, numbers, hyphen
  type: /^[a-z0-9-]+$/,
  // Tags: alphanumeric, underscore, hyphen, colon
  tag: /^[a-zA-Z0-9_:-]+$/,
};

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate and sanitize a string input
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @param {string} options.fieldName - Name of the field (for error messages)
 * @param {number} options.maxLength - Maximum allowed length
 * @param {RegExp} options.pattern - Pattern to match
 * @param {boolean} options.required - Whether field is required
 * @param {*} options.defaultValue - Default value if not provided
 * @returns {string} Sanitized string
 * @throws {ValidationError} If validation fails
 */
function validateString(value, options = {}) {
  const {
    fieldName = 'value',
    maxLength = MAX_LENGTHS.default,
    pattern = null,
    required = false,
    defaultValue = undefined,
  } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return defaultValue;
  }

  // Convert to string
  const str = String(value).trim();

  // Check if empty
  if (str === '') {
    if (required) {
      throw new ValidationError(`${fieldName} cannot be empty`);
    }
    return defaultValue;
  }

  // Check length
  if (str.length > maxLength) {
    throw new ValidationError(
      `${fieldName} exceeds maximum length (${str.length} > ${maxLength})`
    );
  }

  // Check pattern
  if (pattern && !pattern.test(str)) {
    throw new ValidationError(
      `${fieldName} contains invalid characters`
    );
  }

  // Basic sanitization: remove control characters except newline/tab
  const sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return sanitized;
}

/**
 * Validate and sanitize an array input
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @param {string} options.fieldName - Name of the field
 * @param {number} options.maxItems - Maximum number of items
 * @param {number} options.minItems - Minimum number of items
 * @param {Function} options.itemValidator - Validator function for each item
 * @param {boolean} options.required - Whether field is required
 * @param {*} options.defaultValue - Default value if not provided
 * @returns {Array} Sanitized array
 * @throws {ValidationError} If validation fails
 */
function validateArray(value, options = {}) {
  const {
    fieldName = 'array',
    maxItems = 100,
    minItems = 0,
    itemValidator = null,
    required = false,
    defaultValue = [],
  } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return defaultValue;
  }

  // Check if array
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }

  // Check length
  if (value.length < minItems) {
    throw new ValidationError(
      `${fieldName} must have at least ${minItems} items`
    );
  }

  if (value.length > maxItems) {
    throw new ValidationError(
      `${fieldName} exceeds maximum items (${value.length} > ${maxItems})`
    );
  }

  // Validate each item
  if (itemValidator) {
    return value.map((item, index) => {
      try {
        return itemValidator(item);
      } catch (error) {
        throw new ValidationError(
          `${fieldName}[${index}]: ${error.message}`
        );
      }
    });
  }

  return value;
}

/**
 * Validate and sanitize a number input
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @param {string} options.fieldName - Name of the field
 * @param {number} options.min - Minimum value
 * @param {number} options.max - Maximum value
 * @param {boolean} options.integer - Whether to require integer
 * @param {boolean} options.required - Whether field is required
 * @param {*} options.defaultValue - Default value if not provided
 * @returns {number} Validated number
 * @throws {ValidationError} If validation fails
 */
function validateNumber(value, options = {}) {
  const {
    fieldName = 'number',
    min = -Infinity,
    max = Infinity,
    integer = false,
    required = false,
    defaultValue = undefined,
  } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return defaultValue;
  }

  // Convert to number
  const num = Number(value);

  // Check if valid number
  if (isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }

  // Check integer
  if (integer && !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} must be an integer`);
  }

  // Check range
  if (num < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`);
  }

  if (num > max) {
    throw new ValidationError(`${fieldName} must be at most ${max}`);
  }

  return num;
}

/**
 * Validate an enum value
 * @param {*} value - Value to validate
 * @param {Array<string>} allowedValues - List of allowed values
 * @param {Object} options - Validation options
 * @returns {string} Validated value
 * @throws {ValidationError} If validation fails
 */
function validateEnum(value, allowedValues, options = {}) {
  const {
    fieldName = 'value',
    required = false,
    defaultValue = undefined,
  } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return defaultValue;
  }

  const str = String(value);

  if (!allowedValues.includes(str)) {
    throw new ValidationError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`
    );
  }

  return str;
}

/**
 * Validate a boolean value
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @returns {boolean} Validated boolean
 */
function validateBoolean(value, options = {}) {
  const {
    fieldName = 'value',
    required = false,
    defaultValue = undefined,
  } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return defaultValue;
  }

  // Convert to boolean
  if (typeof value === 'boolean') {
    return value;
  }

  const str = String(value).toLowerCase();
  if (str === 'true' || str === '1' || str === 'yes') {
    return true;
  }
  if (str === 'false' || str === '0' || str === 'no') {
    return false;
  }

  throw new ValidationError(`${fieldName} must be a boolean`);
}

// =============================================================================
// TOOL-SPECIFIC VALIDATORS
// =============================================================================

/**
 * Validate cortex__query arguments
 * @param {Object} args - Tool arguments
 * @returns {Object} Validated arguments
 */
function validateQueryArgs(args = {}) {
  return {
    query: validateString(args.query, {
      fieldName: 'query',
      maxLength: MAX_LENGTHS.query,
      required: true,
    }),
    sources: validateArray(args.sources, {
      fieldName: 'sources',
      maxItems: 5,
      defaultValue: ['all'],
      itemValidator: (v) => validateEnum(v,
        ['episodic', 'knowledge-graph', 'jsonl', 'claudemd', 'all'],
        { fieldName: 'source' }
      ),
    }),
    limit: validateNumber(args.limit, {
      fieldName: 'limit',
      min: 1,
      max: 100,
      integer: true,
      defaultValue: 10,
    }),
  };
}

/**
 * Validate cortex__recall arguments
 * @param {Object} args - Tool arguments
 * @returns {Object} Validated arguments
 */
function validateRecallArgs(args = {}) {
  return {
    context: validateString(args.context, {
      fieldName: 'context',
      maxLength: MAX_LENGTHS.context,
      required: true,
    }),
    type: validateEnum(args.type,
      ['skill', 'pattern', 'decision', 'insight', 'any'],
      { fieldName: 'type', defaultValue: 'any' }
    ),
  };
}

/**
 * Validate cortex__reflect arguments
 * @param {Object} args - Tool arguments
 * @returns {Object} Validated arguments
 */
function validateReflectArgs(args = {}) {
  return {
    topic: validateString(args.topic, {
      fieldName: 'topic',
      maxLength: MAX_LENGTHS.topic,
      required: true,
    }),
    depth: validateEnum(args.depth,
      ['quick', 'moderate', 'deep'],
      { fieldName: 'depth', defaultValue: 'moderate' }
    ),
  };
}

/**
 * Validate cortex__infer arguments
 * @param {Object} args - Tool arguments
 * @returns {Object} Validated arguments
 */
function validateInferArgs(args = {}) {
  return {
    concepts: validateArray(args.concepts, {
      fieldName: 'concepts',
      minItems: 2,
      maxItems: 10,
      required: true,
      itemValidator: (v) => validateString(v, {
        fieldName: 'concept',
        maxLength: MAX_LENGTHS.topic,
      }),
    }),
    includeMemories: validateBoolean(args.includeMemories, {
      fieldName: 'includeMemories',
      defaultValue: true,
    }),
  };
}

/**
 * Validate cortex__learn arguments
 * @param {Object} args - Tool arguments
 * @returns {Object} Validated arguments
 */
function validateLearnArgs(args = {}) {
  return {
    insight: validateString(args.insight, {
      fieldName: 'insight',
      maxLength: MAX_LENGTHS.insight,
      required: true,
    }),
    context: validateString(args.context, {
      fieldName: 'context',
      maxLength: MAX_LENGTHS.context,
      defaultValue: '',
    }),
    type: validateEnum(args.type,
      ['skill', 'pattern', 'decision', 'general'],
      { fieldName: 'type', defaultValue: 'general' }
    ),
    tags: validateArray(args.tags, {
      fieldName: 'tags',
      maxItems: 20,
      defaultValue: [],
      itemValidator: (v) => validateString(v, {
        fieldName: 'tag',
        maxLength: MAX_LENGTHS.tag,
        pattern: PATTERNS.tag,
      }),
    }),
  };
}

/**
 * Validate cortex__consolidate arguments
 * @param {Object} args - Tool arguments
 * @returns {Object} Validated arguments
 */
function validateConsolidateArgs(args = {}) {
  return {
    scope: validateEnum(args.scope,
      ['recent', 'type', 'all'],
      { fieldName: 'scope', defaultValue: 'recent' }
    ),
    type: args.scope === 'type'
      ? validateEnum(args.type,
          ['skill', 'pattern', 'decision', 'insight'],
          { fieldName: 'type', required: true }
        )
      : undefined,
    dryRun: validateBoolean(args.dryRun, {
      fieldName: 'dryRun',
      defaultValue: false,
    }),
  };
}

// =============================================================================
// VALIDATION ERROR CLASS
// =============================================================================

/**
 * Custom error class for validation failures
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'CORTEX_E200'; // Input validation error
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Generic validators
  validateString,
  validateArray,
  validateNumber,
  validateEnum,
  validateBoolean,

  // Tool-specific validators
  validateQueryArgs,
  validateRecallArgs,
  validateReflectArgs,
  validateInferArgs,
  validateLearnArgs,
  validateConsolidateArgs,

  // Constants
  MAX_LENGTHS,
  PATTERNS,

  // Error class
  ValidationError,
};
