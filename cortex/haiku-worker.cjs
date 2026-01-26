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
 * @version 1.0.0
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
// HAIKU WORKER CLASS
// =============================================================================

class HaikuWorker {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {string} options.apiKey - Anthropic API key (uses ANTHROPIC_API_KEY env if not provided)
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });

    // Initialize query orchestrator (reuses existing infrastructure)
    this.orchestrator = new QueryOrchestrator({
      basePath: this.basePath,
      semantic: { enabled: true, useHaiku: true },
    });

    // Context analyzer for understanding queries
    this.contextAnalyzer = new ContextAnalyzer({
      workingDir: process.cwd(),
    });

    // Stats tracking
    this.stats = {
      queriesMade: 0,
      tokensUsed: 0,
      cacheHits: 0,
    };
  }

  /**
   * Call Haiku for intelligent processing
   * @private
   */
  async _callHaiku(systemPrompt, userMessage) {
    try {
      const response = await this.client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      this.stats.queriesMade++;
      this.stats.tokensUsed += response.usage?.input_tokens || 0;
      this.stats.tokensUsed += response.usage?.output_tokens || 0;

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

    // Step 1: Use Haiku to extract keywords and classify intent
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

    let analysis = { keywords: query.split(' ').slice(0, 5), intent: 'other', criteria: query };

    const haikuResponse = await this._callHaiku(analysisPrompt, query);
    if (haikuResponse) {
      try {
        analysis = JSON.parse(haikuResponse);
      } catch (e) {
        // Use default analysis
      }
    }

    // Step 2: Query memory sources via orchestrator
    const adaptersToQuery = sources.includes('all')
      ? undefined // Query all adapters
      : sources.map(s => SOURCE_MAP[s]).filter(Boolean);

    const results = await this.orchestrator.query({
      prompt: query,
      types: ['skill', 'pattern', 'decision', 'insight', 'learning'],
      adapters: adaptersToQuery,
      useSemantic: true,
    });

    // Step 3: Score and rank results using Haiku (if we have results)
    let rankedMemories = results.memories || [];

    if (rankedMemories.length > limit) {
      // Ask Haiku to rank if we have too many results
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
            relevanceScore: scores[i] || 50,
          })).sort((a, b) => b.relevanceScore - a.relevanceScore);
        } catch (e) {
          // Keep original order
        }
      }
    }

    // Limit results
    rankedMemories = rankedMemories.slice(0, limit);

    const duration = Date.now() - startTime;

    return {
      query,
      analysis,
      memories: rankedMemories,
      sources: results.sources || [],
      stats: {
        totalFound: results.memories?.length || 0,
        returned: rankedMemories.length,
        duration,
        haikuCalls: this.stats.queriesMade,
      },
    };
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

    // Use Haiku to understand what we're looking for
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

    let contextAnalysis = { seeking: context, related: [], timeFrame: 'any' };

    const haikuResponse = await this._callHaiku(contextPrompt, context);
    if (haikuResponse) {
      try {
        contextAnalysis = JSON.parse(haikuResponse);
      } catch (e) {
        // Use default
      }
    }

    // Build search query from analysis
    const searchTerms = [contextAnalysis.seeking, ...contextAnalysis.related].join(' ');

    // Query with type filter
    const types = type === 'any' ? undefined : [type];

    const results = await this.orchestrator.query({
      prompt: searchTerms,
      types,
      useSemantic: true,
    });

    // Filter by relevance using Haiku
    let memories = results.memories || [];

    if (memories.length > 0) {
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

    const duration = Date.now() - startTime;

    return {
      context,
      type,
      analysis: contextAnalysis,
      memories: memories.slice(0, 5), // Return top 5 matches
      stats: {
        searched: results.memories?.length || 0,
        matched: memories.length,
        duration,
      },
    };
  }

  /**
   * Get worker statistics
   */
  getStats() {
    return {
      ...this.stats,
      estimatedCost: (this.stats.tokensUsed / 1000000) * 0.25, // Haiku pricing
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { HaikuWorker };
