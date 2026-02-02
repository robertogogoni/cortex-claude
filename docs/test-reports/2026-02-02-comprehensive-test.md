# Cortex MCP Comprehensive Test Report

**Date**: 2026-02-02
**Tester**: Claude Opus 4.5
**Environment**: Arch Linux (macbook-air), Node.js v25.1.0

## Executive Summary

All 6 MCP tools are functional. Unit tests pass (142/142). However, **vector search is not operational** because memories stored via the `learn` tool go to JSONL files (insights.jsonl), not the SQLite database that backs vector search. Newly inserted memories are not found in searches.

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Tools (6) | PASS | All tools respond correctly |
| Unit Tests (142) | PASS | 100% pass rate |
| Vector Search | FAIL | Database empty, embeddings not backfilled |
| JSONL Storage | PASS | Memories stored correctly |
| Haiku Integration | PASS | Semantic analysis working |
| Sonnet Integration | PASS | Reflect/Infer tools working |

## 1. MCP Tool Tests

### 1.1 cortex__query
- **Status**: PASS
- **Response Time**: 7-18 seconds (includes Haiku API calls)
- **Behavior**: Returns memories with relevance scores, analysis object with keywords/intent/criteria
- **Sample Query**: "debugging patterns" returned 5 results from JSONL long-term memory
- **Issue**: Results come from keyword/BM25 search, not vector similarity (embeddings are null)

### 1.2 cortex__recall
- **Status**: PASS
- **Response Time**: ~15 seconds
- **Behavior**: Returns memories matching context with semantic analysis
- **Sample Query**: "Chrome extension troubleshooting" returned 5 relevant memories
- **Note**: Uses Haiku for analysis, falls back to keyword matching

### 1.3 cortex__reflect
- **Status**: PASS
- **Response Time**: ~10 seconds
- **Behavior**: Uses Sonnet for deep reflection on topics
- **Sample Topic**: "testing MCP tools" generated coherent reflection with actionable insights
- **Cost Tracking**: Shows ~$0.0125 per reflection

### 1.4 cortex__infer
- **Status**: PASS
- **Response Time**: ~20 seconds
- **Behavior**: Uses Sonnet to find connections between concepts
- **Sample Concepts**: ["cross-machine sync", "memory persistence", "Claude Code"]
- **Output**: Detailed markdown with strong/medium/speculative connections

### 1.5 cortex__learn
- **Status**: PASS
- **Response Time**: ~6 seconds
- **Behavior**: Stores insights to insights.jsonl with quality analysis
- **Validation**: Rejects tags with special characters (e.g., "n+1" rejected)
- **Issue**: Stored memories not indexed for vector search

### 1.6 cortex__consolidate
- **Status**: PASS (with limitation)
- **Response Time**: ~11 seconds
- **Behavior**: Analyzes memories for duplicates/merges (dry run mode)
- **Note**: Analysis showed "no changes recommended" - may need more data

## 2. Stress Test Results

### 2.1 Memory Insertion
- **Inserted**: 21 test memories covering React, TypeScript, Git, Docker, PostgreSQL, etc.
- **Storage Location**: `/home/rob/.claude/memory/data/memories/insights.jsonl`
- **Validation**: All 21 stored successfully

### 2.2 Search Relevance
| Query | Expected Match | Found | Relevance |
|-------|---------------|-------|-----------|
| "React hooks memory leak" | React useEffect cleanup | NO | 0.36 (wrong result) |
| "PostgreSQL EXPLAIN BUFFERS" | PostgreSQL EXPLAIN insight | NO | 0.35 (wrong result) |
| "database performance" | MongoDB/PostgreSQL tips | NO | 0.27 (wrong result) |

**Root Cause**: Newly inserted memories go to `insights.jsonl`, but JSONLAdapter only searches:
- working.jsonl
- short-term.jsonl
- long-term.jsonl
- skills/index.jsonl

### 2.3 Edge Cases
| Test | Query | Result |
|------|-------|--------|
| Empty query | "" | Properly rejected with error |
| Very long query | 400+ chars | Processed correctly, 22 results found |
| Special characters | "@#$%^&*..." | Handled gracefully, 5 results |

## 3. Embedding Backfill Verification

### 3.1 Vector Index Status
```
vectorCount: 0
deletedCount: 0
nextPosition: 0
fillRatio: 0
```

### 3.2 SQLite Memories Table
```
Total memories: 0
With embeddings: 0
```

### 3.3 JSONL File Status
| File | Records |
|------|---------|
| insights.jsonl | 29 |
| learnings.jsonl | 0 |
| long-term.jsonl | 636 |
| short-term.jsonl | 0 |
| working.jsonl | 30 |
| **Total** | 695 |

### 3.4 Diagnosis
The system has two separate storage mechanisms:
1. **JSONL files** (working) - Used by adapters for immediate storage
2. **SQLite + Vector Index** (not working) - Empty, never populated

The `backfillEmbeddings()` method exists in `vector-search-provider.cjs` but operates on SQLite, which has no data.

## 4. Unit Test Results

```
Core Tests:         34/34 PASS
Hooks Tests:        25/25 PASS
LADS Tests:         31/31 PASS
SQLite Store Tests: 52/52 PASS
─────────────────────────────
Total:             142/142 PASS (100%)
```

### Test Categories Covered
- Types and Utilities
- JSONL Storage
- Lock Manager
- Write Queue
- Error Handler (Circuit Breaker, Retry, Degradation)
- Config Manager
- Context Analyzer
- Query Orchestrator
- Extraction Engine
- Session Hooks
- Pattern Tracker
- Outcome Scorer
- Config Evolver
- Docs Writer
- LADS Orchestrator
- SQLite Store (constructor, connection, queries, writes, transactions, introspection)

## 5. Performance Observations

### 5.1 Response Times
| Tool | Avg Time | Notes |
|------|----------|-------|
| query | 12-18s | Multiple Haiku API calls |
| recall | 14-15s | Haiku analysis + search |
| reflect | 10s | Single Sonnet call |
| infer | 20s | Sonnet with memory context |
| learn | 6s | Haiku analysis + JSONL write |
| consolidate | 11s | Sonnet analysis |

### 5.2 API Cost Estimates
- Query/Recall: ~$0.001 per call (Haiku)
- Reflect: ~$0.0125 per call (Sonnet)
- Infer: ~$0.0276 per call (Sonnet)
- Learn: ~$0.001 per call (Haiku)

## 6. Critical Issues

### 6.1 HIGH: Vector Search Non-Functional
**Description**: Vector similarity search is not working because:
1. `learn` tool stores to `insights.jsonl`
2. `insights.jsonl` is not in JSONLAdapter's configured sources
3. SQLite memories table is empty (0 records)
4. Vector index has 0 vectors

**Impact**: Search relies entirely on keyword/BM25 matching, losing semantic capabilities.

**Fix Required**:
1. Add `insights.jsonl` to JSONLAdapter sources, OR
2. Implement sync from JSONL to SQLite, OR
3. Have `learn` tool write to both JSONL and SQLite

### 6.2 MEDIUM: Tag Validation Too Strict
**Description**: Tags containing special characters (e.g., "n+1") are rejected.

**Impact**: Unable to tag memories with common technical terms like "N+1 problem".

**Fix**: Allow alphanumeric characters plus hyphen and underscore.

### 6.3 LOW: Slow Query Performance
**Description**: Queries take 12-18 seconds due to multiple Haiku API calls.

**Impact**: User experience degraded for frequent queries.

**Optimization**: Cache Haiku responses more aggressively, reduce API calls per query.

## 7. Recommendations

### Immediate (P0)
1. Fix insights.jsonl not being searched - add to JSONLAdapter sources
2. Implement backfill from JSONL to SQLite for vector search

### Short-term (P1)
1. Relax tag validation to allow more characters
2. Reduce Haiku API calls per query (currently 5-20 calls)
3. Add progress indicators for long-running operations

### Long-term (P2)
1. Implement automatic embedding generation on JSONL write
2. Add periodic sync between JSONL and SQLite
3. Consider consolidating storage to single source of truth

## 8. Test Artifacts

- Test memories inserted: 21 records in insights.jsonl
- Log file: `logs/cortex-2026-02-02.jsonl`
- Unit test output: All 142 tests passing

## Appendix A: Test Memory IDs

```
insight_1770014201614_ojopat (Jest mocking)
insight_1770014209576_5ttbm4 (SSH forwarding)
insight_1770014216783_ymerjl (Webpack code splitting)
insight_1770014223839_n2bzqw (systemd dependencies)
insight_1770014230981_6s9kxz (Go context.Context)
... and 16 more
```

## Appendix B: Environment Details

```yaml
Node.js: v25.1.0
Platform: linux x64
Memory: 8GB
SQLite: better-sqlite3
Vector Index: hnswlib-node (384 dimensions, cosine)
Embeddings: Xenova/all-MiniLM-L6-v2
```
