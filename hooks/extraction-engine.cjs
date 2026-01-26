/**
 * Cortex - Claude's Cognitive Layer - Extraction Engine
 *
 * Analyzes conversations to extract valuable memories:
 * - Skills: Procedural knowledge (commands, workflows, patterns)
 * - Insights: Architectural decisions, gotchas, edge cases
 * - Patterns: Recurring problem/solution pairs
 * - Decisions: Explicit choices and their rationale
 *
 * Uses heuristics and signal analysis to determine extraction worthiness.
 */

'use strict';

const path = require('path');
const { generateId, getTimestamp, expandPath } = require('../core/types.cjs');
const { JSONLStore } = require('../core/storage.cjs');
const { getLockManager } = require('../core/lock-manager.cjs');

// =============================================================================
// EXTRACTION PATTERNS
// =============================================================================

/**
 * Patterns for detecting extractable content
 */
const EXTRACTION_PATTERNS = {
  skill: {
    // Commands and code blocks with explanations
    patterns: [
      /```(?:bash|sh|shell|powershell|ps1)\n([\s\S]*?)```/g,
      /`([^`]+)`\s+(?:command|to|for|when)/gi,
      /(?:run|execute|use|try)\s+`([^`]+)`/gi,
    ],
    // Phrases indicating procedural knowledge
    indicators: [
      'to do this', 'you can', 'here\'s how', 'the command',
      'run this', 'execute', 'step by step', 'workflow',
      'first, then', 'after that', 'finally',
    ],
    minLength: 20,
    weight: 1.0,
  },
  insight: {
    patterns: [
      /(?:important|note|gotcha|caveat|warning|tip):\s*(.+)/gi,
      /(?:remember|keep in mind|don't forget):\s*(.+)/gi,
      /the (?:reason|cause|issue|problem) (?:is|was):\s*(.+)/gi,
    ],
    indicators: [
      'important to note', 'keep in mind', 'gotcha', 'caveat',
      'the reason', 'because', 'this happens when', 'edge case',
      'be careful', 'watch out', 'common mistake',
    ],
    minLength: 30,
    weight: 0.9,
  },
  pattern: {
    patterns: [
      /when(?:ever)?\s+(.+),?\s+(?:you should|use|try|do)/gi,
      /if\s+(.+),?\s+then\s+(.+)/gi,
      /the (?:solution|fix|answer) (?:is|was):\s*(.+)/gi,
    ],
    indicators: [
      'whenever', 'if you see', 'when this happens', 'the pattern',
      'this usually means', 'common solution', 'best practice',
      'always do', 'never do', 'prefer',
    ],
    minLength: 25,
    weight: 0.85,
  },
  decision: {
    patterns: [
      /(?:decided|choosing|went with|opted for)\s+(.+)/gi,
      /(?:because|since|given that)\s+(.+),?\s+(?:I|we)\s+(.+)/gi,
      /trade-?off:\s*(.+)/gi,
    ],
    indicators: [
      'decided to', 'chose', 'went with', 'opted for',
      'trade-off', 'alternative', 'instead of', 'rather than',
      'pros and cons', 'consideration', 'evaluated',
    ],
    minLength: 30,
    weight: 0.8,
  },
};

/**
 * Content quality signals
 */
const QUALITY_SIGNALS = {
  positive: [
    { pattern: /```[\s\S]*```/, weight: 0.1, name: 'code_block' },
    { pattern: /\b(?:solved|fixed|works|success)\b/gi, weight: 0.15, name: 'success_language' },
    { pattern: /\b(?:learn|understand|realize|discover)\b/gi, weight: 0.1, name: 'learning_language' },
    { pattern: /\b(?:important|critical|essential|key)\b/gi, weight: 0.1, name: 'importance_marker' },
    { pattern: /(?:step \d|first|then|finally)/gi, weight: 0.1, name: 'structured' },
  ],
  negative: [
    { pattern: /\b(?:maybe|perhaps|not sure|might)\b/gi, weight: -0.1, name: 'uncertainty' },
    { pattern: /\b(?:todo|fixme|hack|workaround)\b/gi, weight: -0.15, name: 'incomplete' },
    { pattern: /\b(?:deprecated|obsolete|old)\b/gi, weight: -0.2, name: 'outdated' },
    { pattern: /^\s*(?:ok|yes|no|sure|thanks)\s*$/gi, weight: -0.3, name: 'trivial' },
  ],
};

// =============================================================================
// EXTRACTION ENGINE
// =============================================================================

class ExtractionEngine {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for storage
   * @param {number} options.confidenceThreshold - Min confidence to extract
   * @param {number} options.minSessionLength - Min messages to consider
   */
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');
    this.confidenceThreshold = options.confidenceThreshold || 0.7;
    this.minSessionLength = options.minSessionLength || 3;

    this.lockManager = getLockManager();

    // Stores for different memory types
    this._stores = null;
  }

  /**
   * Get or initialize stores
   * @returns {Object}
   */
  _getStores() {
    if (!this._stores) {
      this._stores = {
        working: new JSONLStore(
          path.join(this.basePath, 'data/memories/working.jsonl'),
          { indexFn: r => r.id }
        ),
        shortTerm: new JSONLStore(
          path.join(this.basePath, 'data/memories/short-term.jsonl'),
          { indexFn: r => r.id }
        ),
        skills: new JSONLStore(
          path.join(this.basePath, 'data/skills/index.jsonl'),
          { indexFn: r => r.id }
        ),
      };
    }
    return this._stores;
  }

  /**
   * Extract memories from a conversation
   * @param {Object} input
   * @param {Object[]} input.messages - Conversation messages
   * @param {string} input.sessionId - Session identifier
   * @param {Object} input.context - Session context
   * @returns {Promise<Object>}
   */
  async extract(input) {
    const { messages, sessionId, context } = input;

    // Validate minimum session length
    if (!messages || messages.length < this.minSessionLength) {
      return {
        success: true,
        extracted: [],
        stats: { reason: 'Session too short', messageCount: messages?.length || 0 },
      };
    }

    const extracted = [];
    const stores = this._getStores();

    // Analyze each message
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Skip user messages (extract from assistant responses)
      if (message.role === 'user') continue;

      const content = this._getMessageContent(message);
      if (!content || content.length < 50) continue;

      // Check for extractable content
      const candidates = this._findCandidates(content, context);

      for (const candidate of candidates) {
        // Calculate confidence
        const confidence = this._calculateConfidence(candidate, content, messages, i);

        if (confidence >= this.confidenceThreshold) {
          const memory = this._createMemory(candidate, {
            sessionId,
            context,
            confidence,
            messageIndex: i,
          });

          extracted.push(memory);
        }
      }
    }

    // Deduplicate similar extractions
    const deduplicated = this._deduplicateExtractions(extracted);

    // Persist extractions
    const persistResults = await this._persistExtractions(deduplicated, stores);

    return {
      success: true,
      extracted: deduplicated,
      stats: {
        messageCount: messages.length,
        candidatesFound: extracted.length,
        afterDedup: deduplicated.length,
        persisted: persistResults.persisted,
        byType: this._countByType(deduplicated),
      },
    };
  }

  /**
   * Get text content from a message
   * @param {Object} message
   * @returns {string}
   */
  _getMessageContent(message) {
    if (typeof message.content === 'string') {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return message.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return '';
  }

  /**
   * Find extraction candidates in content
   * @param {string} content
   * @param {Object} context
   * @returns {Object[]}
   */
  _findCandidates(content, context) {
    const candidates = [];
    const contentLower = content.toLowerCase();

    for (const [type, config] of Object.entries(EXTRACTION_PATTERNS)) {
      // Check for indicators
      let indicatorScore = 0;
      for (const indicator of config.indicators) {
        if (contentLower.includes(indicator.toLowerCase())) {
          indicatorScore += 0.1;
        }
      }

      // Check for patterns
      for (const pattern of config.patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;

        while ((match = regex.exec(content)) !== null) {
          const extractedContent = match[1] || match[0];

          if (extractedContent.length >= config.minLength) {
            candidates.push({
              type,
              content: extractedContent.trim(),
              fullMatch: match[0],
              indicatorScore,
              patternWeight: config.weight,
              context: this._extractContext(content, match.index, 200),
            });
          }
        }
      }

      // Also extract based on strong indicator presence
      if (indicatorScore >= 0.3) {
        // Extract surrounding paragraph
        const paragraphs = content.split(/\n\n+/);
        for (const para of paragraphs) {
          const paraLower = para.toLowerCase();
          let matchedIndicator = false;

          for (const indicator of config.indicators) {
            if (paraLower.includes(indicator.toLowerCase())) {
              matchedIndicator = true;
              break;
            }
          }

          if (matchedIndicator && para.length >= config.minLength) {
            // Avoid duplicates from pattern matching
            if (!candidates.some(c => c.content === para.trim())) {
              candidates.push({
                type,
                content: para.trim(),
                fullMatch: para,
                indicatorScore,
                patternWeight: config.weight * 0.8, // Lower weight for indicator-only
              });
            }
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Extract surrounding context
   * @param {string} content
   * @param {number} index
   * @param {number} windowSize
   * @returns {string}
   */
  _extractContext(content, index, windowSize) {
    const start = Math.max(0, index - windowSize);
    const end = Math.min(content.length, index + windowSize);
    return content.slice(start, end).trim();
  }

  /**
   * Calculate confidence score for a candidate
   * @param {Object} candidate
   * @param {string} fullContent
   * @param {Object[]} messages
   * @param {number} messageIndex
   * @returns {number}
   */
  _calculateConfidence(candidate, fullContent, messages, messageIndex) {
    let score = 0.5; // Base score

    // Add pattern weight
    score += (candidate.patternWeight || 0) * 0.2;

    // Add indicator score
    score += (candidate.indicatorScore || 0);

    // Quality signals
    for (const signal of QUALITY_SIGNALS.positive) {
      if (signal.pattern.test(candidate.content)) {
        score += signal.weight;
      }
    }

    for (const signal of QUALITY_SIGNALS.negative) {
      if (signal.pattern.test(candidate.content)) {
        score += signal.weight; // weight is negative
      }
    }

    // Context relevance (later in conversation = more refined)
    const positionBonus = Math.min(messageIndex / messages.length * 0.1, 0.1);
    score += positionBonus;

    // Content length bonus (longer = more detailed)
    const lengthBonus = Math.min(candidate.content.length / 500 * 0.1, 0.1);
    score += lengthBonus;

    // Check if it's a standalone concept or embedded
    const isStandalone = candidate.content.length > 100 &&
      (candidate.content.includes('.') || candidate.content.includes('\n'));
    if (isStandalone) {
      score += 0.05;
    }

    return Math.min(Math.max(score, 0), 1); // Clamp to 0-1
  }

  /**
   * Create a memory object from a candidate
   * @param {Object} candidate
   * @param {Object} metadata
   * @returns {Object}
   */
  _createMemory(candidate, metadata) {
    const { sessionId, context, confidence, messageIndex } = metadata;

    return {
      id: generateId(),
      type: candidate.type,
      content: candidate.content,
      summary: this._generateSummary(candidate.content),
      context: candidate.context,
      extractionConfidence: confidence,
      sourceSessionId: sessionId,
      sourceMessageIndex: messageIndex,
      projectHash: context?.projectHash,
      intent: context?.intent,
      tags: this._extractTags(candidate.content, context),
      createdAt: getTimestamp(),
      status: 'active',
    };
  }

  /**
   * Generate a brief summary of content
   * @param {string} content
   * @returns {string}
   */
  _generateSummary(content) {
    // Take first sentence or first 100 chars
    const firstSentence = content.match(/^[^.!?]+[.!?]/);
    if (firstSentence && firstSentence[0].length >= 20) {
      return firstSentence[0].trim();
    }

    // Fall back to truncation
    if (content.length <= 100) {
      return content;
    }

    return content.slice(0, 100).trim() + '...';
  }

  /**
   * Extract tags from content
   * @param {string} content
   * @param {Object} context
   * @returns {string[]}
   */
  _extractTags(content, context) {
    const tags = new Set();

    // Add context tags
    if (context?.tags) {
      context.tags.forEach(t => tags.add(t));
    }

    // Extract technology mentions
    const techPatterns = [
      /\b(react|vue|angular|svelte|next\.?js|nuxt)\b/gi,
      /\b(node|deno|bun|express|fastify|nest\.?js)\b/gi,
      /\b(python|django|flask|fastapi)\b/gi,
      /\b(rust|go|java|kotlin|swift)\b/gi,
      /\b(postgres|mysql|mongodb|redis|sqlite)\b/gi,
      /\b(docker|kubernetes|k8s|terraform)\b/gi,
      /\b(aws|gcp|azure|vercel|netlify)\b/gi,
      /\b(git|github|gitlab|bitbucket)\b/gi,
      /\b(typescript|javascript|css|html)\b/gi,
    ];

    for (const pattern of techPatterns) {
      const matches = content.match(pattern) || [];
      matches.forEach(m => tags.add(m.toLowerCase()));
    }

    // Extract explicit hashtags
    const hashTags = content.match(/#(\w+)/g) || [];
    hashTags.forEach(t => tags.add(t.slice(1).toLowerCase()));

    return [...tags].slice(0, 20); // Limit tags
  }

  /**
   * Deduplicate similar extractions
   * @param {Object[]} extractions
   * @returns {Object[]}
   */
  _deduplicateExtractions(extractions) {
    const unique = [];
    const contentHashes = new Set();

    for (const extraction of extractions) {
      // Create a simple hash of content
      const hash = extraction.content.slice(0, 100).toLowerCase().replace(/\s+/g, ' ');

      if (!contentHashes.has(hash)) {
        contentHashes.add(hash);
        unique.push(extraction);
      }
    }

    return unique;
  }

  /**
   * Persist extractions to appropriate stores
   * @param {Object[]} extractions
   * @param {Object} stores
   * @returns {Promise<Object>}
   */
  async _persistExtractions(extractions, stores) {
    let persisted = 0;

    for (const extraction of extractions) {
      try {
        // Skills go to skills store
        if (extraction.type === 'skill') {
          await this.lockManager.withLock('memory:skills', async () => {
            if (!stores.skills.loaded) await stores.skills.load();
            return stores.skills.append(extraction);
          });
        } else {
          // Other types go to working memory first
          await this.lockManager.withLock('memory:working', async () => {
            if (!stores.working.loaded) await stores.working.load();
            return stores.working.append(extraction);
          });
        }

        persisted++;
      } catch (error) {
        console.error(`[ExtractionEngine] Failed to persist ${extraction.type}:`, error.message);
      }
    }

    return { persisted };
  }

  /**
   * Count extractions by type
   * @param {Object[]} extractions
   * @returns {Object}
   */
  _countByType(extractions) {
    const counts = {};
    for (const e of extractions) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ExtractionEngine,
  EXTRACTION_PATTERNS,
  QUALITY_SIGNALS,
};
