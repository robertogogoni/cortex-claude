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

### Restart Claude Code

The Cortex MCP tools and session hooks are now active!

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
