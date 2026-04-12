#!/usr/bin/env node
/**
 * Cortex - Work In Progress Detector
 *
 * Detects incomplete work from previous sessions:
 * - Active plan files with pending tasks
 * - Recent memories with WIP patterns
 * - Git uncommitted changes
 *
 * Returns: Object with WIP items for session injection
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// =============================================================================
// WIP DETECTOR
// =============================================================================

class WIPDetector {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for Cortex
   * @param {string} options.workingDir - Current working directory
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');
    this.workingDir = options.workingDir || process.cwd();
    this.plansDir = path.join(this.basePath, 'docs', 'plans');
    this.memoriesDir = path.join(this.basePath, 'data', 'memories');
  }

  /**
   * Detect all work in progress
   * @returns {Promise<Object>}
   */
  async detect() {
    const results = {
      hasWIP: false,
      items: [],
      summary: null,
    };

    try {
      // 1. Check for active plan files
      const planWIP = await this._checkPlanFiles();
      if (planWIP.length > 0) {
        results.items.push(...planWIP);
      }

      // 2. Check git status for uncommitted work
      const gitWIP = await this._checkGitStatus();
      if (gitWIP) {
        results.items.push(gitWIP);
      }

      // 3. Check for recent WIP memories
      const memoryWIP = await this._checkRecentMemories();
      if (memoryWIP.length > 0) {
        results.items.push(...memoryWIP);
      }

      results.hasWIP = results.items.length > 0;

      if (results.hasWIP) {
        results.summary = this._buildSummary(results.items);
      }

    } catch (error) {
      // WIP detection is optional, don't fail the session
      console.error('[WIPDetector] Error:', error.message);
    }

    return results;
  }

  /**
   * Check for active plan files with pending tasks
   * @returns {Promise<Array>}
   */
  async _checkPlanFiles() {
    const items = [];

    try {
      if (!fs.existsSync(this.plansDir)) {
        return items;
      }

      const files = fs.readdirSync(this.plansDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse(); // Most recent first

      // Only check recent plans (last 7 days)
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000;

      for (const file of files.slice(0, 5)) { // Check up to 5 most recent plans
        const fullPath = path.join(this.plansDir, file);
        const stat = fs.statSync(fullPath);

        if (now - stat.mtimeMs > maxAge) {
          continue; // Skip old plans
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const wip = this._parsePlanForWIP(content, file);

        if (wip) {
          items.push(wip);
        }
      }
    } catch (error) {
      // Ignore plan file errors
    }

    return items;
  }

  /**
   * Parse a plan file for work in progress
   * @param {string} content - Plan file content
   * @param {string} filename - Plan filename
   * @returns {Object|null}
   */
  _parsePlanForWIP(content, filename) {
    // Look for status patterns
    const statusMatch = content.match(/\*\*Status:\*\*\s*([^\n]+)/i) ||
                        content.match(/Status:\s*([^\n]+)/i);

    if (!statusMatch) {
      return null;
    }

    const status = statusMatch[1].toLowerCase();

    // Check if in progress
    if (!status.includes('progress') && !status.includes('pending')) {
      return null;
    }

    // Extract goal
    const goalMatch = content.match(/\*\*Goal:\*\*\s*([^\n]+)/i) ||
                      content.match(/# ([^\n]+)/);

    const goal = goalMatch ? goalMatch[1].trim() : filename.replace('.md', '');

    // Count completed vs total tasks
    const completedTasks = (content.match(/- \[x\]/gi) || []).length;
    const totalTasks = (content.match(/- \[[ x]\]/gi) || []).length;

    // Extract current phase or section
    let currentPhase = null;
    const phaseMatch = content.match(/##\s+Phase\s+\d+[^#]*⏳\s*Pending/i) ||
                       content.match(/##\s+([^\n]+)\n[^#]*- \[ \]/);

    if (phaseMatch) {
      currentPhase = phaseMatch[1] || phaseMatch[0].split('\n')[0].replace('##', '').trim();
    }

    // Find next uncompleted task
    let nextTask = null;
    const taskMatch = content.match(/### Task [^#]*\n\n- \[ \] \*\*Step 1:\*\*\s*([^\n]+)/);
    if (taskMatch) {
      nextTask = taskMatch[1];
    }

    return {
      type: 'plan',
      source: filename,
      goal,
      completedTasks,
      totalTasks,
      progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      currentPhase,
      nextTask,
    };
  }

  /**
   * Check git status for uncommitted changes
   * @returns {Promise<Object|null>}
   */
  async _checkGitStatus() {
    try {
      // Check if we're in a git repo
      const isGitRepo = fs.existsSync(path.join(this.workingDir, '.git'));
      if (!isGitRepo) {
        return null;
      }

      // Get git status
      const status = execSync('git status --porcelain 2>/dev/null', {
        cwd: this.workingDir,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (!status) {
        return null;
      }

      const lines = status.split('\n').filter(l => l.trim());
      const staged = lines.filter(l => l[0] !== ' ' && l[0] !== '?').length;
      const modified = lines.filter(l => l[1] === 'M').length;
      const untracked = lines.filter(l => l.startsWith('??')).length;

      // Get current branch
      let branch = 'main';
      try {
        branch = execSync('git branch --show-current 2>/dev/null', {
          cwd: this.workingDir,
          encoding: 'utf-8',
          timeout: 3000,
        }).trim() || 'main';
      } catch {
        // Ignore branch detection failure
      }

      return {
        type: 'git',
        source: 'working directory',
        branch,
        staged,
        modified,
        untracked,
        total: lines.length,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check for recent memories with WIP patterns
   * @returns {Promise<Array>}
   */
  async _checkRecentMemories() {
    const items = [];
    const wipPatterns = [
      /TODO:/i,
      /WIP:/i,
      /FIXME:/i,
      /in progress/i,
      /not yet implemented/i,
      /needs to be/i,
      /will implement/i,
    ];

    try {
      const memoriesFile = path.join(this.memoriesDir, 'working.jsonl');
      if (!fs.existsSync(memoriesFile)) {
        return items;
      }

      const content = fs.readFileSync(memoriesFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      // Check last 10 memories
      for (const line of lines.slice(-10)) {
        try {
          const memory = JSON.parse(line);
          const text = memory.content || '';

          for (const pattern of wipPatterns) {
            if (pattern.test(text)) {
              // Extract the relevant part
              const match = text.match(new RegExp(`(${pattern.source}[^.\\n]{0,100})`, 'i'));
              if (match) {
                items.push({
                  type: 'memory',
                  source: 'recent memory',
                  content: match[1].trim(),
                  timestamp: memory.sourceTimestamp,
                });
              }
              break;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch (error) {
      // Ignore memory file errors
    }

    return items;
  }

  /**
   * Build a human-readable summary of WIP items
   * @param {Array} items
   * @returns {string}
   */
  _buildSummary(items) {
    const lines = ['📋 **Work in Progress Detected**', ''];

    for (const item of items) {
      switch (item.type) {
        case 'plan':
          lines.push(`• **${item.goal}** (${item.progress}% complete - ${item.completedTasks}/${item.totalTasks} tasks)`);
          if (item.currentPhase) {
            lines.push(`  Current: ${item.currentPhase}`);
          }
          if (item.nextTask) {
            lines.push(`  Next: ${item.nextTask}`);
          }
          break;

        case 'git':
          lines.push(`• **Uncommitted changes** on branch \`${item.branch}\``);
          if (item.staged > 0) lines.push(`  - ${item.staged} staged`);
          if (item.modified > 0) lines.push(`  - ${item.modified} modified`);
          if (item.untracked > 0) lines.push(`  - ${item.untracked} untracked`);
          break;

        case 'memory':
          lines.push(`• ${item.content}`);
          break;
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format WIP for injection
   * @param {Object} wipResult
   * @returns {string}
   */
  formatForInjection(wipResult) {
    if (!wipResult.hasWIP) {
      return '';
    }

    const lines = [
      '',
      '╭─────────────────────────────────────────────────╮',
      '│  📋 CONTINUING FROM PREVIOUS SESSION            │',
      '╰─────────────────────────────────────────────────╯',
      '',
    ];

    for (const item of wipResult.items) {
      switch (item.type) {
        case 'plan':
          lines.push(`**You were working on:** ${item.goal}`);
          lines.push(`**Progress:** ${item.progress}% (${item.completedTasks}/${item.totalTasks} tasks)`);
          if (item.currentPhase) {
            lines.push(`**Current Phase:** ${item.currentPhase}`);
          }
          if (item.nextTask) {
            lines.push(`**Next Step:** ${item.nextTask}`);
          }
          lines.push('');
          break;

        case 'git':
          lines.push(`**Uncommitted changes:** ${item.total} files on \`${item.branch}\``);
          lines.push('');
          break;

        case 'memory':
          lines.push(`**Reminder:** ${item.content}`);
          lines.push('');
          break;
      }
    }

    return lines.join('\n');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { WIPDetector };

// CLI usage
if (require.main === module) {
  const detector = new WIPDetector();
  detector.detect().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.hasWIP) {
      console.log('\n--- Formatted for injection ---\n');
      console.log(detector.formatForInjection(result));
    }
  });
}
