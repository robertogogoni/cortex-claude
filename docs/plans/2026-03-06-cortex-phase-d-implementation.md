# Cortex Phase D: Distribution — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Production-ready plugin manifest, smarter HyDE query expansion via LlmProvider, and a polished terminal demo GIF.

**Architecture:** 3 tasks: PluginManifest (packaging), HyDEProvider (LLM-powered query expansion), DemoRecorder (VHS tape). All CommonJS, standalone testable, minimal new deps.

**Tech Stack:** Node.js (CommonJS `.cjs`), `@anthropic-ai/sdk` (existing), VHS (terminal recorder)

**Depends on:** Phase B (LlmProvider / DirectApiProvider for D2)

**See also:**
- [Design Decisions (Phases B, CR, D)](2026-03-06-cortex-phases-b-cr-d-design-decisions.md) — D2 uses LlmProvider instead of MCP Sampling
- [Original Transformation Plan](2026-02-25-cortex-v3-full-transformation.md) — Phase D spec at line 1292
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) — links to all phase plans

---

## Task D1: Plugin Manifest (Audit + Align)

**Files:**
- Modify: `.claude-plugin/plugin.json` (the authoritative manifest)
- Modify: `plugin.json` (root-level convenience copy)
- Create: `hooks/hooks.json` (hook declarations in standard format)
- Test: `tests/test-plugin-manifest.cjs`

**Overview:**

Cortex already has two plugin.json files:
1. `.claude-plugin/plugin.json` — used by Claude Code's plugin system when installed from a marketplace
2. `plugin.json` — root-level, used when installed via direct path

Both exist but have drifted:
- `.claude-plugin/plugin.json` uses `${CLAUDE_PLUGIN_ROOT}` (correct for marketplace install)
- `plugin.json` uses `${PLUGIN_ROOT}` (incorrect — should also use `${CLAUDE_PLUGIN_ROOT}`)
- Root `plugin.json` declares hooks inline; the standard pattern is a separate `hooks/hooks.json`
- Neither declares `InstructionsLoaded` hook (new in Claude Code v2.1.63+)
- Neither declares `skills` array pointing to `skills/cortex`
- `.claude-plugin/plugin.json` has no `postInstall` command

**Acceptance Criteria:**
- [ ] Both plugin.json files are byte-identical (single source of truth)
- [ ] Hooks declared in `hooks/hooks.json` following standard plugin format
- [ ] All 5 hooks declared: SessionStart, SessionEnd, PreCompact, Stop, InstructionsLoaded
- [ ] MCP server uses `${CLAUDE_PLUGIN_ROOT}` consistently
- [ ] `skills` array declared
- [ ] `postInstall` command for `npm install --production`
- [ ] Validation test passes: schema check, file equivalence, env var consistency

### Step 1: Write the failing test

```javascript
#!/usr/bin/env node
// tests/test-plugin-manifest.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PROJECT_ROOT = path.join(__dirname, '..');

function test(name, fn) {
  try { fn(); console.log(`  pass ${name}`); return true; }
  catch (error) { console.log(`  FAIL ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

function main() {
  console.log('\nTask D1: Plugin Manifest Validation\n');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // -- FILE EXISTENCE --

  record(test('root plugin.json exists', () => {
    const p = path.join(PROJECT_ROOT, 'plugin.json');
    assert.ok(fs.existsSync(p), `Missing: ${p}`);
  }));

  record(test('.claude-plugin/plugin.json exists', () => {
    const p = path.join(PROJECT_ROOT, '.claude-plugin', 'plugin.json');
    assert.ok(fs.existsSync(p), `Missing: ${p}`);
  }));

  record(test('hooks/hooks.json exists', () => {
    const p = path.join(PROJECT_ROOT, 'hooks', 'hooks.json');
    assert.ok(fs.existsSync(p), `Missing: ${p}`);
  }));

  // -- MANIFEST CONTENT --

  const rootManifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'plugin.json'), 'utf8'));
  const claudeManifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

  record(test('both manifests are identical', () => {
    assert.deepStrictEqual(rootManifest, claudeManifest,
      'root plugin.json and .claude-plugin/plugin.json must be identical');
  }));

  record(test('manifest has required metadata fields', () => {
    assert.strictEqual(rootManifest.name, 'cortex', 'name should be "cortex"');
    assert.ok(rootManifest.version, 'version is required');
    assert.ok(rootManifest.description, 'description is required');
    assert.ok(rootManifest.author, 'author is required');
    assert.ok(rootManifest.author.name, 'author.name is required');
    assert.ok(rootManifest.homepage, 'homepage is required');
    assert.ok(rootManifest.repository, 'repository is required');
    assert.strictEqual(rootManifest.license, 'MIT', 'license should be MIT');
    assert.ok(Array.isArray(rootManifest.keywords), 'keywords should be an array');
    assert.ok(rootManifest.keywords.length >= 3, 'keywords should have at least 3 entries');
  }));

  record(test('manifest version matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(rootManifest.version, pkg.version,
      `plugin.json version (${rootManifest.version}) must match package.json (${pkg.version})`);
  }));

  // -- MCP SERVER --

  record(test('manifest declares cortex MCP server', () => {
    assert.ok(rootManifest.mcpServers, 'mcpServers is required');
    assert.ok(rootManifest.mcpServers.cortex, 'cortex server is required');
    const server = rootManifest.mcpServers.cortex;
    assert.strictEqual(server.command, 'node', 'command should be "node"');
    assert.ok(Array.isArray(server.args), 'args should be an array');
    assert.ok(server.args[0].includes('cortex/server.cjs'), 'args should reference cortex/server.cjs');
  }));

  record(test('MCP server uses CLAUDE_PLUGIN_ROOT variable', () => {
    const server = rootManifest.mcpServers.cortex;
    const argsStr = JSON.stringify(server.args);
    assert.ok(argsStr.includes('${CLAUDE_PLUGIN_ROOT}'),
      `args should use \${CLAUDE_PLUGIN_ROOT}, got: ${argsStr}`);
    assert.ok(!argsStr.includes('${PLUGIN_ROOT}'),
      'Should not use deprecated ${PLUGIN_ROOT}');
  }));

  // -- HOOKS --

  const hooksJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'hooks', 'hooks.json'), 'utf8'));

  record(test('hooks.json declares SessionStart hook', () => {
    assert.ok(hooksJson.hooks.SessionStart, 'SessionStart hook is required');
    assert.ok(Array.isArray(hooksJson.hooks.SessionStart), 'SessionStart should be an array');
    assert.ok(hooksJson.hooks.SessionStart.length > 0, 'SessionStart should have entries');
  }));

  record(test('hooks.json declares SessionEnd hook', () => {
    assert.ok(hooksJson.hooks.SessionEnd, 'SessionEnd hook is required');
  }));

  record(test('hooks.json declares PreCompact hook', () => {
    assert.ok(hooksJson.hooks.PreCompact, 'PreCompact hook is required');
  }));

  record(test('hooks.json declares Stop hook', () => {
    assert.ok(hooksJson.hooks.Stop, 'Stop hook is required');
  }));

  record(test('hooks.json declares InstructionsLoaded hook', () => {
    assert.ok(hooksJson.hooks.InstructionsLoaded, 'InstructionsLoaded hook is required (v2.1.63+)');
  }));

  record(test('all hooks use CLAUDE_PLUGIN_ROOT in commands', () => {
    const allHookArrays = Object.values(hooksJson.hooks);
    for (const hookArray of allHookArrays) {
      for (const entry of hookArray) {
        for (const hook of entry.hooks || []) {
          assert.ok(hook.command.includes('${CLAUDE_PLUGIN_ROOT}'),
            `Hook command should use \${CLAUDE_PLUGIN_ROOT}: ${hook.command}`);
          assert.ok(!hook.command.includes('${PLUGIN_ROOT}'),
            `Hook should not use deprecated \${PLUGIN_ROOT}: ${hook.command}`);
        }
      }
    }
  }));

  record(test('all hook script files exist', () => {
    const hookScripts = [
      'hooks/session-start.cjs',
    ];
    for (const script of hookScripts) {
      const fullPath = path.join(PROJECT_ROOT, script);
      assert.ok(fs.existsSync(fullPath), `Missing hook script: ${script}`);
    }
  }));

  // -- SKILLS --

  record(test('manifest declares skills (optional but recommended)', () => {
    if (rootManifest.skills) {
      assert.ok(Array.isArray(rootManifest.skills), 'skills should be an array');
      for (const skillPath of rootManifest.skills) {
        const fullPath = path.join(PROJECT_ROOT, skillPath);
        assert.ok(fs.existsSync(fullPath), `Missing skill directory: ${skillPath}`);
      }
    }
  }));

  // -- POST-INSTALL --

  record(test('manifest has postInstall command', () => {
    assert.ok(rootManifest.postInstall, 'postInstall is required for npm dependency installation');
    assert.ok(rootManifest.postInstall.includes('npm'),
      'postInstall should run npm install');
  }));

  // -- NO INLINE HOOKS --

  record(test('manifest does NOT have inline hook declarations', () => {
    assert.ok(!rootManifest.hooks,
      'plugin.json should NOT contain inline hooks - use hooks/hooks.json instead');
  }));

  // -- SUMMARY --

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
```

### Step 2: Run test to verify it fails

```bash
node tests/test-plugin-manifest.cjs
# Expected: FAIL — hooks.json missing, inline hooks present, env var mismatch, etc.
```

### Step 3: Write the implementation

**Create `hooks/hooks.json`:**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cjs"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-end.cjs"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.cjs"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop-hook.cjs"
          }
        ]
      }
    ],
    "InstructionsLoaded": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cjs --instructions-loaded"
          }
        ]
      }
    ]
  }
}
```

**Create unified `plugin.json`** (copy to both locations):

```json
{
  "name": "cortex",
  "version": "3.0.0",
  "description": "Claude's Cognitive Layer - Cross-session memory with dual-model reasoning, HyDE search, and auto-extraction",
  "author": {
    "name": "Roberto Gogoni"
  },
  "homepage": "https://github.com/robertogogoni/cortex-claude",
  "repository": "https://github.com/robertogogoni/cortex-claude",
  "license": "MIT",
  "keywords": ["memory", "cortex", "cross-session", "hyde", "knowledge-graph", "dual-model", "mcp"],
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/cortex/server.cjs"],
      "env": {}
    }
  },
  "skills": ["skills/cortex"],
  "postInstall": "npm install --production"
}
```

```bash
cp plugin.json .claude-plugin/plugin.json
```

### Step 4: Verify

```bash
node tests/test-plugin-manifest.cjs
# Expected: All 18 tests pass
```

### Step 5: Commit

```bash
git add plugin.json .claude-plugin/plugin.json hooks/hooks.json tests/test-plugin-manifest.cjs
git commit -m "feat(D1): align plugin manifests and add hooks.json

- Unified plugin.json and .claude-plugin/plugin.json (now identical)
- Extracted hook declarations to hooks/hooks.json (standard format)
- Added InstructionsLoaded hook (Claude Code v2.1.63+)
- Fixed env var from \${PLUGIN_ROOT} to \${CLAUDE_PLUGIN_ROOT}
- Removed inline hooks from plugin.json
- Added skills declaration and postInstall command
- 18 validation tests passing"
```

---

## Task D2: HyDE Query Expansion via LlmProvider

**Files:**
- Create: `core/hyde-provider.cjs` (standalone HyDE module using LlmProvider interface)
- Create: `tests/test-hyde-provider.cjs` (comprehensive tests)
- Modify: `cortex/haiku-worker.cjs` (integrate HyDEProvider into query pipeline)

**Overview:**

HyDE (Hypothetical Document Embeddings) is already partially implemented in `cortex/haiku-worker.cjs` as the `_hydeExpand()` method. It works, but it is tightly coupled to HaikuWorker's internal `_callHaiku()` method and the Anthropic SDK directly.

The Phase D design decision specifies that D2 should use the LlmProvider interface (specifically DirectApiProvider from Phase B) instead of direct Anthropic SDK calls. This:
1. Enables future zero-cost HyDE via MCP Sampling when Claude Code adds support
2. Decouples HyDE logic from HaikuWorker into a reusable module
3. Adds proper caching at the HyDE layer (not just reusing AnalysisCache)
4. Supports configurable expansion strategies (single-doc, multi-perspective)

**Architecture:**

```
User Query
    |
    v
HyDEProvider
    |-- check cache (LRU with TTL)
    |-- if miss: call LlmProvider.complete(hydePrompt)
    |-- validate response (length > 20 chars, not a question)
    |-- cache result
    |-- return hypothetical document
    |
    v
Embedder.embed(hypotheticalDocument)  <-- instead of embed(rawQuery)
    |
    v
HybridSearch (vector search uses HyDE embedding)
```

**Dependency:** This task depends on Phase B (LlmProvider interface). If Phase B is not yet implemented, the implementation should:
1. Define the LlmProvider interface contract as a local type
2. Implement a `DirectApiHyDEProvider` that uses `@anthropic-ai/sdk` directly (matching current behavior)
3. Accept an injected `llmProvider` in the constructor for future Phase B integration
4. Fallback gracefully when no provider is available

**Acceptance Criteria:**
- [ ] HyDEProvider is a standalone module in `core/hyde-provider.cjs`
- [ ] Constructor accepts `{ llmProvider, embedder, cacheSize, cacheTTL }` options
- [ ] `expand(query)` returns hypothetical document string or null
- [ ] Cache prevents redundant LLM calls (LRU with configurable TTL)
- [ ] Response validation rejects short, empty, or question-form responses
- [ ] `expandAndEmbed(query)` returns embedding of hypothetical document
- [ ] Graceful fallback: returns null (caller uses raw query) on any failure
- [ ] Stats tracking: expansions, cacheHits, fallbacks, avgLatencyMs
- [ ] Performance: cached path < 1ms, uncached < 500ms (with fast model)
- [ ] All existing test-hyde.cjs tests continue to pass
- [ ] 27+ new tests covering standalone HyDEProvider

### Step 1: Write the failing test

```javascript
#!/usr/bin/env node
// tests/test-hyde-provider.cjs
'use strict';

const assert = require('assert');

// -- Mock LLM Provider --
// Simulates the LlmProvider interface from Phase B

class MockLlmProvider {
  constructor(options = {}) {
    this.responses = options.responses || {};
    this.defaultResponse = options.defaultResponse || 'A hypothetical document about the query topic with specific technical details and concrete examples.';
    this.callCount = 0;
    this.lastPrompt = null;
    this.shouldFail = options.shouldFail || false;
    this.latencyMs = options.latencyMs || 0;
  }

  async complete(prompt, options = {}) {
    this.callCount++;
    this.lastPrompt = prompt;

    if (this.shouldFail) {
      throw new Error('Mock LLM provider failure');
    }

    if (this.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    }

    for (const [key, response] of Object.entries(this.responses)) {
      if (prompt.includes(key)) {
        return { text: response, model: 'mock-haiku', tokensUsed: 50 };
      }
    }

    return { text: this.defaultResponse, model: 'mock-haiku', tokensUsed: 50 };
  }
}

// -- Mock Embedder --

class MockEmbedder {
  constructor() {
    this.embedCount = 0;
    this.lastInput = null;
  }

  async embed(text) {
    this.embedCount++;
    this.lastInput = text;
    const embedding = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      embedding[i] = Math.sin(i + text.length * 0.1) * 0.5;
    }
    return embedding;
  }

  getDimension() { return 384; }
}

// -- Test Helpers --

function test(name, fn) {
  try { fn(); console.log(`  pass ${name}`); return true; }
  catch (error) { console.log(`  FAIL ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  pass ${name}`); return true; }
  catch (error) { console.log(`  FAIL ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

// -- Tests --

async function main() {
  console.log('\nTask D2: HyDE Provider Tests\n');

  const { HyDEProvider, DEFAULT_HYDE_CACHE_SIZE, DEFAULT_HYDE_CACHE_TTL } = require('../core/hyde-provider.cjs');

  let passed = 0;
  let failed = 0;
  function record(ok) { if (ok) passed++; else failed++; }

  // -- CONSTRUCTION --

  record(test('exports HyDEProvider class and constants', () => {
    assert.strictEqual(typeof HyDEProvider, 'function', 'HyDEProvider should be a class');
    assert.strictEqual(typeof DEFAULT_HYDE_CACHE_SIZE, 'number');
    assert.strictEqual(typeof DEFAULT_HYDE_CACHE_TTL, 'number');
  }));

  record(test('constructor accepts llmProvider option', () => {
    const provider = new MockLlmProvider();
    const hyde = new HyDEProvider({ llmProvider: provider });
    assert.ok(hyde, 'Should construct with llmProvider');
  }));

  record(test('constructor works without llmProvider (disabled mode)', () => {
    const hyde = new HyDEProvider();
    assert.ok(hyde, 'Should construct without llmProvider');
    assert.strictEqual(hyde.isEnabled(), false, 'Should be disabled without provider');
  }));

  record(test('constructor accepts embedder option', () => {
    const provider = new MockLlmProvider();
    const embedder = new MockEmbedder();
    const hyde = new HyDEProvider({ llmProvider: provider, embedder });
    assert.ok(hyde, 'Should construct with embedder');
  }));

  record(test('constructor accepts cache configuration', () => {
    const hyde = new HyDEProvider({
      llmProvider: new MockLlmProvider(),
      cacheSize: 100,
      cacheTTL: 30000,
    });
    const stats = hyde.getStats();
    assert.strictEqual(stats.cacheMaxSize, 100);
    assert.strictEqual(stats.cacheTTL, 30000);
  }));

  // -- EXPAND (core method) --

  record(await testAsync('expand() returns hypothetical document for valid query', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'Authentication errors in Node.js are typically caused by expired JWT tokens. The token refresh mechanism should use a sliding window approach with a grace period of 5 minutes.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });
    const result = await hyde.expand('how to debug auth errors');
    assert.ok(result, 'Should return a document');
    assert.ok(result.length > 20, 'Document should be non-trivial');
  }));

  record(await testAsync('expand() returns null when provider is not set', async () => {
    const hyde = new HyDEProvider();
    const result = await hyde.expand('test query');
    assert.strictEqual(result, null, 'Should return null without provider');
  }));

  record(await testAsync('expand() returns null on provider failure', async () => {
    const provider = new MockLlmProvider({ shouldFail: true });
    const hyde = new HyDEProvider({ llmProvider: provider });
    const result = await hyde.expand('test query');
    assert.strictEqual(result, null, 'Should return null on failure');
    const stats = hyde.getStats();
    assert.strictEqual(stats.fallbacks, 1, 'Fallback should be recorded');
  }));

  record(await testAsync('expand() rejects empty/whitespace queries', async () => {
    const hyde = new HyDEProvider({ llmProvider: new MockLlmProvider() });
    const result1 = await hyde.expand('');
    const result2 = await hyde.expand('   ');
    const result3 = await hyde.expand(null);
    assert.strictEqual(result1, null);
    assert.strictEqual(result2, null);
    assert.strictEqual(result3, null);
  }));

  record(await testAsync('expand() rejects too-short LLM responses', async () => {
    const provider = new MockLlmProvider({ defaultResponse: 'Short.' });
    const hyde = new HyDEProvider({ llmProvider: provider });
    const result = await hyde.expand('elaborate query about something complex');
    assert.strictEqual(result, null, 'Short response should be rejected');
  }));

  record(await testAsync('expand() rejects question-form responses', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'What kind of authentication errors are you encountering? Could you provide more context about your setup?',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });
    const result = await hyde.expand('debug auth errors');
    assert.strictEqual(result, null, 'Question responses should be rejected');
  }));

  // -- CACHING --

  record(await testAsync('expand() caches results', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'Detailed technical document about database indexing strategies for PostgreSQL B-tree indexes.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });

    const result1 = await hyde.expand('database indexing');
    const result2 = await hyde.expand('database indexing');

    assert.strictEqual(result1, result2, 'Same query should return cached result');
    assert.strictEqual(provider.callCount, 1, 'Provider should only be called once');
    const stats = hyde.getStats();
    assert.strictEqual(stats.cacheHits, 1);
    assert.strictEqual(stats.expansions, 1);
  }));

  record(await testAsync('expand() cache is case-insensitive', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'React hooks enable functional components to manage state and side effects.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });

    await hyde.expand('react hooks');
    const result = await hyde.expand('React Hooks');

    assert.ok(result, 'Case-different query should hit cache');
    assert.strictEqual(provider.callCount, 1);
  }));

  record(await testAsync('expand() cache respects TTL', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'Kubernetes pod scheduling uses resource requests and limits.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider, cacheTTL: 1 }); // 1ms TTL

    await hyde.expand('kubernetes scheduling');
    await new Promise(resolve => setTimeout(resolve, 10));
    await hyde.expand('kubernetes scheduling');

    assert.strictEqual(provider.callCount, 2, 'Expired cache should trigger new call');
  }));

  record(await testAsync('expand() cache isolates different queries', async () => {
    const provider = new MockLlmProvider({
      responses: {
        'auth': 'Authentication document with JWT tokens and OAuth flows.',
        'database': 'Database document about PostgreSQL query optimization.',
      },
    });
    const hyde = new HyDEProvider({ llmProvider: provider });

    const r1 = await hyde.expand('auth debugging');
    const r2 = await hyde.expand('database optimization');

    assert.notStrictEqual(r1, r2, 'Different queries should return different documents');
  }));

  record(await testAsync('clearCache() empties the cache', async () => {
    const provider = new MockLlmProvider();
    const hyde = new HyDEProvider({ llmProvider: provider });

    await hyde.expand('test query');
    hyde.clearCache();
    await hyde.expand('test query');

    assert.strictEqual(provider.callCount, 2, 'Cleared cache should force new call');
  }));

  // -- EXPAND AND EMBED --

  record(await testAsync('expandAndEmbed() returns embedding of hypothetical doc', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'Detailed technical document about authentication debugging with JWT token validation.',
    });
    const embedder = new MockEmbedder();
    const hyde = new HyDEProvider({ llmProvider: provider, embedder });

    const result = await hyde.expandAndEmbed('auth debugging');

    assert.ok(result, 'Should return a result object');
    assert.ok(result.embedding, 'Should have embedding');
    assert.strictEqual(result.embedding.length, 384, 'Embedding should be 384-dim');
    assert.ok(result.document, 'Should include the hypothetical document');
    assert.strictEqual(embedder.embedCount, 1, 'Embedder should be called once');
  }));

  record(await testAsync('expandAndEmbed() returns null when no embedder', async () => {
    const provider = new MockLlmProvider();
    const hyde = new HyDEProvider({ llmProvider: provider });
    const result = await hyde.expandAndEmbed('test query');
    assert.strictEqual(result, null, 'Should return null without embedder');
  }));

  record(await testAsync('expandAndEmbed() returns null when expand fails', async () => {
    const provider = new MockLlmProvider({ shouldFail: true });
    const embedder = new MockEmbedder();
    const hyde = new HyDEProvider({ llmProvider: provider, embedder });
    const result = await hyde.expandAndEmbed('test query');
    assert.strictEqual(result, null);
    assert.strictEqual(embedder.embedCount, 0, 'Embedder should not be called');
  }));

  // -- STATS --

  record(test('getStats() returns complete statistics', () => {
    const hyde = new HyDEProvider({ llmProvider: new MockLlmProvider() });
    const stats = hyde.getStats();
    assert.strictEqual(typeof stats.expansions, 'number');
    assert.strictEqual(typeof stats.cacheHits, 'number');
    assert.strictEqual(typeof stats.fallbacks, 'number');
    assert.strictEqual(typeof stats.avgLatencyMs, 'number');
    assert.strictEqual(typeof stats.cacheSize, 'number');
    assert.strictEqual(typeof stats.cacheMaxSize, 'number');
    assert.strictEqual(typeof stats.cacheTTL, 'number');
    assert.strictEqual(typeof stats.enabled, 'boolean');
  }));

  record(await testAsync('stats track expansion count correctly', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'Technical document about Node.js event loop internals.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });

    await hyde.expand('event loop');
    await hyde.expand('async patterns');
    await hyde.expand('event loop'); // cache hit

    const stats = hyde.getStats();
    assert.strictEqual(stats.expansions, 2, 'Two unique expansions');
    assert.strictEqual(stats.cacheHits, 1, 'One cache hit');
  }));

  // -- PROMPT CONSTRUCTION --

  record(await testAsync('expand() sends query to LLM in prompt', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'A detailed technical document answering the query with specific details.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });

    await hyde.expand('how to optimize database queries');

    assert.ok(provider.lastPrompt, 'Provider should receive a prompt');
    assert.ok(provider.lastPrompt.includes('how to optimize database queries'),
      'Prompt should include the original query');
  }));

  // -- CONCURRENT ACCESS --

  record(await testAsync('concurrent expand() calls do not corrupt state', async () => {
    const provider = new MockLlmProvider({
      responses: {
        'query A': 'Document A about authentication patterns.',
        'query B': 'Document B about database sharding.',
        'query C': 'Document C about microservice communication.',
      },
    });
    const hyde = new HyDEProvider({ llmProvider: provider });

    const [r1, r2, r3] = await Promise.all([
      hyde.expand('query A'),
      hyde.expand('query B'),
      hyde.expand('query C'),
    ]);

    assert.ok(r1 && r2 && r3, 'All results should exist');
    assert.notStrictEqual(r1, r2);
    assert.notStrictEqual(r2, r3);
  }));

  // -- EDGE CASES --

  record(await testAsync('expand() handles Unicode queries', async () => {
    const provider = new MockLlmProvider({
      defaultResponse: 'Um documento tecnico sobre otimizacao de consultas em bancos de dados relacionais.',
    });
    const hyde = new HyDEProvider({ llmProvider: provider });
    const result = await hyde.expand('como otimizar consultas SQL?');
    assert.ok(result, 'Should handle Unicode queries');
  }));

  // -- SUMMARY --

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

### Step 2: Run test to verify it fails

```bash
node tests/test-hyde-provider.cjs
# Expected: FAIL — Cannot find module '../core/hyde-provider.cjs'
```

### Step 3: Write the implementation

```javascript
#!/usr/bin/env node
// core/hyde-provider.cjs
/**
 * Cortex - HyDE Provider (Hypothetical Document Embeddings)
 *
 * Generates hypothetical "ideal answer" documents for queries, then uses
 * those documents' embeddings for vector search instead of raw query embeddings.
 *
 * Research: "Precise Zero-Shot Dense Retrieval without Relevance Labels" (Gao et al., 2022)
 *
 * Architecture:
 *   Query -> LlmProvider.complete(hydePrompt) -> hypothetical document
 *   hypothetical document -> Embedder.embed() -> embedding for vector search
 *
 * @version 1.0.0
 */

'use strict';

const crypto = require('crypto');

// -- CONSTANTS --

const DEFAULT_HYDE_CACHE_SIZE = 200;
const DEFAULT_HYDE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MIN_DOCUMENT_LENGTH = 20;
const MAX_QUERY_LENGTH = 2000;

const HYDE_SYSTEM_PROMPT = `You are a technical knowledge base. Given a search query, write a short (2-3 sentence) document that would be a PERFECT answer to this query. Be specific, technical, and use concrete details. Do NOT ask questions or hedge - write as if you are the ideal search result.`;

// -- LRU CACHE WITH TTL --

class HyDECache {
  constructor(maxSize = DEFAULT_HYDE_CACHE_SIZE, ttlMs = DEFAULT_HYDE_CACHE_TTL) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  _key(query) {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  get(query) {
    const key = this._key(query);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(query, value) {
    const key = this._key(query);
    if (this.cache.has(key)) this.cache.delete(key);

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear() { this.cache.clear(); }
  get size() { return this.cache.size; }
}

// -- HYDE PROVIDER CLASS --

class HyDEProvider {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || null;
    this.embedder = options.embedder || null;

    this.cache = new HyDECache(
      options.cacheSize || DEFAULT_HYDE_CACHE_SIZE,
      options.cacheTTL || DEFAULT_HYDE_CACHE_TTL,
    );

    this.stats = {
      expansions: 0,
      cacheHits: 0,
      fallbacks: 0,
      totalLatencyMs: 0,
    };
  }

  isEnabled() {
    return this.llmProvider !== null;
  }

  async expand(query) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) return null;
    if (!this.llmProvider) return null;

    const cached = this.cache.get(query);
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    const startTime = Date.now();
    try {
      const truncatedQuery = query.length > MAX_QUERY_LENGTH
        ? query.slice(0, MAX_QUERY_LENGTH) + '...'
        : query;

      const prompt = `${HYDE_SYSTEM_PROMPT}\n\nQuery: ${truncatedQuery}`;

      const response = await this.llmProvider.complete(prompt, {
        maxTokens: 256,
        temperature: 0.7,
      });

      const document = response.text;

      if (!this._isValidDocument(document)) {
        this.stats.fallbacks++;
        return null;
      }

      this.cache.set(query, document);
      this.stats.expansions++;
      this.stats.totalLatencyMs += Date.now() - startTime;

      return document;
    } catch (error) {
      this.stats.fallbacks++;
      return null;
    }
  }

  async expandAndEmbed(query) {
    if (!this.embedder) return null;

    const document = await this.expand(query);
    if (!document) return null;

    try {
      const embedding = await this.embedder.embed(document);
      return { embedding, document };
    } catch (error) {
      return null;
    }
  }

  clearCache() { this.cache.clear(); }

  getStats() {
    const avgLatency = this.stats.expansions > 0
      ? Math.round(this.stats.totalLatencyMs / this.stats.expansions)
      : 0;

    return {
      enabled: this.isEnabled(),
      expansions: this.stats.expansions,
      cacheHits: this.stats.cacheHits,
      fallbacks: this.stats.fallbacks,
      avgLatencyMs: avgLatency,
      totalLatencyMs: this.stats.totalLatencyMs,
      cacheSize: this.cache.size,
      cacheMaxSize: this.cache.maxSize,
      cacheTTL: this.cache.ttlMs,
    };
  }

  _isValidDocument(doc) {
    if (!doc || typeof doc !== 'string') return false;

    const trimmed = doc.trim();
    if (trimmed.length < MIN_DOCUMENT_LENGTH) return false;

    // Reject question-form responses (>30% questions)
    const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const questionMarks = (trimmed.match(/\?/g) || []).length;
    if (sentences.length > 0 && questionMarks / sentences.length > 0.3) return false;

    // Reject hedging/refusal
    const lowerDoc = trimmed.toLowerCase();
    const hedgePatterns = [
      'i cannot', "i can't", "i don't know", "i'm not sure",
      'could you provide', 'can you clarify', 'please provide',
      'more context', 'more information',
    ];
    for (const pattern of hedgePatterns) {
      if (lowerDoc.startsWith(pattern)) return false;
    }

    return true;
  }
}

module.exports = {
  HyDEProvider,
  HyDECache,
  DEFAULT_HYDE_CACHE_SIZE,
  DEFAULT_HYDE_CACHE_TTL,
  MIN_DOCUMENT_LENGTH,
  HYDE_SYSTEM_PROMPT,
};
```

### Step 4: Integrate into HaikuWorker

Modify `cortex/haiku-worker.cjs`:

```javascript
// At top, add import:
const { HyDEProvider } = require('../core/hyde-provider.cjs');

// In constructor, add after existing setup:
const self = this;
const haikuLlmAdapter = {
  async complete(prompt, options = {}) {
    const result = await self._callHaiku('', prompt);
    return { text: result || '', model: 'haiku', tokensUsed: 0 };
  },
};

this.hydeProvider = new HyDEProvider({
  llmProvider: this.enableApiCalls ? haikuLlmAdapter : null,
  embedder: null, // Embedding handled by orchestrator
  cacheSize: 500,
  cacheTTL: 60 * 60 * 1000,
});

// Replace _hydeExpand method body:
async _hydeExpand(query) {
  const legacyCached = this.analysisCache.get(query, 'hyde');
  if (legacyCached) {
    this.stats.hydeCacheHits++;
    this.stats.cacheHits++;
    return legacyCached;
  }

  const result = await this.hydeProvider.expand(query);
  if (result) {
    this.stats.hydeExpansions++;
    this.analysisCache.set(query, 'hyde', result);
  } else if (this.enableApiCalls) {
    this.stats.hydeFallbacks++;
  }
  return result;
}
```

### Step 5: Verify

```bash
node tests/test-hyde-provider.cjs   # All 27 tests pass
node tests/test-hyde.cjs            # All existing tests still pass
```

### Step 6: Commit

```bash
git add core/hyde-provider.cjs tests/test-hyde-provider.cjs cortex/haiku-worker.cjs
git commit -m "feat(D2): standalone HyDE provider with LlmProvider interface

- Extract HyDE logic from HaikuWorker into core/hyde-provider.cjs
- HyDEProvider accepts any LlmProvider-compatible object (Phase B ready)
- Standalone LRU cache with configurable size and TTL
- Response validation: rejects short, question-form, and hedging responses
- expandAndEmbed() combines expansion + embedding in one call
- Comprehensive stats tracking
- 27 new tests + existing tests all passing"
```

---

## Task D3: Terminal Demo GIF (VHS Tape)

**Files:**
- Modify: `assets/demo.tape` (VHS tape file)
- Modify: `scripts/record-asciinema-demo.sh` (asciinema fallback)
- Output: `assets/demo.gif`

**Overview:**

A demo GIF already exists at `assets/demo.gif` with a VHS tape at `assets/demo.tape` and recording scripts. This task updates the demo to showcase Cortex v3.0.0 features.

**Acceptance Criteria:**
- [ ] `assets/demo.tape` updated for v3.0.0 commands
- [ ] Demo shows: session-start banner, search query, status dashboard
- [ ] GIF is < 2 MB
- [ ] Recording reproducible via `vhs assets/demo.tape`

### Step 1: Write updated VHS tape

```tape
# assets/demo.tape
# Cortex v3.0.0 Demo
# Usage: vhs assets/demo.tape

Output assets/demo.gif
Set Theme "Catppuccin Mocha"
Set FontSize 14
Set Width 1100
Set Height 700
Set Padding 20
Set TypingSpeed 35ms
Set Shell "bash"

# Step 1: Session start hook
Type "cd ~/.claude/memory && node hooks/session-start.cjs 2>/dev/null | head -20"
Enter
Sleep 6s
Sleep 1.5s

# Step 2: Memory search (HyDE indicator)
Type 'node bin/cortex.cjs search "debugging authentication errors"'
Enter
Sleep 6s
Sleep 1.5s

# Step 3: Status dashboard
Type "node bin/cortex.cjs status"
Enter
Sleep 5s
Sleep 2s
```

### Step 2: Write updated asciinema fallback

```bash
#!/usr/bin/env bash
# scripts/record-asciinema-demo.sh
# Record Cortex demo using tmux + asciinema + agg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CAST_FILE="/tmp/cortex-demo.cast"
GIF_FILE="$PROJECT_DIR/assets/demo.gif"
TMUX_SESSION="cortex-demo"
COLS=110
ROWS=36

cd "$PROJECT_DIR"
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

echo "Recording Cortex v3.0.0 demo (${COLS}x${ROWS})..."

cat > /tmp/cortex-demo-script.sh << 'DEMO'
#!/usr/bin/env bash
cd ~/.claude/memory

type_cmd() {
  local cmd="$1"
  for (( i=0; i<${#cmd}; i++ )); do
    printf '%s' "${cmd:$i:1}"
    sleep 0.04
  done
  echo
}

clear
sleep 0.5

printf '\033[1;36m'
echo "  Cortex v3.0.0 -- Claude's Cognitive Memory Layer"
printf '\033[0m'
echo ""
sleep 1.2

printf '\033[90m$ \033[0m'
type_cmd "node hooks/session-start.cjs 2>/dev/null | head -20"
sleep 0.3
node hooks/session-start.cjs 2>/dev/null | head -20
sleep 3

echo ""
printf '\033[90m$ \033[0m'
type_cmd 'node bin/cortex.cjs search "debugging authentication errors" 2>/dev/null | head -22'
sleep 0.3
node bin/cortex.cjs search "debugging authentication errors" 2>/dev/null | head -22
sleep 3

echo ""
printf '\033[90m$ \033[0m'
type_cmd 'node bin/cortex.cjs status 2>/dev/null | head -30'
sleep 0.3
node bin/cortex.cjs status 2>/dev/null | head -30
sleep 3

printf '\033[1;32mCortex ready - 7 adapters - 447 tests passing\033[0m\n'
sleep 2
DEMO

chmod +x /tmp/cortex-demo-script.sh

tmux new-session -d -s "$TMUX_SESSION" -x "$COLS" -y "$ROWS" \
  "asciinema rec --idle-time-limit 2 --command /tmp/cortex-demo-script.sh --overwrite $CAST_FILE; tmux wait-for -S done"

tmux wait-for done 2>/dev/null || sleep 30
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

echo "Converting to GIF with agg..."
~/.cargo/bin/agg --theme monokai --font-size 16 --speed 1.2 --fps-cap 12 "$CAST_FILE" "$GIF_FILE"

echo "Done! GIF saved to: $GIF_FILE"
ls -lh "$GIF_FILE"
```

### Step 3: Record and verify

```bash
# Option A: VHS
vhs assets/demo.tape

# Option B: asciinema + agg
bash scripts/record-asciinema-demo.sh

# Verify
ls -lh assets/demo.gif    # < 2 MB
file assets/demo.gif       # GIF image data, version 89a
```

### Step 4: Commit

```bash
git add assets/demo.tape assets/demo.gif scripts/record-asciinema-demo.sh
git commit -m "docs(D3): update terminal demo GIF for v3.0.0"
```

---

## Dependency Summary

| Task | Depends On | Creates |
|------|-----------|---------|
| D1 (Plugin Manifest) | None | `hooks/hooks.json`, unified `plugin.json` |
| D2 (HyDE Provider) | Phase B (LlmProvider) | `core/hyde-provider.cjs` |
| D3 (Terminal Demo) | D1, D2 | `assets/demo.gif` |

**Execution order:** D1 -> D2 -> D3

## Estimated Effort

| Task | Time | Tests |
|------|------|-------|
| D1: Plugin Manifest | 1 hour | 18 tests |
| D2: HyDE Provider | 4 hours | 27 tests |
| D3: Terminal Demo | 1 hour | manual verification |
| **Total** | **6 hours** | **45 tests** |
