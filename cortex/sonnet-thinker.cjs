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
 * @version 2.0.0
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const { QueryOrchestrator } = require('../hooks/query-orchestrator.cjs');
const { JSONLStore } = require('../core/storage.cjs');
const { getVectorSearchProvider } = require('../core/vector-search-provider.cjs');
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

    // Memory tier stores for consolidation
    this.workingStore = new JSONLStore(
      path.join(this.basePath, 'data', 'memories', 'working.jsonl')
    );

    this.shortTermStore = new JSONLStore(
      path.join(this.basePath, 'data', 'memories', 'short-term.jsonl')
    );

    this.longTermStore = new JSONLStore(
      path.join(this.basePath, 'data', 'memories', 'long-term.jsonl')
    );

    // Track whether stores are loaded (with promise for race condition safety)
    this._storesLoaded = false;
    this._loadingPromise = null;

    // Vector search provider for dual-write (lazy initialized)
    this._vectorProvider = null;
    this._vectorProviderInitializing = null;

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
   * Ensure stores are loaded before use
   * Uses loading promise pattern to prevent race conditions from concurrent calls
   * @private
   */
  async _ensureStoresLoaded() {
    if (this._storesLoaded) return;

    // Serialize concurrent calls with a loading promise
    if (!this._loadingPromise) {
      this._loadingPromise = (async () => {
        try {
          // Load stores in parallel for better performance
          const [learningsResult, insightsResult, workingResult, shortTermResult, longTermResult] = await Promise.all([
            this.learningsStore.load(),
            this.insightsStore.load(),
            this.workingStore.load(),
            this.shortTermStore.load(),
            this.longTermStore.load(),
          ]);

          // Log any load issues (non-fatal)
          if (!learningsResult.success || !insightsResult.success) {
            process.stderr.write(
              `[SonnetThinker] Store load warning: learnings=${learningsResult.success}, insights=${insightsResult.success}\n`
            );
          }
          if (!workingResult.success || !shortTermResult.success || !longTermResult.success) {
            process.stderr.write(
              `[SonnetThinker] Tier store load warning: working=${workingResult.success}, short-term=${shortTermResult.success}, long-term=${longTermResult.success}\n`
            );
          }

          this._storesLoaded = true;
        } catch (error) {
          // Reset promise so retry is possible
          this._loadingPromise = null;
          process.stderr.write(`[SonnetThinker] Store load failed: ${error.message}\n`);
          throw error;
        }
      })();
    }

    await this._loadingPromise;
  }

  /**
   * Ensure vector search provider is initialized (lazy loading)
   * @private
   * @returns {Promise<VectorSearchProvider|null>}
   */
  async _ensureVectorProvider() {
    // Already initialized
    if (this._vectorProvider && this._vectorProvider.initialized) {
      return this._vectorProvider;
    }

    // Prevent concurrent initialization
    if (this._vectorProviderInitializing) {
      return this._vectorProviderInitializing;
    }

    this._vectorProviderInitializing = (async () => {
      try {
        this._vectorProvider = getVectorSearchProvider({
          basePath: this.basePath,
        });

        // Initialize if not already
        if (!this._vectorProvider.initialized) {
          const result = await this._vectorProvider.initialize();
          if (!result.success) {
            process.stderr.write(
              `[SonnetThinker] VectorSearchProvider init warning: ${result.error}\n`
            );
            return null;
          }
        }

        return this._vectorProvider;
      } catch (error) {
        process.stderr.write(
          `[SonnetThinker] VectorSearchProvider init failed: ${error.message}\n`
        );
        return null;
      } finally {
        this._vectorProviderInitializing = null;
      }
    })();

    return this._vectorProviderInitializing;
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
    // Ensure stores are loaded before use
    await this._ensureStoresLoaded();

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
    let vectorStored = false;
    let vectorId = null;

    if (analysis.quality >= 4 && !analysis.isDuplicate) {
      const finalContent = analysis.enhancedInsight || insight;
      const finalTags = [...new Set([...tags, ...(analysis.suggestedTags || [])])];
      const timestamp = new Date().toISOString();

      // Map type to MemoryStore memory_type (valid: observation, learning, pattern, skill, etc.)
      const memoryTypeMap = {
        'skill': 'skill',
        'pattern': 'pattern',
        'decision': 'decision',
        'general': 'learning',
        'insight': 'learning',
      };
      const memoryType = memoryTypeMap[type] || 'learning';

      const record = {
        id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        content: finalContent,
        originalInsight: insight,
        context,
        tags: finalTags,
        quality: analysis.quality,
        priority: analysis.priority,
        createdAt: timestamp,
      };

      // 1. Write to JSONL store (existing behavior)
      await this.insightsStore.append(record);
      stored = true;

      // 2. Write to vector store (new dual-write behavior)
      try {
        const vectorProvider = await this._ensureVectorProvider();
        if (vectorProvider) {
          const vectorResult = await vectorProvider.insert({
            content: finalContent,
            summary: context || finalContent.substring(0, 200),
            memory_type: memoryType,
            intent: 'learning',
            tags: JSON.stringify(finalTags),
            source: 'cortex-learn',
            source_id: record.id,
            project_hash: null, // Global insight
            session_id: null,
            extraction_confidence: analysis.quality / 10, // Normalize to 0-1
            quality_score: analysis.quality / 10,
          }, { generateEmbedding: true });

          if (vectorResult.id) {
            vectorStored = true;
            vectorId = vectorResult.id;
          }
        }
      } catch (vectorError) {
        // Log but don't fail - JSONL write succeeded
        process.stderr.write(
          `[SonnetThinker] Vector write warning: ${vectorError.message}\n`
        );
      }
    }

    const duration = Date.now() - startTime;

    return {
      insight,
      analysis,
      stored,
      vectorStored,
      vectorId,
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
    let applied = { duplicatesRemoved: 0, memoriesMerged: 0, outdatedRemoved: 0, errors: [] };

    if (!dryRun) {
      // Ensure stores are loaded before modifications
      await this._ensureStoresLoaded();

      // Build a map of memory ID to its source store for efficient lookup
      const memoryStoreMap = new Map();
      for (const record of this.longTermStore.getAll()) {
        if (record && record.id) memoryStoreMap.set(record.id, { store: this.longTermStore, record });
      }
      for (const record of this.shortTermStore.getAll()) {
        if (record && record.id) memoryStoreMap.set(record.id, { store: this.shortTermStore, record });
      }
      for (const record of this.workingStore.getAll()) {
        if (record && record.id) memoryStoreMap.set(record.id, { store: this.workingStore, record });
      }

      // Process duplicates: soft-delete all but keep the first (newest wins in JSONL)
      for (const duplicate of (analysis.duplicates || [])) {
        const ids = duplicate.ids || [];
        if (ids.length < 2) continue;

        // Keep the first, delete the rest
        for (let i = 1; i < ids.length; i++) {
          const entry = memoryStoreMap.get(ids[i]);
          if (entry) {
            try {
              await entry.store.softDelete(ids[i]);
              applied.duplicatesRemoved++;
            } catch (e) {
              applied.errors.push({ op: 'duplicate-delete', id: ids[i], error: e.message });
            }
          }
        }
      }

      // Process merges: create merged record, soft-delete originals
      for (const merge of (analysis.merges || [])) {
        const ids = merge.ids || [];
        if (ids.length < 2 || !merge.mergedContent) continue;

        // Get the first original record to preserve metadata
        const firstEntry = memoryStoreMap.get(ids[0]);
        if (!firstEntry) continue;

        try {
          // Create new merged record in long-term (consolidated content should persist)
          const mergedRecord = {
            id: `merged_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: firstEntry.record.type || 'merged',
            content: merge.mergedContent,
            summary: merge.mergedContent.substring(0, 100),
            tags: [...new Set((firstEntry.record.tags || []).concat(['consolidated']))],
            status: 'active',
            mergedFrom: ids,
            mergeReason: merge.reason,
            projectHash: firstEntry.record.projectHash || null,
            intent: firstEntry.record.intent || 'general',
            sourceSessionId: 'consolidation',
            sourceTimestamp: new Date().toISOString(),
            extractionConfidence: 0.9,
            usageCount: 0,
            usageSuccessRate: 0.5,
            decayScore: 1,
          };

          await this.longTermStore.append(mergedRecord);

          // Soft-delete all originals
          for (const id of ids) {
            const entry = memoryStoreMap.get(id);
            if (entry) {
              await entry.store.softDelete(id);
            }
          }

          applied.memoriesMerged++;
        } catch (e) {
          applied.errors.push({ op: 'merge', ids, error: e.message });
        }
      }

      // Process outdated: soft-delete
      for (const outdated of (analysis.outdated || [])) {
        const id = outdated.id;
        if (!id) continue;

        const entry = memoryStoreMap.get(id);
        if (entry) {
          try {
            await entry.store.softDelete(id);
            applied.outdatedRemoved++;
          } catch (e) {
            applied.errors.push({ op: 'outdated-delete', id, error: e.message });
          }
        }
      }

      // Compact stores to remove deleted records if we made significant changes
      const totalChanges = applied.duplicatesRemoved + applied.memoriesMerged + applied.outdatedRemoved;
      if (totalChanges >= 5) {
        try {
          await Promise.all([
            this.workingStore.compact({ removeDeleted: true }),
            this.shortTermStore.compact({ removeDeleted: true }),
            this.longTermStore.compact({ removeDeleted: true }),
          ]);
        } catch (e) {
          applied.errors.push({ op: 'compact', error: e.message });
        }
      }

      // Remove errors array if empty for cleaner output
      if (applied.errors.length === 0) {
        delete applied.errors;
      }
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
      estimatedCost: estimateCost(this.stats.inputTokens, this.stats.outputTokens).display,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { SonnetThinker };
