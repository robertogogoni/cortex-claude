/**
 * Cortex - Claude's Cognitive Layer - CLAUDE.md Adapter
 *
 * Parses CLAUDE.md files for structured knowledge.
 * These files contain user-curated knowledge that is highly valuable:
 * - Solutions and fixes
 * - Patterns and workflows
 * - Preferences and standards
 * - Commands and skills
 *
 * @version 1.1.0
 * @see Design: ~/.claude/dev/skill-activator/docs/plans/2026-01-26-claude-memory-orchestrator-design.md#section-2.3.4
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BaseAdapter } = require('./base-adapter.cjs');
const { expandPath } = require('../core/types.cjs');

// =============================================================================
// CLAUDE.MD ADAPTER
// =============================================================================

/**
 * Adapter for parsing CLAUDE.md files
 * Priority: 0.85 - User-curated knowledge is highly valuable
 */
class ClaudeMdAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {string[]} [config.paths] - Paths to scan for CLAUDE.md
   * @param {number} [config.cacheTimeout=60000] - Cache timeout in ms
   */
  constructor(config = {}) {
    super({
      name: 'claudemd',
      priority: 0.85,  // High priority - user-curated
      timeout: 100,    // Local file, fast
      enabled: config.enabled !== false,
    });

    // Paths to scan for CLAUDE.md files
    this.paths = (config.paths || [
      '~/.claude/CLAUDE.md',
      '~/claude-cross-machine-sync/CLAUDE.md',
      '.claude/CLAUDE.md',
      './CLAUDE.md',
    ]).map(p => expandPath(p));

    this.cacheTimeout = config.cacheTimeout || 60 * 1000;  // 1 minute

    // Cache: path -> { mtime, records }
    this._cache = new Map();
  }

  /**
   * Query CLAUDE.md files for relevant memories
   * @param {import('./base-adapter.cjs').AnalysisContext} context
   * @param {import('./base-adapter.cjs').QueryOptions} [options]
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async query(context, options = {}) {
    return this._executeQuery(async () => {
      const allRecords = [];

      for (const basePath of this.paths) {
        try {
          const records = await this._queryFile(basePath);
          allRecords.push(...records);
        } catch (error) {
          // File may not exist, that's ok
          if (error.code !== 'ENOENT') {
            console.error(`[ClaudeMdAdapter] Error reading ${basePath}:`, error.message);
          }
        }
      }

      // Filter by context relevance
      const relevant = this._filterByContext(allRecords, context);

      // Apply additional filters
      const filtered = this._applyQueryOptions(relevant, options);

      return filtered;
    });
  }

  /**
   * Query a single CLAUDE.md file
   * @private
   * @param {string} filePath
   * @returns {Promise<import('./base-adapter.cjs').MemoryRecord[]>}
   */
  async _queryFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const stat = fs.statSync(filePath);
    const cached = this._cache.get(filePath);

    // Check cache validity
    if (cached && cached.mtime === stat.mtimeMs) {
      this._trackCacheAccess(true);
      return cached.records;
    }
    this._trackCacheAccess(false);

    // Parse file
    const content = fs.readFileSync(filePath, 'utf-8');
    const records = this._parseClaudeMd(content, filePath);

    // Update cache
    this._cache.set(filePath, {
      mtime: stat.mtimeMs,
      records,
    });

    return records;
  }

  /**
   * Parse CLAUDE.md content into memory records
   * @private
   * @param {string} content
   * @param {string} sourcePath
   * @returns {import('./base-adapter.cjs').MemoryRecord[]}
   */
  _parseClaudeMd(content, sourcePath) {
    const records = [];
    const sections = this._extractSections(content);

    for (const section of sections) {
      // Extract individual items from section
      const items = this._extractItems(section.content);

      for (const item of items) {
        const type = this._inferType(section.heading, item.content);
        const tags = [...section.tags, ...this._extractItemTags(item.content)];

        records.push(this._createBaseRecord({
          id: this._generateItemId(sourcePath, section.heading, item.content),
          version: 1,
          type,
          content: item.content,
          summary: item.content.slice(0, 100),
          projectHash: this._getProjectHash(sourcePath),
          tags: [...new Set(tags)],  // Deduplicate
          intent: section.intent || 'general',
          sourceSessionId: 'claudemd',
          sourceTimestamp: new Date().toISOString(),
          extractionConfidence: 0.9,  // User-curated = high confidence
          usageCount: 0,
          usageSuccessRate: 0.5,
          lastUsed: null,
          decayScore: 1.0,  // CLAUDE.md doesn't decay
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _source: 'claudemd',
          _sourcePriority: this.priority,
          _sectionHeading: section.heading,
          _sourceFile: sourcePath,
        }));
      }
    }

    return records;
  }

  /**
   * Extract sections from markdown content
   * @private
   * @param {string} content
   * @returns {Array<{level: number, heading: string, content: string, tags: string[], intent: string}>}
   */
  _extractSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = null;

    for (const line of lines) {
      // Match ## or ### headings
      const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);

      if (headingMatch) {
        if (currentSection && currentSection.content.trim()) {
          sections.push(currentSection);
        }
        currentSection = {
          level: headingMatch[1].length,
          heading: headingMatch[2],
          content: '',
          tags: this._extractHeadingTags(headingMatch[2]),
          intent: this._inferIntent(headingMatch[2]),
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      }
    }

    if (currentSection && currentSection.content.trim()) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Extract individual items from section content
   * @private
   * @param {string} content
   * @returns {Array<{content: string, type?: string}>}
   */
  _extractItems(content) {
    const items = [];

    // Extract bullet points
    const bulletMatches = content.match(/^[-*]\s+.+$/gm) || [];
    for (const bullet of bulletMatches) {
      const text = bullet.replace(/^[-*]\s+/, '').trim();
      if (text.length > 10) {  // Skip trivial items
        items.push({ content: text });
      }
    }

    // Extract code blocks with context
    const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
    let codeMatch;
    while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
      const code = codeMatch[1].trim();
      if (code.length > 20) {
        // Get context from preceding text
        const beforeCode = content.slice(0, codeMatch.index);
        const precedingText = beforeCode.split('\n').slice(-3).join(' ').trim();
        items.push({
          content: precedingText ? `${precedingText}\n\n${code}` : code,
          type: 'code',
        });
      }
    }

    // Extract table rows (key-value pairs)
    const tableRowRegex = /\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
    let tableMatch;
    while ((tableMatch = tableRowRegex.exec(content)) !== null) {
      const key = tableMatch[1].trim();
      const value = tableMatch[2].trim();
      // Skip header rows and separator rows
      if (key && value && !key.includes('---') && key.toLowerCase() !== 'key') {
        items.push({ content: `${key}: ${value}` });
      }
    }

    // Extract paragraphs that look like learnings
    const paragraphs = content.split(/\n\n+/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      // Skip if already captured as bullet or code block
      if (trimmed.length > 50 && !trimmed.startsWith('-') && !trimmed.startsWith('*') && !trimmed.startsWith('```')) {
        // Check if it looks like a learning/solution
        if (this._looksLikeLearning(trimmed)) {
          items.push({ content: trimmed });
        }
      }
    }

    return items;
  }

  /**
   * Check if text looks like a learning/solution
   * @private
   * @param {string} text
   * @returns {boolean}
   */
  _looksLikeLearning(text) {
    const lower = text.toLowerCase();
    const indicators = [
      'fixed', 'solved', 'solution', 'fix', 'resolved',
      'learned', 'discovered', 'found that', 'turns out',
      'problem:', 'issue:', 'error:', 'cause:',
      'to do this', 'you can', 'use this', 'run this',
      'key learning', 'key insight', 'important:',
    ];

    return indicators.some(ind => lower.includes(ind));
  }

  /**
   * Check if adapter is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // Check if any CLAUDE.md file exists
    for (const p of this.paths) {
      try {
        if (fs.existsSync(p)) {
          return true;
        }
      } catch {
        // Continue checking
      }
    }
    return false;
  }

  /**
   * Normalize raw data (for interface compliance)
   * @param {Object} rawData
   * @returns {import('./base-adapter.cjs').MemoryRecord}
   */
  normalize(rawData) {
    // CLAUDE.md records are already created in MemoryRecord format
    return rawData;
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  /**
   * Extract tags from heading
   * @private
   */
  _extractHeadingTags(heading) {
    const tags = [];
    const lower = heading.toLowerCase();

    // Date tags
    const dateMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
      tags.push(`date:${dateMatch[0]}`);
    }

    // Technology tags
    const techWords = [
      'git', 'docker', 'linux', 'bash', 'node', 'python',
      'claude', 'mcp', 'hook', 'plugin', 'sync', 'memory',
      'chrome', 'extension', 'api', 'settings', 'config',
    ];

    for (const tech of techWords) {
      if (lower.includes(tech)) {
        tags.push(tech);
      }
    }

    // Action tags
    const actionWords = ['fix', 'setup', 'install', 'configure', 'troubleshoot'];
    for (const action of actionWords) {
      if (lower.includes(action)) {
        tags.push(action);
      }
    }

    return tags;
  }

  /**
   * Extract tags from item content
   * @private
   */
  _extractItemTags(content) {
    const tags = [];
    const lower = content.toLowerCase();

    // Technology detection
    const techPatterns = {
      'javascript': ['javascript', 'js', '.js'],
      'typescript': ['typescript', 'ts', '.ts'],
      'python': ['python', 'py', '.py'],
      'bash': ['bash', 'sh', 'shell'],
      'git': ['git ', 'git add', 'git commit'],
      'docker': ['docker', 'container'],
      'node': ['node', 'npm', 'yarn'],
    };

    for (const [tag, patterns] of Object.entries(techPatterns)) {
      if (patterns.some(p => lower.includes(p))) {
        tags.push(tag);
      }
    }

    return tags;
  }

  /**
   * Infer intent from heading
   * @private
   */
  _inferIntent(heading) {
    const lower = heading.toLowerCase();

    if (lower.includes('fix') || lower.includes('troubleshoot') || lower.includes('debug')) {
      return 'debugging';
    }
    if (lower.includes('setup') || lower.includes('install') || lower.includes('configure')) {
      return 'configuration';
    }
    if (lower.includes('workflow') || lower.includes('process')) {
      return 'workflow';
    }
    if (lower.includes('solution') || lower.includes('accomplished')) {
      return 'solution';
    }

    return 'general';
  }

  /**
   * Infer memory type from heading and content
   * @private
   */
  _inferType(heading, content) {
    const lowerHeading = heading.toLowerCase();
    const lowerContent = content.toLowerCase();

    if (lowerHeading.includes('fix') || lowerHeading.includes('solution') ||
        lowerContent.includes('fixed') || lowerContent.includes('solved')) {
      return 'learning';
    }
    if (lowerHeading.includes('pattern') || lowerHeading.includes('workflow')) {
      return 'pattern';
    }
    if (lowerHeading.includes('preference') || lowerHeading.includes('standard')) {
      return 'preference';
    }
    if (lowerHeading.includes('skill') || lowerHeading.includes('command')) {
      return 'skill';
    }
    if (lowerHeading.includes('warning') || lowerHeading.includes('avoid') ||
        lowerContent.includes('don\'t') || lowerContent.includes('avoid')) {
      return 'correction';
    }

    return 'learning';
  }

  /**
   * Generate unique ID for an item
   * @private
   */
  _generateItemId(sourcePath, heading, content) {
    const hash = crypto.createHash('md5')
      .update(`${sourcePath}:${heading}:${content.slice(0, 100)}`)
      .digest('hex')
      .slice(0, 8);

    return `claudemd:${hash}`;
  }

  /**
   * Get project hash from file path
   * @private
   */
  _getProjectHash(filePath) {
    // Global CLAUDE.md = null (cross-project)
    if (filePath.includes('/.claude/') || filePath.includes('/claude-cross-machine-sync/')) {
      return null;
    }

    // Project-specific CLAUDE.md
    const dir = path.dirname(filePath);
    return crypto.createHash('md5').update(dir).digest('hex').slice(0, 12);
  }

  /**
   * Filter records by context relevance
   * @private
   */
  _filterByContext(records, context) {
    if (!context.tags?.length && !context.intent) {
      return records;  // No filtering if no context
    }

    return records.filter(record => {
      let score = 0;

      // Tag matching
      if (context.tags?.length && record.tags?.length) {
        const contextTags = new Set(context.tags.map(t => t.toLowerCase()));
        const recordTags = record.tags.map(t => t.toLowerCase());

        for (const tag of recordTags) {
          if (contextTags.has(tag)) {
            score += 0.3;
          }
        }
      }

      // Intent matching
      if (context.intent && record.intent === context.intent) {
        score += 0.4;
      }

      // Project matching
      if (context.projectHash && record.projectHash === context.projectHash) {
        score += 0.3;
      }

      // Global records get a base score
      if (record.projectHash === null) {
        score += 0.1;
      }

      return score > 0.1;  // Include if any relevance
    });
  }

  /**
   * Add a new path to scan
   * @param {string} newPath
   */
  addPath(newPath) {
    const expanded = expandPath(newPath);
    if (!this.paths.includes(expanded)) {
      this.paths.push(expanded);
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this._cache.clear();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ClaudeMdAdapter,
};
