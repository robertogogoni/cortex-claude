# Cortex - Claude's Cognitive Layer

## Metadata
name: cortex
description: Cross-session memory with deep reasoning - query, reflect, learn, consolidate
version: 2.0.0
triggers:
  - /cortex
  - memory
  - remember
  - what did I do
  - past sessions
  - learnings

## Overview

Cortex provides persistent memory across Claude Code sessions. This skill exposes
the Cortex MCP tools as user-friendly commands with visual feedback.

## Commands

| Command | Description | Cost |
|---------|-------------|------|
| `/cortex` | Show status and available commands | Free |
| `/cortex query <search>` | Search stored memories | ~$0.001 |
| `/cortex recall` | Get context-aware memories for current task | ~$0.001 |
| `/cortex reflect <topic>` | Deep meta-cognitive analysis | ~$0.01 |
| `/cortex infer <concepts>` | Find connections between ideas | ~$0.01 |
| `/cortex learn <insight>` | Store a new learning | ~$0.01 |
| `/cortex consolidate` | Clean up and organize memories | ~$0.02 |
| `/cortex stats` | Show memory counts and API costs | Free |

## Visual Feedback

When Cortex processes, display neural activity:

```
    ╭──────────────────────────────────╮
    │  🧠 CORTEX ══════════════════════│
    │     ·  ∿  ·  ∿  ·  ∿  ·         │
    │    ◇━━━◇━━━◇     ◆━━━◆━━━◆      │
    │     Haiku          Sonnet        │
    │     querying...                  │
    ╰──────────────────────────────────╯
```

## Instructions

When the user invokes `/cortex` or asks about memories/past sessions:

### 1. Status Command (`/cortex` or `/cortex status`)

Display current Cortex status:

```
╭─────────────────────────────────────────────╮
│  🧠 CORTEX STATUS                           │
├─────────────────────────────────────────────┤
│  MCP Server: ✓ Connected                    │
│  Memories:   127 total                      │
│    • Skills:     23                         │
│    • Patterns:   34                         │
│    • Learnings:  45                         │
│    • Insights:   25                         │
│  Last Activity: 2 hours ago                 │
│  Session Cost:  $0.02                       │
╰─────────────────────────────────────────────╯
```

To get this data:
1. Count lines in `~/.claude/memory/data/memories/*.jsonl`
2. Check `~/.claude/memory/logs/` for last activity
3. Read stats from MCP server if available

### 2. Query Command (`/cortex query <search>`)

```
╭──────────────────────────────────────╮
│  🧠 CORTEX ═══════════════════════   │
│     ·  ∿  ·  ∿  ·                    │
│    ◇━━━◇━━━◇  Haiku searching...    │
╰──────────────────────────────────────╯
```

Use the `cortex__query` MCP tool with the search term.
Display results with relevance scores.

### 3. Reflect Command (`/cortex reflect <topic>`)

```
╭──────────────────────────────────────╮
│  🧠 CORTEX ═══════════════════════   │
│         ·  ∿  ·  ∿  ·                │
│        ◆━━━◆━━━◆  Sonnet thinking...│
╰──────────────────────────────────────╯
```

Use the `cortex__reflect` MCP tool. This uses Sonnet for deep reasoning.
Include depth parameter: quick (512 tokens), moderate (1024), deep (2048).

### 4. Learn Command (`/cortex learn <insight>`)

```
╭──────────────────────────────────────╮
│  🧠 CORTEX ═══════════════════════   │
│         ·  ∿  ·  ∿  ·                │
│        ◆━━━◆━━━◆  Sonnet analyzing..│
╰──────────────────────────────────────╯
```

Use the `cortex__learn` MCP tool to store the insight.
Report quality score and whether it was stored.

### 5. Stats Command (`/cortex stats`)

Read and display:
- Memory file sizes and counts
- API token usage from server stats
- Estimated costs (Haiku: $0.25/1M, Sonnet: $3/1M)

```
╭─────────────────────────────────────────────╮
│  🧠 CORTEX STATS                            │
├─────────────────────────────────────────────┤
│  MEMORIES                                   │
│    Skills:      23 entries (12 KB)          │
│    Patterns:    34 entries (8 KB)           │
│    Learnings:   45 entries (15 KB)          │
│    Insights:    25 entries (6 KB)           │
│    ─────────────────────────────────        │
│    Total:      127 entries (41 KB)          │
├─────────────────────────────────────────────┤
│  API USAGE (This Session)                   │
│    Haiku:      1,234 tokens  ~$0.0003       │
│    Sonnet:     5,678 tokens  ~$0.017        │
│    ─────────────────────────────────        │
│    Total Cost: ~$0.02                       │
╰─────────────────────────────────────────────╯
```

## Auto-Activation

This skill should auto-activate when the user says:
- "What did I do last time?"
- "Do you remember when..."
- "Check my past sessions"
- "What have I learned about..."
- "Search my memories for..."

When auto-activated, show the visual feedback and use the appropriate tool.

## Error Handling

If MCP server is not connected:
```
╭──────────────────────────────────────╮
│  🧠 CORTEX ═══════════════════════   │
│     ✗ MCP Server Not Connected       │
│                                      │
│  Try: claude mcp list                │
│  Check: ~/.claude.json               │
╰──────────────────────────────────────╯
```

## Examples

**User**: `/cortex query authentication`
**Response**: Shows neural animation, then displays matching memories about authentication patterns.

**User**: "What approach did I use for the login system?"
**Response**: Auto-activates, queries memories, shows relevant past decisions.

**User**: `/cortex learn "Always validate JWT expiry before checking permissions"`
**Response**: Analyzes insight quality, stores if good, reports result.
