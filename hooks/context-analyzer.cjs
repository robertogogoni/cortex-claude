/**
 * Claude Memory Orchestrator - Context Analyzer
 *
 * Analyzes current session context to determine what memories are relevant.
 * Extracts intent, project info, and semantic signals from:
 * - Working directory
 * - Git information
 * - Recent files
 * - User prompt (if available)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// =============================================================================
// INTENT CLASSIFICATION
// =============================================================================

/**
 * Intent patterns with priority weights
 */
const INTENT_PATTERNS = {
  debugging: {
    keywords: ['debug', 'error', 'bug', 'fix', 'broken', 'crash', 'fail', 'issue', 'problem'],
    weight: 1.0,
  },
  implementation: {
    keywords: ['implement', 'create', 'build', 'add', 'make', 'write', 'develop'],
    weight: 0.9,
  },
  refactoring: {
    keywords: ['refactor', 'improve', 'optimize', 'clean', 'reorganize', 'restructure'],
    weight: 0.8,
  },
  testing: {
    keywords: ['test', 'tests', 'spec', 'coverage', 'assert', 'expect', 'mock', 'stub'],
    weight: 0.85,
  },
  documentation: {
    keywords: ['document', 'docs', 'readme', 'comment', 'explain', 'describe'],
    weight: 0.7,
  },
  configuration: {
    keywords: ['config', 'setup', 'install', 'configure', 'settings', 'env'],
    weight: 0.75,
  },
  exploration: {
    keywords: ['what', 'how', 'where', 'why', 'find', 'search', 'look', 'understand'],
    weight: 0.6,
  },
  review: {
    keywords: ['review', 'check', 'verify', 'audit', 'inspect', 'examine'],
    weight: 0.7,
  },
};

/**
 * File type to domain mapping
 */
const FILE_DOMAINS = {
  // Frontend
  '.jsx': 'frontend',
  '.tsx': 'frontend',
  '.vue': 'frontend',
  '.svelte': 'frontend',
  '.css': 'frontend',
  '.scss': 'frontend',
  '.html': 'frontend',

  // Backend
  '.go': 'backend',
  '.py': 'backend',
  '.java': 'backend',
  '.rs': 'backend',
  '.rb': 'backend',
  '.php': 'backend',

  // JavaScript/TypeScript (could be either)
  '.js': 'javascript',
  '.ts': 'typescript',
  '.cjs': 'javascript',
  '.mjs': 'javascript',

  // Data
  '.json': 'data',
  '.yaml': 'data',
  '.yml': 'data',
  '.toml': 'data',
  '.xml': 'data',

  // Config
  '.env': 'config',
  '.ini': 'config',
  '.conf': 'config',

  // Documentation
  '.md': 'documentation',
  '.rst': 'documentation',
  '.txt': 'documentation',

  // Shell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'shell',

  // Database
  '.sql': 'database',
  '.prisma': 'database',
};

// =============================================================================
// CONTEXT ANALYZER
// =============================================================================

class ContextAnalyzer {
  /**
   * @param {Object} options
   * @param {string} options.workingDir - Current working directory
   * @param {Object} options.weights - Custom weights for scoring
   */
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.weights = {
      projectMatch: 0.4,
      intentMatch: 0.25,
      tagMatch: 0.2,
      recency: 0.15,
      ...options.weights,
    };

    this._projectCache = null;
    this._gitInfoCache = null;
  }

  /**
   * Analyze the current context
   * @param {Object} input
   * @param {string} input.prompt - Optional user prompt
   * @param {string[]} input.recentFiles - Recently accessed files
   * @returns {Object} Context analysis result
   */
  analyze(input = {}) {
    const project = this.analyzeProject();
    const intent = this.classifyIntent(input.prompt || '');
    const domains = this.detectDomains(input.recentFiles || []);
    const tags = this.extractTags(input);

    return {
      projectHash: project.hash,
      projectName: project.name,
      projectType: project.type,
      intent: intent.primary,
      intentConfidence: intent.confidence,
      secondaryIntents: intent.secondary,
      domains,
      tags,
      gitBranch: project.gitBranch,
      gitRemote: project.gitRemote,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Analyze the current project
   * @returns {Object}
   */
  analyzeProject() {
    if (this._projectCache) return this._projectCache;

    const result = {
      hash: null,
      name: null,
      type: 'unknown',
      gitBranch: null,
      gitRemote: null,
    };

    try {
      // Get project root (git root or working dir)
      let projectRoot = this.workingDir;
      try {
        projectRoot = execSync('git rev-parse --show-toplevel', {
          cwd: this.workingDir,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        // Not a git repo, use working dir
      }

      // Generate hash from project root
      result.hash = crypto
        .createHash('md5')
        .update(projectRoot)
        .digest('hex')
        .slice(0, 12);

      // Get project name
      result.name = path.basename(projectRoot);

      // Detect project type
      result.type = this.detectProjectType(projectRoot);

      // Get git info
      try {
        result.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        result.gitRemote = execSync('git remote get-url origin', {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        // No git info available
      }
    } catch (error) {
      console.error('[ContextAnalyzer] Project analysis failed:', error.message);
    }

    this._projectCache = result;
    return result;
  }

  /**
   * Detect project type from files
   * @param {string} projectRoot
   * @returns {string}
   */
  detectProjectType(projectRoot) {
    const indicators = {
      'package.json': 'node',
      'Cargo.toml': 'rust',
      'go.mod': 'go',
      'requirements.txt': 'python',
      'pyproject.toml': 'python',
      'Gemfile': 'ruby',
      'pom.xml': 'java',
      'build.gradle': 'java',
      'composer.json': 'php',
      'CMakeLists.txt': 'cpp',
      'Makefile': 'make',
    };

    for (const [file, type] of Object.entries(indicators)) {
      if (fs.existsSync(path.join(projectRoot, file))) {
        return type;
      }
    }

    return 'unknown';
  }

  /**
   * Classify intent from prompt
   * @param {string} prompt
   * @returns {Object}
   */
  classifyIntent(prompt) {
    const lowercasePrompt = prompt.toLowerCase();
    const scores = {};

    // Score each intent based on keyword matches
    for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
      let score = 0;
      let matches = 0;

      for (const keyword of config.keywords) {
        if (lowercasePrompt.includes(keyword)) {
          score += config.weight;
          matches++;
        }
      }

      if (matches > 0) {
        scores[intent] = score / config.keywords.length * matches;
      }
    }

    // Sort by score
    const sorted = Object.entries(scores)
      .sort(([, a], [, b]) => b - a);

    if (sorted.length === 0) {
      return {
        primary: 'general',
        confidence: 0.5,
        secondary: [],
      };
    }

    const [primary, primaryScore] = sorted[0];
    const maxPossible = Math.max(...Object.values(INTENT_PATTERNS).map(p => p.weight));
    const confidence = Math.min(primaryScore / maxPossible, 1);

    return {
      primary,
      confidence,
      secondary: sorted.slice(1, 3).map(([intent]) => intent),
    };
  }

  /**
   * Detect domains from file list
   * @param {string[]} files
   * @returns {string[]}
   */
  detectDomains(files) {
    const domains = new Set();

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const domain = FILE_DOMAINS[ext];
      if (domain) {
        domains.add(domain);
      }
    }

    return [...domains];
  }

  /**
   * Extract tags from context
   * @param {Object} input
   * @returns {string[]}
   */
  extractTags(input) {
    const tags = new Set();

    // From prompt
    if (input.prompt) {
      // Extract potential tags (words after # or common terms)
      const hashTags = input.prompt.match(/#(\w+)/g) || [];
      hashTags.forEach(tag => tags.add(tag.slice(1).toLowerCase()));

      // Common technology mentions
      // Note: Using looser patterns to match variations (Node.js, PostgreSQL, etc.)
      const techPatterns = [
        /\b(react|vue|angular|svelte)\b/gi,
        /\b(node)(\.?js)?\b/gi,  // Matches "node", "Node.js", "nodejs"
        /\b(postgres)(ql)?\b/gi, // Matches "postgres", "postgresql"
        /\b(mysql|mongodb|redis)\b/gi,
        /\b(docker|kubernetes|k8s)\b/gi,
        /\b(aws|gcp|azure)\b/gi,
        /\b(api|rest|graphql|grpc)\b/gi,
        /\b(typescript|javascript|python|go|rust)\b/gi,
      ];

      for (const pattern of techPatterns) {
        let match;
        // Use exec to get capture groups
        while ((match = pattern.exec(input.prompt)) !== null) {
          // Use capture group (base name) if available, otherwise full match
          const tag = (match[1] || match[0]).toLowerCase();
          tags.add(tag);
        }
      }
    }

    // From file extensions
    if (input.recentFiles) {
      for (const file of input.recentFiles) {
        const ext = path.extname(file).slice(1).toLowerCase();
        if (ext) tags.add(ext);
      }
    }

    return [...tags];
  }

  /**
   * Score a memory against current context
   * @param {Object} memory
   * @param {Object} context
   * @returns {number} 0-1 score
   */
  scoreMemory(memory, context) {
    let score = 0;

    // Project match (highest weight)
    if (memory.projectHash === context.projectHash) {
      score += this.weights.projectMatch;
    }

    // Intent match
    const intentConfidence = context.intentConfidence ?? 1.0; // Default to 1.0 if not specified
    if (memory.intent === context.intent) {
      score += this.weights.intentMatch * intentConfidence;
    } else if (context.secondaryIntents?.includes(memory.intent)) {
      score += this.weights.intentMatch * 0.5;
    }

    // Tag overlap (Jaccard similarity)
    if (memory.tags?.length && context.tags?.length) {
      const memTags = new Set(memory.tags);
      const ctxTags = new Set(context.tags);
      const intersection = new Set([...memTags].filter(t => ctxTags.has(t)));
      const union = new Set([...memTags, ...ctxTags]);
      const tagScore = intersection.size / union.size;
      score += this.weights.tagMatch * tagScore;
    }

    // Recency decay (exponential)
    if (memory.timestamp) {
      const ageMs = Date.now() - new Date(memory.timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageDays / 30); // 30-day half-life
      score += this.weights.recency * recencyScore;
    }

    return Math.min(score, 1);
  }

  /**
   * Rank memories by relevance to context
   * @param {Object[]} memories
   * @param {Object} context
   * @returns {Object[]} Ranked memories with scores
   */
  rankMemories(memories, context) {
    return memories
      .map(memory => ({
        ...memory,
        relevanceScore: this.scoreMemory(memory, context),
      }))
      .filter(m => m.relevanceScore > 0.1) // Filter very low relevance
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Clear caches (useful for testing)
   */
  clearCache() {
    this._projectCache = null;
    this._gitInfoCache = null;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ContextAnalyzer,
  INTENT_PATTERNS,
  FILE_DOMAINS,
};
