# Cortex Architecture

This document describes the architecture of Cortex, Claude's cognitive layer, and how it may evolve with future MCP capabilities.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLAUDE CODE CLIENT                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐ │
│  │   Skills    │   │   Hooks     │   │ MCP Server  │   │   Claude    │ │
│  │ /cortex ... │   │ SessionEnd  │   │   (stdio)   │   │   API       │ │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘ │
│         │                 │                 │                 ▲        │
│         │                 │                 │                 │        │
│         ▼                 ▼                 ▼                 │        │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │                    CORTEX MCP SERVER                         │      │
│  │                                                              │      │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │      │
│  │  │ HaikuWorker  │  │SonnetThinker │  │  Validation  │       │      │
│  │  │ query/recall │  │reflect/infer │  │  + Security  │       │      │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │      │
│  │         │                 │                                  │      │
│  │         ▼                 ▼                                  │      │
│  │  ┌─────────────────────────────────────────────────────┐    │      │
│  │  │              ANTHROPIC API (via SDK)                 │────┼──────┘
│  │  │         Haiku (~$0.25/1M) │ Sonnet (~$3/1M)          │    │
│  │  └─────────────────────────────────────────────────────┘    │
│  │         │                                                    │
│  │         ▼                                                    │
│  │  ┌─────────────────────────────────────────────────────┐    │
│  │  │              JSONL STORAGE                           │    │
│  │  │  data/memories/ │ data/patterns/ │ data/skills/      │    │
│  │  └─────────────────────────────────────────────────────┘    │
│  │                                                              │
│  └──────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. MCP Server (`cortex/server.cjs`)

The central hub that handles all MCP protocol communications:

| Capability | Handler | Description |
|------------|---------|-------------|
| `tools` | CallToolRequestSchema | Execute memory operations |
| `resources` | ReadResourceRequestSchema | Browse memory files |
| `prompts` | GetPromptRequestSchema | Predefined workflows |

### 2. Dual-Model Workers

**HaikuWorker** (`cortex/haiku-worker.cjs`)
- Fast, cheap queries (~$0.25/1M tokens)
- Tools: `cortex__query`, `cortex__recall`
- Latency: ~500ms

**SonnetThinker** (`cortex/sonnet-thinker.cjs`)
- Deep reasoning (~$3/1M tokens)
- Tools: `cortex__reflect`, `cortex__infer`, `cortex__learn`, `cortex__consolidate`
- Latency: 2-5 seconds

### 3. Security Layer (`core/`)

| Module | Purpose |
|--------|---------|
| `validation.cjs` | Input sanitization, type checking |
| `rate-limiter.cjs` | Cost protection, sliding window limits |
| `audit-logger.cjs` | Accountability, JSONL logs |
| `encryption.cjs` | AES-256-GCM at-rest encryption |
| `errors.cjs` | Structured error codes |

### 4. Storage Layer (`data/`)

```
data/
├── memories/
│   ├── working.jsonl      # Current session
│   ├── short-term.jsonl   # Last 7 days
│   └── long-term.jsonl    # Consolidated insights
├── patterns/
│   ├── decisions.jsonl    # Decision history
│   └── outcomes.jsonl     # Outcome tracking
├── skills/
│   └── index.jsonl        # Learned capabilities
└── projects/
    └── {hash}.jsonl       # Per-project memories
```

## Data Flow

### Query Flow
```
1. Client sends tool call → server.cjs
2. Rate limiter check → pass/fail
3. Input validation → sanitize args
4. HaikuWorker.query() → search memories
5. Anthropic API call → Haiku model
6. Parse results → filter by relevance
7. Audit log → record call
8. Return results → client
```

### Learn Flow
```
1. Client sends tool call → server.cjs
2. Rate limiter check → pass/fail
3. Input validation → sanitize args
4. SonnetThinker.learn() → analyze insight
5. Anthropic API call → Sonnet model
6. Quality check → reject if low quality
7. Store to JSONL → append entry
8. Audit log → record call
9. Return confirmation → client
```

## MCP Protocol Compliance

### Currently Implemented

| Capability | Status | Notes |
|------------|--------|-------|
| Tools | ✅ Full | 6 tools with schemas |
| Resources | ✅ Full | Dynamic discovery, templates |
| Prompts | ✅ Full | 5 predefined workflows |
| Sampling | ⏭️ Direct API | Uses Anthropic API instead |
| Elicitation | ⏳ Deferred | Requires client support |

### Why Direct API Over Sampling

Cortex uses direct Anthropic API calls instead of MCP Sampling for:

1. **Cost Control**: Select between Haiku and Sonnet per-operation
2. **Latency**: Direct calls avoid MCP client overhead
3. **Flexibility**: Full control over prompts and parameters

## Future MCP Features

### MCP Apps (Anticipated 2026)

MCP Apps will enable rich UI components beyond text responses.

**Potential Cortex UI Components:**
- Memory browser with search/filter
- Visual timeline of learnings
- Pattern graph visualization
- Cost dashboard

**Design Approach:**
```javascript
// Future: Return UI component instead of text
return {
  type: 'app',
  component: 'cortex-memory-browser',
  props: {
    memories: results,
    filters: { type: 'skill', date: 'last-week' }
  }
};
```

### OAuth 2.0 (RFC 8707)

For multi-user or cloud deployment scenarios:

**Resource Indicators:**
- `cortex://memories/*` - User's memory files
- `cortex://settings/*` - User preferences
- `cortex://admin/*` - Administrative functions

**Scopes:**
- `memory:read` - Read memories
- `memory:write` - Store new memories
- `memory:delete` - Remove memories
- `admin:*` - Full administrative access

### Elicitation

When client support is available:

```javascript
// Ask user for clarification
const response = await client.elicit({
  question: "Multiple memories match 'auth'. Which did you mean?",
  options: [
    { id: '1', label: 'JWT authentication patterns' },
    { id: '2', label: 'OAuth integration notes' },
    { id: '3', label: 'All auth-related memories' }
  ]
});
```

## Error Handling

### Error Code Ranges

| Range | Category | Example |
|-------|----------|---------|
| E001-E099 | API errors | E002: Rate limit |
| E100-E199 | Memory errors | E100: File not found |
| E200-E299 | Tool errors | E200: Invalid arguments |
| E300-E309 | Config errors | E300: Config not found |
| E310-E319 | Rate limit | E310: Per-minute limit |
| E400-E499 | Quality errors | E400: Low quality insight |
| E500-E509 | Encryption | E500: Encryption failed |
| E900-E999 | System errors | E900: Internal error |

### Error Response Format

```json
{
  "error": true,
  "code": "CORTEX_E200",
  "message": "Invalid tool arguments",
  "category": "tool",
  "suggestion": "Check the tool parameters.",
  "details": "query field is required",
  "timestamp": "2026-01-27T12:00:00Z"
}
```

## Performance Characteristics

| Operation | Latency | Cost | Notes |
|-----------|---------|------|-------|
| query | ~500ms | ~$0.001 | Haiku |
| recall | ~300ms | ~$0.001 | Haiku |
| reflect | 2-3s | ~$0.01 | Sonnet |
| infer | 2-3s | ~$0.01 | Sonnet |
| learn | 2-3s | ~$0.01 | Sonnet |
| consolidate | 3-5s | ~$0.02 | Sonnet, batch |

## Deployment Models

### Local (Current)
- Single user
- MCP over stdio
- Files in `~/.claude/memory/`

### Cloud (Future)
- Multi-user
- MCP over HTTP
- S3/database storage
- OAuth authentication

### Enterprise (Future)
- Self-hosted
- LDAP/SAML auth
- Audit compliance
- Data residency

## Testing Strategy

### Unit Tests
- Validation functions
- Error handling
- Storage operations

### Integration Tests
- Full tool execution
- MCP protocol compliance
- API mocking

### Performance Tests
- Rate limiter accuracy
- Memory under load
- Concurrent requests

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-27 | Initial release |
| 1.1.0 | TBD | MCP Apps UI |
| 2.0.0 | TBD | Cloud deployment |
