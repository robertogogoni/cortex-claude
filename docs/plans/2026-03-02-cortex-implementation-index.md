# Cortex Implementation Index

> Master index linking all phase plans across the full A-K roadmap.

**Last Updated:** 2026-03-06
**Total Phases:** 11 (A, B, C, CR, D, E, F, G, H, I, J, K)
**Total Tasks:** 86 (revised from 77 — B grew from 6→9, C from 4→5)
**Estimated Effort:** ~90 days

---

## Roadmap & Design Documents

| Document | Scope | Description |
|----------|-------|-------------|
| [v3.0 Full Transformation Plan](2026-02-25-cortex-v3-full-transformation.md) | Phases A–G | Original transformation design with Phases A–G inline |
| [Unified Roadmap: Phases H-K](2026-03-02-cortex-unified-roadmap-phases-h-k.md) | Phases H–K | High-level design, dependency graph, cost analysis, academic refs |
| [CLI Renderer Design](2026-02-25-cortex-cli-renderer-design.md) | Phase CR | Streaming CLI visual layer |
| [CLI Renderer Plan](2026-02-25-cortex-cli-renderer-plan.md) | Phase CR | Implementation details (original) |
| [Phases B, C, CR, D — Design Decisions](2026-03-06-cortex-phases-b-cr-d-design-decisions.md) | Phases B–D | Audit findings, MCP protocol status, revised task lists, dual-path LLM architecture |

---

## Phase Implementation Plans

Each phase has a detailed TDD implementation plan with test-first code for every task.

| Phase | Name | Version | Tasks | Est. Days | Status | Implementation Plan |
|-------|------|---------|-------|-----------|--------|---------------------|
| **A** | Ship | v2.0.0 | 5 | 2 | **DONE** | [v3 Transformation (§A)](2026-02-25-cortex-v3-full-transformation.md) |
| **E** | Direct SQLite | v2.1.0 | 4 | 3 | **DONE** | [v3 Transformation (§E)](2026-02-25-cortex-v3-full-transformation.md) |
| **B** | Core Engine | v3.0.0 | 9 | 7 | **TDD Plan Ready** | [Phase B Plan](2026-03-06-cortex-phase-b-implementation.md) |
| **C** | Quality Engine | v3.0.0 | 5 | 6 | **TDD Plan Ready** | [Phase C Plan](2026-03-06-cortex-phase-c-implementation.md) |
| **CR** | CortexRenderer | v3.0.0 | 11 | 4 | **TDD Plan Ready** | [Phase CR Plan](2026-03-06-cortex-phase-cr-implementation.md) |
| **D** | Distribution | v3.0.0 | 3 | 4 | **TDD Plan Ready** | [Phase D Plan](2026-03-06-cortex-phase-d-implementation.md) |
| **F** | Research-Backed Retrieval | v3.0.0 | 5 | 7 | TDD Plan Ready | [Phase F Plan](2026-03-02-cortex-phase-f-implementation.md) |
| **G** | Memory Lifecycle | v3.0.0 | 3 | 5 | TDD Plan Ready | [Phase G Plan](2026-03-02-cortex-phase-g-implementation.md) |
| **H** | Human-Readable Bridge | v3.1.0 | 10 | 10 | TDD Plan Ready | [Phase H Plan](2026-03-02-cortex-phase-h-implementation.md) |
| **I** | Memory Intelligence | v3.2.0 | 11 | 10 | TDD Plan Ready | [Phase I Plan](2026-03-02-cortex-phase-i-implementation.md) |
| **J** | Advanced Memory Science | v3.3.0 | 7 | 15 | TDD Plan Ready | [Phase J Plan](2026-03-02-cortex-phase-j-implementation.md) |
| **K** | Ecosystem & Platform | v3.4.0 | 8 | 15 | TDD Plan Ready | [Phase K Plan](2026-03-02-cortex-phase-k-implementation.md) |

---

## Dependency Graph (Updated 2026-03-06)

```
Phase A ✅ ─→ Phase B (Dual-path LLM: DirectAPI primary + MCP Sampling stub)
Phase E ✅ ─┘     │
                  ├─→ Phase C (needs B for LlmProvider, tool-based curation)
                  ├─→ Phase D (needs B for HyDE via LlmProvider)
                  │         │
                  ├─→ Phase F (needs B for LlmProvider; retrieval)
                  │         │
                  ├─→ Phase G (needs F's types + anchors)
                  │         │
                  └─→ Phase H (needs G's CRUD, F's FTS5, B's LlmProvider)
                              │
                              ├─→ Phase I (needs H's bridge)
                              │         │
                              ├─→ Phase J (needs F + G + I)
                              │
                              └─→ Phase K (needs J for mesh/sync, I for routing)

Phase CR runs in parallel (no deps on B-K)
```

### Key Architecture Change (2026-03-06)

MCP Sampling (`sampling/createMessage`) is **not supported** in Claude Code (issue #1785).
MCP Elicitation (`elicitation/create`) is also **not supported** (issues #2799, #7108).

**Resolution:** Dual-path `LlmProvider` interface:
- `DirectApiProvider` — primary path, uses Anthropic SDK + user's API key
- `SamplingProvider` — stub for future, auto-detected via MCP capability negotiation
- `ProviderFactory.detectBestProvider()` — transparent fallback

Phase C's curation uses tool-based responses instead of MCP Elicitation.

---

## Quick Reference: What's Where

| If you need... | Go to... |
|----------------|----------|
| Why we're building phases H-K | [Unified Roadmap §1: Motivation](2026-03-02-cortex-unified-roadmap-phases-h-k.md) |
| Dependency graph with all phases | [Unified Roadmap §4](2026-03-02-cortex-unified-roadmap-phases-h-k.md) |
| Cost analysis (API, infra) | [Unified Roadmap §10](2026-03-02-cortex-unified-roadmap-phases-h-k.md) |
| Academic references (FSRS-6, RL, etc.) | [Unified Roadmap §14](2026-03-02-cortex-unified-roadmap-phases-h-k.md) |
| Phase A/E audit & MCP protocol status | [Design Decisions](2026-03-06-cortex-phases-b-cr-d-design-decisions.md) |
| CORTEX_E200 (validateArray) bug details | [Phase B Plan §B0-d](2026-03-06-cortex-phase-b-implementation.md) |
| Dual-path LlmProvider architecture | [Phase B Plan §B1-B2](2026-03-06-cortex-phase-b-implementation.md) |
| Test-first code for any specific task | Individual phase plan (table above) |
| Phases A-E original specs | [v3 Transformation](2026-02-25-cortex-v3-full-transformation.md) |
| Combined H-K inline (legacy) | [Phases H-K Combined](2026-03-02-cortex-phases-h-k-implementation.md) |

---

## File Inventory

```
docs/plans/
├── 2026-02-25-cortex-v3-full-transformation.md     # Phases A-G (original)
├── 2026-02-25-cortex-cli-renderer-design.md         # Phase CR design
├── 2026-02-25-cortex-cli-renderer-plan.md           # Phase CR implementation (original)
├── 2026-03-02-cortex-unified-roadmap-phases-h-k.md  # H-K roadmap & design
├── 2026-03-02-cortex-phases-h-k-implementation.md   # H-K combined (legacy)
├── 2026-03-02-cortex-implementation-index.md         # ← THIS FILE
├── 2026-03-02-cortex-phase-f-implementation.md       # Phase F TDD plan
├── 2026-03-02-cortex-phase-g-implementation.md       # Phase G TDD plan
├── 2026-03-02-cortex-phase-h-implementation.md       # Phase H TDD plan
├── 2026-03-02-cortex-phase-i-implementation.md       # Phase I TDD plan
├── 2026-03-02-cortex-phase-j-implementation.md       # Phase J TDD plan
├── 2026-03-02-cortex-phase-k-implementation.md       # Phase K TDD plan
├── 2026-03-06-cortex-phases-b-cr-d-design-decisions.md  # B-D design decisions + audit
├── 2026-03-06-cortex-phase-b-implementation.md       # Phase B TDD plan (9 tasks, 2839 lines)
├── 2026-03-06-cortex-phase-c-implementation.md       # Phase C TDD plan (5 tasks, 2519 lines)
├── 2026-03-06-cortex-phase-cr-implementation.md      # Phase CR TDD plan (11 tasks, 2952 lines)
└── 2026-03-06-cortex-phase-d-implementation.md       # Phase D TDD plan (3 tasks, 1240 lines)
```
