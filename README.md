# Cortex - Claude's Cognitive Layer (Cortex)

[![Tests](https://img.shields.io/badge/tests-90%2F90%20passing-brightgreen)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

**A 100% persistent memory system for Claude Code** that achieves true cross-session memory through auto-extraction, auto-recall, and compounding learnings.

## Why Cortex?

Claude Code is powerful, but it forgets everything between sessions. Cortex solves this by:

| Problem | Cortex Solution |
|---------|--------------|
| Claude forgets context | **Auto-recall**: Injects relevant memories at session start |
| Learnings are lost | **Auto-extraction**: Captures insights from every session |
| No learning from mistakes | **LADS principles**: System gets smarter over time |
| Manual memory management | **Fully automatic**: Zero user intervention required |

## LADS Principles

Cortex follows the **LADS** framework for continuous improvement:

- **L**earnable: Tracks every decision and its outcome
- **A**daptive: Automatically tunes configuration based on what works
- **D**ocumenting: Generates its own usage documentation
- **S**elf-improving: Pattern detection identifies what helps vs. hurts

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Session                       │
├─────────────────────────────────────────────────────────────┤
│  SessionStart Hook          │         SessionEnd Hook        │
│  ┌─────────────────────┐    │    ┌─────────────────────┐    │
│  │ Context Analyzer    │    │    │ Extraction Engine   │    │
│  │ Query Orchestrator  │    │    │ Pattern Tracker     │    │
│  │ Memory Injection    │    │    │ Outcome Scorer      │    │
│  └─────────────────────┘    │    └─────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                       Core Infrastructure                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ JSONL    │ │ Lock     │ │ Write    │ │ Error        │   │
│  │ Storage  │ │ Manager  │ │ Queue    │ │ Handler      │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                        LADS Layer                            │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐  │
│  │ Config       │ │ Pattern      │ │ Docs               │  │
│  │ Evolver      │ │ Tracker      │ │ Writer             │  │
│  └──────────────┘ └──────────────┘ └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### One-Command Install

```bash
# Linux/macOS
curl -fsSL https://raw.githubusercontent.com/robertogogoni/claude-memory-orchestrator/main/install.sh | bash

# Or clone and install manually
git clone https://github.com/robertogogoni/claude-memory-orchestrator.git ~/.claude/memory
cd ~/.claude/memory && ./install.sh
```

### Manual Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/robertogogoni/claude-memory-orchestrator.git ~/.claude/memory
   ```

2. **Register the hooks** in `~/.claude/settings.json`:
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

3. **Start a new Claude Code session** - Cortex is now active!

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

### LADS Learning Loop

Over time, the system learns:

- Which memory types are most useful (and adjusts extraction)
- Which decisions lead to good outcomes (and suggests similar approaches)
- What patterns indicate problems (and warns proactively)

## Configuration

Cortex is highly configurable via `~/.claude/memory/data/configs/current.json`:

```json
{
  "version": "1.0.0",
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
├── data/
│   ├── memories/          # Extracted memories
│   │   ├── skills.jsonl
│   │   ├── working.jsonl
│   │   └── patterns.jsonl
│   ├── patterns/          # Decision tracking
│   │   ├── decisions.jsonl
│   │   └── outcomes.jsonl
│   └── configs/           # Configuration history
│       ├── current.json
│       └── history/
├── logs/                  # Debug logs
└── .locks/                # File locks (auto-cleaned)
```

## API Reference

### Core Classes

```javascript
const {
  // Main orchestrator
  CMOCore, getCMO,

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

## Testing

```bash
# Run all tests
node tests/test-core.cjs && node tests/test-hooks.cjs && node tests/test-lads.cjs

# Run individual test suites
node tests/test-core.cjs   # 34 tests - core infrastructure
node tests/test-hooks.cjs  # 25 tests - hook components
node tests/test-lads.cjs   # 31 tests - LADS components
```

**Current Status**: 90/90 tests passing ✅

## Project Structure

```
~/.claude/memory/
├── index.cjs              # Main entry point
├── core/
│   ├── types.cjs          # Types, utilities, defaults
│   ├── storage.cjs        # JSONL storage engine
│   ├── config.cjs         # Configuration management
│   ├── lock-manager.cjs   # File-based locking
│   ├── write-queue.cjs    # Batched write queue
│   ├── error-handler.cjs  # Circuit breaker, retry, degradation
│   └── lads/
│       ├── pattern-tracker.cjs  # Decision tracking
│       ├── outcome-scorer.cjs   # Outcome evaluation
│       ├── config-evolver.cjs   # Auto-tuning
│       └── docs-writer.cjs      # Self-documentation
├── hooks/
│   ├── session-start.cjs  # Session start hook
│   ├── session-end.cjs    # Session end hook
│   ├── context-analyzer.cjs    # Context analysis
│   ├── query-orchestrator.cjs  # Memory retrieval
│   └── extraction-engine.cjs   # Content extraction
├── tests/
│   ├── test-core.cjs      # Core tests
│   ├── test-hooks.cjs     # Hook tests
│   └── test-lads.cjs      # LADS tests
└── data/                  # Runtime data (gitignored)
```

## Troubleshooting

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

3. Check for errors in logs:
   ```bash
   cat ~/.claude/memory/logs/*.log
   ```

### Memory Not Being Injected

1. Check relevance threshold (lower it to inject more):
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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `node tests/test-*.cjs`
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built for [Claude Code](https://claude.ai/code)
- Inspired by research on autonomous AI learning (Voyager, CASCADE, SEAgent)
- LADS principles adapted from continuous improvement methodologies

---

**Made with 🧠 by the Claude Code community**
