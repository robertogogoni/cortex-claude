# Cortex Unified Roadmap: Phases H-K

**Date:** 2026-03-02
**Author:** Rob + Claude
**Status:** Approved Design
**Scope:** 4 new phases (H, I, J, K) extending the existing A-G roadmap
**Estimated Effort:** ~50 days across 36 tasks
**Replaces:** Phase H "Future" placeholder in `2026-02-25-cortex-v3-full-transformation.md`

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Unified Roadmap Overview (A-K)](#2-unified-roadmap-overview-a-k)
3. [Deduplication Map](#3-deduplication-map)
4. [Dependency Graph](#4-dependency-graph)
5. [Phase H: Human-Readable Memory Bridge](#5-phase-h-human-readable-memory-bridge)
6. [Phase I: Memory Intelligence](#6-phase-i-memory-intelligence)
7. [Phase J: Advanced Memory Science](#7-phase-j-advanced-memory-science)
8. [Phase K: Ecosystem & Platform](#8-phase-k-ecosystem--platform)
9. [Cross-Cutting Concerns](#9-cross-cutting-concerns)
10. [Cost Analysis](#10-cost-analysis)
11. [Version Strategy](#11-version-strategy)
12. [Rollback Plan](#12-rollback-plan)
13. [Performance Budget](#13-performance-budget)
14. [Academic References](#14-academic-references)

---

## 1. Motivation

During a comprehensive memory audit (2026-03-02), we identified that Cortex operates on a separate memory plane from the human-readable `.md` topic files that get loaded into every Claude Code session via `MEMORY.md`. These two systems don't communicate:

- **Cortex**: stores memories in structured JSONL + vector index (machine-searchable)
- **Topic files**: human-readable markdown in `~/.claude/projects/<hash>/memory/` (loaded every session)

Additionally, the existing Phase H "Future" documented 17 research-backed improvements as ideas without concrete implementation specs. This design promotes all of them to real, implementable phases.

### Gaps Identified

| Gap | Description |
|-----|-------------|
| **No retroactive gap finder** | Cannot audit past sessions for uncaptured knowledge |
| **No markdown output** | Cortex only writes JSONL, never `.md` topic files |
| **No cross-session compiler** | Cannot synthesize scattered memories into authoritative docs |
| **No bidirectional sync** | Manual edits to `.md` files don't flow back to Cortex |
| **No auto-categorization** | Memories don't auto-route to topic files |
| **No importance scoring** | All memories treated equally |
| **No topic lifecycle** | Topic files accumulate forever with no staleness detection |
| **Research items not implementable** | Phase H was placeholder, not real tasks |

---

## 2. Unified Roadmap Overview (A-K)

| Phase | Name | Tasks | Est. Days | Status | Key Milestone |
|-------|------|-------|-----------|--------|---------------|
| **A** | Ship | 5 | 2 | **DONE** | v2.0.0 released |
| **E** | Direct SQLite | 4 | 3 | **DONE** | 7.5x memory improvement |
| **B** | Foundation | 6 | 5 | Designed | MCP Sampling = zero-cost LLM |
| **C** | Quality Engine | 4 | 5 | Designed | Write gates + temporal awareness |
| **CR** | CortexRenderer | 11 | 4 | Designed | Streaming CLI visuals (parallel) |
| **D** | Distribution | 3 | 4 | Designed | Plugin packaging + HyDE |
| **F** | Research-Backed Retrieval | 5 | 7 | Designed | SOTA retrieval (FTS5, iterative, types, anchors) |
| **G** | Memory Lifecycle | 3 | 5 | Designed (merged) | CRUD + consolidation + tracking |
| **H** | Human-Readable Bridge | 10 | 10 | **NEW** | Topic files as first-class memory |
| **I** | Memory Intelligence | 11 | 10 | **NEW** | Auto-categorization + scoring + LADS |
| **J** | Advanced Memory Science | 7 | 15 | **NEW** | FSRS-6, RL, multi-hop, harmonic |
| **K** | Ecosystem & Platform | 8 | 15 | **NEW** | TUI, 3D dashboard, multi-agent mesh |
| **TOTAL** | | **77** | **~85d** | | |

---

## 3. Deduplication Map

Features that appeared in multiple locations have been merged:

| Feature | Was In | Merged Into | Resolution |
|---------|--------|-------------|------------|
| Confidence decay | C3, G5, H (our Section 11) | **C3** — unified decay engine | C3 has the formula; G5 deleted; our decay extends C3 for `.md` files |
| Write quality scoring | C1, G2, H (our Section 13) | **C1** — unified write gate | C1 gates entry; G2 deleted; our importance dimensions extend C1 |
| Consolidation + pruning | G3, H (our Section 17), old H:8 | **G3** — extended engine | G3 gets new strategies (pruneImportance, archiveAged) + background daemon |
| Usage tracking | G4, H (our Section 13), old H:9 | **G4** — unified tracker | G4 gets belief evolution (EMA) from old H:9 research |
| Memory types + 4-network | F3, K2 | **Separate** | F3 classifies; K2 separates storage — distinct layers, not duplicates |
| Breakthrough + skill extraction | I2, J5, J6 | **Pipeline** | I2 detects → J5 extracts → J6 evolves — three stages |

**After dedup: 70 → 58 unique tasks** (12 merged/eliminated).

---

## 4. Dependency Graph

```
Phase A ✅ ─→ Phase B (MCP Sampling is the #1 blocker)
Phase E ✅ ─┘     │
                  ├─→ Phase C (needs B for MCP Sampling / elicitation)
                  ├─→ Phase D (needs B for HyDE)
                  └─→ CortexRenderer (parallel, no deps on B)
                       │
Phase C ──────────────→│
Phase D ──────────────→│
                       ↓
              Phase F (Retrieval — needs B for MCP Sampling,
                       benefits from C's quality gates)
                       │
                       ↓
              Phase G (Lifecycle — needs F's types + anchors,
                       C's write gates, B's sampling)
                       │
                       ↓
              Phase H (Bridge — needs G's CRUD, F's FTS5,
                       B's sampling for compilation)
                       │
                       ↓
              Phase I (Intelligence — needs H's bridge,
                       G's scoring + decay, F's types)
                       │
                       ↓
              Phase J (Advanced Science — needs F+G+I
                       for RL training data, multi-hop, harmonic)
                       │
                       ↓
              Phase K (Ecosystem — needs J for mesh/sync,
                       D for plugin packaging)
```

**Critical path:** B (5d) → C (5d) → F (7d) → G (5d) → H (10d) → I (10d) → J (15d) = **57 days**

**Parallelizable:** CortexRenderer, D, K3-K4 (dashboards), K5-K6 (MCP SDK features)

---

## 5. Phase H: Human-Readable Memory Bridge

**Estimated effort:** 10 days | **Tasks:** 10
**Key milestone:** Topic `.md` files become a first-class Cortex memory source with bidirectional read/write.
**Depends on:** B (MCP Sampling), F (FTS5 search), G (CRUD operations)

### Architecture: Two-Stage Async Pipeline

```
STAGE 1: SessionEnd (synchronous, fast, <2s)
  ├─ ExtractionEngine (existing) → extract insights
  ├─ GapDetector (Haiku only) → detect gaps, write gap_report.json
  └─ EXIT — session closes immediately

STAGE 2: Next SessionStart (async, before injection)
  ├─ Check for pending gap_report.json from last session
  ├─ TopicCompiler (Sonnet) → compile .md files
  ├─ MemoryIndexManager → update MEMORY.md
  └─ Cleanup: delete gap_report.json
```

### H1: MarkdownTopicAdapter (read side)

**File:** `adapters/markdown-topic-adapter.cjs`

Bidirectional adapter for `.md` topic files. Read side parses topic files as a queryable memory source.

```javascript
class MarkdownTopicAdapter extends BaseAdapter {
  constructor(config) {
    super('markdown-topic', { priority: 0.85, timeout: 5000 });
    this.topicDir = config.topicDir;
    this.globalDir = config.globalTopicDir;
    this.parsers = [StructuredParser, FlatParser, WholeFileParser];
  }

  async query(queryText, options = {}) {
    const files = await this.discoverFiles();
    const sections = [];
    for (const file of files) {
      const parsed = this.parse(file);
      for (const section of parsed.sections) {
        const sim = await this.embedder.similarity(queryText, section.content);
        if (sim >= (options.minSimilarity || 0.3)) {
          sections.push({ ...section, file: file.name, similarity: sim });
        }
      }
    }
    return sections.sort((a, b) => b.similarity - a.similarity);
  }

  parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const Parser of this.parsers) {
      const result = Parser.parse(content);
      if (result.sections.length > 0) return result;
    }
    return { sections: [{ header: null, content }] };
  }
}
```

**Multi-strategy parser:**
- `StructuredParser`: H2 sections with H3 subsections + tables (ideal format)
- `FlatParser`: Any headings as boundaries, paragraphs as content
- `WholeFileParser`: Entire file as single document (fallback)

**Tests:**
```
- parse structured .md → returns section tree with H2/H3/content
- parse flat .md → FlatParser fallback, returns paragraph chunks
- parse empty file → returns empty result (no error)
- parse file with tables → extracts table data as structured content
- query "beeper" against topic files → returns relevant sections ranked
- priority = 0.85 between KnowledgeGraph (0.8) and Vector (0.9)
- file not found → graceful degradation, returns empty
- scans ~/.claude/projects/<hash>/memory/*.md
```

### H2: MarkdownTopicAdapter (write side)

```javascript
async write({ filename, action, sections }) {
  const filePath = path.join(this.topicDir, filename);
  await this.backup(filePath);  // *.md.bak.<timestamp>

  if (action === 'create') {
    await fs.writeFile(filePath, this.renderSections(sections), 'utf-8');
  } else if (action === 'update') {
    const existing = this.parse(filePath);
    const merged = this.mergeSections(existing, sections);
    await fs.writeFile(filePath, this.renderSections(merged), 'utf-8');
  } else if (action === 'append') {
    await fs.appendFile(filePath, '\n' + this.renderSections(sections), 'utf-8');
  }
  await this.updateHash(filePath);
}
```

**Key behaviors:**
- Section-level updates — doesn't rewrite entire files
- Preserves human formatting in untouched sections
- Creates backups before writing: `*.md.bak.<timestamp>`

**Tests:**
```
- write new file → creates .md with correct structure
- update existing section → replaces content, preserves others
- append section → adds new H2 at end
- backup created → *.md.bak.<timestamp> exists before write
- preserves human formatting in untouched sections
- concurrent writes → no corruption (atomic write)
- write to nonexistent directory → creates directory first
```

### H3: MemoryIndexManager

Auto-manages the topic files table in `MEMORY.md`.

```javascript
class MemoryIndexManager {
  async updateTable(memoryMdPath, { filename, description, action }) {
    const content = fs.readFileSync(memoryMdPath, 'utf-8');
    const table = this.parseTable(content);

    if (action === 'add' || action === 'update') {
      table.upsert(filename, description);
    } else if (action === 'remove') {
      table.remove(filename);
    }

    const newContent = this.rebuildTable(content, table);
    fs.writeFileSync(memoryMdPath, newContent, 'utf-8');
  }
}
```

**Behaviors:**
- Adds `<!-- cortex-managed -->` comment to rows it owns
- Preserves manually-added rows
- Keeps table sorted alphabetically
- Warns if MEMORY.md exceeds 180 lines (200-line context limit)

**Tests:**
```
- add new topic → row appears in table
- update description → row content changes
- remove topic → row removed
- preserves manual rows (no cortex-managed comment)
- table sorted alphabetically
- MEMORY.md > 180 lines → warning logged
- malformed table → creates section if missing
- idempotent: same data twice → no changes
```

### H4: GapDetector

Runs at SessionEnd. Compares extractions against documented knowledge.

```javascript
class GapDetector {
  async detect(extractions, topicAdapter) {
    const gaps = [];
    const stale = [];

    for (const extraction of extractions) {
      const matches = await topicAdapter.query(extraction.content, { minSimilarity: 0.3 });
      if (matches.length === 0 || matches[0].similarity < 0.3) {
        gaps.push({
          topic: extraction.content.slice(0, 100),
          confidence: 1 - (matches[0]?.similarity || 0),
          sessionsFound: await this.countSessions(extraction),
          hasTopic: false
        });
      }
    }

    // Check staleness
    for (const file of await topicAdapter.discoverFiles()) {
      const meta = await this.getMetadata(file);
      if (meta.daysSinceAccess > 30) {
        stale.push({ file: file.name, daysSinceAccess: meta.daysSinceAccess });
      }
    }

    return { gaps, stale, meta: { extractionsAnalyzed: extractions.length } };
  }
}
```

**Algorithm:**
1. For each extraction, search existing topic files
2. Similarity < 0.3 → gap detected
3. Topic file > 30 days since access → stale
4. Same topic in 3+ sessions but no `.md` file → recurring uncaptured topic

**Tests:**
```
- extraction matches existing topic → no gap
- extraction no match (sim < 0.3) → gap detected
- topic file stale (>30d) → stale topic reported
- same topic in 3+ sessions, no .md → recurring uncaptured
- empty extractions → no gaps, no errors
- confidence thresholds: 0.3 (no match), 0.65 (strong match)
- Haiku failure → partial report with error flag
```

### H5: TopicCompiler

Synthesizes memories into structured `.md` topic files.

```javascript
class TopicCompiler {
  async compile(gapReport, { topicAdapter, memoryStores, sampler }) {
    const compiledTopics = [];

    for (const gap of gapReport.gaps.slice(0, this.config.maxNewFilesPerSession)) {
      if (gap.confidence < this.config.minConfidence) continue;

      // Gather ALL related memories
      const memories = await this.gatherMemories(gap.topic, memoryStores);
      if (memories.length < this.config.minMemoriesForTopic) continue;

      // Compile via Sonnet (3-tier fallback)
      const content = await this.synthesize(gap.topic, memories, sampler);
      if (content.quality < this.config.qualityThreshold) continue;

      compiledTopics.push({
        filename: this.generateFilename(gap.topic),
        content: content.markdown,
        action: 'create',
        quality: content.quality
      });
    }

    return compiledTopics;
  }

  async synthesize(topic, memories, sampler) {
    // Tier 1: MCP Sampling (Sonnet, zero cost)
    try {
      return await this.sonnetCompile(topic, memories, sampler);
    } catch (e) {
      // Tier 2: Direct API (Sonnet, ~$0.03)
      try {
        return await this.apiCompile(topic, memories);
      } catch (e2) {
        // Tier 3: Template + Haiku (~$0.002)
        return await this.templateCompile(topic, memories, sampler);
      }
    }
  }
}
```

**Tier 3 template fallback:**
```markdown
# {topic}

## Problem
{extracted problems from memories}

## Solution
{extracted solutions from memories}

## Gotchas
{extracted gotchas/corrections from memories}

## Verification
{extracted verification steps from memories}
```

**Tests:**
```
- gap with 5+ memories → structured .md content
- gap with <3 memories → skipped (minimum threshold)
- Sonnet quality 8 → file written
- Sonnet quality 4 → NOT written (threshold 6)
- max 2 new files per session
- max 3 section updates per session
- MCP Sampling unavailable → API → template fallback
- template fallback produces valid .md
- Haiku self-rate < 5 → marks pendingHighQuality
```

### H6: SessionEnd Integration

Wires GapDetector into the existing SessionEnd hook.

```javascript
// In hooks/session-end.cjs — extended pipeline
async function onSessionEnd(event) {
  // Stage 1: Existing extraction
  const extractions = await extractionEngine.extract(event.transcript);

  // Stage 2: Gap detection (NEW — Haiku only, fast)
  if (config.topicBridge.gapDetection.enabled) {
    const topicAdapter = new MarkdownTopicAdapter(config.topicBridge);
    const gapReport = await gapDetector.detect(extractions, topicAdapter);
    if (gapReport.gaps.length > 0) {
      await writeJSON('data/cache/gap_report.json', gapReport);
    }
  }

  // Stage 3: Existing memory storage
  await storeExtractions(extractions);
  return { extracted: extractions.length, gapsFound: gapReport?.gaps.length || 0 };
}
```

**Tests:**
```
- normal session → GapDetector runs, writes gap_report.json if gaps found
- SessionEnd stays < 2s (Haiku only, no Sonnet)
- ExtractionEngine failure → GapDetector still runs
- GapDetector failure → SessionEnd completes (graceful degradation)
- empty session (<3 messages) → GapDetector skips
- topicBridge.enabled = false → GapDetector skips entirely
```

### H7: `cortex__audit` MCP Tool

On-demand gap analysis + optional compilation.

```javascript
// In cortex/server.cjs — new tool handler
{
  name: 'cortex__audit',
  description: 'Audit memory for gaps, stale topics, and uncaptured knowledge',
  inputSchema: {
    type: 'object',
    properties: {
      topic:   { type: 'string', description: 'Focus on specific topic' },
      scope:   { type: 'string', enum: ['all', 'recent', 'project'], default: 'recent' },
      compile: { type: 'boolean', default: false },
      dryRun:  { type: 'boolean', default: true }
    }
  }
}
```

**Tests:**
```
- no args → scans recent (30d), returns gap report
- topic="beeper" → focused scan, returns completeness assessment
- scope="all" → full audit
- compile=true dryRun=true → shows what would compile, writes nothing
- compile=true dryRun=false → creates/updates .md files
- cost tracking → reports Haiku/Sonnet costs
- rate limited per existing limiter
```

### H8: Bidirectional Sync

Detects manual edits to `.md` files and flows them back to JSONL/vector stores.

```javascript
class BidirectionalSync {
  async sync(topicAdapter, store) {
    const currentHashes = await this.hashAllFiles(topicAdapter);
    const storedHashes = await this.loadHashes();

    for (const [file, hash] of currentHashes) {
      if (storedHashes[file] === hash) continue;  // No change

      // Manual edit detected
      const sections = topicAdapter.parse(file);
      for (const section of sections.sections) {
        const facts = await this.extractFacts(section);  // Haiku
        await store.upsert(facts, { source: 'manual-topic-edit', file });
      }
    }

    await this.saveHashes(currentHashes);
  }
}
```

**Conflict resolution:** Human edit wins. If both Cortex (pending gap_report) and human edited the same section, Cortex's pending write is discarded.

**Tests:**
```
- no changes → no sync (hash match)
- manual edit → extracts facts, upserts JSONL
- manual edit + pending Cortex write → human wins
- conflict logged with message
- new file added manually → picked up, hashed
- file deleted manually → hash removed, row removed from MEMORY.md
- first run (no prior hashes) → baseline all files
```

### H9: Migration Bootstrap

Onboards existing 9 topic files on first run.

**Process:**
1. Discover `~/.claude/projects/<hash>/memory/*.md`
2. Parse each file (multi-strategy)
3. Compute MD5 hashes (baseline)
4. Compute centroid embeddings per file
5. Index sections into JSONL with `source: "topic-migration"`
6. Write `data/cache/migration-v1.json` marker
7. Add `<!-- cortex-managed -->` to MEMORY.md rows

**Safety:** Zero modifications to `.md` content. Only adds hashes, centroids, JSONL entries, and invisible HTML comments. Idempotent.

**Tests:**
```
- 9 existing files → all parsed, hashed, indexed
- migration marker written → subsequent runs skip
- no .md files → migration completes with 0 files
- corrupt file → skipped with warning
- existing JSONL entries → deduped (no double-index)
```

### H10: Tests + Documentation

- TDD tests for H1-H9 (following existing Cortex test patterns)
- README update: new tool, new adapter, new hook behavior
- API.md update: `cortex__audit` tool spec

---

## 6. Phase I: Memory Intelligence

**Estimated effort:** 10 days | **Tasks:** 11
**Key milestone:** Auto-categorization, importance scoring, cross-project sharing, LADS integration.
**Depends on:** H (bridge), C (quality engine), G (lifecycle)

### I1: TopicRouter (Auto-Categorization)

Routes new memories to the correct topic file via centroid embedding comparison.

```javascript
class TopicRouter {
  async route(memory) {
    const memEmbedding = await this.embedder.embed(memory.content);
    const centroids = await this.loadCentroids();

    let bestMatch = null;
    let bestSim = 0;

    for (const [filename, centroid] of centroids) {
      const sim = cosineSimilarity(memEmbedding, centroid);
      if (sim > bestSim) { bestSim = sim; bestMatch = filename; }
    }

    if (bestSim > 0.65) return { action: 'assign', file: bestMatch };
    if (bestSim < 0.40) return { action: 'candidate', tag: 'topicCandidate' };
    return { action: 'ambiguous', bestGuess: bestMatch, confidence: bestSim };
  }
}
```

**New topic creation:** 5+ uncategorized memories clustering > 0.6 pairwise → Haiku generates topic name → TopicCompiler creates `.md`.

**Tests:**
```
- memory sim > 0.65 to "beeper" → assigned to beeper-troubleshooting.md
- memory sim < 0.40 to ALL → tagged topicCandidate
- memory sim 0.40-0.65 → ambiguous, tagged for review
- 5+ candidates clustering > 0.6 → new topic created
- centroid cached and recomputed on file update
- no topic files → all memories are candidates
```

### I2: BreakthroughDetector

Identifies cross-session patterns significant enough to be "wow moments."

```javascript
class BreakthroughDetector {
  async detect(gapReport, jsonlHistory) {
    const breakthroughs = [];

    // Same error/fix in 3+ sessions
    const patterns = await this.findRecurringPatterns(jsonlHistory, 3);
    for (const pattern of patterns) {
      breakthroughs.push({
        topic: pattern.topic,
        significance: pattern.sessions >= 5 ? 'high' : 'medium',
        sessions: pattern.sessions,
        type: 'recurring-pattern'
      });
    }

    // Solution evolution (tried X, then Y, finally Z)
    const evolutions = await this.findEvolutions(jsonlHistory);
    for (const evo of evolutions) {
      breakthroughs.push({
        topic: evo.topic,
        significance: 'high',
        timeline: evo.steps,
        type: 'solution-evolution'
      });
    }

    return breakthroughs;
  }
}
```

**Tests:**
```
- same error in 3+ sessions → flagged as breakthrough
- solution evolution (X→Y→Z) → captured with timeline
- decision in 4+ contexts → architectural insight
- no recurring patterns → empty list
- threshold: 3 sessions minimum
- dedup: same breakthrough not flagged twice
```

### I3: Extended Importance Scoring

Extends C1's write gate with additional dimensions.

```javascript
class ImportanceScorer {
  constructor(config) {
    this.weights = config.scoring.weights;
    // { frequency: 0.25, recency: 0.15, breadth: 0.20, difficulty: 0.20, uniqueness: 0.20 }
  }

  score(memory, usageTracker) {
    const freq = this.normalizeFrequency(usageTracker.getAccessCount(memory.id));
    const recency = this.computeRecency(memory.last_accessed);
    const breadth = this.computeBreadth(memory.projects || []);
    const difficulty = this.computeDifficulty(memory.sessionMetrics);
    const uniqueness = 1 - (memory.maxSimilarity || 0);

    return this.weights.frequency * freq +
           this.weights.recency * recency +
           this.weights.breadth * breadth +
           this.weights.difficulty * difficulty +
           this.weights.uniqueness * uniqueness;
  }
}
```

**Tests:**
```
- high freq + high breadth + high difficulty → score > 0.85
- low freq + old + single context → score < 0.30
- all weights sum to 1.0
- score clamped to 0-1
- frequency: 10 accesses → 1.0, 1 access → 0.1
- recency: today → 1.0, 90d → 0.3, 180d → 0.1
- score updated on access
```

### I4: Memory Decay for Topic Files

Extends C3's decay engine for `.md` file lifecycle.

| Age Since Last Access | Status | Action |
|----------------------|--------|--------|
| < 30 days | Fresh | No action |
| 30-90 days | Aging | Lower query priority |
| 90-180 days | Stale | Suggest archival |
| > 180 days | Archive | Move to `topics/archive/`, remove from MEMORY.md |

**Tests:**
```
- accessed < 30d → "fresh"
- accessed 30-90d → "aging", priority lowered
- accessed 90-180d → "stale", archival suggested
- accessed > 180d → moved to archive/
- archived still searchable via cortex__query
- access resets timestamp → refreshes status
- cortex__audit restores from archive
```

### I5: Cross-Project Memory Sharing

Global topic directory for cross-cutting knowledge.

```
~/.claude/memory/topics/           ← GLOBAL (cross-project)
  ├─ beeper-troubleshooting.md
  └─ system-maintenance.md

~/.claude/projects/<hash>/memory/  ← PROJECT-SCOPED (existing)
  ├─ MEMORY.md
  └─ cortex-project.md
```

**Routing logic:** TopicCompiler decides scope based on content:
- Project-specific files/paths mentioned → project-scoped
- Tools, system config, cross-cutting → global
- Configurable override via tags in `cortex__learn`

**Tests:**
```
- system tool topic → global directory
- project-specific code topic → project directory
- global topic in project MEMORY.md with scope="global"
- query from any project → returns both global + project results
- tag override: global → forces global scope
- no global dir → created on first write
```

### I6: LADS Framework Integration

New LADS metrics from Phase H/I:

```javascript
{
  topicFileCount: 9,
  gapsFilled: 3,
  breakthroughsDetected: 1,
  manualCorrections: 0,
  topicStaleness: 0.12,
  importanceDistribution: { high: 4, medium: 3, low: 2 }
}
```

| LADS Signal | Source | Feed |
|-------------|--------|------|
| Learnable | BreakthroughDetector | Breakthroughs boost score |
| Adaptive | GapDetector | Gap-fill rate as metric |
| Documenting | MarkdownTopicAdapter writes | File count + quality |
| Self-improving | Bidirectional sync | Manual corrections counted |

**Tests:**
```
- topic file created → Documenting increments
- gap filled → Adaptive increments
- breakthrough detected → Learnable boosted
- manual edit synced → Self-improving recorded
- cortex__health includes new metrics
```

### I7: Topic Health Visualization

Extends CortexRenderer with topic health display.

```
╭─ Topic Memory Health ──────────────────────────────╮
│  9 topics │ 3 fresh │ 4 aging │ 1 stale │ 1 archive│
│                                                     │
│  ████████████░░░░  beeper-troubleshooting  [0.91]   │
│  ██████████░░░░░░  cortex-project          [0.78]   │
│  ████████░░░░░░░░  keyboard-cedilla        [0.65]   │
│  ···                                                │
│                                                     │
│  Gaps: 2  │  Breakthroughs: 1                       │
╰─────────────────────────────────────────────────────╯
```

**Tests:**
```
- renders bar chart with importance per topic
- fresh/aging/stale/archive counts correct
- gaps + breakthroughs listed
- empty topics → "No topic files found"
- >20 topics → top 15 + "... and N more"
```

### I8: `cortex__export` MCP Tool

Export all Cortex knowledge.

| Format | Content |
|--------|---------|
| `json` | All memories + topics + metadata |
| `markdown` | Topic files concatenated with TOC |
| `jsonl` | Raw JSONL + vector metadata |

**Tests:**
```
- format="json" → valid JSON
- format="markdown" → .md bundle with TOC
- scope="topics" → only .md files
- output path created if not exists
```

### I9: Memory Provenance & Traceability

Every memory tracks its origin chain.

```javascript
{
  source: 'direct' | 'inferred' | 'consolidated' | 'merged',
  confidence: 0.85,
  evidence: ['mem_a1', 'mem_b2'],
  createdSession: 'session-123',
  mergedFrom: []
}
```

Query retrieval downweights "inferred from inferred" chains.

**Tests:**
```
- direct observation → source: 'direct', high confidence
- consolidated memory → tracks mergedFrom IDs
- inferred from inferred → downweighted in results
- provenance displayed in cortex__query results
```

### I10: User Notification System

SessionStart banner extensions:

```
╭─ Cortex v3.1.0 ─ Relevant Memories ────────────────╮
│  [NEW] Compiled 1 topic file: beeper-troubleshooting│
│  [STALE] 2 topics aging: tty-toolchain (45d)        │
│  [SYNC] 1 manual edit synced: keyboard-cedilla.md   │
├─ ...existing memory injection...                     │
╰──────────────────────────────────────────────────────╯
```

| Level | When |
|-------|------|
| Compiled | Gap filled, new/updated topic |
| Gap found | Detected but not yet compiled |
| Stale | Topic aging (30+ days) |
| Synced | Manual edit flowed back |
| Archived | File moved to archive |
| Error | Self-healing ran |

**Tests:**
```
- gap compiled → [NEW] notification in banner
- stale topic → [STALE] notification
- manual edit synced → [SYNC] notification
- no events → no bridge notifications (clean banner)
```

### I11: Tests + Documentation

---

## 7. Phase J: Advanced Memory Science

**Estimated effort:** 15 days | **Tasks:** 7
**Key milestone:** FSRS-6 recall, RL-optimized CRUD, multi-hop reasoning, harmonic memory.
**Depends on:** F (types + anchors), G (CRUD + tracking), I (breakthroughs)

### J1: FSRS-6 Spaced Repetition Recall

**File:** `core/fsrs6.cjs`
**Research:** Vestige, SuperMemo (Free Spaced Repetition Schedule v6)
**Effort:** 3 days

Replaces simple exponential decay with proven spaced repetition. 19 pre-trained weights, targets 90%+ retention.

```javascript
class FSRS6 {
  constructor() {
    this.w = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01,
              1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61, 0.0, 0.0];
  }

  computeStability(memory) {
    const { difficulty, stability, reps, lapses } = memory.fsrs || this.initState();
    return stability * Math.exp(this.w[8]) *
           (Math.exp(this.w[9] * (1 - difficulty)) - 1) *
           Math.pow(reps + 1, -this.w[10]) *
           Math.pow(lapses + 1, this.w[11]);
  }

  nextReviewDate(memory) {
    const stability = this.computeStability(memory);
    const intervalDays = stability * Math.log(0.9) / Math.log(0.9);
    return new Date(Date.now() + intervalDays * 86400000);
  }

  recordReview(memory, rating) {
    // rating: 1=forgot, 2=hard, 3=good, 4=easy
    const state = memory.fsrs || this.initState();
    state.reps++;
    if (rating === 1) state.lapses++;
    state.difficulty = Math.max(1, Math.min(10,
      state.difficulty + this.w[6] * (rating - 3)));
    state.stability = this.computeStability(memory);
    return state;
  }
}
```

**Integration:** `cortex__query` uses FSRS-6 to boost memories due for review and suppress well-known ones.

**Tests:**
```
- new memory → stability 1.0, difficulty 5
- rating "good" → stability increases, next review ~1d
- rating "easy" → next review ~3d
- rating "forgot" → lapses++, stability drops
- 10 consecutive "good" → intervals grow: 1, 3, 7, 15, 30d
- difficulty bounded [1, 10]
- query access = implicit "good" review
```

### J2: RL-Trained Memory Manager

**File:** `core/rl-trainer.cjs`
**Research:** Memory-R1 (68.9% F1 gain over heuristics)
**Effort:** 5 days

Uses Haiku as in-context "RL policy" — not neural net training, but few-shot learning from past outcomes.

```
State:  [memory_embedding, context, quality, access_count, age, type]
Action: CREATE(0) | UPDATE(1) | DELETE(2) | NOOP(3)
Reward: +1.0 (used successfully), 0.0 (unused), -0.5 (contradicted)
```

Training data: 49 agent conversations + 1,708 Warp queries from episodic memory.

**Tests:**
```
- experience collection: 100 memories → 100 state-action-reward tuples
- high-quality unique → CREATE
- near-duplicate → NOOP
- contradicted → DELETE
- RL policy outperforms heuristic on held-out test
- fallback: RL unavailable → G1 heuristic CRUD
```

### J3: Multi-Hop Reasoning

**File:** `core/multi-hop.cjs`
**Research:** Hindsight (91.4% LongMemEval)
**Effort:** 3 days

Decomposes complex queries into sub-query chains.

```javascript
class MultiHopReasoner {
  async reason(query, maxHops = 3) {
    const chain = [{ query, hop: 0 }];
    let currentQuery = query;

    for (let hop = 0; hop < maxHops; hop++) {
      const results = await this.orchestrator.query(currentQuery, { limit: 5 });
      if (results.length === 0) break;

      const analysis = await this.sampler.complete(
        `Given "${query}" and these memories: ${results.map(r => r.content).join('; ')}` +
        `\nSufficient to answer? JSON: { "sufficient": bool, "nextQuery": "..." }`,
        { model: 'haiku' }
      );
      const { sufficient, nextQuery } = JSON.parse(analysis);
      chain.push({ query: currentQuery, results, hop: hop + 1 });
      if (sufficient) break;
      currentQuery = nextQuery;
    }
    return { chain, totalHops: chain.length - 1 };
  }
}
```

**Tests:**
```
- simple query → 1 hop, sufficient
- complex query → 2-3 hops, chains results
- max 3 hops enforced
- no results → stops early
- full chain returned for inspection
```

### J4: Harmonic Memory Representation

**File:** `core/harmonic-memory.cjs`
**Research:** Memora (arXiv:2602.03315, 87.3% LoCoMo)
**Effort:** 3 days

Three-view scoring: retrieval vector + knowledge graph proximity + context anchor relevance.

```javascript
async score(query, memoryId) {
  const [r, kg, a] = await Promise.all([
    this.vector.similarity(query, memoryId),
    this.kg.proximity(query, memoryId),
    this.anchors.relevance(query, memoryId)
  ]);
  return 0.4 * r + 0.4 * kg + 0.2 * a;
}
```

**Tests:**
```
- all sources agree → combined > 0.8
- vector high, KG low → moderate
- missing KG → 0.5*retrieval + 0.5*anchor fallback
- same fact, different context → anchor detects shift
```

### J5: Auto-Skill Extraction (Claudeception)

**File:** `core/skill-extractor.cjs`
**Research:** Voyager (2023) — 2.3x more effective than hand-written skills
**Effort:** 2 days

Triggered by BreakthroughDetector (I2). Extracts skills when usage success rate > 0.8 and count > 5.

```javascript
async extractSkill(breakthrough) {
  const memories = await this.store.findByTopic(breakthrough.topic, { limit: 20 });
  const skillDef = await this.sampler.complete(
    `Create a Claude Code skill from these memories about "${breakthrough.topic}":\n` +
    memories.map(m => `- ${m.content}`).join('\n') +
    `\nOutput YAML: name, aliases, description, triggers, steps.`,
    { model: 'sonnet' }
  );
  const quality = await this.validate(skillDef);
  if (quality >= 0.7) await this.publish(skillDef);
  return { skill: skillDef, quality };
}
```

**Tests:**
```
- 10+ memories → valid YAML skill
- quality 1.0 (3/3 tests) → published to ~/.claude/skills/
- quality 0.33 → NOT published
- <3 memories → skips extraction
```

### J6: Evolvable Memory Skills (MemSkill)

**File:** `core/evolvable-skills.cjs`
**Research:** MemSkill (controller-executor-designer loop)
**Effort:** 2 days

Self-improving consolidation via three-loop architecture:
- **Controller:** evaluates strategy performance
- **Executor:** runs consolidation with current thresholds
- **Designer:** generates improved thresholds via Haiku

**Tests:**
```
- low precision → designer increases merge threshold
- score > 0.9 → no change needed
- 5 evolution cycles → score improves monotonically
- thresholds bounded (merge: 0.7-0.98, prune: 0.05-0.30)
```

### J7: Cross-Session Belief Tracking

**Research:** PAMU (sliding window + EMA)
**Effort:** 1 day

Already partially implemented in G4's `updateBelief()`. J7 adds query integration:

```
cortex__query "yarn or bun?" →
  "Current belief: bun (0.87). Evolution: yarn(1.0) → bun(0.6) → bun(0.87)"
```

**Tests:**
```
- evolving topic query → returns belief + history
- 5 conflicting beliefs → EMA settles on trend
- old beliefs decay, new dominate
```

---

## 8. Phase K: Ecosystem & Platform

**Estimated effort:** 15 days | **Tasks:** 8
**Key milestone:** TUI browser, 3D dashboard, multi-agent mesh, team sync.
**Depends on:** D (plugin packaging), F (types), MCP SDK 2025-11-25

### K1: Hierarchical Memory Decoupling

**Research:** xMemory (28% token reduction)
**Effort:** 2 days

Theme → Cluster → Item retrieval hierarchy. Token-aware: loads broad themes first, drills into items only as budget allows.

**Tests:**
```
- "debugging" query → selects debugging theme
- token budget 4096 → never exceeded
- 28%+ token reduction vs flat retrieval
```

### K2: 4-Network Memory Separation

**Research:** Hindsight (facts/experiences/summaries/beliefs)
**Effort:** 2 days

Separate storage per network. Intent-aware query routing: "what" → facts, "how" → skills+experiences, "should I" → beliefs.

**Tests:**
```
- "JS uses Promises" → fact
- "I debugged race conditions for 3h" → experience
- "async/await is best" → belief
- fact query never returns beliefs (isolation)
```

### K3: TUI Memory Browser

**Effort:** 2 days

Terminal UI with blessed. Navigate with hjkl, search with `/`, edit with `e`, delete with `d`.

**Tests:**
```
- "/" → search mode, live results
- hjkl → navigate
- enter → detail panel
- 1000+ memories → responsive (<100ms)
```

### K4: 3D Memory Dashboard

**Effort:** 3 days

SvelteKit + Three.js. Force-directed graph: node size = importance, color = type, edges = relationships.

**Tests:**
```
- /api/memories → valid graph JSON
- frontend renders (playwright)
- search highlights nodes
```

### K5: Streamable HTTP Transport

**Depends on:** MCP SDK 2025-11-25
**Effort:** 1 day

Chunked transfer encoding for progressive results.

### K6: MCP Tasks for Async Operations

**Depends on:** MCP SDK 2025-11-25
**Effort:** 1 day

Async task submission for long-running consolidation.

### K7: Multi-Agent Memory Mesh

**Research:** LatentMem (role-aware memory)
**Effort:** 3 days

Redis pub/sub for cross-agent memory sharing with role-based filtering.

```javascript
class MemoryMesh {
  async publish(memory) {
    await this.redis.publish('cortex:memory:learned', JSON.stringify({
      agentId: this.agentId, memory, roles: this.roles
    }));
  }
  async subscribe(callback) {
    this.subscriber.on('message', (ch, msg) => {
      const { agentId, memory, roles } = JSON.parse(msg);
      if (agentId !== this.agentId && this.hasRoleOverlap(roles)) callback(memory);
    });
  }
}
```

**Tests:**
```
- Agent A publishes → Agent B receives
- Agent A doesn't receive own messages
- Role filtering works
- Redis disconnect → reconnects
```

### K8: Git-Based Team Memory Sync

**Effort:** 2 days

JSONL files in git repo. Append-only format means no merge conflicts. Post-pull consolidation deduplicates.

**Tests:**
```
- push 5 memories → git commit
- pull → returns new entries
- JSONL merge → no conflicts
- post-pull dedup works
```

---

## 9. Cross-Cutting Concerns

### 9.1 Configuration Schema

New config section (extends `core/config.cjs`):

```javascript
{
  "topicBridge": {
    "enabled": true,
    "topicDir": "auto",
    "globalTopicDir": "~/.claude/memory/topics/",
    "gapDetection": {
      "enabled": true,
      "minConfidence": 0.7,
      "minSessions": 3,
      "matchThreshold": 0.3,
      "staleThresholdDays": 30
    },
    "compilation": {
      "enabled": true,
      "maxNewFilesPerSession": 2,
      "maxUpdatesPerSession": 3,
      "minMemoriesForTopic": 3,
      "qualityThreshold": 6,
      "fallbackToTemplate": true
    },
    "sync": {
      "enabled": true,
      "conflictResolution": "human-wins",
      "hashFile": "data/cache/topic-hashes.json"
    },
    "scoring": {
      "weights": {
        "frequency": 0.25,
        "recency": 0.15,
        "breadth": 0.20,
        "difficulty": 0.20,
        "uniqueness": 0.20
      }
    },
    "lifecycle": {
      "agingDays": 30,
      "staleDays": 90,
      "archiveDays": 180,
      "pruneThreshold": 0.15,
      "pruneMaxPercent": 0.20
    },
    "notifications": {
      "showInBanner": true,
      "logFile": "data/logs/topic-bridge.log"
    }
  }
}
```

### 9.2 Migration Plan

Bootstrap runs once on first SessionStart after Phase H install:
1. Discover `~/.claude/projects/<hash>/memory/*.md`
2. Parse each file, compute hashes + centroids
3. Index into JSONL with `source: "topic-migration"`
4. Write `data/cache/migration-v1.json` marker
5. Add `<!-- cortex-managed -->` to MEMORY.md rows

**Zero modifications** to existing `.md` content. Idempotent.

### 9.3 Error Recovery & Self-Healing

| Failure | Recovery |
|---------|----------|
| Partial `.md` write | Restore from backup (`.bak.<timestamp>`) |
| Corrupt gap_report.json | Delete, re-run next session |
| MEMORY.md table corruption | Rebuild from file scan |
| Vector index desync | Re-embed on next SessionStart |
| JSONL write failure | Retry once, then log and continue |
| Sonnet timeout | Fall back to API → template |
| Topic file locked | Skip, retry next session |
| Disk full | Skip all writes, critical error in banner |

**Self-healing runs every SessionStart** before memory injection.

### 9.4 Metrics & Observability

Tracked in `data/logs/topic-bridge-metrics.json` (rolling, last 100 sessions):

```javascript
{
  "sessionId": "...",
  "gapsDetected": 2,
  "gapsCompiled": 1,
  "compilationTier": "mcp-sampling",
  "compilationQuality": 7.5,
  "topicFilesTotal": 9,
  "manualEditsDetected": 0,
  "avgImportance": 0.62,
  "selfHealingActions": 0,
  "errors": []
}
```

Exposed via `cortex__health --topics`.

---

## 10. Cost Analysis

### Per-Session (Phase H)

| Operation | Model | Cost |
|-----------|-------|------|
| GapDetector | Haiku | ~$0.001 |
| Bidirectional sync | Haiku | ~$0.0005 |
| TopicCompiler (1 file) | Sonnet | ~$0.03 |
| Template fallback | Haiku | ~$0.002 |

### Monthly Estimates

| Scenario | Cost |
|----------|------|
| Typical (10 sessions/day, 20% gaps) | ~$0.50 |
| Active (50% gaps, 3 compilations/week) | ~$1.50 |
| Heavy (daily compilations, frequent audits) | ~$3.00 |
| **MCP Sampling (zero marginal)** | **~$0.00** |

### Phase J Additional

| Operation | Cost per run |
|-----------|-------------|
| FSRS-6 | $0.000 (local) |
| RL training batch | ~$0.05 (Haiku) |
| Multi-hop (3 hops) | ~$0.003 (Haiku) |
| Harmonic scoring | $0.000 (local) |
| Skill extraction | ~$0.03 (Sonnet) |

**Total H-K budget:** ~$0.50-3.00/month, or $0.00 with MCP Sampling.

---

## 11. Version Strategy

| Release | Phase | Semver | Reason |
|---------|-------|--------|--------|
| Phase H complete | H | **v3.1.0** | New features, backward compatible |
| Phase I complete | I | **v3.2.0** | Additional features |
| Phase J complete | J | **v3.3.0** | Research features, backward compatible |
| Phase K complete | K | **v3.4.0** | Ecosystem tools |

Not v4.0.0 — no breaking changes to existing MCP tools.

---

## 12. Rollback Plan

**Master toggle:** `topicBridge.enabled = false` → instantly disables all Phase H/I features.

**Git-level:** Each phase merged from feature branch. Revert via `git revert <commits>`.

**Data safety:**
- Phase H/I never modify existing JSONL (append-only)
- Topic `.md` files have backups before every write
- Migration is non-destructive
- `gap_report.json` is ephemeral

---

## 13. Performance Budget

| Module | Phase | Max Latency |
|--------|-------|------------|
| SessionStart total | — | < 8s (existing) |
| Hash comparison (sync) | H | < 200ms |
| Pending compilation | H | < 5s (Sonnet, overlaps with injection) |
| Self-healing checks | H | < 300ms |
| Topic file parsing | H | < 500ms/file |
| SessionEnd total | — | < 3s (extended) |
| GapDetector | H | < 1.5s |
| `cortex__audit` | H | < 15s |
| `cortex__query` (with topics) | H | < 3s |
| TopicRouter | I | < 200ms |
| Importance scoring | I | < 100ms |
| Multi-hop (3 hops) | J | < 5s |
| Health visualization | I | < 500ms |
| Export (all) | I | < 10s |

CI fails if any module exceeds 2x its budget.

---

## 14. Academic References

1. **Memora** — arXiv:2602.03315 (Microsoft, Feb 2026) — Harmonic memory, 87.3% LoCoMo
2. **xMemory** — arXiv:2602.02007 (Feb 2026) — Hierarchical decoupling, 28% token reduction
3. **Hindsight** — arXiv:2512.12818 (Dec 2025) — 4-network, multi-hop, 91.4% LongMemEval
4. **Memory-R1** — arXiv:2508.19828 (LMU Munich, Aug 2025) — RL manager, 68.9% F1 gain
5. **MemSkill** — arXiv:2602.02474 (Feb 2026) — Evolvable consolidation
6. **LatentMem** — arXiv:2602.03036 (Feb 2026) — Multi-agent role-aware
7. **Memory in the Age of AI Agents** — arXiv:2512.13564 (survey, 47 authors)
8. **Anatomy of Agentic Memory** — arXiv:2602.19320 (Feb 2026)
9. **Mem-T** — arXiv:2601.23014 (Jan 2026) — Dense reward signals
10. **AtomMem** — arXiv:2601.08323 (Jan 2026) — CRUD atomic operations

**Benchmarks to target:**
- LoCoMo (Memora: 87.3%)
- LongMemEval (Hindsight: 91.4%)
- MemoryAgentBench (ICLR 2026)
- MemoryArena (multi-session)

---

*This document supersedes the Phase H "Future" section in `2026-02-25-cortex-v3-full-transformation.md`.*
*Generated: 2026-03-02 | Approved by Rob*
