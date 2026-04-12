'use strict';

const path = require('path');
const { generateId, getTimestamp, expandPath } = require('../core/types.cjs');
const { JSONLStore } = require('../core/storage.cjs');
const { getLockManager } = require('../core/lock-manager.cjs');
const { WriteGate } = require('../core/write-gate.cjs');
const { Anthropic } = require('@anthropic-ai/sdk');

class ExtractionEngine {
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');
    this.confidenceThreshold = options.confidenceThreshold || 0.7;
    this.minSessionLength = options.minSessionLength || 1; // Set to 1 because ingestion files can be single large strings
    
    this.lockManager = getLockManager();
    this.writeGate = new WriteGate();
    
    const apiKey = process.env.ANTHROPIC_API_KEY || options.apiKey;
    if (!apiKey) {
      console.warn("[ExtractionEngine] WARNING: ANTHROPIC_API_KEY is not set. Inference for Cortex Morphology will fail.");
    }
    this.anthropic = new Anthropic({ apiKey });
  }

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

  async extract(input) {
    const { messages, sessionId, context } = input;

    if (!messages || messages.length < this.minSessionLength) {
      return { success: true, extracted: [], stats: {} };
    }

    const fullText = messages.map(m => m.content).join('\n---\n');

    // Schema describing the structural hierarchy
    const tools = [{
      name: "create_cortex_topology_nodes",
      description: "Extract specific concepts, facts, insights, or code structures from the text into structural Cortex topological clusters.",
      input_schema: {
        type: "object",
        properties: {
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                lobe: { type: "string", description: "Top level anatomical lobe (e.g., Prefrontal, Temporal, Occipital, Parietal)" },
                region: { type: "string", description: "Topic sub-region inside the Lobe (e.g., Database Processing, Daily Logs)" },
                cluster: { type: "string", description: "The specific isolated synaptic concept title this memory revolves around" },
                content: { type: "string", description: "The verbatim content, fact, or code snapshot extracted" },
                type: { type: "string", enum: ["skill", "insight", "pattern", "decision"], description: "The cognitive classification" },
                tags: { type: "array", items: { type: "string" }, description: "Relevant semantic tags" },
              },
              required: ["lobe", "region", "cluster", "content", "type"]
            }
          }
        },
        required: ["nodes"]
      }
    }];

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4000,
        temperature: 0.1,
        system: "You are the Memory Ingestion cortex. Your job is to extract unstructured text into topological neurons. Group them into Lobes, Regions, and Clusters based on semantic purpose. Be extremely precise and preserve raw code context if applicable.",
        messages: [{ role: "user", content: "Extract Neural Cortex nodes from the following session data:\n\n" + fullText }],
        tools: tools,
        tool_choice: { type: "tool", name: "create_cortex_topology_nodes" }
      });

      let extractedNodes = [];
      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'create_cortex_topology_nodes') {
          if (block.input && block.input.nodes) {
            extractedNodes = block.input.nodes;
          }
        }
      }

      const processed = extractedNodes.map((node, i) => ({
        id: generateId(),
        type: node.type,
        lobe: node.lobe,
        region: node.region,
        cluster: node.cluster,
        content: node.content,
        summary: `[${node.lobe}/${node.region}/${node.cluster}] ${node.content.slice(0, 50)}...`,
        tags: node.tags || [],
        extractionConfidence: 0.95, // Default LLM high confidence
        sourceSessionId: sessionId,
        sourceMessageIndex: i,
        projectHash: context?.projectHash,
        intent: context?.intent,
        createdAt: getTimestamp(),
        status: 'active',
      }));

      // Deduplicate
      const unique = [];
      const contentHashes = new Set();
      for (const extraction of processed) {
        const hash = extraction.content.slice(0, 100).toLowerCase().replace(/\s+/g, ' ');
        if (!contentHashes.has(hash)) {
          contentHashes.add(hash);
          unique.push(extraction);
        }
      }

      // Persist Extractions
      const stores = this._getStores();
      let persisted = 0;
      let filtered = 0;

      for (const extraction of unique) {
        if (!this.writeGate.shouldPersist({ content: extraction.content, type: extraction.type, confidence: extraction.extractionConfidence })) {
          filtered++;
          continue;
        }
        if (extraction.type === 'skill') {
          await this.lockManager.withLock('memory:skills', async () => {
             if (!stores.skills.loaded) await stores.skills.load();
             return stores.skills.append(extraction);
          });
        } else {
          await this.lockManager.withLock('memory:working', async () => {
             if (!stores.working.loaded) await stores.working.load();
             return stores.working.append(extraction);
          });
        }
        persisted++;
      }

      return {
        success: true,
        extracted: unique,
        stats: {
          messageCount: messages.length,
          candidatesFound: extractedNodes.length,
          afterDedup: unique.length,
          persisted,
          filteredByWriteGate: filtered
        }
      };
    } catch (error) {
      console.error("[ExtractionEngine] LLM Error:", error);
      return { success: false, extracted: [], stats: { reason: error.message } };
    }
  }
}

module.exports = { ExtractionEngine };
