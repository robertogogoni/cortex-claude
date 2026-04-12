/**
 * Cortex - Claude's Cognitive Layer - Markdown Tree Adapter
 *
 * Reads arbitrary markdown trees and normalizes them into MemoryRecords.
 * This is intended for user-maintained knowledge directories such as:
 * - Claude auto-memory directories
 * - Obsidian-compatible note trees
 * - project learnings, runbooks, and connections registries
 *
 * The adapter is READ-ONLY and uses lightweight filesystem caching keyed by
 * file path + mtime to avoid reparsing unchanged notes.
 *
 * @version 1.0.0
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { BaseAdapter } = require('./base-adapter.cjs');
const { expandPath } = require('../core/types.cjs');

const IGNORED_DIRS = new Set([
  '.git',
  '.obsidian',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
]);

class MarkdownTreeAdapter extends BaseAdapter {
  /**
   * @param {Object} config
   * @param {Array<string|Object>} [config.roots] - Array of root paths or root configs
   * @param {boolean} [config.enabled]
   * @param {number} [config.cacheTTL]
   * @param {number} [config.maxFileSizeBytes]
   */
  constructor(config = {}) {
    const roots = (config.roots || []).map(root => {
      if (typeof root === 'string') {
        return {
          name: path.basename(root) || 'notes',
          path: root,
          tags: [],
          typeHint: null,
          projectHash: null,
        };
      }

      return {
        name: root.name || path.basename(root.path || '') || 'notes',
        path: root.path,
        tags: Array.isArray(root.tags) ? root.tags : [],
        typeHint: root.typeHint || null,
        projectHash: root.projectHash || null,
      };
    }).filter(root => root.path);

    super({
      name: 'markdown-tree',
      priority: 0.82,
      timeout: 300,
      enabled: config.enabled !== false && roots.length > 0,
    });

    this.roots = roots.map(root => ({
      ...root,
      path: expandPath(root.path),
    }));
    this.cacheTTL = config.cacheTTL || 5 * 60 * 1000;
    this.maxFileSizeBytes = config.maxFileSizeBytes || 512 * 1024;

    this._recordCache = new Map();
    this._directoryCache = new Map();
  }

  async query(context, options = {}) {
    return this._executeQuery(async () => {
      let records = [];

      for (const root of this.roots) {
        if (!await this._isRootAvailable(root)) {
          continue;
        }

        const rootRecords = await this._loadRootRecords(root);
        records.push(...rootRecords);
      }

      records = this._filterByContext(records, context);
      records = this._applyQueryOptions(records, options);

      return records.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });
    });
  }

  async isAvailable() {
    for (const root of this.roots) {
      if (await this._isRootAvailable(root)) {
        return true;
      }
    }
    return false;
  }

  normalize(raw) {
    if (!raw || !raw.filePath || typeof raw.content !== 'string') {
      return null;
    }

    const parsed = this._parseMarkdown(raw.content);
    const basename = path.basename(raw.filePath, '.md');
    const title = parsed.frontmatter.name || parsed.title || this._humanize(basename);
    const summary = parsed.frontmatter.description || this._extractSummary(parsed.body);
    const tags = this._extractTags(parsed, raw);

    return this._createBaseRecord({
      id: this._buildId(raw),
      version: 1,
      type: this._inferType(parsed, raw),
      content: parsed.body,
      summary,
      projectHash: raw.projectHash || null,
      tags,
      intent: this._inferIntent(parsed, raw),
      sourceSessionId: `markdown-tree:${raw.rootName}`,
      sourceTimestamp: raw.modifiedTime,
      extractionConfidence: this._inferConfidence(parsed, raw),
      usageCount: 0,
      usageSuccessRate: 0.5,
      lastUsed: null,
      decayScore: 1.0,
      status: 'active',
      createdAt: raw.modifiedTime,
      updatedAt: raw.modifiedTime,
      _source: 'markdown-tree',
      _sourcePriority: this.priority,
      _sourceFile: raw.filePath,
      _rootName: raw.rootName,
      _relativePath: raw.relativePath,
      _noteTitle: title,
      _frontmatter: parsed.frontmatter,
    });
  }

  supportsWrite() {
    return false;
  }

  async _isRootAvailable(root) {
    try {
      return fs.statSync(root.path).isDirectory();
    } catch {
      return false;
    }
  }

  async _loadRootRecords(root) {
    const cacheKey = `${root.name}:${root.path}`;
    const cached = this._directoryCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      this._trackCacheAccess(true);
      return cached.records;
    }

    this._trackCacheAccess(false);

    const files = this._walkMarkdownFiles(root.path);
    const records = [];

    for (const filePath of files) {
      const stat = fs.statSync(filePath);
      if (stat.size > this.maxFileSizeBytes) {
        continue;
      }

      const cacheEntry = this._recordCache.get(filePath);
      if (cacheEntry && cacheEntry.mtimeMs === stat.mtimeMs) {
        records.push(cacheEntry.record);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const record = this.normalize({
        content,
        filePath,
        rootName: root.name,
        relativePath: path.relative(root.path, filePath),
        modifiedTime: stat.mtime.toISOString(),
        projectHash: root.projectHash,
        rootTags: root.tags,
        typeHint: root.typeHint,
      });

      if (record) {
        this._recordCache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          record,
        });
        records.push(record);
      }
    }

    this._directoryCache.set(cacheKey, {
      timestamp: Date.now(),
      records,
    });

    return records;
  }

  _walkMarkdownFiles(rootPath) {
    const results = [];
    const stack = [rootPath];

    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            stack.push(fullPath);
          }
          continue;
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    }

    return results.sort();
  }

  _parseMarkdown(content) {
    let body = content;
    let frontmatter = {};

    if (content.startsWith('---\n')) {
      const endIndex = content.indexOf('\n---\n', 4);
      if (endIndex !== -1) {
        const rawFrontmatter = content.slice(4, endIndex);
        frontmatter = this._parseFrontmatter(rawFrontmatter);
        body = content.slice(endIndex + 5);
      }
    }

    const titleMatch = body.match(/^#\s+(.+)$/m);
    return {
      frontmatter,
      body: body.trim(),
      title: titleMatch ? titleMatch[1].trim() : null,
    };
  }

  _parseFrontmatter(raw) {
    const frontmatter = {};
    let currentKey = null;

    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      const listItem = line.match(/^\s*-\s+(.+)$/);
      if (listItem && currentKey) {
        if (!Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = [];
        }
        frontmatter[currentKey].push(this._stripQuotes(listItem[1].trim()));
        continue;
      }

      const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!keyValue) {
        currentKey = null;
        continue;
      }

      const [, key, rawValue] = keyValue;
      currentKey = key;

      if (!rawValue) {
        frontmatter[key] = frontmatter[key] || [];
        continue;
      }

      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        frontmatter[key] = rawValue
          .slice(1, -1)
          .split(',')
          .map(item => this._stripQuotes(item.trim()))
          .filter(Boolean);
        continue;
      }

      frontmatter[key] = this._stripQuotes(rawValue.trim());
    }

    return frontmatter;
  }

  _stripQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  _extractSummary(body) {
    const cleaned = body
      .replace(/^#.*$/gm, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .split('\n')
      .map(line => line.trim())
      .find(Boolean) || '';

    return cleaned.slice(0, 160) || 'Markdown note';
  }

  _extractTags(parsed, raw) {
    const tags = new Set();

    const addTag = value => {
      if (!value) return;
      const normalized = String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (normalized) {
        tags.add(normalized);
      }
    };

    (raw.rootTags || []).forEach(addTag);
    addTag(raw.rootName);

    const frontmatterTags = parsed.frontmatter.tags || parsed.frontmatter.tag || [];
    (Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags]).forEach(addTag);

    const relativeParts = raw.relativePath.split(path.sep).slice(0, -1);
    relativeParts.forEach(addTag);

    const basename = path.basename(raw.filePath, '.md');
    basename.split(/[_-]+/).forEach(addTag);

    if (parsed.frontmatter.type) addTag(parsed.frontmatter.type);
    if (parsed.frontmatter.name) addTag(parsed.frontmatter.name);

    return Array.from(tags);
  }

  _inferType(parsed, raw) {
    const candidate = String(parsed.frontmatter.type || raw.typeHint || '').toLowerCase();
    const basename = path.basename(raw.filePath).toLowerCase();

    if (candidate === 'feedback' || candidate === 'preference' || basename.startsWith('feedback')) {
      return 'preference';
    }

    if (candidate === 'skill' || basename.includes('skill') || basename.includes('runbook')) {
      return 'skill';
    }

    if (candidate === 'correction' || basename.includes('fix') || basename.includes('troubleshooting')) {
      return 'correction';
    }

    if (candidate === 'pattern' || candidate === 'project' || candidate === 'reference') {
      return 'pattern';
    }

    return 'learning';
  }

  _inferIntent(parsed, raw) {
    const candidate = String(parsed.frontmatter.type || raw.typeHint || '').toLowerCase();
    if (candidate) {
      return candidate;
    }

    const relative = raw.relativePath.toLowerCase();
    if (relative.includes('debug') || relative.includes('troubleshoot')) return 'debugging';
    if (relative.includes('project')) return 'project';
    if (relative.includes('reference')) return 'reference';
    if (relative.includes('feedback')) return 'preference';
    return 'general';
  }

  _inferConfidence(parsed, raw) {
    if (parsed.frontmatter.description || parsed.frontmatter.name) {
      return 0.92;
    }
    if (raw.relativePath.toLowerCase().includes('memory')) {
      return 0.88;
    }
    return 0.8;
  }

  _buildId(raw) {
    const hash = crypto
      .createHash('sha1')
      .update(`${raw.rootName}:${raw.filePath}`)
      .digest('hex')
      .slice(0, 16);
    return `markdown-tree:${hash}`;
  }

  _humanize(value) {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  _filterByContext(records, context) {
    if (!context?.tags?.length && !context?.intent && !context?.projectHash) {
      return records;
    }

    const searchTerms = new Set((context.tags || []).map(tag => tag.toLowerCase()));

    return records.filter(record => {
      let score = 0;

      if (context.projectHash && (record.projectHash === null || record.projectHash === context.projectHash)) {
        score += 0.2;
      }

      if (context.intent && record.intent === context.intent) {
        score += 0.4;
      }

      if (searchTerms.size > 0) {
        const haystack = `${record.summary} ${record.content} ${(record.tags || []).join(' ')}`.toLowerCase();
        for (const term of searchTerms) {
          if (haystack.includes(term)) {
            score += 0.25;
          }
        }
      }

      return score > 0;
    });
  }
}

module.exports = {
  MarkdownTreeAdapter,
};
