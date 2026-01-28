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
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListResourceTemplatesRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
  } = await import('@modelcontextprotocol/sdk/types.js');

  const path = require('path');
  const fs = require('fs');

  // Import our workers
  const { HaikuWorker } = require('./haiku-worker.cjs');
  const { SonnetThinker } = require('./sonnet-thinker.cjs');
  const { NeuralProgressDisplay } = require('../hooks/neural-visuals.cjs');
  const { CortexError, fromAPIError, fromMemoryError } = require('../core/errors.cjs');

  // Import validation (security hardening)
  const {
    validateQueryArgs,
    validateRecallArgs,
    validateReflectArgs,
    validateInferArgs,
    validateLearnArgs,
    validateConsolidateArgs,
    ValidationError,
  } = require('../core/validation.cjs');

  // Import rate limiter (cost protection)
  const { RateLimiter, RateLimitError } = require('../core/rate-limiter.cjs');

  // Import audit logger (accountability)
  const { AuditLogger } = require('../core/audit-logger.cjs');

  // Initialize workers
  const haiku = new HaikuWorker();
  const sonnet = new SonnetThinker();
  const progress = new NeuralProgressDisplay({ verbose: false });

  // Initialize rate limiter (prevents runaway API costs)
  const rateLimiter = new RateLimiter({
    enabled: process.env.CORTEX_RATE_LIMIT !== 'false',
    onLimitReached: (toolName, info) => {
      log(`Rate limit reached for ${toolName}: cooldown until ${new Date(info.cooldownEnd).toISOString()}`);
    },
  });

  // Initialize audit logger (accountability & debugging)
  const auditLogger = new AuditLogger({
    enabled: process.env.CORTEX_AUDIT !== 'false',
    logLevel: process.env.CORTEX_LOG_LEVEL || 'INFO',
    consoleOutput: process.env.CORTEX_AUDIT_CONSOLE === 'true',
  });
  auditLogger.sessionStart();

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
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: true }
        // Note: Sampling capability intentionally not declared
        // Cortex uses direct Anthropic API calls for better cost control
        // and model selection (Haiku for fast queries, Sonnet for deep reasoning)
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
  // RESOURCE DEFINITIONS
  // ==========================================================================

  const BASE_PATH = path.join(process.env.HOME, '.claude', 'memory');

  /**
   * Dynamically discover available memory resources
   * @returns {Array<{uri: string, name: string, description: string, mimeType: string}>}
   */
  function getAvailableResources() {
    const resources = [];

    // Memory layers
    const memoryDir = path.join(BASE_PATH, 'data', 'memories');
    if (fs.existsSync(memoryDir)) {
      const memoryFiles = [
        { file: 'working.jsonl', name: 'Working Memory', desc: 'Current session context and active tasks' },
        { file: 'short-term.jsonl', name: 'Short-Term Memory', desc: 'Recent session history (last 7 days)' },
        { file: 'long-term.jsonl', name: 'Long-Term Memory', desc: 'Consolidated insights and patterns' },
      ];
      for (const { file, name, desc } of memoryFiles) {
        const filePath = path.join(memoryDir, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          const sizeKb = Math.round(stats.size / 1024);
          resources.push({
            uri: `cortex://memories/${file.replace('.jsonl', '')}`,
            name,
            description: `${desc} (${sizeKb}KB)`,
            mimeType: 'application/jsonl'
          });
        }
      }
    }

    // Pattern library
    const patternsDir = path.join(BASE_PATH, 'data', 'patterns');
    if (fs.existsSync(patternsDir)) {
      const patternFiles = [
        { file: 'decisions.jsonl', name: 'Decision Patterns', desc: 'Historical decisions and their outcomes' },
        { file: 'outcomes.jsonl', name: 'Outcome Patterns', desc: 'Tracked outcomes for pattern learning' },
      ];
      for (const { file, name, desc } of patternFiles) {
        const filePath = path.join(patternsDir, file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          const sizeKb = Math.round(stats.size / 1024);
          resources.push({
            uri: `cortex://patterns/${file.replace('.jsonl', '')}`,
            name,
            description: `${desc} (${sizeKb}KB)`,
            mimeType: 'application/jsonl'
          });
        }
      }
    }

    // Skills index
    const skillsIndex = path.join(BASE_PATH, 'data', 'skills', 'index.jsonl');
    if (fs.existsSync(skillsIndex)) {
      const stats = fs.statSync(skillsIndex);
      const sizeKb = Math.round(stats.size / 1024);
      resources.push({
        uri: 'cortex://skills/index',
        name: 'Skills Index',
        description: `Learned skills and capabilities (${sizeKb}KB)`,
        mimeType: 'application/jsonl'
      });
    }

    // Project-specific memories (dynamic discovery)
    const projectsDir = path.join(BASE_PATH, 'data', 'projects');
    if (fs.existsSync(projectsDir)) {
      const projectFiles = fs.readdirSync(projectsDir).filter(f => f.endsWith('.jsonl'));
      for (const file of projectFiles.slice(0, 10)) { // Limit to 10 projects
        const filePath = path.join(projectsDir, file);
        const stats = fs.statSync(filePath);
        const sizeKb = Math.round(stats.size / 1024);
        const projectId = file.replace('.jsonl', '');
        resources.push({
          uri: `cortex://projects/${projectId}`,
          name: `Project ${projectId.substring(0, 8)}`,
          description: `Project-specific memories (${sizeKb}KB)`,
          mimeType: 'application/jsonl'
        });
      }
    }

    // Insights and learnings (if they exist from learn operations)
    const insightsFile = path.join(BASE_PATH, 'data', 'memories', 'insights.jsonl');
    if (fs.existsSync(insightsFile)) {
      const stats = fs.statSync(insightsFile);
      const sizeKb = Math.round(stats.size / 1024);
      resources.push({
        uri: 'cortex://memories/insights',
        name: 'Insights',
        description: `Sonnet-generated insights (${sizeKb}KB)`,
        mimeType: 'application/jsonl'
      });
    }

    const learningsFile = path.join(BASE_PATH, 'data', 'memories', 'learnings.jsonl');
    if (fs.existsSync(learningsFile)) {
      const stats = fs.statSync(learningsFile);
      const sizeKb = Math.round(stats.size / 1024);
      resources.push({
        uri: 'cortex://memories/learnings',
        name: 'Learnings',
        description: `Extracted learnings (${sizeKb}KB)`,
        mimeType: 'application/jsonl'
      });
    }

    return resources;
  }

  /**
   * Resolve a resource URI to a file path
   * @param {string} uri - Resource URI (e.g., cortex://memories/long-term)
   * @returns {string|null} - File path or null if not found
   */
  function resolveResourceUri(uri) {
    const match = uri.match(/^cortex:\/\/(\w+)\/(.+)$/);
    if (!match) return null;

    const [, category, id] = match;

    const pathMap = {
      'memories': path.join(BASE_PATH, 'data', 'memories', `${id}.jsonl`),
      'patterns': path.join(BASE_PATH, 'data', 'patterns', `${id}.jsonl`),
      'skills': path.join(BASE_PATH, 'data', 'skills', `${id}.jsonl`),
      'projects': path.join(BASE_PATH, 'data', 'projects', `${id}.jsonl`),
    };

    const filePath = pathMap[category];
    if (filePath && fs.existsSync(filePath)) {
      return filePath;
    }

    return null;
  }

  // ==========================================================================
  // REQUEST HANDLERS
  // ==========================================================================

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // List available resources (memory files)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = getAvailableResources();
    log(`Listing ${resources.length} resources`);
    return { resources };
  });

  // Read a specific resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    log(`Reading resource: ${uri}`);

    const filePath = resolveResourceUri(uri);
    auditLogger.resourceAccess(uri, !!filePath);

    if (!filePath) {
      throw new CortexError('CORTEX_E201', {
        details: `Resource not found: ${uri}`
      });
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse JSONL and provide summary for large files
      const lines = content.trim().split('\n').filter(Boolean);
      let text;

      if (lines.length > 100) {
        // For large files, provide a summary + sample
        const sample = lines.slice(0, 10).map(l => {
          try {
            const obj = JSON.parse(l);
            return JSON.stringify(obj, null, 2);
          } catch {
            return l;
          }
        }).join('\n');

        text = `# Resource: ${uri}\n\n` +
               `**Total entries:** ${lines.length}\n\n` +
               `## Sample (first 10 entries):\n\`\`\`json\n${sample}\n\`\`\`\n\n` +
               `_Use cortex__query to search specific entries._`;
      } else {
        // For small files, return formatted JSON
        const formatted = lines.map(l => {
          try {
            const obj = JSON.parse(l);
            return JSON.stringify(obj, null, 2);
          } catch {
            return l;
          }
        }).join('\n---\n');

        text = `# Resource: ${uri}\n\n**Total entries:** ${lines.length}\n\n\`\`\`json\n${formatted}\n\`\`\``;
      }

      return {
        contents: [{
          uri,
          mimeType: 'text/markdown',
          text
        }]
      };
    } catch (error) {
      throw new CortexError('CORTEX_E201', {
        cause: error,
        details: `Failed to read resource: ${uri}`
      });
    }
  });

  // List resource templates for dynamic resource discovery
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    log('Listing resource templates');

    return {
      resourceTemplates: [
        {
          uriTemplate: 'cortex://memories/{type}',
          name: 'Memory by Type',
          description: 'Access memory by type (working, short-term, long-term, insights, learnings)',
          mimeType: 'application/jsonl'
        },
        {
          uriTemplate: 'cortex://patterns/{type}',
          name: 'Pattern by Type',
          description: 'Access patterns by type (decisions, outcomes)',
          mimeType: 'application/jsonl'
        },
        {
          uriTemplate: 'cortex://skills/{name}',
          name: 'Skill by Name',
          description: 'Access skill data by name',
          mimeType: 'application/jsonl'
        },
        {
          uriTemplate: 'cortex://projects/{projectId}',
          name: 'Project Memory',
          description: 'Access project-specific memories by project hash',
          mimeType: 'application/jsonl'
        }
      ]
    };
  });

  // ==========================================================================
  // PROMPT DEFINITIONS
  // ==========================================================================

  const PROMPTS = [
    {
      name: 'weekly-review',
      description: 'Summarize the week\'s learnings and identify patterns across all sessions',
      arguments: [
        {
          name: 'focus',
          description: 'Optional focus area (e.g., "debugging", "architecture")',
          required: false
        }
      ]
    },
    {
      name: 'debug-checklist',
      description: 'Pre-debugging memory check - recall relevant past solutions before starting',
      arguments: [
        {
          name: 'error',
          description: 'The error or problem you\'re debugging',
          required: true
        },
        {
          name: 'context',
          description: 'Additional context about the codebase or situation',
          required: false
        }
      ]
    },
    {
      name: 'session-summary',
      description: 'Generate a summary of the current session for future reference',
      arguments: [
        {
          name: 'accomplishments',
          description: 'What was accomplished this session',
          required: false
        }
      ]
    },
    {
      name: 'pattern-analysis',
      description: 'Analyze recurring patterns across your memories and sessions',
      arguments: [
        {
          name: 'domain',
          description: 'Domain to focus on (e.g., "testing", "auth", "performance")',
          required: false
        },
        {
          name: 'depth',
          description: 'Analysis depth: quick, moderate, or deep',
          required: false
        }
      ]
    },
    {
      name: 'project-context',
      description: 'Load all relevant context for the current project',
      arguments: [
        {
          name: 'projectPath',
          description: 'Path to the project (defaults to current directory)',
          required: false
        }
      ]
    }
  ];

  /**
   * Generate prompt content based on template and arguments
   * @param {string} name - Prompt name
   * @param {Object} args - Prompt arguments
   * @returns {Array<{role: string, content: {type: string, text: string}}>}
   */
  function generatePromptContent(name, args = {}) {
    switch (name) {
      case 'weekly-review':
        return [{
          role: 'user',
          content: {
            type: 'text',
            text: `Please provide a weekly review of my Cortex memories.

${args.focus ? `Focus area: ${args.focus}` : ''}

Instructions:
1. Use cortex__query to search for memories from the past 7 days
2. Use cortex__reflect with depth "deep" to analyze patterns
3. Identify:
   - Key learnings and insights
   - Recurring challenges or themes
   - Successful approaches worth repeating
   - Areas needing improvement
4. Provide actionable recommendations for next week

Format your response with clear sections and bullet points.`
          }
        }];

      case 'debug-checklist':
        return [{
          role: 'user',
          content: {
            type: 'text',
            text: `Before debugging, let me check my memory for relevant context.

**Error/Problem:** ${args.error || 'Not specified'}
${args.context ? `**Additional Context:** ${args.context}` : ''}

Instructions:
1. Use cortex__query to search for similar errors or problems I've encountered
2. Use cortex__recall with context "${args.error}" to find relevant past solutions
3. Check patterns using cortex__query for "debugging ${args.error}"
4. Summarize:
   - Similar issues I've seen before
   - What worked previously
   - What to try first
   - What to avoid

This pre-debugging check helps avoid reinventing solutions.`
          }
        }];

      case 'session-summary':
        return [{
          role: 'user',
          content: {
            type: 'text',
            text: `Please summarize this session for future reference.

${args.accomplishments ? `**Accomplishments:** ${args.accomplishments}` : ''}

Instructions:
1. Summarize the key tasks completed
2. Identify any insights worth preserving with cortex__learn
3. Note any unfinished work or TODOs
4. Capture any decisions made and their rationale
5. Extract patterns that might be useful later

This summary helps maintain continuity across sessions.`
          }
        }];

      case 'pattern-analysis':
        return [{
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze recurring patterns in my Cortex memories.

${args.domain ? `**Domain Focus:** ${args.domain}` : ''}
**Analysis Depth:** ${args.depth || 'moderate'}

Instructions:
1. Use cortex__query to gather memories ${args.domain ? `related to "${args.domain}"` : 'across all domains'}
2. Use cortex__reflect with depth "${args.depth || 'moderate'}" to analyze:
   - What approaches keep working
   - What approaches keep failing
   - Common root causes of issues
   - Opportunities for improvement
3. Use cortex__infer to find non-obvious connections
4. Provide actionable insights

Pattern analysis helps compound learnings over time.`
          }
        }];

      case 'project-context':
        return [{
          role: 'user',
          content: {
            type: 'text',
            text: `Load all relevant Cortex context for this project.

${args.projectPath ? `**Project Path:** ${args.projectPath}` : '**Project:** Current directory'}

Instructions:
1. Use cortex__recall with the project context to find project-specific memories
2. Use cortex__query to search for related patterns and decisions
3. Summarize:
   - Key decisions made for this project
   - Patterns that apply to this codebase
   - Past issues and their solutions
   - Important context for continuing work

This provides a comprehensive project briefing.`
          }
        }];

      default:
        return [{
          role: 'user',
          content: {
            type: 'text',
            text: `Unknown prompt: ${name}`
          }
        }];
    }
  }

  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    log(`Listing ${PROMPTS.length} prompts`);
    return { prompts: PROMPTS };
  });

  // Get a specific prompt with filled arguments
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Getting prompt: ${name}`);
    auditLogger.promptAccess(name, args);

    const prompt = PROMPTS.find(p => p.name === name);
    if (!prompt) {
      throw new CortexError('CORTEX_E202', {
        details: `Unknown prompt: ${name}`
      });
    }

    // Validate required arguments
    for (const arg of prompt.arguments || []) {
      if (arg.required && !args?.[arg.name]) {
        throw new CortexError('CORTEX_E200', {
          details: `Missing required argument: ${arg.name}`
        });
      }
    }

    const messages = generatePromptContent(name, args || {});

    return {
      description: prompt.description,
      messages
    };
  });

  // Handle tool calls with progress tracking
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startTime = Date.now();

    // Get tool info for progress tracking
    const toolInfo = TOOL_MODELS[name] || { model: 'Unknown', estimatedMs: 1000 };

    log(`Tool call: ${name} (${toolInfo.model})`);

    // Start audit logging for this call
    const callId = auditLogger.toolCallStart(name, args);

    // Check rate limits before proceeding
    const rateLimitCheck = rateLimiter.check(name);
    if (!rateLimitCheck.allowed) {
      log(`Rate limit: ${rateLimitCheck.reason}`);
      auditLogger.rateLimitHit(name, rateLimitCheck.reason, rateLimitCheck.retryAfter);
      const errorCode = rateLimitCheck.retryAfter > 3600 ? 'CORTEX_E312' :
                        rateLimitCheck.retryAfter > 60 ? 'CORTEX_E311' : 'CORTEX_E310';
      const error = new CortexError(errorCode, {
        details: `${rateLimitCheck.reason}. Retry after ${rateLimitCheck.retryAfter}s`
      });
      auditLogger.toolCallError(callId, errorCode, rateLimitCheck.reason, Date.now() - startTime);
      return {
        content: [{
          type: 'text',
          text: error.toDisplayString()
        }],
        isError: true
      };
    }

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
      let validatedArgs;

      // Validate and sanitize inputs before processing
      try {
        switch (name) {
          case 'cortex__query':
            validatedArgs = validateQueryArgs(args);
            break;
          case 'cortex__recall':
            validatedArgs = validateRecallArgs(args);
            break;
          case 'cortex__reflect':
            validatedArgs = validateReflectArgs(args);
            break;
          case 'cortex__infer':
            validatedArgs = validateInferArgs(args);
            break;
          case 'cortex__learn':
            validatedArgs = validateLearnArgs(args);
            break;
          case 'cortex__consolidate':
            validatedArgs = validateConsolidateArgs(args);
            break;
          default:
            throw new CortexError('CORTEX_E202', { details: name });
        }
      } catch (validationError) {
        if (validationError instanceof ValidationError) {
          auditLogger.validationFailure(name, 'input', validationError.message);
          throw new CortexError('CORTEX_E200', {
            details: validationError.message
          });
        }
        throw validationError;
      }

      switch (name) {
        // Haiku-powered tools
        case 'cortex__query':
          result = await haiku.query(validatedArgs.query, validatedArgs.sources, validatedArgs.limit);
          break;

        case 'cortex__recall':
          result = await haiku.recall(validatedArgs.context, validatedArgs.type);
          break;

        // Sonnet-powered tools
        case 'cortex__reflect':
          result = await sonnet.reflect(validatedArgs.topic, validatedArgs.depth);
          break;

        case 'cortex__infer':
          result = await sonnet.infer(validatedArgs.concepts, validatedArgs.includeMemories);
          break;

        case 'cortex__learn':
          result = await sonnet.learn(validatedArgs.insight, validatedArgs.context, validatedArgs.type, validatedArgs.tags);
          break;

        case 'cortex__consolidate':
          result = await sonnet.consolidate(validatedArgs.scope, validatedArgs.type, validatedArgs.dryRun);
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

      // Record successful call for rate limiting
      rateLimiter.record(name);

      // Log successful completion
      const duration = Date.now() - startTime;
      auditLogger.toolCallEnd(callId, true, duration, {
        model: toolInfo.model,
        resultSize: typeof result === 'string' ? result.length : JSON.stringify(result).length,
      });

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

      // Log the error
      const duration = Date.now() - startTime;
      auditLogger.toolCallError(callId, cortexError.code, cortexError.message, duration);

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
