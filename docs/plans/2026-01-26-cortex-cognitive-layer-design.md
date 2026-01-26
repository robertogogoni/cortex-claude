# Cortex: Claude's Cognitive Layer

**Design Document**
**Date**: 2026-01-26
**Status**: Design Complete, Implementation Pending
**Previous Name**: CMO (Claude Memory Orchestrator)

---

## Executive Summary

Cortex is an active cognitive layer for Claude Code that unifies memory sources, reasons about context, and learns from sessions. Unlike passive memory retrieval systems, Cortex thinks, reflects, and generates insights using a dual-model architecture (Haiku + Sonnet).

---

## The Problem

Claude Code has multiple disconnected memory sources:
- Episodic Memory MCP (conversation history)
- Knowledge Graph MCP (entities and relations)
- CLAUDE.md (project context)
- Local JSONL files (working/short-term/long-term memory)

These sources are:
1. **Isolated** - No unified query interface
2. **Passive** - Only respond when explicitly queried
3. **Non-reasoning** - Return raw data, no synthesis
4. **Invisible** - No UX feedback that memory is active

---

## The Solution: Cortex

Cortex is a cognitive layer that:
1. **Unifies** all memory sources behind a single API
2. **Reasons** about memories using Sonnet for deep thinking
3. **Learns** by extracting insights from sessions automatically
4. **Orchestrates** using Haiku for efficient, low-cost operations
5. **Shows presence** through visual feedback and status indicators

---

## Architecture

```
+---------------------------------------------------------------+
|                     Cortex MCP Server                         |
|                                                               |
|  +-------------------------+  +-----------------------------+ |
|  |  cortex__query          |  |  cortex__reflect            | |
|  |  cortex__recall         |  |  cortex__infer              | |
|  +------------+------------+  +  cortex__learn              | |
|               |               |  cortex__consolidate        | |
|               |               +-------------+---------------+ |
|               |                             |                 |
|               v                             v                 |
|  +----------------------------------------------------------+ |
|  |              Haiku + Sonnet Dual-Model Engine            | |
|  |                                                          | |
|  |  +----------------------+  +---------------------------+ | |
|  |  |  HAIKU (Worker)      |  |  SONNET (Thinker)         | | |
|  |  |                      |  |                           | | |
|  |  |  - Query routing     |  |  - Reflection             | | |
|  |  |  - Intent classify   |  |  - Inference              | | |
|  |  |  - Result filtering  |  |  - Insight generation     | | |
|  |  |  - Tool orchestrate  |  |  - Synthesis              | | |
|  |  |  - Relevance scoring |  |  - Meta-cognition         | | |
|  |  |                      |  |                           | | |
|  |  |  ~50-100 calls/sess  |  |  ~5-10 calls/session      | | |
|  |  |  Cost: ~$0.025/sess  |  |  Cost: ~$0.03/session     | | |
|  |  +----------------------+  +---------------------------+ | |
|  +----------------------------------------------------------+ |
|               |                             |                 |
|               v                             v                 |
|  +----------------------------------------------------------+ |
|  |              Unified Memory Layer                        | |
|  |                                                          | |
|  |  +-----------+ +-----------+ +----------+ +------------+ | |
|  |  | Episodic  | | Knowledge | |   JSONL  | | CLAUDE.md  | | |
|  |  |    MCP    | | Graph MCP | |  (local) | |   (file)   | | |
|  |  +-----------+ +-----------+ +----------+ +------------+ | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
              |
              v
+---------------------------------------------------------------+
|  UserPromptSubmit Hook (lightweight)                          |
|  - Auto-injects relevant context at prompt start              |
|  - Calls cortex__query for relevant memories                  |
|  - Displays status indicator to user                          |
+---------------------------------------------------------------+
```

---

## Dual-Model Architecture

### Haiku (The Worker)
- **Role**: High-frequency, low-cost operations
- **Tasks**:
  - Query routing and source selection
  - Intent classification
  - Result filtering and ranking
  - Tool orchestration
  - Keyword extraction
  - Relevance scoring
- **Cost**: ~$0.25/1M tokens
- **Calls**: ~50-100 per session

### Sonnet (The Thinker)
- **Role**: Low-frequency, high-value reasoning
- **Tasks**:
  - Reflection ("What patterns am I seeing?")
  - Inference ("How does X connect to Y?")
  - Insight generation ("What should I learn?")
  - Synthesis ("Summarize these memories")
  - Meta-cognition ("Am I approaching this right?")
- **Cost**: ~$3/1M tokens
- **Calls**: ~5-10 per session

### Cost Estimate
| Component | Calls/Session | Tokens/Call | Cost |
|-----------|---------------|-------------|------|
| Haiku     | 100           | 500         | $0.025 |
| Sonnet    | 10            | 1000        | $0.03 |
| **Total** |               |             | **~$0.055/session** |

---

## Auto-Escalation System

Haiku automatically decides when to escalate to Sonnet.

### Escalation Formula
```
escalation_score = 0.4 * complexity + 0.3 * (1 - confidence) + 0.3 * task_type

if escalation_score > 0.6:
    use_sonnet()
else:
    use_haiku()
```

### Complexity Score (0-1)
| Signal | Score |
|--------|-------|
| Single entity lookup | 0.1 |
| Multi-entity query | 0.3 |
| Temporal comparison | 0.6 |
| Cross-domain connection | 0.7 |
| Abstract/philosophical | 0.9 |
| Meta-cognitive request | 1.0 |

### Confidence Score (0-1, inverted for escalation)
| Signal | Confidence |
|--------|------------|
| Exact keyword match | 0.9 |
| Multiple strong matches | 0.8 |
| Fuzzy matches only | 0.5 |
| Conflicting memories | 0.3 |
| No relevant memories | 0.2 |

### Task Type Score (0-1)
| Task | Score |
|------|-------|
| Simple recall | 0.1 |
| Keyword search | 0.2 |
| Filtering/ranking | 0.3 |
| Summarization | 0.5 |
| Synthesis | 0.7 |
| Reflection | 0.8 |
| Inference | 0.9 |
| Insight generation | 1.0 |

### Session-Level Triggers
| Trigger | Condition | Action |
|---------|-----------|--------|
| Long session | >30 min active | Reflect on progress |
| Repeated failures | Same error 3x | Analyze pattern |
| Topic shift | Context change | Connect topics |
| Breakthrough | Success after struggle | Extract learnings |
| Memory accumulation | >10 new facts | Consolidate |

---

## MCP Server Tools

| Tool | Purpose | Model |
|------|---------|-------|
| `cortex__query` | Search all memory sources | Haiku |
| `cortex__recall` | Get specific memory by context | Haiku |
| `cortex__reflect` | Think about current session | Sonnet |
| `cortex__infer` | Reason about connections | Sonnet |
| `cortex__learn` | Extract and store insight | Sonnet |
| `cortex__consolidate` | Merge/dedupe memories | Sonnet |

---

## Leveraging Existing Code

Cortex builds on top of existing CMO infrastructure:

| Existing Module | New Role in Cortex |
|-----------------|-------------------|
| `query-orchestrator.cjs` | Memory layer coordinator |
| `context-analyzer.cjs` | Context extraction for queries |
| `semantic-intent-analyzer.cjs` | Haiku integration (already built!) |
| `injection-formatter.cjs` | Output formatting |
| `session-start.cjs` | Hook entry point |
| `session-end.cjs` | Learning extraction |
| JSONL adapters | Local memory access |

### Reuse Strategy
1. **Keep**: All adapters, analyzers, formatters
2. **Rename**: CMO references to Cortex
3. **Enhance**: Add Sonnet reflection layer
4. **Add**: MCP server wrapper
5. **Add**: Escalation decision engine

---

## Visual Feedback (UX)

### Session Start
```
+-----------------------------------------------------+
|  CORTEX v2.0 - Claude's Cognitive Layer             |
+-----------------------------------------------------+
|  Status: Active                                     |
|  Sources: 4 connected                               |
|  Memories: 15 loaded (495 tokens)                   |
|  Model: Haiku ready, Sonnet standby                 |
+-----------------------------------------------------+
```

### Per-Prompt Status (compact)
```
[Cortex] 3 memories | 127 tokens | Haiku
```

### Reflection Triggered
```
+-----------------------------------------------------+
|  CORTEX: Reflection triggered (long session)        |
+-----------------------------------------------------+
|  "I notice we've been debugging auth issues for     |
|   30 minutes. The pattern suggests the JWT token    |
|   isn't being refreshed. Similar issue in session   |
|   2026-01-15 was solved by adding refresh logic."   |
+-----------------------------------------------------+
```

---

## Implementation Phases

### Phase 1: Foundation (Current Session)
- [x] Design architecture
- [x] Define dual-model strategy
- [x] Define escalation criteria
- [x] Rename CMO to Cortex
- [ ] Create design document
- [ ] Extract session learnings

### Phase 2: MCP Server
- [ ] Create Cortex MCP server skeleton
- [ ] Implement `cortex__query` (Haiku)
- [ ] Implement `cortex__reflect` (Sonnet)
- [ ] Add to Claude Code MCP config

### Phase 3: Escalation Engine
- [ ] Implement escalation scoring
- [ ] Add session monitors
- [ ] Test auto-escalation

### Phase 4: Full Integration
- [ ] UserPromptSubmit hook integration
- [ ] Visual feedback system
- [ ] Cross-source memory unification
- [ ] End-to-end testing

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Name | Cortex | Brain metaphor, captures "higher reasoning" |
| Architecture | MCP Server + Hook hybrid | Clean API + automatic injection |
| Worker model | Haiku | Cheap, fast, good for classification |
| Thinker model | Sonnet | Good reasoning at reasonable cost |
| Escalation | Automatic (Haiku decides) | No user friction |
| API key | Use existing ANTHROPIC_API_KEY | No separate billing |

---

## Files to Create/Modify

### New Files
- `cortex/server.cjs` - MCP server entry point
- `cortex/haiku-worker.cjs` - Haiku operations
- `cortex/sonnet-thinker.cjs` - Sonnet operations
- `cortex/escalation.cjs` - Auto-escalation logic
- `cortex/session-monitor.cjs` - Session-level triggers

### Renamed/Modified
- `hooks/` - Update CMO references to Cortex
- `core/config.cjs` - Add Cortex config section
- Package name in `package.json`

---

## Success Criteria

1. **Visibility**: User sees Cortex is active and what it found
2. **Reasoning**: Sonnet generates useful insights during sessions
3. **Efficiency**: <$0.10/session total API cost
4. **Latency**: <200ms for Haiku queries, <2s for Sonnet reflection
5. **Learning**: Session insights are extracted and stored automatically

---

## References

- Cortex existing codebase: `/home/rob/.claude/memory/`
- Episodic Memory MCP: `mcp__plugin_episodic-memory_episodic-memory__*`
- Knowledge Graph MCP: `mcp__memory__*`
- Claude Code hooks documentation
