#!/usr/bin/env node
/**
 * Claude Memory Orchestrator - SessionStart Hook
 *
 * This hook runs at the beginning of each Claude Code session.
 * It injects relevant memories into the conversation context.
 *
 * Environment variables:
 * - CMO_WORKING_DIR: Current working directory
 * - CMO_SESSION_ID: Current session ID
 * - CMO_PROMPT: Initial user prompt (if available)
 *
 * Output: JSON with injection content for session start
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Ensure we can find our modules
const BASE_PATH = path.dirname(__dirname);

// Dynamic requires with error handling
let QueryOrchestrator, ContextAnalyzer, getConfigManager, getLADSCore, generateId, getTimestamp;

try {
  ({ QueryOrchestrator } = require('./query-orchestrator.cjs'));
  ({ ContextAnalyzer } = require('./context-analyzer.cjs'));
  ({ getConfigManager } = require('../core/config.cjs'));
  ({ getLADSCore } = require('../core/lads/index.cjs'));
  ({ generateId, getTimestamp } = require('../core/types.cjs'));
} catch (error) {
  // If modules not found, output empty injection
  console.log(JSON.stringify({
    success: false,
    error: `Module load failed: ${error.message}`,
    injection: '',
  }));
  process.exit(0);
}

// =============================================================================
// SESSION START HOOK
// =============================================================================

class SessionStartHook {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for CMO
   * @param {Object} options.config - Configuration manager
   */
  constructor(options = {}) {
    this.basePath = options.basePath || BASE_PATH;
    this.config = options.config || getConfigManager();

    this.orchestrator = new QueryOrchestrator({
      basePath: this.basePath,
      tokenBudget: this.config.get('sessionStart.slots') || {},
      workingDir: process.env.CMO_WORKING_DIR || process.cwd(),
    });

    this.lads = null;
    try {
      this.lads = getLADSCore({ basePath: this.basePath });
    } catch {
      // LADS not available, continue without tracking
    }
  }

  /**
   * Execute the session start hook
   * @returns {Promise<Object>}
   */
  async execute() {
    const startTime = Date.now();
    const sessionId = process.env.CMO_SESSION_ID || generateId();
    const workingDir = process.env.CMO_WORKING_DIR || process.cwd();
    const initialPrompt = process.env.CMO_PROMPT || '';

    // Check if enabled
    if (!this.config.get('sessionStart.enabled')) {
      return {
        success: true,
        enabled: false,
        injection: '',
        stats: { reason: 'SessionStart disabled' },
      };
    }

    try {
      // Initialize LADS if available
      if (this.lads && !this.lads.initialized) {
        await this.lads.initialize();
      }

      // Query relevant memories
      const queryResult = await this.orchestrator.query({
        prompt: initialPrompt,
        recentFiles: this._getRecentFiles(workingDir),
      });

      // Track the query decision
      let decisionId = null;
      if (this.lads) {
        const trackResult = await this.lads.trackDecision({
          sessionId,
          decisionType: 'memory_injection',
          projectHash: queryResult.context.projectHash,
          intent: queryResult.context.intent,
          tags: queryResult.context.tags,
          choice: `injected_${queryResult.memories.length}_memories`,
          alternatives: ['inject_none', 'inject_all'],
          confidence: queryResult.memories.length > 0 ? 0.7 : 0.5,
          metadata: {
            tokensBudget: this.config.get('sessionStart.slots.maxTokens'),
            tokensUsed: queryResult.stats.estimatedTokens,
            memoriesQueried: queryResult.stats.totalQueried,
            memoriesSelected: queryResult.stats.totalSelected,
          },
        });
        decisionId = trackResult.id;
      }

      // Format for injection
      const injection = this.orchestrator.formatForInjection(
        queryResult.memories,
        { format: this.config.get('sessionStart.format') || 'xml' }
      );

      const duration = Date.now() - startTime;

      // Build context summary
      const contextSummary = this._buildContextSummary(queryResult.context);

      return {
        success: true,
        enabled: true,
        injection: injection ? `${contextSummary}\n\n${injection}` : contextSummary,
        decisionId,
        stats: {
          duration,
          context: queryResult.context,
          memoriesQueried: queryResult.stats.totalQueried,
          memoriesSelected: queryResult.stats.totalSelected,
          estimatedTokens: queryResult.stats.estimatedTokens,
          bySource: queryResult.stats.bySource,
        },
      };
    } catch (error) {
      console.error('[SessionStart] Execution failed:', error.message);

      return {
        success: false,
        error: error.message,
        injection: '',
        stats: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * Get recently modified files in working directory
   * @param {string} workingDir
   * @returns {string[]}
   */
  _getRecentFiles(workingDir) {
    try {
      const files = [];
      const maxFiles = 20;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      const now = Date.now();

      const walk = (dir, depth = 0) => {
        if (depth > 3 || files.length >= maxFiles) return;

        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (files.length >= maxFiles) break;

            // Skip hidden and common ignore patterns
            if (entry.name.startsWith('.')) continue;
            if (['node_modules', 'dist', 'build', '__pycache__', 'venv'].includes(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);

            if (entry.isFile()) {
              try {
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs < maxAge) {
                  files.push(fullPath);
                }
              } catch {
                // Skip inaccessible files
              }
            } else if (entry.isDirectory()) {
              walk(fullPath, depth + 1);
            }
          }
        } catch {
          // Skip inaccessible directories
        }
      };

      walk(workingDir);
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Build a brief context summary
   * @param {Object} context
   * @returns {string}
   */
  _buildContextSummary(context) {
    const lines = ['<session-context>'];

    if (context.projectName) {
      lines.push(`  <project name="${context.projectName}" type="${context.projectType}" />`);
    }

    if (context.intent && context.intentConfidence > 0.5) {
      lines.push(`  <intent type="${context.intent}" confidence="${(context.intentConfidence * 100).toFixed(0)}%" />`);
    }

    if (context.gitBranch) {
      lines.push(`  <git branch="${context.gitBranch}" />`);
    }

    if (context.domains?.length) {
      lines.push(`  <domains>${context.domains.join(', ')}</domains>`);
    }

    if (context.tags?.length) {
      lines.push(`  <tags>${context.tags.slice(0, 10).join(', ')}</tags>`);
    }

    lines.push('</session-context>');
    return lines.join('\n');
  }
}

// =============================================================================
// PROGRESS INDICATOR (stderr)
// =============================================================================

function showProgress(message, icon = '🧠') {
  process.stderr.write(`${icon} ${message}\n`);
}

function showSummary(result) {
  if (!result.success || !result.enabled) return;

  const stats = result.stats || {};
  const selected = stats.memoriesSelected || 0;
  const tokens = stats.estimatedTokens || 0;
  const duration = stats.duration || 0;

  if (selected > 0) {
    process.stderr.write(`✓ CMO: Loaded ${selected} memories (${tokens} tokens) in ${duration}ms\n`);
  } else {
    process.stderr.write(`✓ CMO: Ready (no relevant memories found)\n`);
  }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  showProgress('CMO initializing...');

  const hook = new SessionStartHook();
  const result = await hook.execute();

  showSummary(result);

  // Output JSON result to stdout (for Claude context injection)
  console.log(JSON.stringify(result, null, 2));
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
      injection: '',
    }));
    process.exit(0); // Exit cleanly even on error
  });
}

// Export for testing
module.exports = { SessionStartHook };
