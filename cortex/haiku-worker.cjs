#!/usr/bin/env node
/**
 * Cortex Haiku Worker
 *
 * The "Worker" in the dual-model architecture. Handles high-frequency,
 * low-cost operations using Claude Haiku:
 *
 * - Query routing and source selection
 * - Intent classification
 * - Result filtering and ranking
 * - Keyword extraction
 * - Relevance scoring
 *
 * Cost: ~$0.25/1M tokens (~50-100 calls/session = ~$0.025/session)
 *
 * @version 2.0.0
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const { QueryOrchestrator } = require('../hooks/query-orchestrator.cjs');
const { ContextAnalyzer } = require('../hooks/context-analyzer.cjs');
const path = require('path');
const fs = require('fs');

// =============================================================================
// CONSTANTS
// =============================================================================

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
const MAX_TOKENS = 1024;

// Source mapping
const SOURCE_MAP = {
  'episodic': 'episodic-memory',
  'knowledge-graph': 'knowledge-graph',
  'jsonl': 'jsonl',
  'claudemd': 'claudemd',
  'all': null, // Query all
};

// =============================================================================
// LRU CACHE FOR ANALYSIS RESULTS
// =============================================================================

/**
 * Simple LRU Cache with TTL for analysis results
 * Caches query analysis to avoid redundant Haiku API calls
 */
class AnalysisCache {
  /**
   * @param {Object} options
   * @param {number} options.maxSize - Maximum cache entries (default: 500)
   * @param {number} options.ttlMs - Time-to-live in ms (default: 1 hour)
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 500;
    this.ttlMs = options.ttlMs || 60 * 60 * 1000; // 1 hour
    this.cache = new Map();
  }

  /**
   * Generate cache key from query
   * @param {string} query
   * @param {string} type - 'analysis' or 'ranking'
   * @returns {string}
   */
  _key(query, type) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(`${type}:${query.toLowerCase().trim()}`).digest('hex');
  }

  /**
   * Get cached value if valid
   * @param {string} query
   * @param {string} type
   * @returns {Object|null}
   */
  get(query, type) {
    const key = this._key(query, type);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set cache value
   * @param {string} query
   * @param {string} type
   * @param {Object} value
   */
  set(query, type, value) {
    const key = this._key(query, type);

    // Evict oldest if full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear the cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

// =============================================================================
// HAIKU WORKER CLASS
// =============================================================================

class HaikuWorker {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {string} options.apiKey - Anthropic API key (uses ANTHROPIC_API_KEY env if not provided)
   * @param {boolean} options.enableApiCalls - Enable Haiku API calls (default: true)
   * @param {boolean} options.verbose - Enable verbose timing logs (default: false)
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');
    this.enableApiCalls = options.enableApiCalls !== false;
    this.verbose = options.verbose || false;

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });

    // Initialize query orchestrator (reuses existing infrastructure)
    // IMPORTANT: Disable semantic analysis in orchestrator to avoid DUPLICATE Haiku calls
    // HaikuWorker handles its own analysis
    this.orchestrator = new QueryOrchestrator({
      basePath: this.basePath,
      semantic: { enabled: false }, // Disabled - HaikuWorker does its own analysis
    });

    // Context analyzer for understanding queries
    this.contextAnalyzer = new ContextAnalyzer({
      workingDir: process.cwd(),
    });

    // Analysis cache (reduces API calls by ~95%)
    this.analysisCache = new AnalysisCache({
      maxSize: 500,
      ttlMs: 60 * 60 * 1000, // 1 hour
    });

    // Stats tracking
    this.stats = {
      queriesMade: 0,
      tokensUsed: 0,
      cacheHits: 0,
      apiCalls: 0,
      cachedAnalysis: 0,
      cachedRanking: 0,
      timings: {
        totalQueryMs: 0,
        analysisMs: 0,
        orchestratorMs: 0,
        rankingMs: 0,
        avgQueryMs: 0,
      },
    };
  }

  /**
   * Log message if verbose mode enabled
   * @private
   */
  _log(msg) {
    if (this.verbose) {
      process.stderr.write(`[HaikuWorker] ${msg}\n`);
    }
  }

  /**
   * Call Haiku for intelligent processing
   * @private
   */
  async _callHaiku(systemPrompt, userMessage) {
    if (!this.enableApiCalls) {
      this._log('API calls disabled, using fallback');
      return null;
    }

    const startTime = Date.now();
    try {
      const response = await this.client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.stats.queriesMade++;
      this.stats.apiCalls++;
      this.stats.tokensUsed += response.usage?.input_tokens || 0;
      this.stats.tokensUsed += response.usage?.output_tokens || 0;

      const elapsed = Date.now() - startTime;
      this._log(`Haiku API call: ${elapsed}ms`);

      return response.content[0]?.text || '';
    } catch (error) {
      // Log but don't fail - return empty to allow fallback
      process.stderr.write(`[HaikuWorker] API error: ${error.message}\n`);
      return null;
    }
  }

  /**
   * Search all memory sources for relevant context
   *
   * @param {string} query - Natural language query
   * @param {string[]} sources - Sources to search ('all', 'episodic', 'jsonl', etc.)
   * @param {number} limit - Maximum results
   * @returns {Promise<Object>} Search results with metadata
   */
  async query(query, sources = ['all'], limit = 10) {
    const startTime = Date.now();
    const timings = { analysis: 0, orchestrator: 0, ranking: 0 };

    // Step 1: Use Haiku to extract keywords and classify intent (with cache)
    const analysisStart = Date.now();
    let analysis = this.analysisCache.get(query, 'analysis');
    let analysisCached = !!analysis;

    if (!analysis) {
      // Default fallback analysis (fast, no API)
      analysis = {
        keywords: this._extractKeywordsFast(query),
        intent: this._classifyIntentFast(query),
        criteria: query,
      };

      // Try Haiku enhancement (only if enabled)
      if (this.enableApiCalls) {
        const analysisPrompt = `You are a memory search optimizer. Given a user's query, extract:
1. Key search terms (2-5 words most relevant for searching)
2. Intent type (one of: debugging, implementing, learning, reviewing, planning, other)
3. Relevance criteria (what makes a result relevant)

Respond in JSON format:
{
  "keywords": ["word1", "word2"],
  "intent": "debugging",
  "criteria": "Results about X solving Y"
}`;

        const haikuResponse = await this._callHaiku(analysisPrompt, query);
        if (haikuResponse) {
          try {
            analysis = JSON.parse(haikuResponse);
            // Cache the successful analysis
            this.analysisCache.set(query, 'analysis', analysis);
          } catch (e) {
            // Use fallback analysis
          }
        }
      }
    } else {
      this.stats.cachedAnalysis++;
      this.stats.cacheHits++;
    }
    timings.analysis = Date.now() - analysisStart;
    this._log(`Analysis: ${timings.analysis}ms (cached: ${analysisCached})`);

    // Step 2: Query memory sources via orchestrator
    const orchestratorStart = Date.now();
    const adaptersToQuery = sources.includes('all')
      ? undefined // Query all adapters
      : sources.map(s => SOURCE_MAP[s]).filter(Boolean);

    const results = await this.orchestrator.query({
      prompt: query,
      types: ['skill', 'pattern', 'decision', 'insight', 'learning'],
      adapters: adaptersToQuery,
      useSemantic: false, // Disabled - we handle analysis ourselves
    });
    timings.orchestrator = Date.now() - orchestratorStart;
    this._log(`Orchestrator: ${timings.orchestrator}ms, found ${results.memories?.length || 0} memories`);

    // Step 3: Score and rank results
    // OPTIMIZATION: Only use Haiku ranking for large result sets (>3x limit)
    // For smaller sets, use local relevance scoring (already done by orchestrator)
    const rankingStart = Date.now();
    let rankedMemories = results.memories || [];
    let usedApiRanking = false;

    // Skip API ranking if:
    // - Result count is small (already manageable)
    // - Results already have good relevance scores
    // - API calls are disabled
    const shouldUseApiRanking = this.enableApiCalls &&
                                rankedMemories.length > limit * 3 &&
                                rankedMemories.length > 10;

    if (shouldUseApiRanking) {
      // Check cache first
      const rankCacheKey = `${query}:${rankedMemories.slice(0, 20).map(m => m.id || '').join(',')}`;
      let cachedScores = this.analysisCache.get(rankCacheKey, 'ranking');

      if (cachedScores) {
        this.stats.cachedRanking++;
        this.stats.cacheHits++;
        rankedMemories = rankedMemories.map((m, i) => ({
          ...m,
          relevanceScore: cachedScores[i] || m.relevanceScore || 50,
        })).sort((a, b) => b.relevanceScore - a.relevanceScore);
      } else {
        // Ask Haiku to rank
        const rankPrompt = `You are a relevance scorer. Given memories and a query, score each memory 0-100 for relevance.

Query: "${query}"
Intent: ${analysis.intent}
Criteria: ${analysis.criteria}

Respond with JSON array of scores matching the input order:
[85, 42, 91, ...]`;

        const memorySummaries = rankedMemories.slice(0, 20).map((m, i) =>
          `${i}: ${(m.content || m.summary || '').substring(0, 100)}`
        ).join('\n');

        const rankResponse = await this._callHaiku(rankPrompt, memorySummaries);
        if (rankResponse) {
          try {
            const scores = JSON.parse(rankResponse);
            rankedMemories = rankedMemories.map((m, i) => ({
              ...m,
              relevanceScore: scores[i] || m.relevanceScore || 50,
            })).sort((a, b) => b.relevanceScore - a.relevanceScore);
            usedApiRanking = true;
            // Cache the ranking scores
            this.analysisCache.set(rankCacheKey, 'ranking', scores);
          } catch (e) {
            // Keep original order
          }
        }
      }
    } else {
      // Use existing relevance scores from orchestrator (already sorted)
      // Just ensure all have a score for consistency
      rankedMemories = rankedMemories.map(m => ({
        ...m,
        relevanceScore: m.relevanceScore || 50,
      }));
    }
    timings.ranking = Date.now() - rankingStart;
    this._log(`Ranking: ${timings.ranking}ms (usedApi: ${usedApiRanking})`);

    // Limit results
    rankedMemories = rankedMemories.slice(0, limit);

    const duration = Date.now() - startTime;

    // Update timing stats
    this.stats.timings.totalQueryMs += duration;
    this.stats.timings.analysisMs += timings.analysis;
    this.stats.timings.orchestratorMs += timings.orchestrator;
    this.stats.timings.rankingMs += timings.ranking;
    this.stats.timings.avgQueryMs = Math.round(this.stats.timings.totalQueryMs / Math.max(1, this.stats.queriesMade));

    this._log(`Total: ${duration}ms (analysis: ${timings.analysis}ms, search: ${timings.orchestrator}ms, rank: ${timings.ranking}ms)`);

    return {
      query,
      analysis,
      memories: rankedMemories,
      sources: results.sources || [],
      stats: {
        totalFound: results.memories?.length || 0,
        returned: rankedMemories.length,
        duration,
        timings,
        apiCalls: this.stats.apiCalls,
        cacheHits: this.stats.cacheHits,
        analysisCached,
        usedApiRanking,
      },
    };
  }

  /**
   * Fast local keyword extraction (no API call)
   * @private
   * @param {string} query
   * @returns {string[]}
   */
  _extractKeywordsFast(query) {
    const stopwords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'can', 'may', 'might', 'must', 'i', 'me', 'my', 'you', 'your',
      'we', 'they', 'it', 'he', 'she', 'in', 'on', 'at', 'to', 'for', 'of',
      'with', 'by', 'from', 'about', 'help', 'please', 'want', 'need', 'like',
      'get', 'make', 'use', 'how', 'what', 'where', 'when', 'why', 'this', 'that',
    ]);

    return query
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopwords.has(w))
      .slice(0, 5);
  }

  /**
   * Fast local intent classification (no API call)
   * @private
   * @param {string} query
   * @returns {string}
   */
  _classifyIntentFast(query) {
    const lower = query.toLowerCase();
    const patterns = {
      debugging: ['debug', 'error', 'bug', 'fix', 'broken', 'crash', 'fail', 'issue'],
      implementing: ['implement', 'create', 'build', 'add', 'make', 'write', 'develop'],
      learning: ['how', 'what', 'why', 'explain', 'understand', 'learn'],
      reviewing: ['review', 'check', 'audit', 'examine', 'look'],
      planning: ['plan', 'design', 'architect', 'structure', 'organize'],
    };

    for (const [intent, keywords] of Object.entries(patterns)) {
      if (keywords.some(k => lower.includes(k))) {
        return intent;
      }
    }
    return 'other';
  }

  /**
   * Retrieve specific memories by context
   *
   * @param {string} context - Context to match
   * @param {string} type - Type of memory ('skill', 'pattern', 'decision', 'insight', 'any')
   * @returns {Promise<Object>} Matched memories
   */
  async recall(context, type = 'any') {
    const startTime = Date.now();
    const timings = { analysis: 0, search: 0, filter: 0 };

    // Step 1: Analyze context (with cache)
    const analysisStart = Date.now();
    let contextAnalysis = this.analysisCache.get(`recall:${context}`, 'analysis');
    let analysisCached = !!contextAnalysis;

    if (!contextAnalysis) {
      // Fast local analysis
      contextAnalysis = {
        seeking: context,
        related: this._extractKeywordsFast(context),
        timeFrame: this._detectTimeFrame(context),
      };

      // Try Haiku enhancement
      if (this.enableApiCalls) {
        const contextPrompt = `You are a memory retrieval specialist. Given a context description, identify:
1. What specific information is being sought
2. Related concepts that might help find it
3. Time frame if mentioned (recent, old, specific date)

Context: "${context}"
Type filter: ${type}

Respond in JSON:
{
  "seeking": "specific thing being looked for",
  "related": ["related1", "related2"],
  "timeFrame": "recent|old|any"
}`;

        const haikuResponse = await this._callHaiku(contextPrompt, context);
        if (haikuResponse) {
          try {
            contextAnalysis = JSON.parse(haikuResponse);
            this.analysisCache.set(`recall:${context}`, 'analysis', contextAnalysis);
          } catch (e) {
            // Use fallback
          }
        }
      }
    } else {
      this.stats.cachedAnalysis++;
      this.stats.cacheHits++;
    }
    timings.analysis = Date.now() - analysisStart;
    this._log(`Recall analysis: ${timings.analysis}ms (cached: ${analysisCached})`);

    // Step 2: Query memory sources
    const searchStart = Date.now();
    const searchTerms = [contextAnalysis.seeking, ...contextAnalysis.related].join(' ');
    const types = type === 'any' ? undefined : [type];

    const results = await this.orchestrator.query({
      prompt: searchTerms,
      types,
      useSemantic: false,
    });
    timings.search = Date.now() - searchStart;
    this._log(`Recall search: ${timings.search}ms, found ${results.memories?.length || 0}`);

    // Step 3: Filter by relevance
    // OPTIMIZATION: Skip API filtering for small result sets
    const filterStart = Date.now();
    let memories = results.memories || [];

    // Only use API filtering for large sets (>10 results)
    if (this.enableApiCalls && memories.length > 10) {
      const filterPrompt = `Given memories and what we're seeking, mark each as KEEP or SKIP.

Seeking: ${contextAnalysis.seeking}
Related: ${contextAnalysis.related.join(', ')}

Respond with JSON array of "KEEP" or "SKIP" for each:
["KEEP", "SKIP", "KEEP", ...]`;

      const memorySummaries = memories.slice(0, 15).map((m, i) =>
        `${i}: ${(m.content || m.summary || '').substring(0, 150)}`
      ).join('\n');

      const filterResponse = await this._callHaiku(filterPrompt, memorySummaries);
      if (filterResponse) {
        try {
          const decisions = JSON.parse(filterResponse);
          memories = memories.filter((m, i) => decisions[i] === 'KEEP');
        } catch (e) {
          // Keep all
        }
      }
    }
    timings.filter = Date.now() - filterStart;

    const duration = Date.now() - startTime;
    this._log(`Recall total: ${duration}ms`);

    return {
      context,
      type,
      analysis: contextAnalysis,
      memories: memories.slice(0, 5), // Return top 5 matches
      stats: {
        searched: results.memories?.length || 0,
        matched: memories.length,
        duration,
        timings,
        analysisCached,
      },
    };
  }

  /**
   * Detect time frame from query
   * @private
   * @param {string} query
   * @returns {string}
   */
  _detectTimeFrame(query) {
    const lower = query.toLowerCase();
    if (lower.includes('recent') || lower.includes('today') || lower.includes('yesterday') ||
        lower.includes('this week')) {
      return 'recent';
    }
    if (lower.includes('old') || lower.includes('last year') || lower.includes('long ago')) {
      return 'old';
    }
    return 'any';
  }

  /**
   * Get worker statistics
   */
  getStats() {
    return {
      ...this.stats,
      cache: this.analysisCache.getStats(),
      estimatedCost: (this.stats.tokensUsed / 1000000) * 0.25, // Haiku pricing
    };
  }

  /**
   * Clear analysis cache
   */
  clearCache() {
    this.analysisCache.clear();
    this._log('Analysis cache cleared');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { HaikuWorker };
