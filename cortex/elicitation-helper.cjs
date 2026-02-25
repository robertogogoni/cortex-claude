'use strict';

/**
 * Elicitation Helper for MCP-based memory curation
 *
 * Creates structured question schemas for MCP Elicitation,
 * allowing users to confirm, edit, or discard memories.
 */

/**
 * Create an elicitation schema for memory confirmation
 * @param {string} insight - The insight text to confirm
 * @param {number} qualityScore - Quality score (0-1)
 * @returns {Object} Elicitation schema for ctx.mcpReq.elicitInput()
 */
function createElicitationSchema(insight, qualityScore) {
  const qualityBar = '\u2588'.repeat(Math.round(qualityScore * 10)) + '\u2591'.repeat(10 - Math.round(qualityScore * 10));

  return {
    message: `Cortex wants to remember:\n\n"${insight}"\n\nQuality: ${qualityBar} ${(qualityScore * 100).toFixed(0)}%`,
    requestedSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'edit', 'discard'],
          description: 'Save as-is, edit before saving, or discard',
          default: 'save',
        },
        edited: {
          type: 'string',
          description: 'Edited version of the insight (only used if action is "edit")',
        },
      },
      required: ['action'],
    },
  };
}

/**
 * Process the result from elicitation
 * @param {Object|null} result - Elicitation response (may be null if not supported)
 * @param {string} originalContent - Original insight content
 * @returns {{ action: string, content: string|null }}
 */
function processElicitationResult(result, originalContent) {
  if (!result || !result.action) {
    // Elicitation not supported or user dismissed — default to save
    return { action: 'save', content: originalContent };
  }

  switch (result.action) {
    case 'edit':
      return { action: 'edit', content: result.edited || originalContent };
    case 'discard':
      return { action: 'discard', content: null };
    case 'save':
    default:
      return { action: 'save', content: originalContent };
  }
}

module.exports = { createElicitationSchema, processElicitationResult };
