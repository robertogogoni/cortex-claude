#!/usr/bin/env node
/**
 * Cortex - Claude's Cognitive Layer - Stop Hook
 *
 * This hook runs after every Claude Code response (Stop event).
 * It must be EXTREMELY fast (<50ms). It only captures high-signal items.
 *
 * High-signal patterns detected:
 *   - "remember:" / "remember this:" / "don't forget:" — explicit memory requests
 *   - "the fix was" / "solved by" / "root cause:" / "the issue was" / "fixed by" — error resolution
 *   - "important:" / "key insight:" / "note to self:" — insight patterns
 *   - "always X before Y" / "never X without Y" — rule patterns
 *
 * Input: JSON via stdin with structure:
 *   {
 *     "hook_event_name": "Stop",
 *     "stop_hook_active": true,
 *     "response": "Claude's latest response text..."
 *   }
 *
 * Output: JSON to stdout: { success: boolean, captured: number }
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Ensure we can find our modules — matches session-start.cjs / session-end.cjs
const BASE_PATH = path.dirname(__dirname);

// Dynamic requires with error handling
let generateId, getTimestamp;

try {
  ({ generateId, getTimestamp } = require('../core/types.cjs'));
} catch (error) {
  // Fallback if types module not found
  generateId = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  };
  getTimestamp = () => new Date().toISOString();
}

// =============================================================================
// STOP HOOK
// =============================================================================

class StopHook {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   */
  constructor(options = {}) {
    this.basePath = options.basePath || BASE_PATH;
  }

  /**
   * Execute the stop hook — must be fast (<50ms)
   * @param {Object} input - Hook input from stdin JSON
   * @param {string} input.response - Claude's latest response text
   * @returns {Promise<Object>} { success: boolean, captured: number }
   */
  async execute(input = {}) {
    const response = input.response || '';

    // Fast exit for empty or very short responses
    if (!response || response.length < 10) {
      return { success: true, captured: 0 };
    }

    try {
      const items = this._extractHighSignal(response);
      if (items.length > 0) {
        this._persist(items);
      }
      return { success: true, captured: items.length };
    } catch (error) {
      // Never block Claude — swallow errors and return success
      return { success: true, captured: 0 };
    }
  }

  /**
   * Extract high-signal items from response text using regex patterns.
   * No LLM calls — pure pattern matching for speed.
   * @param {string} text - Response text
   * @returns {Array<{type: string, content: string, confidence: number}>}
   */
  _extractHighSignal(text) {
    const items = [];
    const seen = new Set(); // Deduplicate within a single response

    // Split into sentences for pattern matching
    const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 10);

    const rememberPatterns = [
      /remember:\s*(.+)/i,
      /remember this:\s*(.+)/i,
      /note to self:\s*(.+)/i,
      /don't forget:\s*(.+)/i,
    ];

    const errorFixPatterns = [
      /(?:the (?:issue|problem|bug|error) was)\s+(.+)/i,
      /(?:fixed|solved|resolved)\s+(?:by|with)\s+(.+)/i,
      /(?:root cause|reason):\s*(.+)/i,
    ];

    const insightPatterns = [
      /important:\s*(.+)/i,
      /key insight:\s*(.+)/i,
      /always\s+(.{10,}?)\s+before/i,
      /never\s+(.{10,}?)\s+without/i,
    ];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();

      // Check remember patterns
      for (const p of rememberPatterns) {
        if (p.test(trimmed) && !seen.has(trimmed)) {
          seen.add(trimmed);
          items.push({ type: 'preference', content: trimmed, confidence: 0.9 });
          break;
        }
      }

      // Check error fix patterns
      for (const p of errorFixPatterns) {
        if (p.test(trimmed) && !seen.has(trimmed)) {
          seen.add(trimmed);
          items.push({ type: 'pattern', content: trimmed, confidence: 0.75 });
          break;
        }
      }

      // Check insight patterns
      for (const p of insightPatterns) {
        if (p.test(trimmed) && !seen.has(trimmed)) {
          seen.add(trimmed);
          items.push({ type: 'learning', content: trimmed, confidence: 0.8 });
          break;
        }
      }
    }

    // Max 3 items per turn to avoid noise
    return items.slice(0, 3);
  }

  /**
   * Persist captured items to working.jsonl
   * Uses append-only writes for speed.
   * @param {Array<{type: string, content: string, confidence: number}>} items
   */
  _persist(items) {
    const workingPath = path.join(this.basePath, 'data', 'memories', 'working.jsonl');
    const dir = path.dirname(workingPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const now = getTimestamp();
    const lines = items.map(item => JSON.stringify({
      id: generateId(),
      version: 1,
      type: item.type,
      content: item.content,
      summary: item.content.substring(0, 100),
      tags: ['stop-hook', item.type],
      extractionConfidence: item.confidence,
      usageCount: 0,
      usageSuccessRate: 0,
      decayScore: 1.0,
      status: 'active',
      sourceSessionId: 'stop-hook',
      sourceTimestamp: now,
      createdAt: now,
      updatedAt: now,
    }));

    fs.appendFileSync(workingPath, lines.join('\n') + '\n');
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
        // Fast timeout — Stop hook must be quick
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      }, 500);

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
  const hook = new StopHook();
  const input = await hook._readStdin();
  const result = await hook.execute(input);
  console.log(JSON.stringify(result));
}

// Run if executed directly
if (require.main === module) {
  main().catch(() => {
    console.log(JSON.stringify({ success: true, captured: 0 }));
    process.exit(0);
  });
}

// Export for testing
module.exports = { StopHook };
