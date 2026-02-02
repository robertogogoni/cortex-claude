# Cortex Usage Examples

> Practical examples for common Cortex workflows and integrations.

---

## Table of Contents

- [Basic Query Workflow](#basic-query-workflow)
- [Learning and Storing Insights](#learning-and-storing-insights)
- [Deep Reflection Patterns](#deep-reflection-patterns)
- [Concept Inference](#concept-inference)
- [Memory Consolidation](#memory-consolidation)
- [Multi-Session Memory](#multi-session-memory)
- [Integration with Claude Code Hooks](#integration-with-claude-code-hooks)
- [Natural Language Usage](#natural-language-usage)
- [Cost Optimization](#cost-optimization)

---

## Basic Query Workflow

### Simple Search

Search for memories about a specific topic:

```
# Natural language (Claude uses cortex__query automatically)
"What did I do last time with authentication?"

# Explicit tool call
Use cortex__query with query "JWT authentication implementation"
```

### Filtered Search

Search specific memory sources:

```json
{
  "name": "cortex__query",
  "arguments": {
    "query": "Docker container optimization",
    "sources": ["jsonl", "claudemd"],
    "limit": 5
  }
}
```

### Search by Type with Recall

When you know what type of memory you want:

```json
{
  "name": "cortex__recall",
  "arguments": {
    "context": "debugging async race conditions",
    "type": "pattern"
  }
}
```

**When to use query vs recall:**
- Use `query` for broad searches across all sources
- Use `recall` when you need specific context with type filtering

---

## Learning and Storing Insights

### Basic Learning

Store a new insight:

```
"Remember: When debugging React state, always check if the parent component is causing unnecessary re-renders"
```

Claude will automatically call:

```json
{
  "name": "cortex__learn",
  "arguments": {
    "insight": "When debugging React state, always check if the parent component is causing unnecessary re-renders",
    "type": "pattern",
    "tags": ["react", "debugging", "state"]
  }
}
```

### Detailed Learning with Context

For important learnings, provide context:

```json
{
  "name": "cortex__learn",
  "arguments": {
    "insight": "The order service API requires a specific header X-Request-ID for tracing. Without it, requests fail silently in production but work in development.",
    "context": "Order service integration, production debugging",
    "type": "decision",
    "tags": ["order-service", "api", "headers", "production"]
  }
}
```

### Quality-Gated Learning

Cortex analyzes and enhances insights:

**Input:**
```json
{
  "insight": "git rebase is better",
  "type": "pattern"
}
```

**Response (rejected):**
```json
{
  "analysis": {
    "quality": 3,
    "value": "Too vague - doesn't specify when or why rebase is better",
    "isDuplicate": false,
    "priority": "low"
  },
  "stored": false
}
```

**Better input:**
```json
{
  "insight": "Use git rebase -i for cleaning up local commits before pushing. This keeps history linear and easier to review. Never rebase commits that have been pushed to shared branches.",
  "context": "Git workflow, team collaboration",
  "type": "pattern",
  "tags": ["git", "rebase", "workflow"]
}
```

---

## Deep Reflection Patterns

### Quick Session Check

Get a fast overview of patterns:

```json
{
  "name": "cortex__reflect",
  "arguments": {
    "topic": "my progress this session",
    "depth": "quick"
  }
}
```

**Output:** 2-3 bullet points about what you've accomplished and any patterns noticed.

### Moderate Analysis

Balanced reflection with examples:

```json
{
  "name": "cortex__reflect",
  "arguments": {
    "topic": "my debugging approach for async code",
    "depth": "moderate"
  }
}
```

### Deep Meta-Cognitive Analysis

Thorough exploration of patterns and connections:

```json
{
  "name": "cortex__reflect",
  "arguments": {
    "topic": "how my coding style has evolved over the past month",
    "depth": "deep"
  }
}
```

**Use cases for deep reflection:**
- Weekly reviews
- Pattern analysis before major refactoring
- Learning retrospectives
- Decision validation

---

## Concept Inference

### Finding Hidden Connections

Discover relationships between concepts:

```json
{
  "name": "cortex__infer",
  "arguments": {
    "concepts": ["event sourcing", "audit logging", "debugging"],
    "includeMemories": true
  }
}
```

**Example output:**
```markdown
## Connections Found

### Strong Connections (High Confidence)
1. **Event sourcing provides natural audit logs** - Every state change is recorded as an event, creating a complete audit trail automatically.

2. **Debugging benefits from event replay** - Past issues can be reproduced by replaying events up to the failure point.

### Implications
- Your past work on the order service audit could be simplified by adopting event sourcing
- The debugging patterns you've developed for async issues could leverage event replay
```

### Architecture Decision Support

When considering architectural choices:

```json
{
  "name": "cortex__infer",
  "arguments": {
    "concepts": ["microservices", "monolith", "team size", "deployment complexity"],
    "includeMemories": true
  }
}
```

### Without Memory Context

For pure conceptual analysis:

```json
{
  "name": "cortex__infer",
  "arguments": {
    "concepts": ["GraphQL", "REST", "real-time updates"],
    "includeMemories": false
  }
}
```

---

## Memory Consolidation

### Preview Consolidation (Dry Run)

See what would change without applying:

```json
{
  "name": "cortex__consolidate",
  "arguments": {
    "scope": "recent",
    "dryRun": true
  }
}
```

### Consolidate by Type

Clean up a specific category:

```json
{
  "name": "cortex__consolidate",
  "arguments": {
    "scope": "type",
    "type": "pattern",
    "dryRun": false
  }
}
```

### Full Consolidation

Clean up all memories (use sparingly):

```json
{
  "name": "cortex__consolidate",
  "arguments": {
    "scope": "all",
    "dryRun": true
  }
}
```

**Consolidation actions:**
- **Duplicates**: Removes redundant memories, keeping the most complete version
- **Merges**: Combines related memories into a single, better memory
- **Outdated**: Removes memories superseded by newer information

---

## Multi-Session Memory

### Session Start (Automatic)

When you start a Claude Code session, the SessionStart hook automatically:

1. Analyzes your working directory and git context
2. Queries relevant memories
3. Injects up to 5 relevant memories into context

**Configuration** (`~/.claude/memory/data/configs/current.json`):
```json
{
  "sessionStart": {
    "slots": {
      "maxTotal": 5,
      "skills": 2,
      "workingMemory": 2,
      "patterns": 1
    },
    "relevanceThreshold": 0.3
  }
}
```

### Session End (Automatic)

When a session ends, the SessionEnd hook:

1. Analyzes the conversation for learnings
2. Extracts high-quality insights
3. Stores them for future sessions

**Configuration:**
```json
{
  "sessionEnd": {
    "qualityThreshold": 0.4,
    "maxExtractionsPerSession": 10
  }
}
```

### Manual Context Loading

If you need to load specific context mid-session:

```
"Load my memories about the payment service integration"
```

Claude uses cortex__recall to fetch relevant memories.

---

## Integration with Claude Code Hooks

### Hook Configuration

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node ~/.claude/memory/hooks/session-start.cjs"
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "node ~/.claude/memory/hooks/session-end.cjs"
      }]
    }]
  }
}
```

### Custom Hook Integration

Create custom hooks that use Cortex:

```javascript
// my-pre-debug-hook.cjs
const { HaikuWorker } = require('~/.claude/memory/cortex/haiku-worker.cjs');

async function preDebugCheck(error) {
  const haiku = new HaikuWorker();

  // Search for similar past errors
  const results = await haiku.query(
    `error: ${error}`,
    ['jsonl', 'episodic'],
    5
  );

  if (results.memories.length > 0) {
    console.log('Found similar past issues:');
    results.memories.forEach(m => {
      console.log(`- ${m.content.substring(0, 100)}...`);
    });
  }
}
```

---

## Natural Language Usage

Cortex tools are designed to be used naturally. Claude automatically selects the right tool.

### Query Patterns

| What You Say | Tool Used |
|--------------|-----------|
| "What did I do last time?" | cortex__recall |
| "Search my memories for auth" | cortex__query |
| "What patterns am I seeing?" | cortex__reflect |
| "How does X connect to Y?" | cortex__infer |
| "Remember this for next time" | cortex__learn |
| "Clean up old memories" | cortex__consolidate |

### Conversation Examples

**Debug context loading:**
```
User: I'm getting a null pointer error in the payment service
Claude: Let me check if you've encountered similar issues before.
[Uses cortex__recall with context "payment service null pointer error"]
Found 2 relevant memories...
```

**Pattern recognition:**
```
User: I feel like I keep making the same mistakes with async code
Claude: Let me reflect on your debugging patterns.
[Uses cortex__reflect with topic "async debugging patterns" depth "moderate"]
Based on your history, I see these recurring issues...
```

**Knowledge storage:**
```
User: Note that the legacy API requires Basic auth, not Bearer tokens
Claude: I'll store that for future reference.
[Uses cortex__learn with insight "Legacy API requires Basic auth..." type "decision"]
Stored successfully with quality score 8/10.
```

---

## Cost Optimization

### Use Haiku for Simple Queries

Haiku tools cost ~$0.001 per call:

```
# Cheap - uses cortex__query (Haiku)
"Search for React patterns"

# Expensive - uses cortex__reflect (Sonnet)
"Analyze my React patterns deeply"
```

### Batch Operations

Instead of multiple reflect calls, use one with broader scope:

```json
// Expensive: 5 separate reflects
// Better: 1 deep reflect
{
  "name": "cortex__reflect",
  "arguments": {
    "topic": "my overall development patterns including debugging, testing, and architecture decisions",
    "depth": "deep"
  }
}
```

### Monitor Costs

Check your usage:

```
/cortex stats
```

Output:
```
Session Cost: ~$0.0234
- Queries: 12 (Haiku)
- Reflections: 2 (Sonnet)
- Learnings: 3 (Sonnet)
Total tokens: 45,230 input / 8,450 output
```

### Rate Limit Awareness

If you hit rate limits:

```
Error: CORTEX_E310 - Rate limit exceeded
Suggestion: Wait 60 seconds or use cortex__query for cached results
```

**Prevention:**
- Use query for frequent searches (30/minute limit)
- Reserve reflect/infer for important analysis (10-15/minute limit)
- Run consolidate monthly, not daily (5/minute limit)

---

## Advanced Patterns

### Pre-Debugging Checklist

Before debugging, always check memory:

```
Use the debug-checklist prompt with error "Cannot read property 'map' of undefined"
```

This runs a structured workflow:
1. Query for similar past errors
2. Recall relevant patterns
3. Check for known solutions
4. Summarize what to try first

### Weekly Review Workflow

```
Use the weekly-review prompt with focus "performance optimization"
```

This:
1. Queries memories from past 7 days
2. Runs deep reflection
3. Identifies patterns and learnings
4. Provides actionable recommendations

### Project Context Loading

When switching projects:

```
Use the project-context prompt with projectPath "/path/to/project"
```

Loads all relevant:
- Project-specific memories
- Related decisions
- Applicable patterns

---

## Troubleshooting Examples

### No Memories Found

```json
{
  "error": "CORTEX_E104",
  "message": "No memories found",
  "suggestion": "Try broader search terms or use /cortex learn to store new memories"
}
```

**Solution:** Start with `cortex__learn` to build up your memory:
```
"Remember: [your first insight]"
```

### Quality Too Low

```json
{
  "stored": false,
  "analysis": {
    "quality": 2,
    "value": "Too vague"
  }
}
```

**Solution:** Add more context and specificity:
```json
{
  "insight": "When X happens, do Y because Z",
  "context": "Specific situation where this applies",
  "tags": ["relevant", "tags"]
}
```

### Rate Limit Hit

```
Error: CORTEX_E311 - Hourly rate limit exceeded
```

**Solution:** Wait or switch to cheaper operations:
```
# Instead of reflect (Sonnet, limited)
# Use query (Haiku, higher limits)
"Search for patterns about [topic]"
```

---

## See Also

- [API.md](API.md) - Complete API reference
- [README.md](../README.md) - Overview and quick start
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
