/**
 * Cortex - Claude's Cognitive Layer - Hooks Index
 *
 * Entry point for Cortex hooks that integrate with Claude Code:
 * - SessionStart: Injects relevant memories at session beginning
 * - SessionEnd: Extracts learnings when session ends
 *
 * Also exports supporting components for testing and customization.
 */

'use strict';

const { SessionStartHook } = require('./session-start.cjs');
const { SessionEndHook } = require('./session-end.cjs');
const { ContextAnalyzer, INTENT_PATTERNS, FILE_DOMAINS } = require('./context-analyzer.cjs');
const { QueryOrchestrator, MEMORY_SOURCES } = require('./query-orchestrator.cjs');
const { ExtractionEngine, EXTRACTION_PATTERNS, QUALITY_SIGNALS } = require('./extraction-engine.cjs');
const { ProgressDisplay, InjectionFormatter, ICONS, TYPE_LABELS, SOURCE_LABELS } = require('./injection-formatter.cjs');

// =============================================================================
// HOOK RUNNER
// =============================================================================

/**
 * Run a hook by name
 * @param {string} hookName - 'sessionStart' or 'sessionEnd'
 * @param {Object} options - Hook options
 * @returns {Promise<Object>}
 */
async function runHook(hookName, options = {}) {
  switch (hookName) {
    case 'sessionStart':
    case 'session-start':
    case 'start': {
      const hook = new SessionStartHook(options);
      return hook.execute();
    }

    case 'sessionEnd':
    case 'session-end':
    case 'end': {
      const hook = new SessionEndHook(options);
      return hook.execute(options);
    }

    default:
      return {
        success: false,
        error: `Unknown hook: ${hookName}`,
      };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Hooks
  SessionStartHook,
  SessionEndHook,
  runHook,

  // Context Analysis
  ContextAnalyzer,
  INTENT_PATTERNS,
  FILE_DOMAINS,

  // Query Orchestration
  QueryOrchestrator,
  MEMORY_SOURCES,

  // Extraction
  ExtractionEngine,
  EXTRACTION_PATTERNS,
  QUALITY_SIGNALS,

  // UX Display
  ProgressDisplay,
  InjectionFormatter,
  ICONS,
  TYPE_LABELS,
  SOURCE_LABELS,
};
