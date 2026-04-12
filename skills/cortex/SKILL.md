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
| `/cortex help` | Show detailed help with examples | Free |
| `/cortex query <search>` | Search stored memories | ~$0.001 |
| `/cortex recall` | Get context-aware memories for current task | ~$0.001 |
| `/cortex reflect <topic>` | Deep meta-cognitive analysis | ~$0.01 |
| `/cortex infer <concepts>` | Find connections between ideas | ~$0.01 |
| `/cortex learn <insight>` | Store a new learning | ~$0.01 |
| `/cortex consolidate` | Clean up and organize memories | ~$0.02 |
| `/cortex forget <id|keyword>` | Selectively delete a memory | Free |
| `/cortex stats` | Show memory counts and API costs | Free |
| `/cortex health` | Verify all systems are working | Free |
| `/cortex log` | View recent activity log | Free |
| `/cortex config` | View/edit configuration | Free |
| `/cortex export [format]` | Export memories (json/md) | Free |
| `/cortex session` | Show current session summary | Free |

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

### 0. Help Command (`/cortex help`)

Display comprehensive help with groupings:

```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX v2.0 - Claude's Memory Layer         │
├─────────────────────────────────────────────────┤
│  QUICK                                          │
│    /cortex              Status overview         │
│    /cortex help         This screen             │
│    /cortex stats        Memory counts & costs   │
│    /cortex health       Verify everything works │
│                                                 │
│  MEMORY (Haiku - fast, ~$0.001)                 │
│    /cortex query "X"    Search memories         │
│    /cortex recall       Context retrieval       │
│                                                 │
│  REASONING (Sonnet - deep, ~$0.01)              │
│    /cortex reflect "X"  Meta-analysis           │
│    /cortex infer A B    Find connections        │
│    /cortex learn "X"    Store insight           │
│    /cortex consolidate  Clean up                │
│                                                 │
│  UTILITIES                                      │
│    /cortex forget "X"   Delete specific memory  │
│    /cortex log          Recent activity         │
│    /cortex config       View/edit settings      │
│    /cortex export       Export memories         │
│    /cortex session      Current session info    │
│                                                 │
│  NATURAL LANGUAGE                               │
│    "What did I do last time?"                   │
│    "Remember: always validate JWT first"        │
│    "What patterns am I seeing?"                 │
│    "How does X connect to Y?"                   │
╰─────────────────────────────────────────────────╯
```

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

### 6. Health Command (`/cortex health`)

Run comprehensive health check:

```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX HEALTH CHECK                         │
├─────────────────────────────────────────────────┤
│  MCP Server      ✓ Connected                    │
│  Memory Files    ✓ 5 files (127 entries)        │
│  API Key         ✓ Valid (sk-ant-...)           │
│  Hooks           ✓ SessionStart, SessionEnd     │
│  Last Activity   2 hours ago                    │
│  Disk Usage      41 KB                          │
├─────────────────────────────────────────────────┤
│  STATUS: All systems operational ✓              │
╰─────────────────────────────────────────────────╯
```

To verify:
1. Check MCP connection: `claude mcp list | grep cortex`
2. Check files exist: `ls ~/.claude/memory/data/memories/`
3. Check API key: `[ -n "$ANTHROPIC_API_KEY" ] && echo "Set"`
4. Check hooks: `grep -A3 "SessionStart" ~/.claude/settings.json`

### 7. Log Command (`/cortex log`)

Show recent activity from logs:

```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX ACTIVITY LOG (last 10)               │
├─────────────────────────────────────────────────┤
│  14:32  query "authentication"        → 3 hits  │
│  14:28  learn "JWT pattern"           → stored  │
│  14:15  recall (session start)        → 2 items │
│  13:45  reflect "debugging approach"  → complete│
│  ...                                            │
╰─────────────────────────────────────────────────╯
```

Read from: `~/.claude/memory/logs/*.log`

### 8. Config Command (`/cortex config`)

Show current configuration:

```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX CONFIGURATION                        │
├─────────────────────────────────────────────────┤
│  SESSION START                                  │
│    Max memories injected:  5                    │
│    Relevance threshold:    0.3                  │
│                                                 │
│  SESSION END                                    │
│    Quality threshold:      0.4                  │
│    Max extractions:        10                   │
│                                                 │
│  Neural Consolidation                              │
│    Evolution enabled:      yes                  │
│    Evolution interval:     24h                  │
│                                                 │
│  Config file: ~/.claude/memory/data/configs/   │
│               current.json                      │
╰─────────────────────────────────────────────────╯
```

Read from: `~/.claude/memory/data/configs/current.json`

### 9. Export Command (`/cortex export [format]`)

Export memories to file:

```
/cortex export           # Default: markdown
/cortex export json      # JSON format
/cortex export md        # Markdown format
```

Output example for markdown:
```markdown
# Cortex Memory Export
Generated: 2026-01-27

## Skills (23 entries)
- Authentication: Use JWT with refresh tokens...
- Error handling: Always log context...

## Learnings (45 entries)
- "Always validate JWT expiry before permissions"
- "Use circuit breaker for external API calls"
...
```

### 10. Session Command (`/cortex session`)

Show current session summary:

```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX SESSION                              │
├─────────────────────────────────────────────────┤
│  Started:         14:00 (2h 32m ago)            │
│  Working Dir:     ~/.claude/memory              │
│  Git Branch:      master                        │
│                                                 │
│  INJECTED AT START                              │
│    • JWT authentication pattern                 │
│    • Error handling best practices              │
│                                                 │
│  WILL EXTRACT AT END                            │
│    • MCP Resources implementation approach      │
│    • Skill enhancement patterns                 │
│                                                 │
│  API Usage:       ~$0.02                        │
╰─────────────────────────────────────────────────╯
```

This shows what memories were injected at session start and previews what will be extracted at session end.

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
