# Cortex Agents Guide

**Purpose**: Help AI agents work effectively in the Cortex repository without making common mistakes.

## Architecture Overview

Cortex is a **dual-model memory system** for Claude Code with these key components:

```
~/.claude/memory/
├── bin/cortex.cjs          # CLI entry point (export-vault, search, promote)
├── core/obsidian-vault.cjs # Obsidian exporter (Graph-optimized v2)
├── adapters/               # Memory sources (JSONL, Warp, Gemini, Markdown-tree)
├── cortex/server.cjs       # MCP server (7 tools: query, recall, reflect, infer, learn, consolidate, health)
├── hooks/                  # Session lifecycle hooks
└── data/                   # JSONL memories, vector index, configs
```

## Critical Commands

```bash
# Run full test suite (22 suites, 447 tests)
npm test

# Test Obsidian vault exporter specifically
node tests/test-obsidian-vault.cjs

# Export Obsidian vault (Graph-optimized)
node bin/cortex.cjs export-vault --markdown-dir /path/to/markdown --clean

# Check vector index status
ls -la data/vector/

# View memory counts
wc -l data/memories/*.jsonl
```

## Key Conventions

| Pattern | Description |
|---------|-------------|
| `*.cjs` | All code is CommonJS (not ESM) |
| `BaseAdapter` | All memory adapters extend this class |
| `MemoryRecord` | Standardized memory format with id, type, content, tags, intent |
| `_source`, `_sourceFile` | Private fields track origin (Obsidian exporter uses these) |
| `expandPath()` | Always use for paths with `~` |

## Obsidian Vault Export Structure

The exporter generates a **Graph-optimized** vault:

```
Cortex Atlas/
├── 00 Home.md          # Map of Content with navigation
├── 00 Nodes/           # Entity nodes (tags, projects, concepts)
├── 10 Records/         # Raw memory records by source
├── 20 Sources/         # Adapter indices
├── 30 Types/           # Type indices (learning, pattern, skill, etc.)
├── 40 Tags/            # Tag indices
└── manifest.json       # Export metadata
```

**Frontmatter fields**: `id`, `title`, `source`, `memory_type`, `intent`, `confidence`, `created_at`, `tags`

## Common Pitfalls

1. **Don't use ESM imports** - All files are CommonJS (`require()`)
2. **Don't skip BaseAdapter** - New adapters must extend it for proper lifecycle
3. **Don't hardcode paths** - Use `expandPath()` for `~` resolution
4. **Vector index needs initialization** - Check `data/vector/index.bin` exists
5. **SQLite stores need `open()` before use** - Connection is lazy

## Testing Quirks

- Tests are **sequential** in `npm test` script
- `test-obsidian-vault.cjs` validates the Graph-optimized export structure
- Vector tests require model cache (`~/.cache/transformers.js`)
- SQLite tests create temp DBs in `data/test-*.db`

## MCP Tool Usage

When Cortex MCP is registered, Claude can use:
- `cortex__query` - Hybrid search (vector + BM25)
- `cortex__recall` - Context retrieval
- `cortex__reflect` - Deep analysis (Sonnet)
- `cortex__learn` - Store insights
- `cortex__infer` - Find connections
- `cortex__consolidate` - Deduplicate
- `cortex__health` - System status

## Environment

- **Node**: >=18.0.0
- **SQLite**: better-sqlite3 (bundled)
- **Vectors**: hnswlib-node + sqlite-vec
- **Embeddings**: all-MiniLM-L6-v2 (384 dim, via transformers.js)

## Files That Matter Most

| File | Why Read It |
|------|-------------|
| `adapters/base-adapter.cjs` | Adapter contract and MemoryRecord format |
| `core/obsidian-vault.cjs` | Export logic and frontmatter structure |
| `core/types.cjs` | Type definitions and utility functions |
| `tests/test-obsidian-vault.cjs` | Expected export structure |
## MANDATORY INSTRUCTIONS (FOR CLAUDE, GEMINI, AND ALL AGENTS)
1. NEVER write placeholder code, stubs, or mock implementations.
2. If a feature requires an external dependency, install it and write the actual execution logic.
3. Every script must contain 100% production-ready, fully functional code.

## STRICT ANTI-PATTERNS (ZERO TOLERANCE FOR ANY AI)
- No simulation
- No faking
- No generic implementations
- No placeholders
- No stubs
- No 'fast coding' just to deliver quickly
- Every line of code MUST mean a feature fully shipped to production standard.
