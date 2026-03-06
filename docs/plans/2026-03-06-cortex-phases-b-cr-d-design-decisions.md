# Cortex Phases B, C, CR, D — Revised Design Decisions

> Design document capturing audit findings and revised architecture before TDD plan writing.
> **Date:** 2026-03-06
> **Claude Code Version:** 2.1.70
> **Cortex Version:** 3.0.0

---

## 1. Audit Findings (Phase A & E)

### Phase E: Direct SQLite (v2.1.0) — CLEAN
- 4/4 tasks complete, implementation exceeds spec
- Bonus: WarpSQLiteAdapter (unplanned addition)
- No action needed

### Phase A: Ship (v2.0.0) — HAS GAPS
| Task | Gap | Resolution |
|------|-----|------------|
| A1: Version Mismatch | TDD test never written | Add to Phase B as B0-a |
| A2: Injection Format | Constructor defaults to `'rich'` not `'neural'` (line 84), test never written | Add to Phase B as B0-b |
| A3: GitHub Topics | `gh repo edit --add-topic` unverifiable | Add to Phase B as B0-c |

### CORTEX_E200: Input Validation Bug
- **Location:** `core/validation.cjs:137` — `validateArray()` rejects string inputs
- **Affects:** `cortex__learn` (tags), `cortex__query` (sources), `cortex__infer` (concepts)
- **Resolution:** Add to Phase B as B0-d (input resilience)

---

## 2. Critical Protocol Status (as of 2026-03-06)

| MCP Feature | Supported in Claude Code? | Impact | Reference |
|-------------|--------------------------|--------|-----------|
| **MCP Sampling** (`sampling/createMessage`) | **NO** | Phase B primary path must be Direct API | [#1785](https://github.com/anthropics/claude-code/issues/1785) |
| **MCP Elicitation** (`elicitation/create`) | **NO** | Phase C Task C4 must use tool-based curation | [#2799](https://github.com/anthropics/claude-code/issues/2799), [#7108](https://github.com/anthropics/claude-code/issues/7108) |
| `InstructionsLoaded` hook | **YES** | New opportunity for memory sync | v2.1.63+ |
| `ConfigChange` hook | **YES** | New opportunity for re-injection triggers | v2.1.63+ |
| HTTP Hooks | **YES** | Alternative hook delivery | v2.1.63+ |
| Auto-Memory (`/memory`) | **YES** | Must deconflict with Cortex memory | v2.1.69+ |

---

## 3. Revised Phase B: Core Engine

### Architecture: Dual-Path LLM Provider

```
LlmProvider (interface)
  |
  +-- DirectApiProvider (PRIMARY — uses Anthropic SDK + user's API key)
  |     - Works everywhere (CI, standalone, any host)
  |     - Costs real API credits
  |     - Already functional in current Cortex (HaikuWorker, etc.)
  |
  +-- SamplingProvider (FUTURE — uses MCP sampling/createMessage)
        - Zero marginal cost (piggybacks on host's API connection)
        - Only works inside MCP-sampling-capable hosts
        - Auto-detected at runtime via capability negotiation
        - Stub implementation now, activate when Claude Code adds support

ProviderFactory
  - detectBestProvider(): checks MCP capabilities first, falls back to Direct API
  - Transparent to callers — HaikuWorker, SonnetWorker use LlmProvider interface
```

### Revised Task List

| Task | Name | Description |
|------|------|-------------|
| **B0** | Phase A Debt + Input Resilience | a) Version test, b) Injection format fix+test, c) GitHub topics, d) validateArray resilience |
| **B1** | LlmProvider Interface + DirectApiProvider | Abstract LLM interface, Direct API as primary implementation |
| **B2** | SamplingProvider Stub + ProviderFactory | MCP Sampling stub (future), auto-detection factory |
| **B3** | Integrate LlmProvider into HaikuWorker | Replace raw API calls with provider pattern |
| **B4** | PreCompact Hook | Capture context before Claude compresses conversation |
| **B5** | Stop Hook for Continuous Capture | Save memories on session end |
| **B6** | InstructionsLoaded Hook Integration | Sync/inject memories when CLAUDE.md loads |
| **B7** | Visual Pipeline Fix — Neural Themes in MCP Responses | Fix theme rendering in tool responses |
| **B8** | Unify Color Systems | Single color system across CLI and MCP |

---

## 4. Revised Phase C: Quality Engine

| Task | Name | Change from Original |
|------|------|---------------------|
| **C1** | Write Gate (Extraction Engine) | Unchanged |
| **C2** | Bi-Temporal Memory Schema | Unchanged |
| **C3** | Confidence Decay | Unchanged |
| **C4** | Tool-Based Memory Curation | **CHANGED**: Was MCP Elicitation, now uses MCP tool responses to ask user curation questions (e.g., "Should I keep this memory?") |
| **C5** | Auto-Memory Deconfliction | **NEW**: Ensure Cortex and Claude Code's built-in Auto-Memory (`/memory`) don't duplicate or conflict |

---

## 5. Phase CR: CortexRenderer (unchanged)

No MCP protocol dependencies. 11 tasks as originally designed.
Runs in parallel with B-D (no dependency chain).

---

## 6. Revised Phase D: Distribution

| Task | Name | Change from Original |
|------|------|---------------------|
| **D1** | Plugin Manifest | Unchanged |
| **D2** | HyDE Query Expansion | Uses LlmProvider (DirectApiProvider) instead of MCP Sampling |
| **D3** | Terminal Demo GIF | Unchanged |

---

## 7. Dependency Graph (Updated)

```
Phase A debt ──┐
CORTEX_E200 ───┤
               v
Phase B (Core Engine + LlmProvider)
  |
  +---> Phase C (Quality Engine + Tool-Based Curation)
  |         |
  +---> Phase D (Distribution + HyDE via LlmProvider)
  |         |
  +---> Phase F (Research-Backed Retrieval) [TDD plan exists]
  |         |
  |         v
  |     Phase G (Memory Lifecycle) [TDD plan exists]
  |         |
  |         v
  |     Phase H (Human-Readable Bridge) [TDD plan exists]
  |         |
  |         v
  |     Phase I (Memory Intelligence) [TDD plan exists]
  |         |
  |         v
  |     Phase J (Advanced Memory Science) [TDD plan exists]
  |         |
  |         v
  |     Phase K (Ecosystem & Platform) [TDD plan exists]
  |
  +---> Phase CR (CortexRenderer) [parallel, no deps]
```

---

## 8. New Hook Events to Leverage

| Hook | When | Cortex Use |
|------|------|-----------|
| `InstructionsLoaded` | CLAUDE.md loads | Trigger memory injection, sync check |
| `ConfigChange` | Settings change | Re-evaluate adapter configs |
| `SessionStart` | Session begins | Memory injection (existing) |
| `PreCompact` | Before context compression | Save context about to be lost |
| `Stop` / `SessionEnd` | Session ends | Extract and consolidate memories |

---

## 9. Total Task Count (Phases B, C, CR, D)

| Phase | Tasks | Est. Days |
|-------|-------|-----------|
| B (Core Engine) | 9 (including B0 debt) | 7 |
| C (Quality Engine) | 5 (including C5 new) | 6 |
| CR (CortexRenderer) | 11 | 4 |
| D (Distribution) | 3 | 4 |
| **Total** | **28 tasks** | **21 days** |
