#!/usr/bin/env node
/**
 * Cortex MCP Server
 *
 * Claude's Cognitive Layer - A dual-model memory system using Haiku (worker)
 * and Sonnet (thinker) for intelligent memory operations.
 *
 * Tools:
 *   - cortex__query: Search all memory sources (Haiku)
 *   - cortex__recall: Get specific memory by context (Haiku)
 *   - cortex__reflect: Think about current session (Sonnet)
 *   - cortex__infer: Reason about connections (Sonnet)
 *   - cortex__learn: Extract and store insight (Sonnet)
 *   - cortex__consolidate: Merge/dedupe memories (Sonnet)
 *
 * @version 1.0.0
 */

'use strict';

// MCP SDK uses ESM, we need dynamic import
async function main() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
  } = await import('@modelcontextprotocol/sdk/types.js');

  // Import our workers
  const { HaikuWorker } = require('./haiku-worker.cjs');
  const { SonnetThinker } = require('./sonnet-thinker.cjs');
  const { NeuralProgressDisplay } = require('../hooks/neural-visuals.cjs');
  const { CortexError, fromAPIError, fromMemoryError } = require('../core/errors.cjs');

  // Initialize workers
  const haiku = new HaikuWorker();
  const sonnet = new SonnetThinker();
  const progress = new NeuralProgressDisplay({ verbose: false });

  // Tool execution tracking
  const TOOL_MODELS = {
    'cortex__query': { model: 'Haiku', estimatedMs: 500 },
    'cortex__recall': { model: 'Haiku', estimatedMs: 300 },
    'cortex__reflect': { model: 'Sonnet', estimatedMs: 3000 },
    'cortex__infer': { model: 'Sonnet', estimatedMs: 2000 },
    'cortex__learn': { model: 'Sonnet', estimatedMs: 2000 },
    'cortex__consolidate': { model: 'Sonnet', estimatedMs: 5000 },
  };

  // Log to stderr to not interfere with stdio transport
  const log = (msg) => process.stderr.write(`[Cortex] ${msg}\n`);

  // Create MCP server
  const server = new Server(
    {
      name: 'cortex',
      version: '1.0.0',
      description: "Claude's Cognitive Layer - Intelligent memory with dual-model architecture"
    },
    {
      capabilities: {
        tools: { listChanged: true }
      }
    }
  );

  // ==========================================================================
  // TOOL DEFINITIONS
  // ==========================================================================

  const TOOLS = [
    // Haiku-powered tools (fast, cheap)
    {
      name: 'cortex__query',
      description: 'Search all memory sources for relevant context. Uses Haiku for fast, efficient queries across episodic memory, knowledge graph, JSONL files, and CLAUDE.md.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query to search memories'
          },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'knowledge-graph', 'jsonl', 'claudemd', 'all'] },
            description: 'Which memory sources to search (default: all)',
            default: ['all']
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)',
            default: 10
          }
        },
        required: ['query']
      }
    },
    {
      name: 'cortex__recall',
      description: 'Retrieve specific memories by context. Uses Haiku to find exact matches or closely related memories.',
      inputSchema: {
        type: 'object',
        properties: {
          context: {
            type: 'string',
            description: 'Context to match (e.g., "debugging auth issues", "React patterns")'
          },
          type: {
            type: 'string',
            enum: ['skill', 'pattern', 'decision', 'insight', 'any'],
            description: 'Type of memory to recall (default: any)',
            default: 'any'
          }
        },
        required: ['context']
      }
    },

    // Sonnet-powered tools (deep reasoning)
    {
      name: 'cortex__reflect',
      description: 'Deep reflection on the current session or topic. Uses Sonnet for meta-cognitive analysis, pattern recognition, and insight generation.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'What to reflect on (e.g., "current debugging approach", "session progress")'
          },
          depth: {
            type: 'string',
            enum: ['quick', 'moderate', 'deep'],
            description: 'How deep to reflect (default: moderate)',
            default: 'moderate'
          }
        },
        required: ['topic']
      }
    },
    {
      name: 'cortex__infer',
      description: 'Reason about connections between concepts or memories. Uses Sonnet to find non-obvious relationships and generate insights.',
      inputSchema: {
        type: 'object',
        properties: {
          concepts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concepts to find connections between',
            minItems: 2
          },
          includeMemories: {
            type: 'boolean',
            description: 'Whether to include stored memories in reasoning (default: true)',
            default: true
          }
        },
        required: ['concepts']
      }
    },
    {
      name: 'cortex__learn',
      description: 'Extract and store an insight or learning. Uses Sonnet to analyze the insight quality and determine optimal storage.',
      inputSchema: {
        type: 'object',
        properties: {
          insight: {
            type: 'string',
            description: 'The insight or learning to store'
          },
          context: {
            type: 'string',
            description: 'Context where this insight applies'
          },
          type: {
            type: 'string',
            enum: ['skill', 'pattern', 'decision', 'general'],
            description: 'Type of learning (default: general)',
            default: 'general'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization'
          }
        },
        required: ['insight']
      }
    },
    {
      name: 'cortex__consolidate',
      description: 'Merge, deduplicate, or reorganize memories. Uses Sonnet to intelligently combine related memories and remove redundancy.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['recent', 'type', 'all'],
            description: 'Scope of consolidation (default: recent)',
            default: 'recent'
          },
          type: {
            type: 'string',
            enum: ['skill', 'pattern', 'decision', 'insight'],
            description: 'If scope is "type", which type to consolidate'
          },
          dryRun: {
            type: 'boolean',
            description: 'Preview changes without applying (default: false)',
            default: false
          }
        }
      }
    }
  ];

  // ==========================================================================
  // REQUEST HANDLERS
  // ==========================================================================

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool calls with progress tracking
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startTime = Date.now();

    // Get tool info for progress tracking
    const toolInfo = TOOL_MODELS[name] || { model: 'Unknown', estimatedMs: 1000 };

    log(`Tool call: ${name} (${toolInfo.model})`);

    // Show progress for Sonnet operations (they take longer)
    let progressInterval = null;
    if (toolInfo.model === 'Sonnet') {
      let dots = 0;
      progressInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        const elapsed = Date.now() - startTime;
        process.stderr.write(`\r[Cortex] ${name} - ${toolInfo.model} thinking${'.'.repeat(dots)}${' '.repeat(3 - dots)} (${Math.round(elapsed / 1000)}s)`);
      }, 500);
    }

    try {
      let result;

      switch (name) {
        // Haiku-powered tools
        case 'cortex__query':
          result = await haiku.query(args.query, args.sources, args.limit);
          break;

        case 'cortex__recall':
          result = await haiku.recall(args.context, args.type);
          break;

        // Sonnet-powered tools
        case 'cortex__reflect':
          result = await sonnet.reflect(args.topic, args.depth);
          break;

        case 'cortex__infer':
          result = await sonnet.infer(args.concepts, args.includeMemories);
          break;

        case 'cortex__learn':
          result = await sonnet.learn(args.insight, args.context, args.type, args.tags);
          break;

        case 'cortex__consolidate':
          result = await sonnet.consolidate(args.scope, args.type, args.dryRun);
          break;

        default:
          throw new CortexError('CORTEX_E202', { details: name });
      }

      // Clear progress and show completion
      if (progressInterval) {
        clearInterval(progressInterval);
        const duration = Date.now() - startTime;
        process.stderr.write(`\r[Cortex] ${name} - ${toolInfo.model} ✓ (${Math.round(duration / 1000)}s)\n`);
      }

      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };

    } catch (error) {
      // Clear progress on error
      if (progressInterval) {
        clearInterval(progressInterval);
        process.stderr.write(`\r[Cortex] ${name} - ${toolInfo.model} ✗\n`);
      }

      // Convert to CortexError if not already
      let cortexError = error;
      if (!(error instanceof CortexError)) {
        // Try to categorize the error
        if (error.message?.includes('API') || error.message?.includes('fetch') ||
            error.message?.includes('401') || error.message?.includes('429')) {
          cortexError = fromAPIError(error);
        } else if (error.message?.includes('ENOENT') || error.message?.includes('JSON')) {
          cortexError = fromMemoryError(name, error);
        } else {
          cortexError = new CortexError('CORTEX_E900', {
            cause: error,
            details: `${name}: ${error.message}`
          });
        }
      }

      log(`Error ${cortexError.code} in ${name}: ${cortexError.message}`);

      return {
        content: [{
          type: 'text',
          text: cortexError.toDisplayString()
        }],
        isError: true
      };
    }
  });

  // ==========================================================================
  // START SERVER
  // ==========================================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('Cortex MCP server started');
}

// Run the server
main().catch((error) => {
  process.stderr.write(`[Cortex] Fatal error: ${error.message}\n`);
  process.exit(1);
});
