/**
 * Cortex - Claude's Cognitive Layer - Gemini Adapter
 *
 * Reads Google Antigravity/Gemini task sessions from ~/.gemini/antigravity/brain/
 * Each session is a UUID directory containing markdown files:
 * - task.md: Task definition and requirements
 * - implementation_plan.md: Step-by-step implementation
 * - walkthrough.md: Guided walkthrough
 * - verification_plan.md: Testing and verification steps
 *
 * This adapter is READ-ONLY - it provides access to 15+ structured task sessions
 * from Gemini without modifying them.
 *
 * @version 1.0.0
 * @see Design: ../docs/design/memory-orchestrator.md#section-2.3
 */

'use strict';

const { BaseAdapter } = require('./base-adapter.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * File type configurations for Gemini brain files
 * Maps filename patterns to memory types and confidence levels
 */
const FILE_TYPE_CONFIG = {
  'task.md': { type: 'skill', confidence: 1.0 },
  'implementation_plan.md': { type: 'pattern', confidence: 0.9 },
  'walkthrough.md': { type: 'skill', confidence: 0.8 },
  'verification_plan.md': { type: 'pattern', confidence: 0.7 },
};

/**
 * Technology tags to extract from content
 */
const TECH_TAGS = [
  'docker', 'git', 'typescript', 'javascript', 'python', 'node',
  'react', 'vue', 'angular', 'kubernetes', 'aws', 'linux', 'bash',
  'vitest', 'jest', 'npm', 'ffmpeg', 'chrome', 'extension',
  'api', 'database', 'postgresql', 'mongodb', 'redis',
  'ci', 'cd', 'pipeline', 'test', 'debug', 'deploy',
];

/**
 * Default cache TTL: 5 minutes
 */
const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

// =============================================================================
// GEMINI ADAPTER
// =============================================================================

/**
 * Adapter for Google Antigravity/Gemini task sessions
 * Priority: 0.7 - Structured task documentation, moderate relevance
 * Timeout: 200ms - Local filesystem, should be fast
 */
class GeminiAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string} [config.brainPath] - Path to brain directory (auto-discovers if not provided)
   * @param {number} [config.cacheTTL] - Cache TTL in milliseconds (default: 5 minutes)
   * @param {boolean} [config.enabled] - Whether adapter is enabled (default: true)
   */
  constructor(config = {}) {
    super({
      name: 'gemini',
      priority: 0.7,
      timeout: 200,
      enabled: config.enabled !== false,
    });

    // Auto-discover or use provided brain path
    this.brainPath = config.brainPath ||
      path.join(os.homedir(), '.gemini', 'antigravity', 'brain');

    // Cache configuration
    this._cacheTTL = config.cacheTTL || DEFAULT_CACHE_TTL;
    this._cache = new Map();
    this._sessionCache = null;
    this._sessionCacheTime = 0;
  }

  // ---------------------------------------------------------------------------
  // CORE INTERFACE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Query Gemini sessions for relevant memories
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      // Check cache first
      const cacheKey = this._getCacheKey(context, options);
      const cached = this._getFromCache(cacheKey);
      if (cached) {
        this._trackCacheAccess(true);
        return cached;
      }
      this._trackCacheAccess(false);

      // Check availability
      if (!await this.isAvailable()) {
        return [];
      }

      // Load all sessions
      const sessions = await this._loadSessions();

      // Convert to memory records
      let records = [];
      for (const session of sessions) {
        for (const file of session.files) {
          const record = this.normalize({
            sessionId: session.uuid,
            fileName: file.name,
            content: file.content,
            filePath: file.path,
            modifiedTime: file.modifiedTime,
          });

          if (record) {
            records.push(record);
          }
        }
      }

      // Apply search filter if context has tags
      if (context.tags?.length) {
        const searchTerms = context.tags.map(t => t.toLowerCase());
        records = records.filter(r => {
          const content = r.content.toLowerCase();
          const summary = r.summary.toLowerCase();
          const tags = r.tags.map(t => t.toLowerCase());

          return searchTerms.some(term =>
            content.includes(term) ||
            summary.includes(term) ||
            tags.some(tag => tag.includes(term))
          );
        });
      }

      // Apply standard query options
      const filtered = this._applyQueryOptions(records, options);

      // Cache results
      this._setCache(cacheKey, filtered);

      return filtered;
    });
  }

  /**
   * Check if Gemini brain directory is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const stats = fs.statSync(this.brainPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Normalize raw session file data to MemoryRecord format
   * @param {Object} raw - Raw session file data
   * @param {string} raw.sessionId - Session UUID
   * @param {string} raw.fileName - File name (e.g., 'task.md')
   * @param {string} raw.content - File content
   * @param {string} raw.filePath - Full file path
   * @param {string} [raw.modifiedTime] - File modification time
   * @returns {import('./base-adapter.cjs').MemoryRecord | null}
   */
  normalize(raw) {
    // Validate required fields
    if (!raw || !raw.sessionId || !raw.fileName) return null;

    // Determine type and confidence from file name
    const config = FILE_TYPE_CONFIG[raw.fileName] || {
      type: 'learning',
      confidence: 0.5,
    };

    // Extract title from first # heading
    const title = this._extractTitle(raw.content);

    // Extract tags from content
    const extractedTags = this._extractTags(raw.content);

    // Create unique ID
    const id = `gemini:${raw.sessionId}:${raw.fileName}`;

    // Determine timestamp
    const timestamp = raw.modifiedTime || new Date().toISOString();

    return this._createBaseRecord({
      id,
      version: 1,
      type: config.type,
      content: raw.content || '',
      summary: title || (raw.content || '').slice(0, 100),
      projectHash: null, // Gemini sessions are global
      tags: extractedTags,
      intent: this._inferIntent(raw.fileName, raw.content),
      sourceSessionId: raw.sessionId,
      sourceTimestamp: timestamp,
      extractionConfidence: config.confidence,
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: this._calculateDecay(timestamp),
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      _source: 'gemini',
      _sourcePriority: this.priority,
      _fileName: raw.fileName,
      _filePath: raw.filePath,
    });
  }

  /**
   * This adapter is read-only
   * @returns {boolean} Always false
   */
  supportsWrite() {
    return false;
  }

  // ---------------------------------------------------------------------------
  // ADDITIONAL PUBLIC METHODS
  // ---------------------------------------------------------------------------

  /**
   * Get count of available sessions
   * @returns {Promise<number>}
   */
  async getSessionCount() {
    try {
      const entries = fs.readdirSync(this.brainPath, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this._cache.clear();
    this._sessionCache = null;
    this._sessionCacheTime = 0;
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Load all sessions from brain directory
   * @private
   * @returns {Promise<Array<{uuid: string, files: Array<{name: string, content: string, path: string, modifiedTime: string}>}>>}
   */
  async _loadSessions() {
    // Check session cache
    if (this._sessionCache && (Date.now() - this._sessionCacheTime) < this._cacheTTL) {
      return this._sessionCache;
    }

    const sessions = [];

    try {
      const entries = fs.readdirSync(this.brainPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionUuid = entry.name;
        const sessionDir = path.join(this.brainPath, sessionUuid);

        const files = [];
        const fileEntries = fs.readdirSync(sessionDir, { withFileTypes: true });

        for (const fileEntry of fileEntries) {
          // Only process .md files (ignore .resolved, .metadata.json, images, etc.)
          if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue;

          // Skip resolved/backup files
          if (fileEntry.name.includes('.resolved') || fileEntry.name.includes('.metadata')) {
            continue;
          }

          const filePath = path.join(sessionDir, fileEntry.name);

          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const stats = fs.statSync(filePath);

            files.push({
              name: fileEntry.name,
              content,
              path: filePath,
              modifiedTime: stats.mtime.toISOString(),
            });
          } catch {
            // Skip files we can't read
            continue;
          }
        }

        // Always include session (even if empty) for accurate count
        sessions.push({
          uuid: sessionUuid,
          files,
        });
      }
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }

    // Cache sessions
    this._sessionCache = sessions;
    this._sessionCacheTime = Date.now();

    return sessions;
  }

  /**
   * Extract title from first # heading in markdown
   * @private
   * @param {string} content
   * @returns {string | null}
   */
  _extractTitle(content) {
    if (!content) return null;

    // Match first # heading (supports # or ## or ### etc.)
    const match = content.match(/^#{1,6}\s+(.+)$/m);
    if (match) {
      // Clean up the title (remove trailing punctuation, limit length)
      let title = match[1].trim();
      if (title.length > 100) {
        title = title.slice(0, 97) + '...';
      }
      return title;
    }

    return null;
  }

  /**
   * Extract technology tags from content
   * @private
   * @param {string} content
   * @returns {string[]}
   */
  _extractTags(content) {
    if (!content) return [];

    const lower = content.toLowerCase();
    const tags = [];

    for (const tech of TECH_TAGS) {
      if (lower.includes(tech)) {
        tags.push(tech);
      }
    }

    // Limit to 10 tags
    return tags.slice(0, 10);
  }

  /**
   * Infer intent from file name and content
   * @private
   * @param {string} fileName
   * @param {string} content
   * @returns {string}
   */
  _inferIntent(fileName, content) {
    const lower = (content || '').toLowerCase();

    // Intent based on file type
    if (fileName === 'task.md') return 'task_definition';
    if (fileName === 'implementation_plan.md') return 'planning';
    if (fileName === 'walkthrough.md') return 'guide';
    if (fileName === 'verification_plan.md') return 'testing';

    // Content-based fallback
    if (lower.includes('debug') || lower.includes('fix')) return 'debugging';
    if (lower.includes('install') || lower.includes('setup')) return 'setup';
    if (lower.includes('test') || lower.includes('verify')) return 'testing';

    return 'general';
  }

  /**
   * Calculate decay score based on timestamp
   * @private
   * @param {string} timestamp
   * @returns {number} 0.0-1.0
   */
  _calculateDecay(timestamp) {
    if (!timestamp) return 0.5;

    try {
      const age = Date.now() - new Date(timestamp).getTime();
      // Decay over 90 days (Gemini sessions are often valuable long-term)
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      const decay = Math.exp(-age / ninetyDays);
      return Math.max(0.1, Math.min(1.0, decay));
    } catch {
      return 0.5;
    }
  }

  /**
   * Generate cache key for query
   * @private
   */
  _getCacheKey(context, options) {
    const contextKey = context.tags?.join(',') || '';
    return `${contextKey}:${JSON.stringify(options)}`;
  }

  /**
   * Get from cache if valid
   * @private
   */
  _getFromCache(key) {
    const cached = this._cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this._cacheTTL) {
      this._cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cache entry
   * @private
   */
  _setCache(key, data) {
    this._cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // Clean old entries if cache is too large
    if (this._cache.size > 50) {
      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [k, entry] of this._cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this._cache.delete(oldestKey);
      }
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  GeminiAdapter,
};
