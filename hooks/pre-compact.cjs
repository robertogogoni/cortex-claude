#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - PreCompact Hook
 *
 * This hook fires before Claude Code compresses conversation context.
 * It extracts and preserves critical information (decisions, insights,
 * error patterns) using fast heuristic extraction (no LLM calls).
 *
 * Input: JSON via stdin with structure:
 *   {
 *     "transcript_summary": "...",
 *     "cwd": "/path/to/project",
 *     "hook_event_name": "PreCompact"
 *   }
 *
 * Output: JSON with preservation results
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateId, getTimestamp } = require('../core/types.cjs');

// =============================================================================
// PRECOMPACT HOOK
// =============================================================================

class PreCompactHook {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for Cortex memory storage
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');
  }

  /**
   * Execute the pre-compact hook
   * @param {Object} input - Hook input from stdin JSON
   * @param {string} input.transcript_summary - Conversation summary text
   * @param {string} input.cwd - Working directory
   * @returns {Promise<Object>}
   */
  async execute(input = {}) {
    const summary = input.transcript_summary || '';
    const cwd = input.cwd || process.cwd();

    if (!summary || summary.length < 20) {
      return { success: true, preserved: 0, items: [] };
    }

    try {
      const items = this._extractCriticalInfo(summary);
      if (items.length > 0) {
        this._persistItems(items, cwd);
      }
      return {
        success: true,
        preserved: items.length,
        items: items.map(i => ({ type: i.type, preview: i.content.substring(0, 80) })),
      };
    } catch (error) {
      console.error('[PreCompact] Error:', error.message);
      return { success: false, preserved: 0, items: [], error: error.message };
    }
  }

  /**
   * Extract critical information from summary using heuristic patterns.
   * No LLM calls -- pure regex matching for speed.
   * @param {string} summary
   * @returns {Array<{type: string, content: string, confidence: number}>}
   */
  _extractCriticalInfo(summary) {
    const items = [];
    const sentences = summary.split(/[.!?\n]+/).filter(s => s.trim().length > 15);

    const decisionPatterns = [
      /decided to\s+(.+)/i, /chose\s+(.+)/i, /went with\s+(.+)/i,
      /using\s+(.+?)\s+(?:for|because|instead)/i, /switched to\s+(.+)/i,
    ];
    const insightPatterns = [
      /key insight:\s*(.+)/i, /important:\s*(.+)/i, /remember:\s*(.+)/i,
      /always\s+(.+?)\s+before/i, /never\s+(.+?)\s+without/i,
      /the (?:trick|key|secret) is\s+(.+)/i,
    ];
    const errorPatterns = [
      /(?:fixed|solved|resolved)\s+(?:by|with)\s+(.+)/i,
      /the (?:issue|problem|bug) was\s+(.+)/i,
      /(?:root cause|reason):\s*(.+)/i,
    ];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      for (const pattern of decisionPatterns) {
        if (pattern.test(trimmed)) {
          items.push({ type: 'decision', content: trimmed, confidence: 0.8 });
          break;
        }
      }
      for (const pattern of insightPatterns) {
        if (pattern.test(trimmed)) {
          items.push({ type: 'insight', content: trimmed, confidence: 0.85 });
          break;
        }
      }
      for (const pattern of errorPatterns) {
        if (pattern.test(trimmed)) {
          items.push({ type: 'pattern', content: trimmed, confidence: 0.75 });
          break;
        }
      }
    }

    // Deduplicate by content prefix
    const unique = [];
    for (const item of items) {
      const isDupe = unique.some(u => u.content.length > 0 && item.content.includes(u.content.substring(0, 30)));
      if (!isDupe) unique.push(item);
    }
    return unique.slice(0, 10);
  }

  /**
   * Persist extracted items to working memory JSONL store
   * @param {Array<{type: string, content: string, confidence: number}>} items
   * @param {string} cwd
   */
  _persistItems(items, cwd) {
    const workingPath = path.join(this.basePath, 'data', 'memories', 'working.jsonl');
    const dir = path.dirname(workingPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const lines = items.map(item => JSON.stringify({
      id: generateId(),
      version: 1,
      type: item.type,
      content: item.content,
      summary: item.content.substring(0, 100),
      tags: ['pre-compact', item.type],
      extractionConfidence: item.confidence,
      usageCount: 0,
      usageSuccessRate: 0,
      decayScore: 1.0,
      status: 'active',
      sourceSessionId: 'pre-compact',
      sourceTimestamp: getTimestamp(),
      projectHash: this._hashCwd(cwd),
      createdAt: getTimestamp(),
      updatedAt: getTimestamp(),
    }));

    fs.appendFileSync(workingPath, lines.join('\n') + '\n');
  }

  /**
   * Hash a working directory path to a short project identifier
   * @param {string} cwd
   * @returns {string}
   */
  _hashCwd(cwd) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(cwd).digest('hex').substring(0, 8);
  }

  /**
   * Read hook input JSON from stdin
   * @returns {Promise<Object>} Parsed hook input object
   */
  _readStdin() {
    return new Promise((resolve) => {
      // Don't block if stdin is not piped
      if (process.stdin.isTTY) {
        resolve({});
        return;
      }

      let data = '';
      const timeout = setTimeout(() => {
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
        } catch {
          resolve({});
        }
      });
      process.stdin.on('error', () => {
        clearTimeout(timeout);
        resolve({});
      });
    });
  }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  const hook = new PreCompactHook();

  // Read hook input from stdin (Claude Code passes JSON with session info)
  const input = await hook._readStdin();

  // Debug: log received input structure (to stderr so it doesn't interfere with JSON output)
  if (process.env.CORTEX_DEBUG) {
    console.error('[PreCompact] Input:', JSON.stringify(input, null, 2));
  }

  const result = await hook.execute(input);

  // Output JSON result
  console.log(JSON.stringify(result, null, 2));
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(0);
  });
}

// Export for testing
module.exports = { PreCompactHook };
