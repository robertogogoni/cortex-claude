/**
 * Cortex - Claude's Cognitive Layer - Semantic Intent Analyzer
 *
 * Uses Claude Haiku for intelligent semantic analysis of user queries:
 * - Complexity assessment (simple/moderate/complex)
 * - Match type detection (semantic/keyword/pattern)
 * - Intent extraction for memory retrieval
 * - Auto-learning score adaptation based on feedback
 *
 * Cost: ~$0.25/1M input tokens (~$1-2/month at 100 queries/day)
 * Latency: ~200ms first call, <10ms cached
 *
 * @version 1.0.0
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // API settings
  apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  model: 'claude-3-5-haiku-20241022',
  maxTokens: 800,
  timeout: 10000,

  // Cache settings
  cachePath: path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude', 'memory', 'data', 'semantic-cache.json'
  ),
  cacheTTLMinutes: 60,

  // Score adaptation settings
  adaptationPath: path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude', 'memory', 'data', 'score-adaptations.json'
  ),
  adaptationDecayDays: 30,

  // Complexity thresholds
  complexity: {
    simple: { maxKeywords: 3, memoryLimit: 5 },
    moderate: { maxKeywords: 6, memoryLimit: 15 },
    complex: { maxKeywords: Infinity, memoryLimit: 30 },
  },
};

// =============================================================================
// MATCH TYPE DEFINITIONS
// =============================================================================

/**
 * Match types with their base score multipliers
 */
const MATCH_TYPES = {
  semantic: {
    name: 'semantic',
    description: 'Conceptual/meaning-based match via AI',
    multiplier: 1.0,
    fallbackOrder: 1,
  },
  keyword: {
    name: 'keyword',
    description: 'Exact word/phrase match in content',
    multiplier: 0.85,
    fallbackOrder: 2,
  },
  pattern: {
    name: 'pattern',
    description: 'Regex pattern match',
    multiplier: 0.7,
    fallbackOrder: 3,
  },
  fuzzy: {
    name: 'fuzzy',
    description: 'Similar word/typo-tolerant match',
    multiplier: 0.6,
    fallbackOrder: 4,
  },
};

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

/**
 * Load cache from disk
 * @returns {Object}
 */
function loadCache() {
  try {
    if (fs.existsSync(CONFIG.cachePath)) {
      const data = fs.readFileSync(CONFIG.cachePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[SemanticAnalyzer] Cache load failed:', error.message);
  }
  return { entries: {}, lastCleanup: Date.now() };
}

/**
 * Save cache to disk with cleanup
 * @param {Object} cache
 */
function saveCache(cache) {
  try {
    // Ensure directory exists
    const dir = path.dirname(CONFIG.cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Cleanup expired entries
    const now = Date.now();
    const ttlMs = CONFIG.cacheTTLMinutes * 60 * 1000;

    if (now - cache.lastCleanup > ttlMs / 2) {
      for (const key of Object.keys(cache.entries)) {
        if (now - cache.entries[key].timestamp > ttlMs) {
          delete cache.entries[key];
        }
      }
      cache.lastCleanup = now;
    }

    fs.writeFileSync(CONFIG.cachePath, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error('[SemanticAnalyzer] Cache save failed:', error.message);
  }
}

/**
 * Generate cache key from query
 * @param {string} query
 * @returns {string}
 */
function hashQuery(query) {
  return crypto
    .createHash('md5')
    .update(query.toLowerCase().trim())
    .digest('hex');
}

// =============================================================================
// SCORE ADAPTATION (AUTO-LEARNING)
// =============================================================================

/**
 * Load score adaptations from disk
 * @returns {Object}
 */
function loadAdaptations() {
  try {
    if (fs.existsSync(CONFIG.adaptationPath)) {
      const data = fs.readFileSync(CONFIG.adaptationPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[SemanticAnalyzer] Adaptations load failed:', error.message);
  }
  return { patterns: {}, lastCleanup: Date.now() };
}

/**
 * Save score adaptations to disk
 * @param {Object} adaptations
 */
function saveAdaptations(adaptations) {
  try {
    const dir = path.dirname(CONFIG.adaptationPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Decay old adaptations
    const now = Date.now();
    const decayMs = CONFIG.adaptationDecayDays * 24 * 60 * 60 * 1000;

    if (now - adaptations.lastCleanup > decayMs / 2) {
      for (const key of Object.keys(adaptations.patterns)) {
        const pattern = adaptations.patterns[key];
        // Apply exponential decay
        const age = now - pattern.lastUsed;
        pattern.weight *= Math.exp(-age / decayMs);
        // Remove if decayed too much
        if (pattern.weight < 0.1) {
          delete adaptations.patterns[key];
        }
      }
      adaptations.lastCleanup = now;
    }

    fs.writeFileSync(CONFIG.adaptationPath, JSON.stringify(adaptations, null, 2));
  } catch (error) {
    console.error('[SemanticAnalyzer] Adaptations save failed:', error.message);
  }
}

// =============================================================================
// HAIKU API INTEGRATION
// =============================================================================

/**
 * Call Claude Haiku API for semantic analysis
 * @param {string} query - User query
 * @param {Object} options - Additional context
 * @returns {Promise<Object>}
 */
async function callHaiku(query, options = {}) {
  const apiKey = process.env[CONFIG.apiKeyEnvVar];

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const systemPrompt = `You are a semantic query analyzer for a memory retrieval system. Analyze the user's query and provide structured analysis.

Your response MUST be valid JSON with this exact structure:
{
  "complexity": "simple" | "moderate" | "complex",
  "intent": {
    "primary": "debugging" | "implementation" | "exploration" | "configuration" | "documentation" | "general",
    "confidence": 0.0-1.0,
    "description": "Brief description of what user is looking for"
  },
  "keywords": {
    "required": ["must-have keywords"],
    "optional": ["nice-to-have keywords"],
    "excluded": ["keywords that indicate irrelevance"]
  },
  "concepts": ["high-level concepts this relates to"],
  "matchStrategy": {
    "primary": "semantic" | "keyword" | "pattern",
    "reasoning": "Why this match strategy is best"
  }
}

Complexity levels:
- simple: Single topic, 1-3 keywords, looking for specific memory (e.g., "FileSystemWatcher PowerShell")
- moderate: Multiple related topics, 4-6 keywords, broader search (e.g., "debugging terminal issues on Linux")
- complex: Abstract question, many concepts, needs synthesis (e.g., "how should I structure my project for scalability")

Be precise and concise. Focus on extracting actionable search criteria.`;

  const userContent = options.additionalContext
    ? `Query: "${query}"\n\nAdditional context:\n${options.additionalContext}`
    : `Query: "${query}"`;

  const requestBody = JSON.stringify({
    model: CONFIG.model,
    max_tokens: CONFIG.maxTokens,
    messages: [
      { role: 'user', content: userContent },
    ],
    system: systemPrompt,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);

          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }

          const content = response.content?.[0]?.text || '{}';
          // Extract JSON from response (handles markdown code blocks)
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                           content.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            resolve(JSON.parse(jsonStr));
          } else {
            reject(new Error('No valid JSON in response'));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(CONFIG.timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(requestBody);
    req.end();
  });
}

// =============================================================================
// KEYWORD-BASED FALLBACK
// =============================================================================

/**
 * Analyze query using keyword-based rules (fallback when API unavailable)
 * @param {string} query
 * @returns {Object}
 */
function analyzeWithKeywords(query) {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter(w => w.length >= 2);

  // Detect complexity based on word count and structure
  let complexity = 'simple';
  if (words.length > 6 || lowerQuery.includes('how') || lowerQuery.includes('why')) {
    complexity = 'complex';
  } else if (words.length > 3) {
    complexity = 'moderate';
  }

  // Detect intent from keywords
  const intentPatterns = {
    debugging: ['debug', 'error', 'bug', 'fix', 'broken', 'crash', 'fail', 'issue'],
    implementation: ['implement', 'create', 'build', 'add', 'make', 'write', 'develop'],
    exploration: ['what', 'how', 'where', 'why', 'find', 'search', 'understand', 'explain'],
    configuration: ['config', 'setup', 'install', 'configure', 'settings', 'env'],
    documentation: ['document', 'docs', 'readme', 'comment', 'describe'],
  };

  let primaryIntent = 'general';
  let intentScore = 0;

  for (const [intent, keywords] of Object.entries(intentPatterns)) {
    const matches = keywords.filter(k => lowerQuery.includes(k)).length;
    if (matches > intentScore) {
      intentScore = matches;
      primaryIntent = intent;
    }
  }

  // Extract keywords (filter common words)
  const stopwords = new Set([
    'a', 'an', 'the', 'this', 'that', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must',
    'i', 'me', 'my', 'you', 'your', 'we', 'they', 'it', 'he', 'she',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about',
    'help', 'please', 'want', 'need', 'like', 'get', 'make', 'use',
  ]);

  const requiredKeywords = words.filter(w => !stopwords.has(w) && w.length >= 3);

  return {
    complexity,
    intent: {
      primary: primaryIntent,
      confidence: Math.min(0.5 + intentScore * 0.15, 0.9),
      description: `Query appears to be about ${primaryIntent}`,
    },
    keywords: {
      required: requiredKeywords.slice(0, 5),
      optional: [],
      excluded: [],
    },
    concepts: requiredKeywords.slice(0, 3),
    matchStrategy: {
      primary: 'keyword',
      reasoning: 'Using keyword fallback (API unavailable or disabled)',
    },
    source: 'fallback',
  };
}

// =============================================================================
// SEMANTIC INTENT ANALYZER CLASS
// =============================================================================

class SemanticIntentAnalyzer {
  /**
   * @param {Object} options
   * @param {boolean} options.useHaiku - Enable Haiku API (default: true)
   * @param {boolean} options.useCache - Enable caching (default: true)
   * @param {boolean} options.useAdaptation - Enable score adaptation (default: true)
   */
  constructor(options = {}) {
    this.useHaiku = options.useHaiku !== false;
    this.useCache = options.useCache !== false;
    this.useAdaptation = options.useAdaptation !== false;

    this._cache = null;
    this._adaptations = null;
  }

  /**
   * Get cache (lazy load)
   * @returns {Object}
   */
  get cache() {
    if (!this._cache) {
      this._cache = loadCache();
    }
    return this._cache;
  }

  /**
   * Get adaptations (lazy load)
   * @returns {Object}
   */
  get adaptations() {
    if (!this._adaptations) {
      this._adaptations = loadAdaptations();
    }
    return this._adaptations;
  }

  /**
   * Analyze a query for memory retrieval
   * @param {string} query - User's query/prompt
   * @param {Object} options
   * @param {string} options.additionalContext - Extra context (e.g., recent files)
   * @param {boolean} options.forceApi - Bypass cache
   * @returns {Promise<Object>}
   */
  async analyze(query, options = {}) {
    if (!query || query.trim().length === 0) {
      return this._emptyResult();
    }

    const queryHash = hashQuery(query);

    // Check cache
    if (this.useCache && !options.forceApi) {
      const cached = this.cache.entries[queryHash];
      if (cached) {
        const age = Date.now() - cached.timestamp;
        if (age < CONFIG.cacheTTLMinutes * 60 * 1000) {
          return {
            ...cached.result,
            cached: true,
            cacheAge: Math.round(age / 1000),
          };
        }
      }
    }

    // Try Haiku API
    let result;
    if (this.useHaiku && process.env[CONFIG.apiKeyEnvVar]) {
      try {
        result = await callHaiku(query, options);
        result.source = 'haiku';
      } catch (error) {
        console.error('[SemanticAnalyzer] Haiku API failed:', error.message);
        result = analyzeWithKeywords(query);
      }
    } else {
      result = analyzeWithKeywords(query);
    }

    // Apply score adaptations
    if (this.useAdaptation) {
      result = this._applyAdaptations(result, query);
    }

    // Add memory limit based on complexity
    result.memoryLimit = CONFIG.complexity[result.complexity]?.memoryLimit || 15;

    // Cache result
    if (this.useCache) {
      this.cache.entries[queryHash] = {
        timestamp: Date.now(),
        result,
      };
      saveCache(this.cache);
    }

    return {
      ...result,
      cached: false,
    };
  }

  /**
   * Apply learned adaptations to analysis result
   * @param {Object} result
   * @param {string} query
   * @returns {Object}
   */
  _applyAdaptations(result, query) {
    const lowerQuery = query.toLowerCase();

    // Check for learned patterns
    for (const [pattern, adaptation] of Object.entries(this.adaptations.patterns)) {
      if (lowerQuery.includes(pattern)) {
        // Boost keywords that were previously useful
        if (adaptation.boostedKeywords) {
          result.keywords.required = [
            ...result.keywords.required,
            ...adaptation.boostedKeywords.filter(k => !result.keywords.required.includes(k)),
          ];
        }

        // Adjust intent if learned
        if (adaptation.learnedIntent && adaptation.weight > 0.5) {
          result.intent.primary = adaptation.learnedIntent;
          result.intent.confidence = Math.min(
            result.intent.confidence + adaptation.weight * 0.2,
            1.0
          );
        }
      }
    }

    return result;
  }

  /**
   * Record feedback for auto-learning
   * Call this when user selects/uses a memory from results
   * @param {string} query - Original query
   * @param {Object} selectedMemory - Memory the user found useful
   * @param {Object} context - Analysis context
   */
  recordFeedback(query, selectedMemory, context) {
    if (!this.useAdaptation) return;

    const lowerQuery = query.toLowerCase();

    // Extract pattern from query (significant words)
    const words = lowerQuery.split(/\s+/).filter(w => w.length >= 3);
    const pattern = words.slice(0, 3).join(' ');

    if (!pattern) return;

    // Update or create adaptation
    const existing = this.adaptations.patterns[pattern] || {
      weight: 0,
      boostedKeywords: [],
      learnedIntent: null,
      lastUsed: 0,
    };

    // Increase weight
    existing.weight = Math.min(existing.weight + 0.2, 1.0);
    existing.lastUsed = Date.now();

    // Learn from selected memory
    if (selectedMemory.tags?.length) {
      const newKeywords = selectedMemory.tags.filter(
        t => !existing.boostedKeywords.includes(t)
      );
      existing.boostedKeywords = [
        ...existing.boostedKeywords,
        ...newKeywords.slice(0, 5),
      ].slice(0, 10);
    }

    if (selectedMemory.intent && selectedMemory.intent !== context?.intent?.primary) {
      existing.learnedIntent = selectedMemory.intent;
    }

    this.adaptations.patterns[pattern] = existing;
    saveAdaptations(this.adaptations);
  }

  /**
   * Get match type configuration
   * @param {string} type
   * @returns {Object}
   */
  getMatchType(type) {
    return MATCH_TYPES[type] || MATCH_TYPES.keyword;
  }

  /**
   * Calculate adjusted score based on match type
   * @param {number} baseScore
   * @param {string} matchType
   * @returns {number}
   */
  adjustScore(baseScore, matchType) {
    const config = this.getMatchType(matchType);
    return baseScore * config.multiplier;
  }

  /**
   * Return empty result for empty queries
   * @returns {Object}
   */
  _emptyResult() {
    return {
      complexity: 'simple',
      intent: { primary: 'general', confidence: 0, description: '' },
      keywords: { required: [], optional: [], excluded: [] },
      concepts: [],
      matchStrategy: { primary: 'keyword', reasoning: 'Empty query' },
      memoryLimit: 5,
      source: 'empty',
      cached: false,
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this._cache = null;
    try {
      if (fs.existsSync(CONFIG.cachePath)) {
        fs.unlinkSync(CONFIG.cachePath);
      }
    } catch (error) {
      console.error('[SemanticAnalyzer] Clear cache failed:', error.message);
    }
  }

  /**
   * Clear adaptations
   */
  clearAdaptations() {
    this._adaptations = null;
    try {
      if (fs.existsSync(CONFIG.adaptationPath)) {
        fs.unlinkSync(CONFIG.adaptationPath);
      }
    } catch (error) {
      console.error('[SemanticAnalyzer] Clear adaptations failed:', error.message);
    }
  }

  /**
   * Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      cacheEntries: Object.keys(this.cache.entries).length,
      adaptationPatterns: Object.keys(this.adaptations.patterns).length,
      haiku: {
        enabled: this.useHaiku,
        apiKeySet: !!process.env[CONFIG.apiKeyEnvVar],
      },
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  SemanticIntentAnalyzer,
  MATCH_TYPES,
  CONFIG,
  // Utility exports for testing
  hashQuery,
  loadCache,
  saveCache,
  loadAdaptations,
  saveAdaptations,
  analyzeWithKeywords,
};
