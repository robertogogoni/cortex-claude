# Cortex Memory Orchestrator - Design Document

**Version**: 2.0.0
**Status**: Implementation Complete (with full CRUD)

## Overview

Cortex is Claude's Cognitive Layer - a multi-source memory system that provides cross-session memory, pattern recognition, and contextual awareness.

## Section 2: Adapter Architecture

The adapter pattern enables pluggable memory sources with graceful degradation.

### Section 2.1: Base Adapter

All adapters extend `BaseAdapter` which provides:
- Priority-based ranking (0.0-1.0)
- Query timeout management
- Statistics and error tracking (reads and writes)
- Cache management helpers
- Optional write interface (`supportsWrite()`, `write()`, `update()`, `delete()`, `archive()`)

### Section 2.2: Write Operations

Adapters that support writes implement these methods:

| Method | Purpose | Returns |
|--------|---------|---------|
| `supportsWrite()` | Check if adapter can write | `boolean` |
| `write(record, options)` | Create new memory | `WriteResult` |
| `update(id, updates, options)` | Update existing memory | `WriteResult` |
| `delete(id, options)` | Delete memory | `WriteResult` |
| `archive(id)` | Soft delete (recoverable) | `WriteResult` |

### Section 2.3: Adapter Implementations

#### Section 2.3.1: JSONL Adapter
Local file-based storage for working, short-term, and long-term memories.
- Priority: 1.0 (highest - always available)
- Timeout: 100ms
- **Write Support**: Full CRUD
  - `write()` - Smart target selection based on record type
  - `update()` - Updates in-place
  - `delete()` - Soft or hard delete
  - `archive()` - Mark as archived
  - `compact()` - Remove deleted records
  - `getById()` - Direct record access

#### Section 2.3.2: Episodic Memory Adapter
MCP-based access to 233+ archived conversations.
- Priority: 0.9
- Timeout: 3000ms
- **Read Support**: Full
  - `query()` - Semantic and text search
  - `read()` - Full conversation by path
  - `show()` - Conversation with metadata
  - `searchWithContext()` - Search + read combined
- **Write Support**: No (conversations are read-only archives)

#### Section 2.3.3: Knowledge Graph Adapter
MCP-based structured knowledge storage.
- Priority: 0.8
- Timeout: 2000ms
- **Write Support**: Full
  - `write()` - Create entity from MemoryRecord
  - `update()` - Add observations to entity
  - `delete()` - Delete entity
  - `createEntities()` - Batch entity creation
  - `createRelations()` - Link entities
  - `addObservations()` - Add facts to entity
  - `deleteEntities()` - Batch delete
  - `deleteRelations()` - Remove links
  - `deleteObservations()` - Remove specific facts

#### Section 2.3.4: CLAUDE.md Adapter
Parses user-curated CLAUDE.md files.
- Priority: 0.85
- Timeout: 100ms
- High confidence (user-curated content)
- **Write Support**: No (user-maintained files)

#### Section 2.3.5: Warp SQLite Adapter
Local SQLite storage for Warp Terminal AI history.
- Priority: 0.75
- Timeout: 500ms
- **Read Support**: Full
  - `query()` - Search ai_queries and agent_conversations
  - `getTotalCounts()` - Statistics across all databases
- **Write Support**: No (Warp manages its own database)
- **Data Sources**:
  - `~/.local/state/warp-terminal/warp.sqlite`
  - `~/.local/state/warp-terminal-preview/warp.sqlite`

#### Section 2.3.6: Gemini Adapter
Markdown file storage for Google Antigravity/Gemini task sessions.
- Priority: 0.7
- Timeout: 200ms
- **Read Support**: Full
  - `query()` - Search task sessions by content
  - `getSessionCount()` - Count available sessions
- **Write Support**: No (Gemini manages its own files)
- **Data Source**: `~/.gemini/antigravity/brain/`

#### Section 2.3.7: Episodic Annotations Layer
Overlay for adding write capability to read-only episodic memory.
- **Write Support**: Full
  - `addAnnotation()` - Tag, note, highlight conversations
  - `updateAnnotation()` - Modify existing annotation
  - `deleteAnnotation()` - Remove annotation
  - `searchAnnotations()` - Find by query
  - `enrichRecords()` - Merge annotations into MemoryRecords
- **Storage**: `~/.claude/memory/annotations/episodic.jsonl`

### Section 2.4: Adapter Registry

Central registry that:
- Manages adapter lifecycle
- Coordinates parallel queries with individual timeouts
- Provides factory functions for default configuration
- Injects MCP caller to MCP-based adapters

## Section 3: Data Types

### Section 3.1: MemoryRecord

Standard memory record format across all adapters:

```javascript
{
  id: string,              // Unique identifier
  version: number,         // Schema version
  type: MemoryType,        // 'learning' | 'pattern' | 'skill' | 'correction' | 'preference'
  content: string,         // Full content
  summary: string,         // Brief summary (< 100 chars)
  projectHash: string|null,// null = global
  tags: string[],          // Searchable tags
  intent: string,          // Original intent category
  sourceSessionId: string, // Source session
  sourceTimestamp: string, // ISO 8601 timestamp
  extractionConfidence: number, // 0.0-1.0
  usageCount: number,      // Times used
  usageSuccessRate: number,// 0.0-1.0
  lastUsed: string|null,   // ISO timestamp or null
  decayScore: number,      // 0.0-1.0, decreases over time
  status: string,          // 'active' | 'archived' | 'deleted'
  createdAt: string,       // ISO 8601
  updatedAt: string,       // ISO 8601
}
```

### Section 3.2: WriteResult

Standard result from write operations:

```javascript
{
  success: boolean,        // Whether operation succeeded
  id?: string,             // ID of affected record
  error?: string,          // Error message if failed
  affectedCount?: number,  // Number of records affected
}
```

## Configuration

Users can customize adapter behavior via config:

```javascript
const registry = createDefaultRegistry({
  basePath: '~/.claude/memory',
  adapters: {
    claudeMd: {
      paths: [
        '~/.claude/CLAUDE.md',
        '.claude/CLAUDE.md',
        './CLAUDE.md',
        // Users can add custom paths here
      ],
    },
  },
});
```

## Cross-Platform Support

All paths use `expandPath()` which handles:
- `~` expansion to `$HOME` (Linux/macOS) or `$USERPROFILE` (Windows)
- Relative path resolution

---

*This design document is referenced by JSDoc `@see` annotations throughout the codebase.*
