#!/usr/bin/env node
/**
 * Cortex Sonnet Thinker
 *
 * The "Thinker" in the dual-model architecture. Handles low-frequency,
 * high-value reasoning operations using Claude Sonnet:
 *
 * - Reflection ("What patterns am I seeing?")
 * - Inference ("How does X connect to Y?")
 * - Insight generation ("What should I learn?")
 * - Synthesis ("Summarize these memories")
 * - Meta-cognition ("Am I approaching this right?")
 *
 * Cost: ~$3/1M tokens (~5-10 calls/session = ~$0.03/session)
 *
 * @version 1.0.0
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const { QueryOrchestrator } = require('../hooks/query-orchestrator.cjs');
const { JSONLStore } = require('../core/storage.cjs');
const path = require('path');
const fs = require('fs');

// =============================================================================
// CONSTANTS
// =============================================================================

const SONNET_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2048;

// Depth settings for reflection
const DEPTH_TOKENS = {
  quick: 512,
  moderate: 1024,
  deep: 2048,
};

// Cost per million tokens (as of 2026)
const SONNET_COST = {
  inputPerMillion: 3.0,   // $3/1M input tokens
  outputPerMillion: 15.0, // $15/1M output tokens
};

/**
 * Estimate cost of an operation
 * @param {number} inputTokens - Estimated input tokens
 * @param {number} outputTokens - Estimated output tokens
 * @returns {{ cost: number, display: string }}
 */
function estimateCost(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1000000) * SONNET_COST.inputPerMillion;
  const outputCost = (outputTokens / 1000000) * SONNET_COST.outputPerMillion;
  const totalCost = inputCost + outputCost;

  return {
    cost: totalCost,
    display: totalCost < 0.001 ? '<$0.001' : `~$${totalCost.toFixed(4)}`,
  };
}

// =============================================================================
// SONNET THINKER CLASS
// =============================================================================

class SonnetThinker {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for memory storage
   * @param {string} options.apiKey - Anthropic API key
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });

    // Initialize query orchestrator for memory access
    this.orchestrator = new QueryOrchestrator({
      basePath: this.basePath,
      semantic: { enabled: false }, // Sonnet does its own reasoning
    });

    // Storage for learnings - JSONLStore expects (filePath, options)
    this.learningsStore = new JSONLStore(
      path.join(this.basePath, 'data', 'memories', 'learnings.jsonl')
    );

    this.insightsStore = new JSONLStore(
      path.join(this.basePath, 'data', 'memories', 'insights.jsonl')
    );

    // Stats tracking with cost
    this.stats = {
      reflections: 0,
      inferences: 0,
      learnings: 0,
      consolidations: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
    };
  }

  /**
   * Get current session cost
   * @returns {Object}
   */
  getSessionCost() {
    const estimated = estimateCost(this.stats.inputTokens, this.stats.outputTokens);
    return {
      inputTokens: this.stats.inputTokens,
      outputTokens: this.stats.outputTokens,
      estimatedCost: estimated.display,
      operations: {
        reflections: this.stats.reflections,
        inferences: this.stats.inferences,
        learnings: this.stats.learnings,
        consolidations: this.stats.consolidations,
      },
    };
  }

  /**
   * Call Sonnet for deep reasoning with cost tracking
   * @private
   */
  async _callSonnet(systemPrompt, userMessage, maxTokens = MAX_TOKENS) {
    // Estimate tokens for cost warning (rough estimate: 4 chars = 1 token)
    const estimatedInputTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4);
    const estimated = estimateCost(estimatedInputTokens, maxTokens);

    // Show cost warning for larger operations
    if (estimated.cost > 0.005) {
      process.stderr.write(`[Cortex] Sonnet operation - estimated cost: ${estimated.display}\n`);
    }

    try {
      const response = await this.client.messages.create({
        model: SONNET_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      // Track actual usage
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const actualCost = estimateCost(inputTokens, outputTokens);

      this.stats.inputTokens += inputTokens;
      this.stats.outputTokens += outputTokens;
      this.stats.totalCost += actualCost.cost;

      return response.content[0]?.text || '';
    } catch (error) {
      process.stderr.write(`[SonnetThinker] API error: ${error.message}\n`);
      throw error;
    }
  }

  /**
   * Deep reflection on a topic or the current session
   *
   * @param {string} topic - What to reflect on
   * @param {string} depth - 'quick', 'moderate', or 'deep'
   * @returns {Promise<Object>} Reflection results
   */
  async reflect(topic, depth = 'moderate') {
    this.stats.reflections++;
    const startTime = Date.now();
    const maxTokens = DEPTH_TOKENS[depth] || DEPTH_TOKENS.moderate;

    // Gather relevant memories for context
    const memories = await this.orchestrator.query({
      prompt: topic,
      types: ['skill', 'pattern', 'decision', 'insight'],
    });

    const memoryContext = (memories.memories || [])
      .slice(0, 10)
      .map(m => `- ${m.content || m.summary}`)
      .join('\n');

    const systemPrompt = `You are Cortex, Claude's cognitive layer responsible for meta-cognition and reflection.

Your role is to think deeply about patterns, progress, and insights. When reflecting:
1. Look for recurring patterns or themes
2. Identify what's working and what isn't
3. Consider connections to past experiences
4. Generate actionable insights
5. Be honest about uncertainty

Depth level: ${depth}
${depth === 'quick' ? 'Be concise - 2-3 key observations.' : ''}
${depth === 'moderate' ? 'Provide balanced analysis with specific examples.' : ''}
${depth === 'deep' ? 'Explore thoroughly, including subtle patterns and non-obvious connections.' : ''}`;

    const userMessage = `## Topic to Reflect On
${topic}

## Relevant Memories
${memoryContext || 'No directly relevant memories found.'}

## Reflection Request
Please reflect on this topic. What patterns do you see? What insights emerge? What might be worth remembering?`;

    const reflection = await this._callSonnet(systemPrompt, userMessage, maxTokens);

    const duration = Date.now() - startTime;

    // Calculate cost for this operation
    const sessionCost = this.getSessionCost();

    return {
      topic,
      depth,
      reflection,
      memoriesConsidered: memories.memories?.length || 0,
      stats: {
        duration,
        maxTokens,
      },
      cost: {
        session: sessionCost.estimatedCost,
        note: '💡 Use /cortex stats to see detailed cost breakdown',
      },
    };
  }

  /**
   * Reason about connections between concepts
   *
   * @param {string[]} concepts - Concepts to find connections between
   * @param {boolean} includeMemories - Include stored memories in reasoning
   * @returns {Promise<Object>} Inference results
   */
  async infer(concepts, includeMemories = true) {
    this.stats.inferences++;
    const startTime = Date.now();

    let memoryContext = '';
    if (includeMemories) {
      // Query memories for each concept
      const allMemories = [];
      for (const concept of concepts.slice(0, 5)) {
        const results = await this.orchestrator.query({
          prompt: concept,
          types: ['skill', 'pattern', 'decision', 'insight'],
        });
        allMemories.push(...(results.memories || []).slice(0, 3));
      }

      memoryContext = allMemories
        .map(m => `- [${m.type || 'memory'}] ${m.content || m.summary}`)
        .join('\n');
    }

    const systemPrompt = `You are Cortex, Claude's cognitive layer responsible for finding connections and generating insights.

When inferring connections:
1. Look for non-obvious relationships
2. Consider causal links, analogies, and patterns
3. Generate hypotheses that could be tested
4. Rate confidence in each connection (high/medium/low)
5. Suggest implications or actions

Be creative but grounded. Distinguish between strong connections and speculative ones.`;

    const userMessage = `## Concepts to Connect
${concepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${memoryContext ? `## Relevant Memories\n${memoryContext}\n` : ''}
## Inference Request
What connections exist between these concepts? What patterns or relationships emerge? What are the implications?`;

    const inference = await this._callSonnet(systemPrompt, userMessage);

    const duration = Date.now() - startTime;

    const sessionCost = this.getSessionCost();

    return {
      concepts,
      inference,
      memoriesUsed: includeMemories,
      stats: {
        duration,
      },
      cost: {
        session: sessionCost.estimatedCost,
      },
    };
  }

  /**
   * Extract and store an insight or learning
   *
   * @param {string} insight - The insight to store
   * @param {string} context - Context where it applies
   * @param {string} type - Type of learning
   * @param {string[]} tags - Tags for categorization
   * @returns {Promise<Object>} Storage result
   */
  async learn(insight, context = '', type = 'general', tags = []) {
    this.stats.learnings++;
    const startTime = Date.now();

    // Use Sonnet to analyze and enhance the insight
    const systemPrompt = `You are Cortex, Claude's cognitive layer responsible for learning and knowledge management.

When processing a new insight:
1. Assess its quality and usefulness (1-10)
2. Identify what makes it valuable
3. Suggest related concepts or tags
4. Determine if it duplicates existing knowledge
5. Recommend storage priority (high/medium/low)

Respond in JSON format:
{
  "quality": 8,
  "value": "Why this is useful",
  "suggestedTags": ["tag1", "tag2"],
  "isDuplicate": false,
  "priority": "high",
  "enhancedInsight": "Refined version of the insight"
}`;

    const userMessage = `## New Insight
${insight}

## Context
${context || 'General'}

## Type
${type}

## User Tags
${tags.join(', ') || 'None'}

Please analyze this insight for storage.`;

    let analysis;
    try {
      const response = await this._callSonnet(systemPrompt, userMessage, 1024);
      analysis = JSON.parse(response);
    } catch (e) {
      // Use defaults if parsing fails
      analysis = {
        quality: 5,
        value: 'User-provided insight',
        suggestedTags: tags,
        isDuplicate: false,
        priority: 'medium',
        enhancedInsight: insight,
      };
    }

    // Store if quality is sufficient and not duplicate
    let stored = false;
    if (analysis.quality >= 4 && !analysis.isDuplicate) {
      const record = {
        id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        content: analysis.enhancedInsight || insight,
        originalInsight: insight,
        context,
        tags: [...new Set([...tags, ...(analysis.suggestedTags || [])])],
        quality: analysis.quality,
        priority: analysis.priority,
        createdAt: new Date().toISOString(),
      };

      await this.insightsStore.append(record);
      stored = true;
    }

    const duration = Date.now() - startTime;

    return {
      insight,
      analysis,
      stored,
      stats: {
        duration,
      },
    };
  }

  /**
   * Consolidate memories - merge, deduplicate, reorganize
   *
   * @param {string} scope - 'recent', 'type', or 'all'
   * @param {string} type - If scope is 'type', which type
   * @param {boolean} dryRun - Preview without applying
   * @returns {Promise<Object>} Consolidation results
   */
  async consolidate(scope = 'recent', type = null, dryRun = false) {
    this.stats.consolidations++;
    const startTime = Date.now();

    // Gather memories based on scope
    let memories = [];
    const types = type ? [type] : ['skill', 'pattern', 'decision', 'insight'];

    const results = await this.orchestrator.query({
      prompt: '', // Empty to get all
      types,
    });
    memories = results.memories || [];

    if (scope === 'recent') {
      // Last 7 days
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      memories = memories.filter(m => {
        const timestamp = m.timestamp || m.createdAt;
        return timestamp && new Date(timestamp).getTime() > cutoff;
      });
    }

    if (memories.length < 2) {
      return {
        scope,
        type,
        dryRun,
        message: 'Not enough memories to consolidate',
        stats: { memoriesFound: memories.length },
      };
    }

    // Use Sonnet to identify consolidation opportunities
    const systemPrompt = `You are Cortex, Claude's cognitive layer responsible for memory management and consolidation.

When consolidating memories:
1. Identify duplicates or near-duplicates
2. Find memories that could be merged into a better single memory
3. Spot outdated information that conflicts with newer knowledge
4. Suggest reorganization for better retrieval

Respond in JSON format:
{
  "duplicates": [{"ids": ["id1", "id2"], "reason": "Same concept"}],
  "merges": [{"ids": ["id1", "id2"], "mergedContent": "Combined insight", "reason": "Related concepts"}],
  "outdated": [{"id": "id1", "reason": "Superseded by newer info"}],
  "summary": "Overall assessment"
}`;

    const memorySummaries = memories.slice(0, 30).map(m => ({
      id: m.id,
      type: m.type,
      content: (m.content || m.summary || '').substring(0, 200),
      timestamp: m.timestamp || m.createdAt,
    }));

    const userMessage = `## Memories to Consolidate (${memories.length} total, showing ${memorySummaries.length})

${JSON.stringify(memorySummaries, null, 2)}

Please analyze for consolidation opportunities.`;

    let analysis;
    try {
      const response = await this._callSonnet(systemPrompt, userMessage, 2048);
      analysis = JSON.parse(response);
    } catch (e) {
      analysis = {
        duplicates: [],
        merges: [],
        outdated: [],
        summary: 'Analysis failed - no changes recommended',
      };
    }

    // Apply changes if not dry run
    let applied = { duplicatesRemoved: 0, memoriesMerged: 0, outdatedRemoved: 0 };

    if (!dryRun) {
      // TODO: Implement actual storage modifications
      // For now, just report what would be done
      applied = {
        duplicatesRemoved: analysis.duplicates?.length || 0,
        memoriesMerged: analysis.merges?.length || 0,
        outdatedRemoved: analysis.outdated?.length || 0,
        note: 'Storage modification not yet implemented - showing analysis only',
      };
    }

    const duration = Date.now() - startTime;

    return {
      scope,
      type,
      dryRun,
      analysis,
      applied: dryRun ? null : applied,
      stats: {
        memoriesAnalyzed: memorySummaries.length,
        duration,
      },
    };
  }

  /**
   * Get thinker statistics
   */
  getStats() {
    return {
      ...this.stats,
      estimatedCost: (this.stats.tokensUsed / 1000000) * 3, // Sonnet pricing
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { SonnetThinker };
