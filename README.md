# Cortex - Claude's Cognitive Layer

[![Tests](https://img.shields.io/badge/tests-90%2F90%20passing-brightgreen)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-blue)]()
[![MCP](https://img.shields.io/badge/MCP-6%20tools-purple)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

**A dual-model cognitive layer for Claude Code** that provides true cross-session memory through auto-extraction, auto-recall, MCP tools for deep reasoning, and compounding learnings.

## Why Cortex?

Claude Code is powerful, but it forgets everything between sessions. Cortex solves this with a dual-model architecture:

| Problem | Cortex Solution |
|---------|-----------------|
| Claude forgets context | **Auto-recall**: Injects relevant memories at session start |
| Learnings are lost | **Auto-extraction**: Captures insights from every session |
| No deep reasoning tools | **MCP Server**: 6 tools for query, recall, reflect, infer, learn, consolidate |
| Expensive API calls | **Dual-model**: Haiku for fast ops (~$0.25/1M), Sonnet for deep reasoning (~$3/1M) |
| Manual memory management | **Fully automatic**: Zero user intervention required |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Claude Code Session                               │
├─────────────────────────────────────────────────────────────────────────┤
│                           Cortex MCP Server                              │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────┐ │
│  │     Haiku Worker            │    │      Sonnet Thinker             │ │
│  │     (Fast, Cheap)           │    │      (Deep Reasoning)           │ │
│  │  • cortex__query            │    │  • cortex__reflect              │ │
│  │  • cortex__recall           │    │  • cortex__infer                │ │
│  │     ~$0.25/1M tokens        │    │  • cortex__learn                │ │
│  │                             │    │  • cortex__consolidate          │ │
│  │                             │    │     ~$3/1M tokens               │ │
│  └─────────────────────────────┘    └─────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  SessionStart Hook          │         SessionEnd Hook                    │
│  ┌─────────────────────┐    │    ┌─────────────────────┐                │
│  │ Context Analyzer    │    │    │ Extraction Engine   │                │
│  │ Query Orchestrator  │    │    │ Pattern Tracker     │                │
│  │ Memory Injection    │    │    │ Outcome Scorer      │                │
│  └─────────────────────┘    │    └─────────────────────┘                │
├─────────────────────────────────────────────────────────────────────────┤
│                       Core Infrastructure                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐               │
│  │ JSONL    │ │ Lock     │ │ Write    │ │ Error        │               │
│  │ Storage  │ │ Manager  │ │ Queue    │ │ Handler      │               │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘               │
├─────────────────────────────────────────────────────────────────────────┤
│                        LADS Layer                                        │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐              │
│  │ Config       │ │ Pattern      │ │ Docs               │              │
│  │ Evolver      │ │ Tracker      │ │ Writer             │              │
│  └──────────────┘ └──────────────┘ └────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

## User Experience

### Understanding MCP Tools vs Slash Commands

Cortex works at two levels:

| Interface | How It Works | User Action |
|-----------|--------------|-------------|
| **MCP Tools** | Claude uses them automatically when relevant | Just ask naturally |
| **Slash Commands** | User invokes explicitly with `/cortex` | Type `/cortex <command>` |

**MCP Tools** are invisible to users - Claude decides when to use them. You might ask "What authentication approach did I use before?" and Claude will automatically call `cortex__query` behind the scenes.

**Slash Commands** give you direct control via the `/cortex` skill (see below).

### The `/cortex` Skill

After installation, you can use these commands:

```bash
/cortex                    # Show status + help
/cortex query "search"     # Search memories
/cortex reflect "topic"    # Deep meta-cognitive analysis
/cortex learn "insight"    # Store a new insight
/cortex stats              # Memory counts, API costs
/cortex consolidate        # Clean up memories
```

### Visual Feedback

When Cortex processes, you'll see neural activity indicators:

```
╭──────────────────────────────────────╮
│  🧠 CORTEX ═══════════════════════   │
│     ·  ∿  ·  ∿  ·  ∿  ·             │
│    ◇━━━◇━━━◇     ◆━━━◆━━━◆          │
│     Haiku          Sonnet            │
│     querying...                      │
╰──────────────────────────────────────╯
```

- **◇ Diamonds** = Haiku (fast, cheap queries)
- **◆ Filled Diamonds** = Sonnet (deep reasoning)

### How to Know Cortex is Working

1. **Check MCP Status**: Run `claude mcp list` - look for `cortex: ✓ Connected`
2. **Use `/cortex status`**: Shows memory counts and last activity
3. **Session Start**: The hook injects relevant memories (check logs)
4. **Session End**: Learnings are extracted automatically

### Verifying Activity

```bash
# Check if memories exist
wc -l ~/.claude/memory/data/memories/*.jsonl

# View recent logs
tail -20 ~/.claude/memory/logs/*.log

# Test MCP server directly
timeout 3 node ~/.claude/memory/cortex/server.cjs
```

### Natural Language Usage

Just ask naturally - Claude will use Cortex tools when relevant:

| What You Say | What Cortex Does |
|--------------|------------------|
| "What did I do last time?" | `cortex__recall` - retrieves recent context |
| "Remember this for next time: ..." | `cortex__learn` - stores the insight |
| "What patterns am I seeing?" | `cortex__reflect` - meta-cognitive analysis |
| "How does X connect to Y?" | `cortex__infer` - finds relationships |
| "Search my memories for auth" | `cortex__query` - keyword search |
| "Clean up old memories" | `cortex__consolidate` - deduplication |
| "What have I learned about testing?" | `cortex__query` + `cortex__reflect` |
| "Why did I make that decision?" | `cortex__recall` - decision tracking |

**Pro tip:** You don't need to know the tool names. Just describe what you need.

### Limitations

⚠️ **Cortex cannot:**
- Remember conversations from before installation
- Access memories from other users or machines (yet - sync planned)
- Work offline (requires Anthropic API for Haiku/Sonnet)
- Guarantee perfect recall (relevance threshold filters results)
- Read your mind (be specific about what you want to remember)

💡 **For best results:**
- Use `/cortex learn` for important insights you want to preserve
- Check `/cortex stats` periodically to see what's stored
- Run `/cortex consolidate` monthly to clean up duplicates
- Be explicit: "Remember: always check JWT expiry first" > "note this"

### Cost Transparency

Cortex uses two Claude models with different costs:

| Model | Tools | Cost | When Used |
|-------|-------|------|-----------|
| **Haiku** | query, recall | ~$0.25/1M tokens | Every search, recall |
| **Sonnet** | reflect, infer, learn, consolidate | ~$3/1M tokens | Deep reasoning only |

**Typical costs:**
- Single query: ~$0.0001 (Haiku)
- Deep reflection: ~$0.005-0.01 (Sonnet)
- Session extraction: ~$0.002-0.005 (Haiku analysis)
- Monthly estimate: $1-5 depending on usage

Use `/cortex stats` to see your actual usage and costs.

---

## MCP Tools

Cortex exposes 6 MCP tools via its server:

### Haiku-Powered (Fast, ~$0.25/1M tokens)

| Tool | Description |
|------|-------------|
| `cortex__query` | Search all memory sources with intelligent keyword extraction and ranking |
| `cortex__recall` | Context-aware memory retrieval with relevance filtering |

### Sonnet-Powered (Deep Reasoning, ~$3/1M tokens)

| Tool | Description |
|------|-------------|
| `cortex__reflect` | Meta-cognitive analysis with quick/moderate/deep depth options |
| `cortex__infer` | Find non-obvious connections between concepts |
| `cortex__learn` | Extract, analyze, and store insights with quality gating |
| `cortex__consolidate` | Merge duplicates, remove outdated, reorganize memories |

## Quick Start

### One-Command Install

```bash
# Linux/macOS
git clone https://github.com/robertogogoni/cortex-claude.git ~/.claude/memory
cd ~/.claude/memory && npm install
```

### Register MCP Server

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/home/YOUR_USER/.claude/memory/cortex/server.cjs"],
      "env": {}
    }
  }
}
```

### Register Session Hooks

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

### Install the `/cortex` Skill (Optional)

Link the skill for slash command access:

```bash
mkdir -p ~/.claude/skills
ln -s ~/.claude/memory/skills/cortex ~/.claude/skills/cortex
```

### Restart Claude Code

The Cortex MCP tools, session hooks, and `/cortex` skill are now active!

### Verify Installation

After restarting Claude Code, verify everything works:

```bash
# Check MCP server is connected
claude mcp list | grep cortex
# Expected: cortex: node /home/YOUR_USER/.claude/memory/cortex/server.cjs - ✓ Connected

# Test the skill
/cortex status
```

### First Use Example

Try these commands to verify Cortex is working:

```
/cortex                      # Should show status
/cortex learn "Test memory"  # Should store successfully
/cortex query "test"         # Should find your test memory
```

If all three work, Cortex is fully operational! 🧠

## How It Works

### Session Start (Auto-Recall)

When you start a Claude Code session:

1. **Context Analysis**: Analyzes working directory, git info, recent files
2. **Intent Classification**: Determines what you're likely doing (debugging, implementing, etc.)
3. **Memory Query**: Searches stored memories for relevant context
4. **Injection**: Adds relevant memories to session context

### Session End (Auto-Extraction)

When a session ends:

1. **Content Extraction**: Identifies code patterns, solutions, decisions
2. **Quality Scoring**: Rates extraction quality using multiple signals
3. **Outcome Tracking**: Links decisions to their outcomes
4. **Storage**: Persists high-quality memories for future sessions

### MCP Tools (On-Demand)

Use Cortex tools directly in Claude Code:

```
# Search memories
Use cortex__query with query "debugging authentication"

# Deep reflection on current approach
Use cortex__reflect with topic "my debugging strategy" and depth "deep"

# Store a learning
Use cortex__learn with insight "Always check token expiry first"
```

### LADS Learning Loop

Over time, the system learns:

- Which memory types are most useful (and adjusts extraction)
- Which decisions lead to good outcomes (and suggests similar approaches)
- What patterns indicate problems (and warns proactively)

## LADS Principles

Cortex follows the **LADS** framework for continuous improvement:

- **L**earnable: Tracks every decision and its outcome
- **A**daptive: Automatically tunes configuration based on what works
- **D**ocumenting: Generates its own usage documentation
- **S**elf-improving: Pattern detection identifies what helps vs. hurts

## Configuration

Cortex is configurable via `~/.claude/memory/data/configs/current.json`:

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

## Data Storage

Cortex uses JSONL (JSON Lines) format for efficient append-only storage:

```
~/.claude/memory/
├── cortex/                # MCP Server
│   ├── server.cjs         # Main MCP entry point
│   ├── haiku-worker.cjs   # Fast queries (Haiku)
│   └── sonnet-thinker.cjs # Deep reasoning (Sonnet)
├── data/
│   ├── memories/          # Extracted memories
│   │   ├── skills.jsonl
│   │   ├── working.jsonl
│   │   ├── patterns.jsonl
│   │   ├── learnings.jsonl
│   │   └── insights.jsonl
│   ├── patterns/          # Decision tracking
│   │   ├── decisions.jsonl
│   │   └── outcomes.jsonl
│   └── configs/           # Configuration history
│       ├── current.json
│       └── history/
├── hooks/                 # Session hooks
├── core/                  # Core infrastructure
├── logs/                  # Debug logs
└── .locks/                # File locks (auto-cleaned)
```

## Testing

```bash
# Run all tests
npm test

# Run individual test suites
npm run test:core   # 34 tests - core infrastructure
npm run test:hooks  # 25 tests - hook components
npm run test:lads   # 31 tests - LADS components
```

**Current Status**: 90/90 tests passing

## Troubleshooting

### MCP Tools Not Available

1. Check MCP server registration in `~/.claude.json`
2. Test server manually: `node ~/.claude/memory/cortex/server.cjs`
3. Restart Claude Code

### Hooks Not Running

1. Check hook registration:
   ```bash
   cat ~/.claude/settings.json | grep -A5 "SessionStart"
   ```

2. Test hooks manually:
   ```bash
   node ~/.claude/memory/hooks/session-start.cjs
   node ~/.claude/memory/hooks/session-end.cjs
   ```

3. Check logs:
   ```bash
   cat ~/.claude/memory/logs/*.log
   ```

### Memory Not Being Injected

1. Lower relevance threshold:
   ```json
   { "sessionStart": { "relevanceThreshold": 0.2 } }
   ```

2. Ensure memories exist:
   ```bash
   wc -l ~/.claude/memory/data/memories/*.jsonl
   ```

### Lock Errors

Stale locks are auto-cleaned after TTL expires. To force cleanup:
```bash
rm -rf ~/.claude/memory/.locks/*
```

### Cortex Not Responding

If Cortex tools seem unresponsive:

1. **Check server is running:**
   ```bash
   timeout 3 node ~/.claude/memory/cortex/server.cjs
   # Should show: "Cortex MCP Server running..."
   ```

2. **Check API key is set:**
   ```bash
   echo $ANTHROPIC_API_KEY | head -c 10
   # Should show first 10 chars of your key
   ```

3. **Check for errors in logs:**
   ```bash
   tail -50 ~/.claude/memory/logs/cortex-*.log
   ```

4. **Full reset (last resort):**
   ```bash
   # Kill any stuck processes
   pkill -f "cortex/server.cjs"
   # Clear locks
   rm -rf ~/.claude/memory/.locks/*
   # Clear session cache
   rm -f ~/.claude/memory/data/.session-*
   # Restart Claude Code
   ```

### Skill Not Working

If `/cortex` commands don't work:

1. **Check skill is linked:**
   ```bash
   ls -la ~/.claude/skills/cortex
   # Should show symlink to ~/.claude/memory/skills/cortex
   ```

2. **Re-link skill:**
   ```bash
   rm -f ~/.claude/skills/cortex
   ln -s ~/.claude/memory/skills/cortex ~/.claude/skills/cortex
   ```

3. **Check skill file exists:**
   ```bash
   cat ~/.claude/memory/skills/cortex/SKILL.md | head -20
   ```

### High API Costs

If costs seem higher than expected:

1. **Check usage with `/cortex stats`**

2. **Limit Sonnet usage:**
   - Use `/cortex query` instead of `/cortex reflect` for simple searches
   - `query` uses Haiku (~$0.25/1M), `reflect` uses Sonnet (~$3/1M)

3. **Adjust extraction aggressiveness:**
   ```json
   // In data/configs/current.json
   { "sessionEnd": { "qualityThreshold": 0.6 } }
   ```
   Higher threshold = fewer extractions = lower cost

## API Reference

### Core Classes

```javascript
const {
  // Storage
  JSONLStore, MemoryIndex, StorageManager,

  // Concurrency
  LockManager, WriteQueue,

  // Error handling
  CircuitBreaker, RetryHandler, GracefulDegradationManager,

  // LADS
  PatternTracker, OutcomeScorer, ConfigEvolver, DocsWriter,
} = require('./index.cjs');
```

### Hook Classes

```javascript
const {
  // Session hooks
  SessionStartHook, SessionEndHook, runHook,

  // Analysis
  ContextAnalyzer, QueryOrchestrator, ExtractionEngine,
} = require('./index.cjs');
```

### Cortex MCP Classes

```javascript
const { HaikuWorker } = require('./cortex/haiku-worker.cjs');
const { SonnetThinker } = require('./cortex/sonnet-thinker.cjs');
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built for [Claude Code](https://claude.ai/code)
- Uses [MCP SDK](https://github.com/modelcontextprotocol/sdk) for tool integration
- Inspired by research on autonomous AI learning (Voyager, CASCADE, SEAgent)
- LADS principles adapted from continuous improvement methodologies

---

**Made with 🧠 by the Claude Code community**
