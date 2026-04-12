/**
 * Cortex - Claude's Cognitive Layer - Context Analyzer
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
/**
 * Common English stopwords to filter from keyword extraction
 */
const STOPWORDS = new Set([
  // Articles & determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // Pronouns
  'i', 'me', 'my', 'you', 'your', 'he', 'she', 'it', 'we', 'they',
  'him', 'her', 'his', 'its', 'our', 'their', 'who', 'what', 'which',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  // Conjunctions
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while', 'as',
  // Verbs (common)
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'must', 'shall',
  // Adverbs
  'not', 'no', 'yes', 'very', 'just', 'also', 'only', 'now', 'here',
  'there', 'how', 'why', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'any', 'so', 'than', 'too', 'out',
  // Common Claude Code prompts
  'help', 'please', 'want', 'need', 'like', 'get', 'make', 'use',
  'let', 'know', 'think', 'see', 'look', 'tell', 'show', 'give',
]);

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
   * @param {Object} options.semantic - Semantic analyzer options
   * @param {boolean} options.semantic.enabled - Enable semantic analysis (default: false)
   * @param {boolean} options.semantic.useHaiku - Use Haiku API (default: true)
   * @param {boolean} options.semantic.useCache - Enable caching (default: true)
   * @param {boolean} options.semantic.useAdaptation - Enable auto-learning (default: true)
   */
  constructor(options = {}) {
    this.workingDir = options.workingDir || process.cwd();
    this.weights = {
      projectMatch: 0.3,      // Reduced from 0.4
      intentMatch: 0.2,       // Reduced from 0.25
      tagMatch: 0.15,         // Reduced from 0.2
      recency: 0.1,           // Reduced from 0.15
      contentMatch: 0.25,     // Boost memories containing prompt keywords
      semanticMatch: 0.15,    // NEW: Boost from semantic analysis
      ...options.weights,
    };

    this._projectCache = null;
    this._gitInfoCache = null;

    // Semantic analyzer (lazy-loaded)
    this._semanticOptions = options.semantic || {};
    this._semanticAnalyzer = null;
  }

  /**
   * Get semantic analyzer (lazy initialization)
   * @returns {SemanticIntentAnalyzer|null}
   */
  get semanticAnalyzer() {
    if (this._semanticAnalyzer === null && this._semanticOptions.enabled) {
      try {
        const { SemanticIntentAnalyzer } = require('./semantic-intent-analyzer.cjs');
        this._semanticAnalyzer = new SemanticIntentAnalyzer({
          useHaiku: this._semanticOptions.useHaiku !== false,
          useCache: this._semanticOptions.useCache !== false,
          useAdaptation: this._semanticOptions.useAdaptation !== false,
        });
      } catch (error) {
        console.error('[ContextAnalyzer] Failed to load SemanticIntentAnalyzer:', error.message);
        this._semanticAnalyzer = false; // Prevent retry
      }
    }
    return this._semanticAnalyzer || null;
  }

  /**
   * Analyze the current context (synchronous, keyword-based)
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
    const keywords = this.extractKeywords(input.prompt || '');

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
      // Internal field for content matching (prefixed with _ to indicate internal use)
      _promptKeywords: keywords,
    };
  }

  /**
   * Analyze context with semantic enhancement (async, uses Haiku API when available)
   * Falls back to basic analysis if semantic analyzer unavailable
   * @param {Object} input
   * @param {string} input.prompt - User prompt
   * @param {string[]} input.recentFiles - Recently accessed files
   * @param {boolean} input.forceApi - Bypass cache for semantic analysis
   * @returns {Promise<Object>} Enhanced context analysis result
   */
  async analyzeWithSemantic(input = {}) {
    // Get basic analysis first
    const basicContext = this.analyze(input);

    // If semantic analyzer not available, return basic
    if (!this.semanticAnalyzer) {
      return {
        ...basicContext,
        _matchStrategy: 'keyword',
        _complexity: 'moderate',
        _memoryLimit: 15,
        _semanticEnabled: false,
      };
    }

    // Get semantic analysis
    try {
      const semantic = await this.semanticAnalyzer.analyze(input.prompt || '', {
        additionalContext: input.recentFiles?.length
          ? `Recent files: ${input.recentFiles.slice(0, 5).join(', ')}`
          : undefined,
        forceApi: input.forceApi,
      });

      // Merge semantic insights with basic context
      return {
        ...basicContext,
        // Override intent if semantic has higher confidence
        intent: semantic.intent.confidence > basicContext.intentConfidence
          ? semantic.intent.primary
          : basicContext.intent,
        intentConfidence: Math.max(
          semantic.intent.confidence,
          basicContext.intentConfidence
        ),
        intentDescription: semantic.intent.description,
        // Enhanced keywords from semantic analysis
        _promptKeywords: [
          ...new Set([
            ...basicContext._promptKeywords,
            ...(semantic.keywords?.required || []),
          ]),
        ],
        _optionalKeywords: semantic.keywords?.optional || [],
        _excludedKeywords: semantic.keywords?.excluded || [],
        // Semantic-specific fields
        _concepts: semantic.concepts || [],
        _matchStrategy: semantic.matchStrategy?.primary || 'keyword',
        _matchReasoning: semantic.matchStrategy?.reasoning,
        _complexity: semantic.complexity || 'moderate',
        _memoryLimit: semantic.memoryLimit || 15,
        _semanticEnabled: true,
        _semanticSource: semantic.source,
        _semanticCached: semantic.cached,
      };
    } catch (error) {
      console.error('[ContextAnalyzer] Semantic analysis failed:', error.message);
      return {
        ...basicContext,
        _matchStrategy: 'keyword',
        _complexity: 'moderate',
        _memoryLimit: 15,
        _semanticEnabled: false,
        _semanticError: error.message,
      };
    }
  }

  /**
   * Record feedback for auto-learning (delegates to semantic analyzer)
   * @param {string} query - Original query
   * @param {Object} selectedMemory - Memory the user found useful
   * @param {Object} context - Analysis context
   */
  recordFeedback(query, selectedMemory, context) {
    if (this.semanticAnalyzer) {
      this.semanticAnalyzer.recordFeedback(query, selectedMemory, context);
    }
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
   * Extract significant keywords from prompt for content matching
   * Filters stopwords and returns normalized keywords
   * @param {string} prompt
   * @returns {string[]}
   */
  extractKeywords(prompt) {
    if (!prompt) return [];

    // Tokenize: split on non-alphanumeric, keep hyphenated words
    const tokens = prompt.toLowerCase()
      .replace(/[^a-z0-9\-_]/gi, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 2);

    // Filter stopwords and deduplicate
    const keywords = new Set();
    for (const token of tokens) {
      if (!STOPWORDS.has(token) && token.length >= 3) {
        keywords.add(token);
      }
    }

    return [...keywords];
  }

  /**
   * Score a memory against current context
   * @param {Object} memory
   * @param {Object} context
   * @returns {number} 0-1 score
   */
  scoreMemory(memory, context) {
    let score = 0;

    // Project match
    if (memory.projectHash === context.projectHash) {
      score += this.weights.projectMatch;
    } else if (memory.projectHash === null) {
      // Global memories (e.g., from ~/.claude/CLAUDE.md) get partial project score
      // They're cross-project and always somewhat relevant
      score += this.weights.projectMatch * 0.3;
    }

    // Intent match
    const intentConfidence = context.intentConfidence ?? 1.0;
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

    // Content keyword matching
    // Match required keywords from prompt against memory content
    const memoryText = ((memory.content || '') + ' ' + (memory.summary || '')).toLowerCase();
    let keywordScore = 0;
    let matchedKeywords = [];

    if (context._promptKeywords?.length) {
      for (const keyword of context._promptKeywords) {
        if (memoryText.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }

      if (matchedKeywords.length > 0) {
        // Score based on proportion of keywords matched
        const matchRatio = matchedKeywords.length / context._promptKeywords.length;
        keywordScore = this.weights.contentMatch * matchRatio;
        score += keywordScore;
      }
    }

    // Semantic concept matching (when semantic analysis is enabled)
    // This boosts memories that match high-level concepts from Haiku analysis
    if (context._concepts?.length && context._semanticEnabled) {
      let conceptMatches = 0;
      for (const concept of context._concepts) {
        if (memoryText.includes(concept.toLowerCase())) {
          conceptMatches++;
        }
        // Also check tags for concept matches
        if (memory.tags?.some(t => t.toLowerCase().includes(concept.toLowerCase()))) {
          conceptMatches++;
        }
      }

      if (conceptMatches > 0) {
        // Semantic matches get the semanticMatch weight
        const conceptRatio = Math.min(conceptMatches / context._concepts.length, 1);
        score += this.weights.semanticMatch * conceptRatio;
      }
    }

    // Apply match strategy multiplier (from semantic analysis)
    // If semantic analyzer determined this should be a "semantic" match type
    // but we're falling back to keyword, slightly reduce the score
    if (context._matchStrategy === 'semantic' && matchedKeywords.length > 0 && keywordScore > 0) {
      // Boost: semantic strategy confirmed by keyword match
      score *= 1.1;
    }

    // Penalize excluded keywords
    if (context._excludedKeywords?.length) {
      for (const excluded of context._excludedKeywords) {
        if (memoryText.includes(excluded.toLowerCase())) {
          score *= 0.5; // Significant penalty
          break;
        }
      }
    }

    // Recency decay (exponential)
    // Support multiple timestamp fields: timestamp, sourceTimestamp, createdAt
    const timestamp = memory.timestamp || memory.sourceTimestamp || memory.createdAt;
    if (timestamp) {
      const ageMs = Date.now() - new Date(timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageDays / 30); // 30-day half-life
      score += this.weights.recency * recencyScore;
    }

    return Math.min(score, 1);
  }

  /**
   * Score memory with match type detection
   * Returns detailed scoring breakdown
   * @param {Object} memory
   * @param {Object} context
   * @returns {Object} { score, matchType, matchedKeywords, breakdown }
   */
  scoreMemoryDetailed(memory, context) {
    const score = this.scoreMemory(memory, context);
    const memoryText = ((memory.content || '') + ' ' + (memory.summary || '')).toLowerCase();

    // Determine match type
    let matchType = 'none';
    const matchedKeywords = [];
    const matchedConcepts = [];

    // Check keyword matches
    if (context._promptKeywords?.length) {
      for (const keyword of context._promptKeywords) {
        if (memoryText.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }
    }

    // Check concept matches
    if (context._concepts?.length) {
      for (const concept of context._concepts) {
        if (memoryText.includes(concept.toLowerCase())) {
          matchedConcepts.push(concept);
        }
      }
    }

    // Determine primary match type
    if (context._semanticEnabled && matchedConcepts.length > 0) {
      matchType = 'semantic';
    } else if (matchedKeywords.length > 0) {
      matchType = 'keyword';
    } else if (score > 0.1) {
      matchType = 'pattern'; // Matched by tags/project/intent
    }

    return {
      score,
      matchType,
      matchedKeywords,
      matchedConcepts,
      breakdown: {
        hasProjectMatch: memory.projectHash === context.projectHash,
        hasIntentMatch: memory.intent === context.intent,
        keywordMatchCount: matchedKeywords.length,
        conceptMatchCount: matchedConcepts.length,
      },
    };
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
    if (this._semanticAnalyzer && this._semanticAnalyzer.clearCache) {
      this._semanticAnalyzer.clearCache();
    }
  }

  /**
   * Get semantic analyzer statistics
   * @returns {Object|null}
   */
  getSemanticStats() {
    return this.semanticAnalyzer?.getStats() || null;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ContextAnalyzer,
  INTENT_PATTERNS,
  FILE_DOMAINS,
  STOPWORDS,
};
