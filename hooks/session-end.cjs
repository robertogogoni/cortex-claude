#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - SessionEnd Hook
 *
 * This hook runs at the end of each Claude Code session.
 * It extracts learnings and resolves pending decisions.
 *
 * Input: JSON via stdin with structure:
 *   {
 *     "session_id": "abc123",
 *     "transcript_path": "~/.claude/projects/.../session-id.jsonl",
 *     "cwd": "/path/to/project",
 *     "hook_event_name": "SessionEnd",
 *     "reason": "exit"
 *   }
 *
 * The transcript_path points to a JSONL file with conversation messages.
 *
 * Output: JSON with extraction results
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Ensure we can find our modules
const BASE_PATH = path.dirname(__dirname);

// Dynamic requires with error handling
let ExtractionEngine, ContextAnalyzer, getConfigManager, getLADSCore, generateId, getTimestamp;

try {
  ({ ExtractionEngine } = require('./extraction-engine.cjs'));
  ({ ContextAnalyzer } = require('./context-analyzer.cjs'));
  ({ getConfigManager } = require('../core/config.cjs'));
  ({ getLADSCore } = require('../core/lads/index.cjs'));
  ({ generateId, getTimestamp } = require('../core/types.cjs'));
} catch (error) {
  // If modules not found, output empty result
  console.log(JSON.stringify({
    success: false,
    error: `Module load failed: ${error.message}`,
    extracted: [],
  }));
  process.exit(0);
}

// =============================================================================
// SESSION END HOOK
// =============================================================================

class SessionEndHook {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for Cortex
   * @param {Object} options.config - Configuration manager
   */
  constructor(options = {}) {
    this.basePath = options.basePath || BASE_PATH;
    this.config = options.config || getConfigManager();

    this.extractionEngine = new ExtractionEngine({
      basePath: this.basePath,
      confidenceThreshold: this.config.get('sessionEnd.extractionThreshold') || 0.7,
      minSessionLength: this.config.get('sessionEnd.minSessionLength') || 3,
    });

    this.contextAnalyzer = new ContextAnalyzer({
      workingDir: process.env.CORTEX_WORKING_DIR || process.cwd(),
    });

    this.lads = null;
    try {
      this.lads = getLADSCore({ basePath: this.basePath });
    } catch {
      // LADS not available
    }
  }

  /**
   * Execute the session end hook
   * @param {Object} input - Hook input from stdin JSON
   * @param {string} input.session_id - Session identifier
   * @param {string} input.transcript_path - Path to transcript JSONL file
   * @param {string} input.cwd - Working directory
   * @param {string} input.hook_event_name - Should be "SessionEnd"
   * @param {string} input.reason - Exit reason
   * @param {Object[]} input.messages - Optional pre-loaded messages
   * @returns {Promise<Object>}
   */
  async execute(input = {}) {
    const startTime = Date.now();
    const sessionId = input.session_id || generateId();
    const workingDir = input.cwd || process.cwd();
    const transcriptPath = input.transcript_path || null;

    // Check if enabled
    if (!this.config.get('sessionEnd.enabled')) {
      return {
        success: true,
        enabled: false,
        extracted: [],
        stats: { reason: 'SessionEnd disabled' },
      };
    }

    try {
      // Get conversation messages from transcript file
      const messages = input.messages || await this._loadMessages(transcriptPath);

      if (!messages || messages.length === 0) {
        return {
          success: true,
          extracted: [],
          stats: { reason: 'No messages to process' },
        };
      }

      // Initialize LADS if available
      if (this.lads && !this.lads.initialized) {
        await this.lads.initialize();
      }

      // Update context analyzer with correct working directory from hook input
      this.contextAnalyzer.workingDir = workingDir;

      // Analyze context
      const context = this.contextAnalyzer.analyze({
        recentFiles: this._getRecentFiles(workingDir),
      });

      // Run extraction
      const extractionResult = await this.extractionEngine.extract({
        messages,
        sessionId,
        context,
      });

      // Log extractions to docs
      if (this.lads && extractionResult.extracted.length > 0) {
        for (const memory of extractionResult.extracted) {
          this.lads.docsWriter.logExtraction(memory);
        }
      }

      // Resolve pending decisions
      const decisionResults = await this._resolvePendingDecisions(sessionId, messages);

      // Check if consolidation is needed
      const consolidationNeeded = await this._checkConsolidation();

      const duration = Date.now() - startTime;

      return {
        success: true,
        enabled: true,
        extracted: extractionResult.extracted,
        decisions: decisionResults,
        consolidationNeeded,
        stats: {
          duration,
          ...extractionResult.stats,
          decisionsResolved: decisionResults.resolved,
        },
      };
    } catch (error) {
      console.error('[SessionEnd] Execution failed:', error.message);

      return {
        success: false,
        error: error.message,
        extracted: [],
        stats: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * Load messages from transcript file
   * @param {string} transcriptPath - Path to transcript JSONL file (may contain ~)
   * @returns {Promise<Object[]>}
   */
  async _loadMessages(transcriptPath) {
    if (!transcriptPath) {
      return [];
    }

    // Expand ~ to home directory
    const expandedPath = transcriptPath.replace(/^~/, process.env.HOME || '');

    if (!fs.existsSync(expandedPath)) {
      console.error('[SessionEnd] Transcript file not found:', expandedPath);
      return [];
    }

    try {
      const content = fs.readFileSync(expandedPath, 'utf8');
      return this._parseTranscript(content);
    } catch (error) {
      console.error('[SessionEnd] Failed to load transcript:', error.message);
      return [];
    }
  }

  /**
   * Read hook input JSON from stdin
   * @returns {Promise<Object>} Parsed hook input object
   */
  _readStdin() {
    return new Promise((resolve, reject) => {
      // Don't block if stdin is not piped
      if (process.stdin.isTTY) {
        resolve({});
        return;
      }

      let data = '';
      const timeout = setTimeout(() => {
        // Timeout - try to parse what we have
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      }, 1000);

      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => {
        data += chunk;
      });
      process.stdin.on('end', () => {
        clearTimeout(timeout);
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (parseError) {
          console.error('[SessionEnd] Failed to parse stdin JSON:', parseError.message);
          resolve({});
        }
      });
      process.stdin.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Parse transcript into messages
   * @param {string} content
   * @returns {Object[]}
   */
  _parseTranscript(content) {
    try {
      // Try JSON first
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed.messages && Array.isArray(parsed.messages)) {
        return parsed.messages;
      }
    } catch {
      // Not JSON, try JSONL
    }

    // Try JSONL
    const messages = [];
    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.role && msg.content) {
          messages.push(msg);
        }
      } catch {
        // Skip invalid lines
      }
    }

    return messages;
  }

  /**
   * Resolve pending decisions from this session
   * @param {string} sessionId
   * @param {Object[]} messages
   * @returns {Promise<Object>}
   */
  async _resolvePendingDecisions(sessionId, messages) {
    if (!this.lads) {
      return { resolved: 0, pending: 0 };
    }

    try {
      const pendingDecisions = this.lads.patternTracker.getPendingDecisions(sessionId);

      if (pendingDecisions.length === 0) {
        return { resolved: 0, pending: 0 };
      }

      // Analyze conversation for success signals
      const successSignals = this._detectSuccessSignals(messages);

      let resolved = 0;
      for (const decision of pendingDecisions) {
        // Determine outcome based on signals
        const outcome = this._determineOutcome(decision, messages, successSignals);

        if (outcome.useful !== null) {
          await this.lads.resolveDecision(decision.id, outcome);
          resolved++;
        }
      }

      return {
        resolved,
        pending: pendingDecisions.length - resolved,
      };
    } catch (error) {
      console.error('[SessionEnd] Decision resolution failed:', error.message);
      return { resolved: 0, pending: 0, error: error.message };
    }
  }

  /**
   * Detect success signals in conversation
   * @param {Object[]} messages
   * @returns {Object}
   */
  _detectSuccessSignals(messages) {
    const signals = {
      explicitSuccess: false,
      explicitFailure: false,
      errorMentions: 0,
      fixMentions: 0,
      thanksMentions: 0,
      frustrationMentions: 0,
    };

    const successPhrases = ['works', 'working', 'success', 'solved', 'fixed', 'perfect', 'great', 'thanks'];
    const failurePhrases = ['still not', 'doesn\'t work', 'failed', 'broken', 'wrong', 'error'];
    const frustrationPhrases = ['frustrated', 'annoying', 'ugh', 'argh', 'wtf'];

    for (const message of messages) {
      if (message.role !== 'user') continue;

      const content = typeof message.content === 'string'
        ? message.content.toLowerCase()
        : '';

      for (const phrase of successPhrases) {
        if (content.includes(phrase)) {
          signals.explicitSuccess = true;
          if (phrase === 'thanks') signals.thanksMentions++;
          if (phrase === 'fixed') signals.fixMentions++;
        }
      }

      for (const phrase of failurePhrases) {
        if (content.includes(phrase)) {
          signals.explicitFailure = true;
          if (phrase === 'error') signals.errorMentions++;
        }
      }

      for (const phrase of frustrationPhrases) {
        if (content.includes(phrase)) {
          signals.frustrationMentions++;
        }
      }
    }

    return signals;
  }

  /**
   * Determine outcome for a decision
   * @param {Object} decision
   * @param {Object[]} messages
   * @param {Object} signals
   * @returns {Object}
   */
  _determineOutcome(decision, messages, signals) {
    // Explicit signals override everything
    if (signals.explicitSuccess && !signals.explicitFailure) {
      return {
        useful: true,
        reason: 'Explicit success signals in conversation',
        signals,
      };
    }

    if (signals.explicitFailure && !signals.explicitSuccess) {
      return {
        useful: false,
        reason: 'Explicit failure signals in conversation',
        signals,
      };
    }

    // Mixed signals - use weighted analysis
    let score = 0;
    if (signals.thanksMentions > 0) score += 0.3;
    if (signals.fixMentions > 0) score += 0.2;
    if (signals.errorMentions > 0) score -= 0.2;
    if (signals.frustrationMentions > 0) score -= 0.3;

    // Session length as proxy for success (shorter = resolved faster)
    const avgSessionLength = 10; // messages
    if (messages.length < avgSessionLength) {
      score += 0.1;
    } else if (messages.length > avgSessionLength * 2) {
      score -= 0.1;
    }

    if (score > 0.2) {
      return {
        useful: true,
        reason: 'Weighted signal analysis positive',
        signals,
        score,
      };
    } else if (score < -0.2) {
      return {
        useful: false,
        reason: 'Weighted signal analysis negative',
        signals,
        score,
      };
    }

    // Inconclusive
    return {
      useful: null,
      reason: 'Insufficient signals to determine outcome',
      signals,
      score,
    };
  }

  /**
   * Check if memory consolidation is needed
   * @returns {Promise<boolean>}
   */
  async _checkConsolidation() {
    try {
      const consolidationConfig = this.config.get('ladsCore.consolidation') || {};
      const threshold = consolidationConfig.workingMemoryThreshold || 100;

      // Check working memory size
      const workingStorePath = path.join(this.basePath, 'data/memories/working.jsonl');
      if (!fs.existsSync(workingStorePath)) {
        return false;
      }

      const content = fs.readFileSync(workingStorePath, 'utf8');
      const lineCount = content.split('\n').filter(l => l.trim()).length;

      return lineCount >= threshold;
    } catch {
      return false;
    }
  }

  /**
   * Get recently modified files
   * @param {string} workingDir
   * @returns {string[]}
   */
  _getRecentFiles(workingDir) {
    try {
      const files = [];
      const maxFiles = 10;

      const walk = (dir, depth = 0) => {
        if (depth > 2 || files.length >= maxFiles) return;

        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (files.length >= maxFiles) break;
            if (entry.name.startsWith('.')) continue;
            if (['node_modules', 'dist', 'build'].includes(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);

            if (entry.isFile()) {
              files.push(fullPath);
            } else if (entry.isDirectory()) {
              walk(fullPath, depth + 1);
            }
          }
        } catch {
          // Skip inaccessible
        }
      };

      walk(workingDir);
      return files;
    } catch {
      return [];
    }
  }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  const hook = new SessionEndHook();

  // Read hook input from stdin (Claude Code passes JSON with session info)
  const hookInput = await hook._readStdin();

  // Debug: log received input structure (to stderr so it doesn't interfere with JSON output)
  if (process.env.CORTEX_DEBUG) {
    console.error('[SessionEnd] Received hook input:', JSON.stringify(hookInput, null, 2));
  }

  const result = await hook.execute(hookInput);

  // Output JSON result
  console.log(JSON.stringify(result, null, 2));
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
      extracted: [],
    }));
    process.exit(0);
  });
}

// Export for testing
module.exports = { SessionEndHook };
