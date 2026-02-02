# Cortex API Reference

> Complete documentation for all Cortex MCP tools, adapters, CLI commands, and configuration options.

**Version**: 2.0.0
**Last Updated**: 2026-02-02

---

## Table of Contents

- [MCP Tools](#mcp-tools)
  - [cortex__query](#cortex__query)
  - [cortex__recall](#cortex__recall)
  - [cortex__reflect](#cortex__reflect)
  - [cortex__infer](#cortex__infer)
  - [cortex__learn](#cortex__learn)
  - [cortex__consolidate](#cortex__consolidate)
- [MCP Resources](#mcp-resources)
- [MCP Prompts](#mcp-prompts)
- [Memory Adapters](#memory-adapters)
- [CLI Commands](#cli-commands)
- [Environment Variables](#environment-variables)
- [Error Codes](#error-codes)
- [Configuration Reference](#configuration-reference)

---

## MCP Tools

Cortex exposes 6 MCP tools organized by their underlying model:

| Tool | Model | Typical Latency | Typical Cost |
|------|-------|-----------------|--------------|
| `cortex__query` | Haiku | ~500ms | ~$0.001 |
| `cortex__recall` | Haiku | ~300ms | ~$0.001 |
| `cortex__reflect` | Sonnet | 2-3s | ~$0.01 |
| `cortex__infer` | Sonnet | 2-3s | ~$0.01 |
| `cortex__learn` | Sonnet | 2-3s | ~$0.01 |
| `cortex__consolidate` | Sonnet | 3-5s | ~$0.02 |

---

### cortex__query

**Description**: Search all memory sources for relevant context. Uses Haiku for fast, efficient queries across episodic memory, knowledge graph, JSONL files, and CLAUDE.md.

**Model**: Claude 3.5 Haiku (~$0.25/1M tokens)

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Natural language query to search memories |
| `sources` | array | No | `["all"]` | Which memory sources to search |
| `limit` | number | No | `10` | Maximum number of results (1-100) |

**Valid sources**:
- `"all"` - Query all available sources
- `"episodic"` - Episodic memory (conversation history)
- `"knowledge-graph"` - Knowledge graph entities and relations
- `"jsonl"` - Local JSONL memory files
- `"claudemd"` - CLAUDE.md files

#### Example Request

```json
{
  "name": "cortex__query",
  "arguments": {
    "query": "authentication patterns for JWT",
    "sources": ["episodic", "jsonl"],
    "limit": 5
  }
}
```

#### Example Response

```json
{
  "query": "authentication patterns for JWT",
  "analysis": {
    "keywords": ["authentication", "JWT", "patterns"],
    "intent": "implementing",
    "criteria": "Results about JWT authentication implementation"
  },
  "memories": [
    {
      "id": "mem_abc123",
      "type": "pattern",
      "content": "Always validate JWT expiry before checking claims...",
      "relevanceScore": 92,
      "_source": "jsonl"
    }
  ],
  "sources": ["jsonl", "episodic"],
  "stats": {
    "totalFound": 12,
    "returned": 5,
    "duration": 487,
    "haikuCalls": 2
  }
}
```

#### Validation Rules

- `query`: Required, max 10,000 characters
- `sources`: Max 5 items, must be valid source names
- `limit`: Integer between 1 and 100

---

### cortex__recall

**Description**: Retrieve specific memories by context. Uses Haiku to find exact matches or closely related memories.

**Model**: Claude 3.5 Haiku (~$0.25/1M tokens)

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `context` | string | Yes | - | Context to match (e.g., "debugging auth issues") |
| `type` | string | No | `"any"` | Type of memory to recall |

**Valid types**:
- `"any"` - Match any memory type
- `"skill"` - Learned skills and capabilities
- `"pattern"` - Recurring patterns and solutions
- `"decision"` - Historical decisions and rationale
- `"insight"` - Extracted insights and learnings

#### Example Request

```json
{
  "name": "cortex__recall",
  "arguments": {
    "context": "fixing React useEffect cleanup issues",
    "type": "pattern"
  }
}
```

#### Example Response

```json
{
  "context": "fixing React useEffect cleanup issues",
  "type": "pattern",
  "analysis": {
    "seeking": "React useEffect cleanup patterns",
    "related": ["memory leaks", "component unmount", "async cleanup"],
    "timeFrame": "any"
  },
  "memories": [
    {
      "id": "mem_xyz789",
      "type": "pattern",
      "content": "Always return a cleanup function from useEffect when using subscriptions or timers...",
      "_source": "long-term"
    }
  ],
  "stats": {
    "searched": 45,
    "matched": 3,
    "duration": 312
  }
}
```

#### Validation Rules

- `context`: Required, max 5,000 characters
- `type`: Must be one of: `skill`, `pattern`, `decision`, `insight`, `any`

---

### cortex__reflect

**Description**: Deep reflection on the current session or topic. Uses Sonnet for meta-cognitive analysis, pattern recognition, and insight generation.

**Model**: Claude Sonnet 4 (~$3/1M input, ~$15/1M output tokens)

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `topic` | string | Yes | - | What to reflect on |
| `depth` | string | No | `"moderate"` | How deep to reflect |

**Depth levels**:
- `"quick"` - 2-3 key observations, ~512 tokens
- `"moderate"` - Balanced analysis with examples, ~1024 tokens
- `"deep"` - Thorough exploration of patterns, ~2048 tokens

#### Example Request

```json
{
  "name": "cortex__reflect",
  "arguments": {
    "topic": "my debugging approach for async code",
    "depth": "deep"
  }
}
```

#### Example Response

```json
{
  "topic": "my debugging approach for async code",
  "depth": "deep",
  "reflection": "## Patterns Observed\n\nYour async debugging shows several consistent patterns:\n\n1. **Promise chain inspection** - You frequently add `.catch()` blocks to identify where errors originate...\n\n2. **Race condition awareness** - Multiple instances show you checking for timing issues...\n\n## Recommendations\n\n- Consider using async/await with try-catch more consistently...",
  "memoriesConsidered": 8,
  "stats": {
    "duration": 2847,
    "maxTokens": 2048
  },
  "cost": {
    "session": "~$0.0142",
    "note": "Use /cortex stats to see detailed cost breakdown"
  }
}
```

#### Validation Rules

- `topic`: Required, max 1,000 characters
- `depth`: Must be one of: `quick`, `moderate`, `deep`

---

### cortex__infer

**Description**: Reason about connections between concepts or memories. Uses Sonnet to find non-obvious relationships and generate insights.

**Model**: Claude Sonnet 4 (~$3/1M input, ~$15/1M output tokens)

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `concepts` | array | Yes | - | Concepts to find connections between (2-10 items) |
| `includeMemories` | boolean | No | `true` | Include stored memories in reasoning |

#### Example Request

```json
{
  "name": "cortex__infer",
  "arguments": {
    "concepts": ["microservices", "event sourcing", "CQRS"],
    "includeMemories": true
  }
}
```

#### Example Response

```json
{
  "concepts": ["microservices", "event sourcing", "CQRS"],
  "inference": "## Connections Found\n\n### Strong Connections (High Confidence)\n\n1. **CQRS enables event sourcing in microservices** - Event sourcing provides the write model while CQRS separates read optimization...\n\n### Implications\n\n- Your past work on the order service could benefit from...",
  "memoriesUsed": true,
  "stats": {
    "duration": 2341
  },
  "cost": {
    "session": "~$0.0089"
  }
}
```

#### Validation Rules

- `concepts`: Required, array with 2-10 items, each max 1,000 characters
- `includeMemories`: Boolean value

---

### cortex__learn

**Description**: Extract and store an insight or learning. Uses Sonnet to analyze the insight quality and determine optimal storage.

**Model**: Claude Sonnet 4 (~$3/1M input, ~$15/1M output tokens)

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `insight` | string | Yes | - | The insight or learning to store |
| `context` | string | No | `""` | Context where this insight applies |
| `type` | string | No | `"general"` | Type of learning |
| `tags` | array | No | `[]` | Tags for categorization |

**Valid types**:
- `"skill"` - A learned capability or technique
- `"pattern"` - A recurring solution pattern
- `"decision"` - A decision with rationale
- `"general"` - General insight

#### Example Request

```json
{
  "name": "cortex__learn",
  "arguments": {
    "insight": "When debugging React state issues, always check if the component is re-rendering unnecessarily by adding console.log in the component body, not just in useEffect",
    "context": "React debugging",
    "type": "pattern",
    "tags": ["react", "debugging", "performance"]
  }
}
```

#### Example Response

```json
{
  "insight": "When debugging React state issues...",
  "analysis": {
    "quality": 8,
    "value": "Provides actionable debugging technique with clear context",
    "suggestedTags": ["react", "debugging", "state-management", "console-debugging"],
    "isDuplicate": false,
    "priority": "high",
    "enhancedInsight": "When debugging React state issues, check for unnecessary re-renders by placing console.log statements in the component body (not just useEffect). This reveals renders triggered by parent components or context changes."
  },
  "stored": true,
  "stats": {
    "duration": 2156
  }
}
```

#### Validation Rules

- `insight`: Required, max 50,000 characters
- `context`: Optional, max 5,000 characters
- `type`: Must be one of: `skill`, `pattern`, `decision`, `general`
- `tags`: Max 20 items, each max 100 characters, alphanumeric with underscores/hyphens/colons

#### Quality Gating

Insights are only stored if:
- Quality score >= 4 (out of 10)
- Not detected as duplicate

Low-quality insights return `"stored": false` with the analysis showing why.

---

### cortex__consolidate

**Description**: Merge, deduplicate, or reorganize memories. Uses Sonnet to intelligently combine related memories and remove redundancy.

**Model**: Claude Sonnet 4 (~$3/1M input, ~$15/1M output tokens)

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `scope` | string | No | `"recent"` | Scope of consolidation |
| `type` | string | Conditional | - | Required if scope is "type" |
| `dryRun` | boolean | No | `false` | Preview changes without applying |

**Scope options**:
- `"recent"` - Memories from last 7 days
- `"type"` - All memories of a specific type (requires `type` parameter)
- `"all"` - All memories

#### Example Request

```json
{
  "name": "cortex__consolidate",
  "arguments": {
    "scope": "type",
    "type": "pattern",
    "dryRun": true
  }
}
```

#### Example Response

```json
{
  "scope": "type",
  "type": "pattern",
  "dryRun": true,
  "analysis": {
    "duplicates": [
      {
        "ids": ["mem_001", "mem_002"],
        "reason": "Both describe JWT validation approach"
      }
    ],
    "merges": [
      {
        "ids": ["mem_003", "mem_004"],
        "mergedContent": "Combined React debugging pattern...",
        "reason": "Related useEffect patterns"
      }
    ],
    "outdated": [
      {
        "id": "mem_005",
        "reason": "Superseded by newer async/await pattern"
      }
    ],
    "summary": "Found 2 duplicate pairs, 1 merge opportunity, 1 outdated entry"
  },
  "applied": null,
  "stats": {
    "memoriesAnalyzed": 28,
    "duration": 4521
  }
}
```

#### Validation Rules

- `scope`: Must be one of: `recent`, `type`, `all`
- `type`: Required when scope is `type`, must be one of: `skill`, `pattern`, `decision`, `insight`
- `dryRun`: Boolean value

---

## MCP Resources

Cortex exposes memory stores as MCP Resources for direct browsing.

### Available Resources

| URI | Name | Description |
|-----|------|-------------|
| `cortex://memories/working` | Working Memory | Current session context |
| `cortex://memories/short-term` | Short-Term Memory | Last 7 days |
| `cortex://memories/long-term` | Long-Term Memory | Consolidated insights |
| `cortex://memories/insights` | Insights | Sonnet-generated insights |
| `cortex://memories/learnings` | Learnings | Extracted learnings |
| `cortex://patterns/decisions` | Decision Patterns | Historical decisions |
| `cortex://patterns/outcomes` | Outcome Patterns | Tracked outcomes |
| `cortex://skills/index` | Skills Index | Learned capabilities |
| `cortex://projects/{id}` | Project Memory | Project-specific memories |

### Resource Templates

| Template | Description |
|----------|-------------|
| `cortex://memories/{type}` | Access by memory type |
| `cortex://patterns/{type}` | Access by pattern type |
| `cortex://skills/{name}` | Access by skill name |
| `cortex://projects/{projectId}` | Access by project hash |

### Reading Resources

Resources return formatted markdown for small files (<100 entries) or a summary with samples for large files.

```javascript
// Example: Read long-term memory
const response = await client.readResource({
  uri: 'cortex://memories/long-term'
});
// Returns: { contents: [{ uri, mimeType: 'text/markdown', text: '...' }] }
```

---

## MCP Prompts

Cortex provides reusable prompt templates for common cognitive tasks.

### Available Prompts

| Prompt | Description | Required Args | Optional Args |
|--------|-------------|---------------|---------------|
| `weekly-review` | Summarize week's learnings | - | `focus` |
| `debug-checklist` | Pre-debugging memory check | `error` | `context` |
| `session-summary` | Generate session summary | - | `accomplishments` |
| `pattern-analysis` | Analyze recurring patterns | - | `domain`, `depth` |
| `project-context` | Load project context | - | `projectPath` |

### Example: debug-checklist

```javascript
const prompt = await client.getPrompt({
  name: 'debug-checklist',
  arguments: {
    error: 'Cannot read property map of undefined',
    context: 'React component rendering'
  }
});
```

Returns a structured prompt that guides Claude through:
1. Searching for similar past errors
2. Recalling relevant solutions
3. Checking patterns for this error type
4. Summarizing what worked before

---

## Memory Adapters

Cortex uses a pluggable adapter system to query multiple memory sources.

### Built-in Adapters

| Adapter | Type | Description | Default State |
|---------|------|-------------|---------------|
| `JSONLAdapter` | File-based | Local JSONL memory files | Enabled |
| `EpisodicMemoryAdapter` | MCP-based | Conversation history | Enabled |
| `KnowledgeGraphAdapter` | MCP-based | Entity-relation graph | Enabled |
| `ClaudeMdAdapter` | File-based | CLAUDE.md files | Enabled |
| `GeminiAdapter` | File-based | Gemini brain sessions | Enabled |
| `WarpSQLiteAdapter` | SQLite | Warp Terminal AI history | Enabled |
| `VectorSearchAdapter` | Hybrid | Semantic + BM25 search | Enabled |

### Adapter Configuration

```javascript
const { createDefaultRegistry } = require('./adapters/index.cjs');

const registry = createDefaultRegistry({
  basePath: '~/.claude/memory',
  adapters: {
    jsonl: {
      sources: [
        { name: 'working', path: 'data/memories/working.jsonl', maxAge: 86400000 },
        { name: 'long-term', path: 'data/memories/long-term.jsonl' },
      ]
    },
    episodicMemory: {
      enabled: true,
      maxResults: 20,
      searchMode: 'both'  // 'vector' | 'text' | 'both'
    },
    knowledgeGraph: {
      enabled: true,
      maxResults: 50
    },
    vector: {
      enabled: true,
      vectorWeight: 0.6,
      bm25Weight: 0.4,
      minScore: 0.1
    }
  }
});
```

### Custom Adapter Implementation

```javascript
const { BaseAdapter } = require('./adapters/base-adapter.cjs');

class MyAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: 'my-adapter',
      enabled: options.enabled ?? true,
      priority: options.priority ?? 0.5,
      timeout: options.timeout ?? 5000,
    });
  }

  async query(context, options = {}) {
    // Implement query logic
    // Return array of MemoryRecord objects
    return [];
  }

  async getStats() {
    return {
      name: this.name,
      available: true,
      totalRecords: 0,
      lastQueryTime: 0,
      cacheHitRate: 0,
      errorCount: 0,
    };
  }
}
```

---

## CLI Commands

The `cmo` CLI provides command-line access to Cortex functionality.

### Available Commands

| Command | Description |
|---------|-------------|
| `cmo status` | Show installation and configuration status |
| `cmo search <query>` | Search memories across local sources |
| `cmo adapters` | List configured memory adapters |
| `cmo bootstrap` | Initialize Cortex |
| `cmo install` | Register hooks in Claude Code settings |
| `cmo uninstall` | Remove hooks from Claude Code settings |
| `cmo test` | Run all tests |
| `cmo help` | Show help message |

### Search Options

```bash
cmo search <query> [options]

Options:
  --type <type>     Filter by type (learning, pattern, preference, skill, correction)
  --source <src>    Filter by source (jsonl, claudemd, episodic-memory, knowledge-graph)
  --limit <n>       Maximum results (default: 20)
  --format <fmt>    Output format: table, json, plain (default: table)

Examples:
  cmo search "git error"                    # Search all sources
  cmo search "docker" --type pattern        # Find docker patterns
  cmo search "fix" --source claudemd        # Search only CLAUDE.md
  cmo search "sync" --format json           # Output as JSON
```

### Bootstrap Options

```bash
cmo bootstrap [options]

Options:
  --seed            Populate initial memories from CLAUDE.md
  --force           Overwrite existing configuration
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Anthropic API key for Haiku/Sonnet calls |
| `CORTEX_RATE_LIMIT` | No | `true` | Enable/disable rate limiting |
| `CORTEX_AUDIT` | No | `true` | Enable/disable audit logging |
| `CORTEX_LOG_LEVEL` | No | `INFO` | Log level: DEBUG, INFO, WARN, ERROR |
| `CORTEX_AUDIT_CONSOLE` | No | `false` | Echo audit logs to stderr |
| `CORTEX_ENCRYPTION_SECRET` | No | - | Base64 encryption key for at-rest encryption |

### Setting Environment Variables

```bash
# Linux/macOS
export ANTHROPIC_API_KEY="sk-ant-..."
export CORTEX_LOG_LEVEL="DEBUG"

# Windows PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:CORTEX_LOG_LEVEL = "DEBUG"
```

---

## Error Codes

Cortex uses structured error codes for troubleshooting.

### Error Code Ranges

| Range | Category | Description |
|-------|----------|-------------|
| E001-E099 | API | Anthropic API errors |
| E100-E199 | Memory | Memory file operations |
| E200-E299 | Tool | Tool execution errors |
| E300-E309 | Config | Configuration errors |
| E310-E319 | Rate Limit | Rate limiting errors |
| E400-E499 | Quality | Quality gating errors |
| E500-E509 | Encryption | Encryption errors |
| E900-E999 | System | Internal system errors |

### Common Error Codes

| Code | Message | Suggestion |
|------|---------|------------|
| `CORTEX_E001` | API key not configured | Set ANTHROPIC_API_KEY environment variable |
| `CORTEX_E002` | API rate limit exceeded | Wait and retry, or reduce request frequency |
| `CORTEX_E100` | Memory file not found | Run `/cortex health` to check installation |
| `CORTEX_E200` | Invalid tool arguments | Check parameters, run `/cortex help` |
| `CORTEX_E310` | Rate limit exceeded | Wait for cooldown period |
| `CORTEX_E400` | Low quality insight rejected | Provide more specific, actionable knowledge |
| `CORTEX_E900` | Internal error | Check logs at ~/.claude/memory/logs/ |

### Error Response Format

```json
{
  "error": true,
  "code": "CORTEX_E200",
  "message": "Invalid tool arguments",
  "category": "tool",
  "suggestion": "Check the tool parameters. Run `/cortex help` for usage examples.",
  "details": "query field is required",
  "timestamp": "2026-02-02T12:00:00Z"
}
```

---

## Configuration Reference

Configuration is stored in `~/.claude/memory/data/configs/current.json`.

### Full Configuration Schema

```json
{
  "version": "2.0.0",
  "sessionStart": {
    "slots": {
      "maxTotal": 5,
      "skills": 2,
      "workingMemory": 2,
      "patterns": 1
    },
    "relevanceThreshold": 0.3
  },
  "sessionEnd": {
    "qualityThreshold": 0.4,
    "maxExtractionsPerSession": 10
  },
  "ladsCore": {
    "evolutionEnabled": true,
    "evolutionInterval": 86400000,
    "minSamplesForEvolution": 10
  }
}
```

### Configuration Options

| Path | Type | Default | Description |
|------|------|---------|-------------|
| `sessionStart.slots.maxTotal` | number | 5 | Max memories injected at session start |
| `sessionStart.slots.skills` | number | 2 | Skill memory slots |
| `sessionStart.slots.workingMemory` | number | 2 | Working memory slots |
| `sessionStart.slots.patterns` | number | 1 | Pattern memory slots |
| `sessionStart.relevanceThreshold` | number | 0.3 | Minimum relevance score (0-1) |
| `sessionEnd.qualityThreshold` | number | 0.4 | Minimum quality for extraction |
| `sessionEnd.maxExtractionsPerSession` | number | 10 | Max learnings extracted per session |
| `ladsCore.evolutionEnabled` | boolean | true | Enable config auto-tuning |
| `ladsCore.evolutionInterval` | number | 86400000 | Evolution interval (ms) |
| `ladsCore.minSamplesForEvolution` | number | 10 | Min samples before evolving |

### Rate Limiter Defaults

| Tool Type | Per Minute | Per Hour | Per Day |
|-----------|------------|----------|---------|
| Haiku (query, recall) | 30 | 300 | 1,000 |
| Sonnet (reflect, infer, learn) | 10-15 | 60-100 | 200-300 |
| Sonnet (consolidate) | 5 | 20 | 50 |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-02-02 | Added vector search, 7 adapters, security hardening |
| 1.0.0 | 2026-01-27 | Initial release with 6 MCP tools |

---

## See Also

- [README.md](../README.md) - Overview and quick start
- [QUICKSTART.md](../QUICKSTART.md) - 2-minute setup guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [SECURITY.md](SECURITY.md) - Security guide
- [EXAMPLES.md](EXAMPLES.md) - Usage examples
