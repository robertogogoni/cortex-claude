# Cortex MCP Roadmap

```
+=======================================================================+
|                                                                       |
|     ██████╗ ██████╗ ██████╗ ████████╗███████╗██╗  ██╗                 |
|    ██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝                 |
|    ██║     ██║   ██║██████╔╝   ██║   █████╗   ╚███╔╝                  |
|    ██║     ██║   ██║██╔══██╗   ██║   ██╔══╝   ██╔██╗                  |
|    ╚██████╗╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗                 |
|     ╚═════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝                 |
|                                                                       |
|              ROADMAP - Claude's Cognitive Layer                       |
|                                                                       |
+=======================================================================+
```

**Version**: 2.0.0
**Last Updated**: 2026-02-02
**Status**: Production Ready

---

## Executive Summary

Cortex is a **production-ready** dual-model cognitive layer for Claude Code that provides true cross-session memory through auto-extraction, auto-recall, vector search, and compounding learnings.

### Quick Stats

| Metric | Value |
|--------|-------|
| **Test Coverage** | 142/142 passing |
| **Lines of Code** | ~94,693 |
| **MCP Tools** | 6 |
| **Memory Adapters** | 7 |
| **Vector Index** | 672 embeddings |

---

## Current Status (v2.0.0)

```
+===========================================================================+
|                         FEATURE COMPLETENESS                              |
+===========================================================================+
|                                                                           |
|  Core Tools          [##########] 100%   6/6 tools implemented            |
|  Memory Adapters     [##########] 100%   7/7 adapters working             |
|  Vector Search       [##########] 100%   HNSW + BM25 + RRF fusion         |
|  Tier Promotion      [##########] 100%   Working -> Short -> Long-term    |
|  MCP Protocol        [##########] 100%   Tools, Resources, Prompts        |
|  Security            [##########] 100%   AES-256-GCM, validation, limits  |
|  UX Enhancements     [########--]  91%   39/43 tasks complete             |
|                                                                           |
+===========================================================================+
```

---

## Completed Phases

### Phase 1: Cognitive Layer Design (2026-01-26)

| Component | Status | Description |
|-----------|--------|-------------|
| Architecture | Done | Dual-model (Haiku + Sonnet) design |
| Escalation Engine | Done | Auto-escalation based on complexity/confidence |
| MCP Server | Done | 6 tools: query, recall, reflect, infer, learn, consolidate |
| Memory Unification | Done | 7 adapters behind single API |

**Key Design Decisions**:
- **Haiku** (~$0.25/1M tokens): Fast queries, intent classification, keyword extraction
- **Sonnet** (~$3/1M tokens): Deep reasoning, reflection, insight generation
- **Auto-escalation**: Haiku decides when to involve Sonnet based on scoring

### Phase 2: UX Enhancements (2026-01-27)

| Sub-Phase | Tasks | Status |
|-----------|-------|--------|
| Documentation & README | 6 | Done |
| Core Skills (/cortex commands) | 8 | Done |
| MCP Resources | 4 | Done |
| MCP Prompts | 4 | Done |
| Security Hardening | 5 | Done |
| Future-Proofing | 4 | 3/4 Done |

**Skills Implemented**:
```
/cortex              Status overview
/cortex help         Command reference
/cortex stats        Memory counts & costs
/cortex health       System health check
/cortex query "X"    Search memories
/cortex recall       Context retrieval
/cortex reflect "X"  Meta-analysis (Sonnet)
/cortex infer A B    Find connections (Sonnet)
/cortex learn "X"    Store insight (Sonnet)
/cortex consolidate  Clean up duplicates
/cortex log          View activity logs
/cortex config       View/edit configuration
/cortex export       Export memories
/cortex session      Current session summary
```

### Phase 3: Vector Search (2026-02-02)

| Component | Status | Details |
|-----------|--------|---------|
| Embedder | Done | all-MiniLM-L6-v2 (384 dimensions) |
| VectorIndex | Done | HNSW algorithm via hnswlib-node |
| BM25 Search | Done | Full-text via SQLite FTS5 |
| Hybrid Search | Done | RRF fusion (vector 0.6 + BM25 0.4) |
| Backfill Script | Done | 672 memories indexed |
| Dual-Write | Done | JSONL + Vector on learn() |

**Performance**:
- Search: ~5-50ms
- Insert: ~10-20ms (includes embedding)
- Query latency: 714ms average (94% improvement from 12-18s)

### Phase 4: Quick Wins (2026-02-02)

| Feature | File | Status |
|---------|------|--------|
| Memory Scheduler | `core/memory-scheduler.cjs` | Done |
| Usage Tracking | `hooks/query-orchestrator.cjs` | Done |
| Health Check Tool | `cortex/server.cjs` | Done |

---

## In Progress

### Phase 5: UX Polish

| Task | Priority | Status |
|------|----------|--------|
| Work-in-progress detection | Medium | Pending |
| Progress tracking for long ops | Medium | Pending |
| Improved error messages | Medium | Pending |
| Inline cost warnings | Low | Pending |
| Activity indicator | Low | Pending |
| First-run onboarding | Low | Pending |

### Phase 6: MCP Sampling

| Task | Status | Notes |
|------|--------|-------|
| Sampling capability | Design Done | Prepared but not exposed |
| Reflect enhancement | Design Done | Multi-step reasoning ready |
| Documentation | Done | |

---

## Planned (Next Sprint)

### Phase 7: Adapter Expansion

Detailed plan in: `docs/plans/2026-02-01-cortex-adapter-expansion.md`

```
+-----------------------------------------------------------------------+
|                      ADAPTER EXPANSION PLAN                           |
+-----------------------------------------------------------------------+
|                                                                       |
|  Task 1: SQLiteStore Base Class                                       |
|  +-- File: core/sqlite-store.cjs                                      |
|  +-- Purpose: Reusable SQLite ops with connection pooling             |
|  +-- Status: Planned                                                  |
|                                                                       |
|  Task 2: WarpSQLiteAdapter Enhancement                                |
|  +-- File: adapters/warp-sqlite-adapter.cjs                           |
|  +-- Purpose: Read AI queries from Warp Terminal                      |
|  +-- Status: Planned                                                  |
|                                                                       |
|  Task 3: GeminiAdapter Enhancement                                    |
|  +-- File: adapters/gemini-adapter.cjs                                |
|  +-- Purpose: Parse Gemini task sessions                              |
|  +-- Status: Planned                                                  |
|                                                                       |
|  Task 4: EpisodicAnnotationsLayer                                     |
|  +-- File: adapters/episodic-annotations-adapter.cjs                  |
|  +-- Purpose: Write ops on read-only episodic archives                |
|  +-- Status: Planned                                                  |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Phase 8: Operational Tooling

| Feature | Priority | Effort | Description |
|---------|----------|--------|-------------|
| HTTP API Bridge | Medium | ~200 LOC | REST access for debugging/dashboards |
| Backup/Restore | Medium | ~100 LOC | Data safety for production |
| Streaming Responses | Medium | ~50 LOC | Better UX for large responses |
| /cortex forget | Medium | ~50 LOC | Memory deletion with confirmation |
| CLI Interface | Low | ~150 LOC | Standalone cortex CLI |
| Metrics/Telemetry | Low | ~100 LOC | Usage analytics |

---

## Long-Term Roadmap

### Phase 9: Advanced Features

| Feature | Priority | Notes |
|---------|----------|-------|
| Web Dashboard | Low | Visual memory management |
| Document Ingestion | Low | PDF/MD/JSON parsing |
| External Embedding APIs | Low | Ollama/vLLM integration |
| Knowledge Graph Visualization | Low | D3.js graph view |

### Phase 10: Enterprise Features

| Feature | Priority | Notes |
|---------|----------|-------|
| OAuth 2.0 Support | Low | Out of scope for local deployment |
| Multi-user Support | Low | Requires auth layer |
| Cloud Sync | Low | Cross-machine memory sync |

---

## Deferred

| Feature | Reason | Status |
|---------|--------|--------|
| MCP Elicitation | Requires Claude Code client support | Waiting for SDK |
| Python SDK v2 Compat | SDK v2 not yet released | Waiting for release |

---

## Comparison vs Reference Implementations

```
+===========================================================================+
|                    FEATURE COMPARISON MATRIX                              |
+===========================================================================+
|                                                                           |
|  Feature              | Cortex    | server-memory | mcp-memory-service   |
|  ---------------------|-----------|---------------|----------------------|
|  Language             | JS (CJS)  | TypeScript    | Python               |
|  AI Integration       | Haiku+Son | None          | Local ONNX           |
|  Search Type          | Hybrid    | Substring     | Hybrid               |
|  Storage Adapters     | 7         | 1 (JSONL)     | SQLite               |
|  Tools Count          | 6         | 9 (CRUD)      | 8                    |
|  Web Dashboard        | No        | No            | Yes                  |
|  Lines of Code        | ~94K      | ~500          | Very High            |
|                                                                           |
+===========================================================================+

Legend:
  Cortex           = This project
  server-memory    = @modelcontextprotocol/server-memory (official)
  mcp-memory-service = doobidoo/mcp-memory-service (community)
```

**Conclusion**: Cortex exceeds both reference implementations in core memory operations. Main gaps are operational tooling (HTTP API, backup) and UI (dashboard).

---

## Architecture Overview

```
+======================================================================+
|                        CLAUDE CODE SESSION                           |
+======================================================================+
                                 |
                                 v
+======================================================================+
|                        CORTEX MCP SERVER                             |
+----------------------------------------------------------------------+
|                                                                      |
|   +------------------------+      +---------------------------+      |
|   |     HAIKU WORKER       |      |     SONNET THINKER        |      |
|   |     (Fast, Cheap)      |      |     (Deep Reasoning)      |      |
|   |                        |      |                           |      |
|   |   o query              |      |   * reflect               |      |
|   |   o recall             |      |   * infer                 |      |
|   |                        |      |   * learn                 |      |
|   |   ~$0.25/1M tokens     |      |   * consolidate           |      |
|   |                        |      |   ~$3/1M tokens           |      |
|   +----------+-------------+      +-----------+---------------+      |
|              |                                |                      |
|              +----------------+---------------+                      |
|                               |                                      |
|                               v                                      |
|   +----------------------------------------------------------+      |
|   |              VECTOR SEARCH ENGINE                         |      |
|   |                                                           |      |
|   |    HNSW Index    |    BM25    |    RRF Fusion            |      |
|   |    672 vectors   |   FTS5     |   Hybrid ranking         |      |
|   |                                                           |      |
|   |    Local Embeddings: all-MiniLM-L6-v2 (384 dim)          |      |
|   +----------------------------------------------------------+      |
|                                                                      |
+======================================================================+
                    |                           |
        +-----------+-----------+   +-----------+-------------+
        |    SESSION START      |   |      SESSION END        |
        |-----------------------|   |-------------------------|
        |  - Context Analyzer   |   |  - Extraction Engine    |
        |  - Query Orchestrator |   |  - Pattern Tracker      |
        |  - Memory Injection   |   |  - Outcome Scorer       |
        +-----------------------+   +-------------------------+
                    |                           |
                    +-------------+-------------+
                                  |
                                  v
        +------------------------------------------------------+
        |                 MEMORY ADAPTERS (7)                   |
        |                                                       |
        |  +----------+  +----------+  +----------+  +-------+  |
        |  |  JSONL   |  | Episodic |  | KnowGraph|  |Claude |  |
        |  | Storage  |  |  Memory  |  |   MCP    |  |  .md  |  |
        |  +----------+  +----------+  +----------+  +-------+  |
        |                                                       |
        |  +----------+  +----------+  +----------+             |
        |  |  Gemini  |  |   Warp   |  |  Vector  |             |
        |  | Sessions |  |  SQLite  |  |  Search  |             |
        |  +----------+  +----------+  +----------+             |
        +------------------------------------------------------+
```

---

## File Structure

```
~/.claude/memory/
|
+-- cortex/                    # MCP Server
|   +-- server.cjs             # Main entry point (954 lines)
|   +-- haiku-worker.cjs       # Fast operations (310 lines)
|   +-- sonnet-thinker.cjs     # Deep reasoning (695 lines)
|   +-- prompts/               # MCP Prompt templates
|
+-- core/                      # Core Infrastructure
|   +-- storage.cjs            # JSONL persistence
|   +-- validation.cjs         # Input validation
|   +-- tier-promotion.cjs     # Memory lifecycle
|   +-- memory-scheduler.cjs   # Background tasks
|   +-- vector-search-provider.cjs  # Hybrid search
|   +-- embedder.cjs           # Local embeddings
|   +-- hybrid-search.cjs      # RRF fusion
|
+-- adapters/                  # Memory Sources
|   +-- index.cjs              # Adapter registry
|   +-- base-adapter.cjs       # Interface
|   +-- jsonl-adapter.cjs      # File storage
|   +-- episodic-memory-adapter.cjs
|   +-- knowledge-graph-adapter.cjs
|   +-- claudemd-adapter.cjs
|   +-- gemini-adapter.cjs
|   +-- warp-sqlite-adapter.cjs
|   +-- vector-search-adapter.cjs
|
+-- hooks/                     # Claude Code Hooks
|   +-- session-start.cjs      # Auto-inject context
|   +-- session-end.cjs        # Extract learnings
|   +-- query-orchestrator.cjs # Coordinate queries
|
+-- skills/                    # User Skills
|   +-- cortex/SKILL.md        # /cortex commands
|
+-- data/                      # Storage
|   +-- memories/              # JSONL files
|   +-- memories.db            # SQLite + vectors
|   +-- vector/                # HNSW index
|
+-- docs/                      # Documentation
|   +-- API.md                 # Complete reference
|   +-- EXAMPLES.md            # Usage patterns
|   +-- plans/                 # Implementation plans
|
+-- tests/                     # Test Suite
|   +-- *.test.cjs             # 142 tests
```

---

## Contributing

1. Check the roadmap for available tasks
2. Read relevant plan documents in `docs/plans/`
3. Follow TDD: Write tests first
4. Run `npm test` before submitting
5. Update this roadmap when completing phases

---

## Plan Documents

| Document | Date | Focus |
|----------|------|-------|
| [Cognitive Layer Design](docs/plans/2026-01-26-cortex-cognitive-layer-design.md) | 2026-01-26 | Architecture |
| [UX Enhancements](docs/plans/2026-01-27-cortex-ux-enhancements.md) | 2026-01-27 | 43 tasks |
| [Adapter Expansion](docs/plans/2026-02-01-cortex-adapter-expansion.md) | 2026-02-01 | SQLite, Warp, Gemini |
| [Feature Gap Analysis](docs/feature-gap-analysis-2026-02-02.md) | 2026-02-02 | Comparison |

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 2.0.0 | 2026-02-02 | Vector search, 142 tests, production ready |
| 1.5.0 | 2026-01-27 | UX enhancements, MCP resources/prompts |
| 1.0.0 | 2026-01-26 | Initial dual-model architecture |

---

**Made with the Claude Code community**
