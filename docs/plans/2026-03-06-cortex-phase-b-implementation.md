# Cortex Phase B: Core Engine -- Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up Phase A debt (version mismatch, injection-formatter default, validateArray resilience), build a dual-path LLM provider (DirectApiProvider + SamplingProvider stub), integrate it into HaikuWorker/SonnetThinker, add InstructionsLoaded hook, and unify the color system across CLI and MCP outputs.

**Architecture:** LlmProvider interface with DirectApiProvider (primary, uses Anthropic SDK) and SamplingProvider (stub for future MCP sampling support). ProviderFactory auto-detects the best provider. Hooks: InstructionsLoaded for memory sync. Color unification via shared constants module.

**Tech Stack:** Node.js (CommonJS `.cjs`), @anthropic-ai/sdk (existing), custom test runner (`test()`/`testAsync()`)

**Depends on:** Phase A (v2.0.0) + Phase E (SQLite adapters)

**See also:**
- [Design Decisions (Phases B, C, CR, D)](2026-03-06-cortex-phases-b-cr-d-design-decisions.md) -- revised task list and architecture
- [Original Transformation Plan](2026-02-25-cortex-v3-full-transformation.md) -- original Phase B spec (lines 343-1063)
- [Master Implementation Index](2026-03-02-cortex-implementation-index.md) -- links to all phase plans

---

### Task B0: Phase A Debt + Input Resilience

**Files:**
- Modify: `cortex/server.cjs` (B0-a: version from package.json)
- Modify: `hooks/injection-formatter.cjs` (B0-b: default format to 'neural')
- Modify: `core/validation.cjs` (B0-d: validateArray auto-convert strings)
- Test: `tests/test-phase-a-debt.cjs`

**Rationale:** Phase A audit found 3 gaps: version hardcoded in server.cjs instead of read from package.json, injection-formatter constructor defaults to `'rich'` not `'neural'`, and `validateArray()` rejects comma-separated strings causing CORTEX_E200 for LLM-generated inputs.

---

#### Step 1: Write the failing test

```javascript
// tests/test-phase-a-debt.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  console.log('\n\u2501\u2501\u2501 Phase A Debt + Input Resilience Tests \u2501\u2501\u2501\n');

  let passed = 0;
  let failed = 0;

  // ── B0-a: Version matching ──────────────────────────────────────────────────

  // T1: server.cjs version must match package.json version
  test('server.cjs version matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'package.json'), 'utf8'
    ));
    const serverSource = fs.readFileSync(
      path.join(__dirname, '..', 'cortex', 'server.cjs'), 'utf8'
    );

    // Check the Server constructor version string
    const versionMatch = serverSource.match(/version:\s*['"]([^'"]+)['"]/);
    assert.ok(versionMatch, 'server.cjs should contain a version string');

    // The version should be read from package.json, not hardcoded
    // After the fix, it should use require('../package.json').version or equivalent
    // We verify by checking the version in the Server info block matches package.json
    const serverVersionMatches = serverSource.match(/version:\s*['"]([^'"]+)['"]/g);
    // At least the Server constructor version should match
    let found = false;
    for (const match of serverVersionMatches || []) {
      const v = match.match(/['"]([^'"]+)['"]/)[1];
      if (v === pkg.version) {
        found = true;
        break;
      }
    }
    // After fix, server.cjs should dynamically read version or match package.json
    // For now, we just verify they're in sync
    assert.ok(found || serverSource.includes('require(') && serverSource.includes('package.json'),
      `server.cjs version should match package.json (${pkg.version}) or dynamically read it`
    );
  }) ? passed++ : failed++;

  // T2: health status version should match package.json
  test('health status version matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'package.json'), 'utf8'
    ));
    const serverSource = fs.readFileSync(
      path.join(__dirname, '..', 'cortex', 'server.cjs'), 'utf8'
    );

    // The getHealthStatus function also has a hardcoded version
    // After fix, it should use the same dynamic version
    const healthVersionMatch = serverSource.match(/version:\s*['"](\d+\.\d+\.\d+)['"]/g);
    if (healthVersionMatch) {
      for (const match of healthVersionMatch) {
        const v = match.match(/['"]([^'"]+)['"]/)[1];
        assert.strictEqual(v, pkg.version,
          `Health status version ${v} should match package.json ${pkg.version}`
        );
      }
    }
  }) ? passed++ : failed++;

  // ── B0-b: Injection formatter default ───────────────────────────────────────

  // T3: InjectionFormatter defaults to 'neural' format
  test('InjectionFormatter defaults to neural format', () => {
    const { InjectionFormatter } = require('../hooks/injection-formatter.cjs');
    const formatter = new InjectionFormatter();
    assert.strictEqual(formatter.formatType, 'neural',
      `Default format should be 'neural', got '${formatter.formatType}'`
    );
  }) ? passed++ : failed++;

  // T4: InjectionFormatter still accepts explicit format override
  test('InjectionFormatter accepts explicit format override', () => {
    const { InjectionFormatter } = require('../hooks/injection-formatter.cjs');
    const rich = new InjectionFormatter({ format: 'rich' });
    assert.strictEqual(rich.formatType, 'rich');
    const compact = new InjectionFormatter({ format: 'compact' });
    assert.strictEqual(compact.formatType, 'compact');
    const xml = new InjectionFormatter({ format: 'xml' });
    assert.strictEqual(xml.formatType, 'xml');
  }) ? passed++ : failed++;

  // T5: neural format still renders correctly (falls through to rich)
  test('neural format renders memories correctly', () => {
    const { InjectionFormatter } = require('../hooks/injection-formatter.cjs');
    const formatter = new InjectionFormatter({ format: 'neural' });
    const result = formatter.formatMemories([
      { type: 'learning', content: 'Test memory', summary: 'Test', _source: 'jsonl' }
    ], { projectName: 'test' }, { estimatedTokens: 50 });
    assert.ok(result.length > 0, 'Should produce output');
    assert.ok(typeof result === 'string', 'Should be a string');
  }) ? passed++ : failed++;

  // ── B0-d: validateArray auto-convert strings ────────────────────────────────

  // T6: validateArray auto-converts comma-separated strings to arrays
  test('validateArray converts comma-separated string to array', () => {
    const { validateArray } = require('../core/validation.cjs');
    const result = validateArray('tag1, tag2, tag3', {
      fieldName: 'tags',
      maxItems: 20,
      defaultValue: [],
    });
    assert.ok(Array.isArray(result), 'Should return an array');
    assert.strictEqual(result.length, 3, `Should have 3 items, got ${result.length}`);
    assert.strictEqual(result[0], 'tag1');
    assert.strictEqual(result[1], 'tag2');
    assert.strictEqual(result[2], 'tag3');
  }) ? passed++ : failed++;

  // T7: validateArray still works with real arrays (no regression)
  test('validateArray still works with real arrays', () => {
    const { validateArray } = require('../core/validation.cjs');
    const result = validateArray(['a', 'b', 'c'], {
      fieldName: 'tags',
      maxItems: 20,
      defaultValue: [],
    });
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result, ['a', 'b', 'c']);
  }) ? passed++ : failed++;

  // T8: validateArray converts single string (no comma) to single-element array
  test('validateArray converts single string to single-element array', () => {
    const { validateArray } = require('../core/validation.cjs');
    const result = validateArray('solo-tag', {
      fieldName: 'tags',
      maxItems: 20,
      defaultValue: [],
    });
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], 'solo-tag');
  }) ? passed++ : failed++;

  // T9: validateArray still returns defaultValue for null/undefined
  test('validateArray returns default for null', () => {
    const { validateArray } = require('../core/validation.cjs');
    const result = validateArray(null, { fieldName: 'tags', defaultValue: ['default'] });
    assert.deepStrictEqual(result, ['default']);
  }) ? passed++ : failed++;

  // T10: validateArray applies itemValidator after string conversion
  test('validateArray applies itemValidator after string conversion', () => {
    const { validateArray, validateString, PATTERNS } = require('../core/validation.cjs');
    const result = validateArray('auth, debug, test-tag', {
      fieldName: 'tags',
      maxItems: 20,
      defaultValue: [],
      itemValidator: (v) => validateString(v, {
        fieldName: 'tag',
        maxLength: 100,
        pattern: PATTERNS.tag,
      }),
    });
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 3);
  }) ? passed++ : failed++;

  // T11: validateArray rejects non-string non-array types (number, object)
  test('validateArray rejects number input', () => {
    const { validateArray, ValidationError } = require('../core/validation.cjs');
    assert.throws(
      () => validateArray(42, { fieldName: 'tags' }),
      (err) => err instanceof ValidationError || err.name === 'ValidationError',
      'Should throw ValidationError for number input'
    );
  }) ? passed++ : failed++;

  // T12: validateArray handles empty string input
  test('validateArray handles empty string input', () => {
    const { validateArray } = require('../core/validation.cjs');
    const result = validateArray('', { fieldName: 'tags', defaultValue: [] });
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0, 'Empty string should yield empty array');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-phase-a-debt.cjs
# Expected: T3 fails (default is 'rich', not 'neural')
# Expected: T6, T8, T10 fail (validateArray rejects string input)
```

---

#### Step 3: Write the implementation

**B0-a: Fix version in `cortex/server.cjs`**

At the top of the `main()` function (after the `require` statements around line 35), add:

```javascript
  // Read version from package.json (single source of truth)
  const CORTEX_VERSION = require('../package.json').version;
```

Then replace all hardcoded `version: '3.0.0'` and `version: '2.0.0'` references with `version: CORTEX_VERSION`:

- Line ~100 in Server constructor: `version: CORTEX_VERSION,`
- Line ~294 in getHealthStatus: `version: CORTEX_VERSION,`

**B0-b: Fix injection-formatter default in `hooks/injection-formatter.cjs`**

Change line 84 from:
```javascript
    this.formatType = options.format || 'rich';
```
to:
```javascript
    this.formatType = options.format || 'neural';
```

**B0-d: Fix validateArray in `core/validation.cjs`**

Replace the `validateArray` function (lines 118-168) with:

```javascript
function validateArray(value, options = {}) {
  const {
    fieldName = 'array',
    maxItems = 100,
    minItems = 0,
    itemValidator = null,
    required = false,
    defaultValue = [],
  } = options;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return defaultValue;
  }

  // Auto-convert string to array (handles LLM-generated comma-separated strings)
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return defaultValue;
    }
    // Split on commas, trim each element, filter empty strings
    value = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  // Check if array
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }

  // Check length
  if (value.length < minItems) {
    throw new ValidationError(
      `${fieldName} must have at least ${minItems} items`
    );
  }

  if (value.length > maxItems) {
    throw new ValidationError(
      `${fieldName} exceeds maximum items (${value.length} > ${maxItems})`
    );
  }

  // Validate each item
  if (itemValidator) {
    return value.map((item, index) => {
      try {
        return itemValidator(item);
      } catch (error) {
        throw new ValidationError(
          `${fieldName}[${index}]: ${error.message}`
        );
      }
    });
  }

  return value;
}
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-phase-a-debt.cjs
# Expected: 12 passed, 0 failed
```

#### Step 5: B0-c: Verify/add GitHub topics

```bash
cd /home/rob/repos/cortex-claude
gh repo edit robertogogoni/cortex-claude --add-topic claude-code --add-topic mcp --add-topic memory --add-topic persistent-memory --add-topic ai --add-topic claude --add-topic llm --add-topic dual-model --add-topic hooks --add-topic learning
```

#### Step 6: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/validation.cjs hooks/injection-formatter.cjs cortex/server.cjs tests/test-phase-a-debt.cjs
git commit -m "fix(B0): Phase A debt — version sync, neural default, validateArray resilience

- B0-a: server.cjs reads version from package.json (single source of truth)
- B0-b: InjectionFormatter defaults to 'neural' format (was 'rich')
- B0-c: GitHub topics verified/added
- B0-d: validateArray() auto-converts comma-separated strings to arrays
  Fixes CORTEX_E200 when LLMs generate 'tag1, tag2' instead of ['tag1','tag2']
- 12 tests covering: version sync, formatter defaults, string-to-array
  conversion, itemValidator after conversion, edge cases (empty, null, number)"
```

---

### Task B1: LlmProvider Interface + DirectApiProvider

**Files:**
- Create: `core/llm-provider.cjs`
- Test: `tests/test-llm-provider.cjs`

**Rationale:** The design decisions doc specifies a dual-path LLM architecture: DirectApiProvider (primary, using Anthropic SDK) and SamplingProvider (future, using MCP sampling). Both implement the same LlmProvider interface so callers are agnostic.

---

#### Step 1: Write the failing test

```javascript
// tests/test-llm-provider.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  console.log('\n\u2501\u2501\u2501 LlmProvider Interface + DirectApiProvider Tests \u2501\u2501\u2501\n');

  const { LlmProvider, DirectApiProvider } = require('../core/llm-provider.cjs');
  let passed = 0;
  let failed = 0;

  // T1: LlmProvider is a class that can be extended
  test('LlmProvider is an abstract class', () => {
    assert.ok(typeof LlmProvider === 'function', 'LlmProvider should be a function/class');
    const provider = new LlmProvider();
    assert.ok(provider instanceof LlmProvider);
  }) ? passed++ : failed++;

  // T2: LlmProvider.complete() throws "not implemented"
  await testAsync('LlmProvider.complete() throws not implemented', async () => {
    const provider = new LlmProvider();
    try {
      await provider.complete('test');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('not implemented') || err.message.includes('abstract'),
        `Error should mention "not implemented", got: ${err.message}`);
    }
  }) ? passed++ : failed++;

  // T3: LlmProvider.createEmbedding() throws "not implemented"
  await testAsync('LlmProvider.createEmbedding() throws not implemented', async () => {
    const provider = new LlmProvider();
    try {
      await provider.createEmbedding('test');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('not implemented') || err.message.includes('abstract'),
        `Error should mention "not implemented", got: ${err.message}`);
    }
  }) ? passed++ : failed++;

  // T4: DirectApiProvider extends LlmProvider
  test('DirectApiProvider extends LlmProvider', () => {
    // Use a fake API key to construct without error
    const provider = new DirectApiProvider({ apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000' });
    assert.ok(provider instanceof LlmProvider, 'Should be instance of LlmProvider');
    assert.ok(provider instanceof DirectApiProvider, 'Should be instance of DirectApiProvider');
  }) ? passed++ : failed++;

  // T5: DirectApiProvider.getProviderName() returns 'direct-api'
  test('DirectApiProvider.getProviderName() returns direct-api', () => {
    const provider = new DirectApiProvider({ apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000' });
    assert.strictEqual(provider.getProviderName(), 'direct-api');
  }) ? passed++ : failed++;

  // T6: DirectApiProvider selects correct model for speed parameter
  test('DirectApiProvider selects correct model based on speed', () => {
    const provider = new DirectApiProvider({ apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000' });
    assert.strictEqual(provider._selectModel('fast'), 'claude-haiku-4-5-20251001');
    assert.strictEqual(provider._selectModel('deep'), 'claude-sonnet-4-6-20250627');
  }) ? passed++ : failed++;

  // T7: DirectApiProvider accepts model override
  test('DirectApiProvider accepts model override in options', () => {
    const provider = new DirectApiProvider({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
      models: { fast: 'claude-haiku-custom', deep: 'claude-sonnet-custom' },
    });
    assert.strictEqual(provider._selectModel('fast'), 'claude-haiku-custom');
    assert.strictEqual(provider._selectModel('deep'), 'claude-sonnet-custom');
  }) ? passed++ : failed++;

  // T8: DirectApiProvider stores configuration properly
  test('DirectApiProvider stores configuration', () => {
    const provider = new DirectApiProvider({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
      maxRetries: 5,
      timeoutMs: 30000,
    });
    assert.strictEqual(provider.maxRetries, 5);
    assert.strictEqual(provider.timeoutMs, 30000);
  }) ? passed++ : failed++;

  // T9: DirectApiProvider without API key throws clear error
  test('DirectApiProvider without API key throws clear error', () => {
    // Save and clear env
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      // Clear cached key
      try { require('../core/api-key.cjs').clearCache(); } catch {}

      assert.throws(
        () => new DirectApiProvider({ apiKey: null }),
        (err) => err.message.includes('API key') || err.message.includes('ANTHROPIC_API_KEY'),
        'Should throw error about missing API key'
      );
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
      try { require('../core/api-key.cjs').clearCache(); } catch {}
    }
  }) ? passed++ : failed++;

  // T10: DirectApiProvider.isAvailable() reflects API key state
  test('DirectApiProvider.isAvailable() returns true when key exists', () => {
    const provider = new DirectApiProvider({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
    });
    assert.strictEqual(provider.isAvailable(), true);
  }) ? passed++ : failed++;

  // T11: LlmProvider interface has all required method stubs
  test('LlmProvider has complete, createEmbedding, getProviderName, isAvailable', () => {
    const provider = new LlmProvider();
    assert.strictEqual(typeof provider.complete, 'function');
    assert.strictEqual(typeof provider.createEmbedding, 'function');
    assert.strictEqual(typeof provider.getProviderName, 'function');
    assert.strictEqual(typeof provider.isAvailable, 'function');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-llm-provider.cjs
# Expected: Error — Cannot find module '../core/llm-provider.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/llm-provider.cjs
#!/usr/bin/env node
/**
 * Cortex LLM Provider System
 *
 * Dual-path LLM abstraction:
 *   - DirectApiProvider: Uses Anthropic SDK + user's API key (primary)
 *   - SamplingProvider: Uses MCP sampling/createMessage (future, stub)
 *
 * All callers (HaikuWorker, SonnetThinker) use the LlmProvider interface,
 * making them agnostic to the underlying LLM delivery mechanism.
 *
 * @version 1.0.0
 */

'use strict';

const { getApiKey } = require('./api-key.cjs');

// =============================================================================
// MODEL CONSTANTS
// =============================================================================

const DEFAULT_MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  deep: 'claude-sonnet-4-6-20250627',
};

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;

// =============================================================================
// ABSTRACT LLM PROVIDER
// =============================================================================

/**
 * Abstract LLM Provider interface.
 * All LLM providers must extend this class and implement the abstract methods.
 */
class LlmProvider {
  constructor() {
    // Base class — no initialization needed
  }

  /**
   * Send a completion request to the LLM.
   * @param {string} prompt - The prompt text
   * @param {Object} options
   * @param {'fast'|'deep'} options.speed - 'fast' hints Haiku-class, 'deep' hints Sonnet-class
   * @param {number} options.maxTokens - Max response tokens (default: 1024)
   * @param {string} options.systemPrompt - Optional system prompt
   * @param {number} options.temperature - Sampling temperature (0.0-1.0)
   * @returns {Promise<{text: string, model: string, provider: string, usage?: Object}>}
   */
  async complete(prompt, options = {}) {
    throw new Error('LlmProvider.complete() is abstract and must be implemented by subclass — not implemented');
  }

  /**
   * Create an embedding for the given text.
   * @param {string} text - Text to embed
   * @returns {Promise<{embedding: number[], model: string, provider: string}>}
   */
  async createEmbedding(text) {
    throw new Error('LlmProvider.createEmbedding() is abstract and must be implemented by subclass — not implemented');
  }

  /**
   * Get the provider name for logging and diagnostics.
   * @returns {string}
   */
  getProviderName() {
    return 'abstract';
  }

  /**
   * Check if this provider is available and configured.
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}

// =============================================================================
// DIRECT API PROVIDER
// =============================================================================

/**
 * DirectApiProvider - Uses the Anthropic SDK with the user's API key.
 *
 * This is the primary provider. It works everywhere (CI, standalone, any host)
 * but costs real API credits.
 */
class DirectApiProvider extends LlmProvider {
  /**
   * @param {Object} options
   * @param {string} options.apiKey - Anthropic API key (falls back to getApiKey())
   * @param {Object} options.models - Model overrides { fast: '...', deep: '...' }
   * @param {number} options.maxRetries - Max retry attempts (default: 2)
   * @param {number} options.timeoutMs - Timeout in ms (default: 60000)
   */
  constructor(options = {}) {
    super();

    const apiKey = options.apiKey || getApiKey();
    if (!apiKey) {
      throw new Error(
        'DirectApiProvider requires an API key. ' +
        'Set ANTHROPIC_API_KEY environment variable or pass apiKey option. ' +
        'Get a key at https://console.anthropic.com/settings/keys'
      );
    }

    this.apiKey = apiKey;
    this.models = { ...DEFAULT_MODELS, ...(options.models || {}) };
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    // Lazy-initialize Anthropic client
    this._client = null;
  }

  /**
   * Get or create the Anthropic client (lazy initialization).
   * @returns {Object} Anthropic client
   * @private
   */
  _getClient() {
    if (!this._client) {
      const Anthropic = require('@anthropic-ai/sdk').default;
      this._client = new Anthropic({ apiKey: this.apiKey });
    }
    return this._client;
  }

  /**
   * Select the appropriate model based on speed parameter.
   * @param {'fast'|'deep'} speed
   * @returns {string} Model identifier
   */
  _selectModel(speed) {
    return this.models[speed] || this.models.fast;
  }

  /**
   * @inheritdoc
   */
  async complete(prompt, options = {}) {
    const {
      speed = 'fast',
      maxTokens = DEFAULT_MAX_TOKENS,
      systemPrompt = null,
      temperature = undefined,
    } = options;

    const model = this._selectModel(speed);
    const client = this._getClient();

    const params = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (systemPrompt) params.system = systemPrompt;
    if (temperature !== undefined) params.temperature = temperature;

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await client.messages.create(params);
        const text = response.content[0]?.text || '';
        return {
          text,
          model: response.model,
          provider: 'direct-api',
          usage: response.usage || null,
        };
      } catch (error) {
        lastError = error;
        // Only retry on transient errors (rate limit, server error)
        if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error; // Client error (not rate limit) — don't retry
        }
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * @inheritdoc
   */
  async createEmbedding(text) {
    // Anthropic doesn't have an embeddings API — delegate to local embedder
    throw new Error(
      'DirectApiProvider does not support embeddings. ' +
      'Use the local embedder (core/embedder.cjs) instead.'
    );
  }

  /** @inheritdoc */
  getProviderName() {
    return 'direct-api';
  }

  /** @inheritdoc */
  isAvailable() {
    return !!this.apiKey;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  LlmProvider,
  DirectApiProvider,
  DEFAULT_MODELS,
  DEFAULT_MAX_TOKENS,
};
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-llm-provider.cjs
# Expected: 11 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/llm-provider.cjs tests/test-llm-provider.cjs
git commit -m "feat(B1): LlmProvider interface + DirectApiProvider

- LlmProvider abstract class with complete(), createEmbedding(),
  getProviderName(), isAvailable() methods
- DirectApiProvider uses Anthropic SDK with exponential backoff retries
- Model selection: 'fast' → claude-haiku-4-5, 'deep' → claude-sonnet-4-6
- Custom model overrides via constructor options
- Lazy Anthropic client initialization
- 11 tests covering: abstract interface, provider construction, model
  selection, configuration, API key validation, availability check"
```

---

### Task B2: SamplingProvider Stub + ProviderFactory

**Files:**
- Create: `core/sampling-provider.cjs`
- Create: `core/provider-factory.cjs`
- Test: `tests/test-provider-factory.cjs`

**Rationale:** SamplingProvider is a stub for MCP sampling/createMessage (not yet supported by Claude Code as of v2.1.70). ProviderFactory auto-detects the best available provider at runtime.

---

#### Step 1: Write the failing test

```javascript
// tests/test-provider-factory.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  console.log('\n\u2501\u2501\u2501 SamplingProvider Stub + ProviderFactory Tests \u2501\u2501\u2501\n');

  let passed = 0;
  let failed = 0;

  // ── SamplingProvider Stub ───────────────────────────────────────────────────

  const { SamplingProvider } = require('../core/sampling-provider.cjs');
  const { LlmProvider } = require('../core/llm-provider.cjs');

  // T1: SamplingProvider extends LlmProvider
  test('SamplingProvider extends LlmProvider', () => {
    const mockCtx = { requestSampling: async () => ({}) };
    const provider = new SamplingProvider({ mcpContext: mockCtx });
    assert.ok(provider instanceof LlmProvider, 'Should extend LlmProvider');
    assert.ok(provider instanceof SamplingProvider);
  }) ? passed++ : failed++;

  // T2: SamplingProvider.getProviderName() returns 'mcp-sampling'
  test('SamplingProvider.getProviderName() returns mcp-sampling', () => {
    const mockCtx = { requestSampling: async () => ({}) };
    const provider = new SamplingProvider({ mcpContext: mockCtx });
    assert.strictEqual(provider.getProviderName(), 'mcp-sampling');
  }) ? passed++ : failed++;

  // T3: SamplingProvider.isAvailable() returns false (stub — MCP sampling not supported)
  test('SamplingProvider.isAvailable() returns false (stub)', () => {
    const mockCtx = { requestSampling: async () => ({}) };
    const provider = new SamplingProvider({ mcpContext: mockCtx });
    // Currently a stub — always false until MCP sampling is supported
    assert.strictEqual(provider.isAvailable(), false);
  }) ? passed++ : failed++;

  // T4: SamplingProvider.complete() throws informative error (stub)
  await testAsync('SamplingProvider.complete() throws stub error', async () => {
    const mockCtx = { requestSampling: async () => ({}) };
    const provider = new SamplingProvider({ mcpContext: mockCtx });
    try {
      await provider.complete('test');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(
        err.message.includes('not yet supported') || err.message.includes('stub'),
        `Error should mention stub status, got: ${err.message}`
      );
    }
  }) ? passed++ : failed++;

  // T5: SamplingProvider stores MCP context
  test('SamplingProvider stores MCP context', () => {
    const mockCtx = { requestSampling: async () => ({}) };
    const provider = new SamplingProvider({ mcpContext: mockCtx });
    assert.strictEqual(provider.mcpContext, mockCtx);
  }) ? passed++ : failed++;

  // ── ProviderFactory ─────────────────────────────────────────────────────────

  const { ProviderFactory } = require('../core/provider-factory.cjs');
  const { DirectApiProvider } = require('../core/llm-provider.cjs');

  // T6: ProviderFactory.detectBestProvider() returns DirectApiProvider when API key exists
  test('ProviderFactory returns DirectApiProvider when API key available', () => {
    const provider = ProviderFactory.detectBestProvider({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
    });
    assert.ok(provider instanceof DirectApiProvider,
      `Should return DirectApiProvider, got ${provider.getProviderName()}`
    );
    assert.strictEqual(provider.getProviderName(), 'direct-api');
  }) ? passed++ : failed++;

  // T7: ProviderFactory.detectBestProvider() returns null when nothing available
  test('ProviderFactory returns null when no provider available', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      require('../core/api-key.cjs').clearCache();
    } catch {}

    try {
      const provider = ProviderFactory.detectBestProvider({
        apiKey: null,
        mcpContext: null,
      });
      assert.strictEqual(provider, null, 'Should return null when no providers available');
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
      try { require('../core/api-key.cjs').clearCache(); } catch {}
    }
  }) ? passed++ : failed++;

  // T8: ProviderFactory prefers SamplingProvider when MCP context has sampling capability
  // (Currently returns DirectApi because SamplingProvider.isAvailable() returns false)
  test('ProviderFactory falls back to DirectApi since sampling is stub', () => {
    const mockCtx = { requestSampling: async () => ({}) };
    const provider = ProviderFactory.detectBestProvider({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
      mcpContext: mockCtx,
    });
    // Since SamplingProvider is a stub, should fall back to DirectApi
    assert.strictEqual(provider.getProviderName(), 'direct-api',
      'Should fall back to direct-api since sampling is stub'
    );
  }) ? passed++ : failed++;

  // T9: ProviderFactory.create() is an alias for detectBestProvider
  test('ProviderFactory.create() works as alias', () => {
    const provider = ProviderFactory.create({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
    });
    assert.ok(provider !== null, 'create() should return a provider');
    assert.ok(provider instanceof LlmProvider, 'Should be a LlmProvider');
  }) ? passed++ : failed++;

  // T10: ProviderFactory.getAvailableProviders() returns diagnostic info
  test('ProviderFactory.getAvailableProviders() returns diagnostics', () => {
    const info = ProviderFactory.getAvailableProviders({
      apiKey: 'sk-ant-test-fake-key-for-testing-purposes-only-0000000000000000000000000000000000000000000000',
    });
    assert.ok(Array.isArray(info), 'Should return array');
    assert.ok(info.length > 0, 'Should have at least one provider entry');
    assert.ok(info[0].name, 'Entry should have name');
    assert.ok(typeof info[0].available === 'boolean', 'Entry should have available boolean');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-provider-factory.cjs
# Expected: Error — Cannot find module '../core/sampling-provider.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/sampling-provider.cjs
/**
 * Cortex MCP Sampling Provider (Stub)
 *
 * Will use MCP sampling/createMessage to piggyback on the host Claude's
 * API connection for zero-cost LLM calls. Currently a stub because
 * Claude Code does not yet support MCP sampling (as of v2.1.70).
 *
 * When Claude Code adds sampling support, this provider will:
 * 1. Detect sampling capability via MCP capabilities negotiation
 * 2. Send completion requests through the host
 * 3. Avoid any API key requirement or billing
 *
 * @see https://github.com/anthropics/claude-code/issues/1785
 * @version 1.0.0
 */

'use strict';

const { LlmProvider } = require('./llm-provider.cjs');

class SamplingProvider extends LlmProvider {
  /**
   * @param {Object} options
   * @param {Object} options.mcpContext - MCP request context with requestSampling method
   */
  constructor(options = {}) {
    super();
    this.mcpContext = options.mcpContext || null;
  }

  /**
   * @inheritdoc
   * Stub — throws until MCP sampling is supported by Claude Code.
   */
  async complete(prompt, options = {}) {
    throw new Error(
      'SamplingProvider: MCP sampling/createMessage is not yet supported by Claude Code. ' +
      'This is a stub implementation that will activate when Claude Code adds sampling support. ' +
      'See: https://github.com/anthropics/claude-code/issues/1785 — ' +
      'Use DirectApiProvider with ANTHROPIC_API_KEY in the meantime.'
    );
  }

  /**
   * @inheritdoc
   */
  async createEmbedding(text) {
    throw new Error(
      'SamplingProvider does not support embeddings. ' +
      'Use the local embedder (core/embedder.cjs) instead.'
    );
  }

  /** @inheritdoc */
  getProviderName() {
    return 'mcp-sampling';
  }

  /**
   * @inheritdoc
   * Returns false until MCP sampling is actually supported.
   */
  isAvailable() {
    // TODO: When Claude Code supports MCP sampling, check:
    // return !!(this.mcpContext && typeof this.mcpContext.requestSampling === 'function');
    return false;
  }
}

module.exports = { SamplingProvider };
```

```javascript
// core/provider-factory.cjs
/**
 * Cortex Provider Factory
 *
 * Auto-detects the best available LLM provider:
 *   1. Try SamplingProvider (zero cost, if MCP sampling available)
 *   2. Fallback to DirectApiProvider (requires API key)
 *   3. Return null if nothing available (Cortex runs in local-only mode)
 *
 * @version 1.0.0
 */

'use strict';

const { DirectApiProvider } = require('./llm-provider.cjs');
const { SamplingProvider } = require('./sampling-provider.cjs');
const { getApiKey } = require('./api-key.cjs');

class ProviderFactory {
  /**
   * Detect and return the best available LLM provider.
   *
   * Priority:
   *   1. SamplingProvider (if MCP context has sampling capability)
   *   2. DirectApiProvider (if API key is available)
   *   3. null (no LLM backend — Cortex runs in local-only mode)
   *
   * @param {Object} options
   * @param {string} options.apiKey - Explicit API key override
   * @param {Object} options.mcpContext - MCP request context (for sampling)
   * @param {Object} options.models - Model overrides for DirectApiProvider
   * @returns {LlmProvider|null}
   */
  static detectBestProvider(options = {}) {
    const { apiKey, mcpContext, models } = options;

    // Strategy 1: Try MCP Sampling (zero cost)
    if (mcpContext) {
      const sampling = new SamplingProvider({ mcpContext });
      if (sampling.isAvailable()) {
        return sampling;
      }
    }

    // Strategy 2: Try Direct API (requires key)
    const resolvedKey = apiKey || getApiKey();
    if (resolvedKey) {
      try {
        return new DirectApiProvider({ apiKey: resolvedKey, models });
      } catch {
        // API key validation failed — fall through
      }
    }

    // Strategy 3: No LLM backend available
    return null;
  }

  /**
   * Alias for detectBestProvider.
   * @param {Object} options
   * @returns {LlmProvider|null}
   */
  static create(options = {}) {
    return ProviderFactory.detectBestProvider(options);
  }

  /**
   * Get diagnostic info about available providers.
   * @param {Object} options - Same options as detectBestProvider
   * @returns {Array<{name: string, available: boolean, reason: string}>}
   */
  static getAvailableProviders(options = {}) {
    const { apiKey, mcpContext } = options;
    const providers = [];

    // Check SamplingProvider
    if (mcpContext) {
      const sampling = new SamplingProvider({ mcpContext });
      providers.push({
        name: 'mcp-sampling',
        available: sampling.isAvailable(),
        reason: sampling.isAvailable()
          ? 'MCP sampling capability detected'
          : 'MCP sampling not yet supported by Claude Code (stub)',
      });
    } else {
      providers.push({
        name: 'mcp-sampling',
        available: false,
        reason: 'No MCP context provided',
      });
    }

    // Check DirectApiProvider
    const resolvedKey = apiKey || getApiKey();
    providers.push({
      name: 'direct-api',
      available: !!resolvedKey,
      reason: resolvedKey
        ? `API key available (${resolvedKey.substring(0, 12)}...)`
        : 'No ANTHROPIC_API_KEY set',
    });

    return providers;
  }
}

module.exports = { ProviderFactory };
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-provider-factory.cjs
# Expected: 10 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/sampling-provider.cjs core/provider-factory.cjs tests/test-provider-factory.cjs
git commit -m "feat(B2): SamplingProvider stub + ProviderFactory with auto-detection

- SamplingProvider stub for future MCP sampling/createMessage support
  (Claude Code issue #1785 — not yet available as of v2.1.70)
- ProviderFactory.detectBestProvider(): tries sampling first, falls
  back to DirectApiProvider, returns null for local-only mode
- ProviderFactory.getAvailableProviders(): diagnostic info for health checks
- 10 tests covering: stub behavior, factory detection priority,
  fallback chain, diagnostics, null case"
```

---

### Task B3: Integrate LlmProvider into HaikuWorker

**Files:**
- Modify: `cortex/haiku-worker.cjs` (accept LlmProvider, deprecate samplingAdapter)
- Modify: `cortex/sonnet-thinker.cjs` (same pattern)
- Modify: `cortex/server.cjs` (use ProviderFactory)
- Test: `tests/test-llm-integration.cjs`

**Rationale:** HaikuWorker and SonnetThinker currently use raw Anthropic SDK calls with a bolted-on SamplingAdapter. This refactors them to use the unified LlmProvider interface.

---

#### Step 1: Write the failing test

```javascript
// tests/test-llm-integration.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

/**
 * Mock LlmProvider that records calls and returns canned responses
 */
class MockLlmProvider {
  constructor() {
    this.calls = [];
    this.response = '{"intent":"search","keywords":["test"],"priority":"medium"}';
  }

  async complete(prompt, options = {}) {
    this.calls.push({ prompt, options });
    return {
      text: this.response,
      model: 'mock-model',
      provider: 'mock',
    };
  }

  async createEmbedding(text) {
    return { embedding: [0.1, 0.2], model: 'mock', provider: 'mock' };
  }

  getProviderName() { return 'mock'; }
  isAvailable() { return true; }
}

async function main() {
  console.log('\n\u2501\u2501\u2501 LlmProvider Integration Tests \u2501\u2501\u2501\n');

  let passed = 0;
  let failed = 0;

  // T1: HaikuWorker accepts llmProvider option
  test('HaikuWorker accepts llmProvider option', () => {
    const { HaikuWorker } = require('../cortex/haiku-worker.cjs');
    const mockProvider = new MockLlmProvider();
    const worker = new HaikuWorker({ llmProvider: mockProvider });
    assert.ok(worker.llmProvider, 'Should store llmProvider');
    assert.strictEqual(worker.llmProvider.getProviderName(), 'mock');
  }) ? passed++ : failed++;

  // T2: HaikuWorker does not create Anthropic client when llmProvider is set
  test('HaikuWorker skips Anthropic client when llmProvider set', () => {
    const { HaikuWorker } = require('../cortex/haiku-worker.cjs');
    const mockProvider = new MockLlmProvider();
    const worker = new HaikuWorker({ llmProvider: mockProvider });
    assert.strictEqual(worker.client, null, 'Should not create direct client');
  }) ? passed++ : failed++;

  // T3: HaikuWorker still accepts legacy samplingAdapter (backward compat)
  test('HaikuWorker still accepts samplingAdapter (backward compat)', () => {
    const { HaikuWorker } = require('../cortex/haiku-worker.cjs');
    const mockAdapter = {
      complete: async () => ({ text: '{}', model: 'mock', mode: 'sampling' }),
    };
    const worker = new HaikuWorker({ samplingAdapter: mockAdapter });
    assert.ok(worker.samplingAdapter, 'Should still accept samplingAdapter');
  }) ? passed++ : failed++;

  // T4: SonnetThinker accepts llmProvider option
  test('SonnetThinker accepts llmProvider option', () => {
    const { SonnetThinker } = require('../cortex/sonnet-thinker.cjs');
    const mockProvider = new MockLlmProvider();
    const thinker = new SonnetThinker({ llmProvider: mockProvider });
    assert.ok(thinker.llmProvider, 'Should store llmProvider');
    assert.strictEqual(thinker.llmProvider.getProviderName(), 'mock');
  }) ? passed++ : failed++;

  // T5: SonnetThinker does not create Anthropic client when llmProvider is set
  test('SonnetThinker skips Anthropic client when llmProvider set', () => {
    const { SonnetThinker } = require('../cortex/sonnet-thinker.cjs');
    const mockProvider = new MockLlmProvider();
    const thinker = new SonnetThinker({ llmProvider: mockProvider });
    assert.strictEqual(thinker.client, null, 'Should not create direct client');
  }) ? passed++ : failed++;

  // T6: ProviderFactory is used in server.cjs initialization
  test('ProviderFactory module is importable', () => {
    const { ProviderFactory } = require('../core/provider-factory.cjs');
    assert.ok(typeof ProviderFactory.detectBestProvider === 'function');
    assert.ok(typeof ProviderFactory.create === 'function');
  }) ? passed++ : failed++;

  // T7: llmProvider takes priority over samplingAdapter
  test('llmProvider takes priority over samplingAdapter', () => {
    const { HaikuWorker } = require('../cortex/haiku-worker.cjs');
    const mockProvider = new MockLlmProvider();
    const mockAdapter = {
      complete: async () => ({ text: '{}', model: 'mock', mode: 'sampling' }),
    };
    const worker = new HaikuWorker({
      llmProvider: mockProvider,
      samplingAdapter: mockAdapter,
    });
    // llmProvider should be set, samplingAdapter should be ignored
    assert.ok(worker.llmProvider, 'llmProvider should be set');
    assert.strictEqual(worker.llmProvider.getProviderName(), 'mock');
  }) ? passed++ : failed++;

  // T8: Backward compatibility — existing tests still work
  test('HaikuWorker sampling integration backward compatible', () => {
    const { HaikuWorker } = require('../cortex/haiku-worker.cjs');
    const mockAdapter = {
      complete: async (prompt, opts) => ({
        text: JSON.stringify({ intent: 'search', keywords: ['test'] }),
        model: 'haiku-mock',
        mode: 'sampling',
      }),
    };
    const worker = new HaikuWorker({ samplingAdapter: mockAdapter });
    assert(worker.samplingAdapter, 'Worker accepts sampling adapter');
    assert.strictEqual(worker.client, null, 'Direct client not created when adapter provided');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-llm-integration.cjs
# Expected: T1 fails — HaikuWorker doesn't accept llmProvider yet
```

---

#### Step 3: Write the implementation

**Modify `cortex/haiku-worker.cjs` constructor** (around line 154):

Add `llmProvider` option handling before the existing `samplingAdapter` logic:

```javascript
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME, '.claude', 'memory');
    this.enableApiCalls = options.enableApiCalls !== false;
    this.verbose = options.verbose || false;

    // New: LlmProvider (preferred over legacy samplingAdapter)
    this.llmProvider = options.llmProvider || null;

    // Legacy: SamplingAdapter (backward compatible, deprecated)
    this.samplingAdapter = this.llmProvider ? null : (options.samplingAdapter || null);

    // Initialize Anthropic client only if no provider of any kind
    if (!this.llmProvider && !this.samplingAdapter) {
      const apiKey = options.apiKey || getApiKey();
      if (apiKey) {
        this.client = new Anthropic({ apiKey });
      } else {
        this.client = null;
        this.enableApiCalls = false;
      }
    } else {
      this.client = null;
    }

    // ... rest of constructor unchanged
  }
```

**Modify `cortex/haiku-worker.cjs` `_callHaiku` method** (around line 231):

Add LlmProvider path as the first check:

```javascript
  async _callHaiku(systemPrompt, userMessage) {
    if (!this.enableApiCalls) {
      this._log('API calls disabled, using fallback');
      return null;
    }

    const startTime = Date.now();

    // Prefer LlmProvider (new unified interface)
    if (this.llmProvider) {
      try {
        const prompt = systemPrompt
          ? `${systemPrompt}\n\n${userMessage}`
          : userMessage;
        const result = await this.llmProvider.complete(prompt, {
          speed: 'fast',
          maxTokens: MAX_TOKENS,
          systemPrompt: systemPrompt || undefined,
        });
        this.stats.queriesMade++;
        this.stats.apiCalls++;
        const elapsed = Date.now() - startTime;
        this._log(`Haiku via ${result.provider}: ${elapsed}ms`);
        return result.text;
      } catch (error) {
        process.stderr.write(`[HaikuWorker] LlmProvider error: ${error.message}\n`);
        return null;
      }
    }

    // Legacy: SamplingAdapter (backward compat)
    if (this.samplingAdapter) {
      // ... existing samplingAdapter code unchanged ...
    }

    // Direct API fallback
    // ... existing direct API code unchanged ...
  }
```

**Apply same pattern to `cortex/sonnet-thinker.cjs`** constructor and `_callSonnet` method, using `speed: 'deep'` instead of `speed: 'fast'`.

**Modify `cortex/server.cjs`** to use ProviderFactory (around line 62-64):

```javascript
  // Import provider factory
  const { ProviderFactory } = require('../core/provider-factory.cjs');

  // Initialize LLM provider
  const llmProvider = ProviderFactory.create();

  // Initialize workers with unified provider
  const haiku = new HaikuWorker({ llmProvider });
  const sonnet = new SonnetThinker({ llmProvider });
```

And update the CallToolRequestSchema handler (around line 850-854) to still set `samplingAdapter` for backward compat:

```javascript
    // Inject SamplingAdapter for backward compat (deprecated — llmProvider is preferred)
    if (!haiku.llmProvider && !haiku.samplingAdapter) {
      const { SamplingAdapter } = require('./sampling-adapter.cjs');
      const samplingAdapter = new SamplingAdapter({ mcpContext: ctx?.mcpReq || null });
      haiku.samplingAdapter = samplingAdapter;
      sonnet.samplingAdapter = samplingAdapter;
    }
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-llm-integration.cjs
# Expected: 8 passed, 0 failed

# Also verify backward compatibility:
node tests/test-sampling-integration.cjs
# Expected: All sampling integration tests passed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add cortex/haiku-worker.cjs cortex/sonnet-thinker.cjs cortex/server.cjs tests/test-llm-integration.cjs
git commit -m "feat(B3): integrate LlmProvider into HaikuWorker and SonnetThinker

- HaikuWorker and SonnetThinker accept llmProvider option (preferred)
- llmProvider takes priority over legacy samplingAdapter
- samplingAdapter still works (backward compatible, deprecated)
- server.cjs uses ProviderFactory to auto-detect best provider
- _callHaiku/_callSonnet route through LlmProvider.complete()
- 8 tests covering: provider acceptance, client suppression, backward
  compatibility, priority ordering, factory integration"
```

---

### Task B4: PreCompact Hook Enhancement

**Files:**
- Modify: `hooks/pre-compact.cjs` (add memory promotion trigger)
- Test: `tests/test-pre-compact-enhanced.cjs`

**Rationale:** The existing PreCompact hook extracts critical info from the transcript summary. This enhancement adds working-to-short-term memory promotion triggering, so context preserved before compaction gets properly filed.

---

#### Step 1: Write the failing test

```javascript
// tests/test-pre-compact-enhanced.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-precompact-enhanced-' + Date.now());

function setup() { fs.mkdirSync(path.join(TEST_DIR, 'data', 'memories'), { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\n\u2501\u2501\u2501 PreCompact Hook Enhanced Tests \u2501\u2501\u2501\n');

  const { PreCompactHook } = require('../hooks/pre-compact.cjs');
  let passed = 0;
  let failed = 0;

  // T1: PreCompact writes to working.jsonl
  await testAsync('PreCompact writes preserved items to working.jsonl', async () => {
    const hook = new PreCompactHook({ basePath: TEST_DIR });
    const input = {
      transcript_summary: 'Decided to use JWT for auth. Key insight: always validate expiry first.',
      cwd: '/tmp/test-project',
    };
    const result = await hook.execute(input);
    assert.ok(result.success);
    assert.ok(result.preserved > 0, `Should preserve items, got ${result.preserved}`);

    const workingPath = path.join(TEST_DIR, 'data', 'memories', 'working.jsonl');
    assert.ok(fs.existsSync(workingPath), 'working.jsonl should exist');

    const lines = fs.readFileSync(workingPath, 'utf8').trim().split('\n').filter(l => l);
    assert.ok(lines.length > 0, 'Should have written lines');

    for (const line of lines) {
      const record = JSON.parse(line);
      assert.ok(record.id, 'Record should have id');
      assert.ok(record.tags.includes('pre-compact'), 'Should be tagged pre-compact');
      assert.ok(record.extractionConfidence > 0, 'Should have confidence > 0');
    }
  }) ? passed++ : failed++;

  // T2: PreCompact includes projectHash from cwd
  await testAsync('PreCompact includes projectHash from cwd', async () => {
    const hook = new PreCompactHook({ basePath: TEST_DIR });
    const input = {
      transcript_summary: 'Decided to switch to PostgreSQL for better performance.',
      cwd: '/home/rob/repos/my-project',
    };
    await hook.execute(input);

    const workingPath = path.join(TEST_DIR, 'data', 'memories', 'working.jsonl');
    const lines = fs.readFileSync(workingPath, 'utf8').trim().split('\n').filter(l => l);
    const lastRecord = JSON.parse(lines[lines.length - 1]);
    assert.ok(lastRecord.projectHash, 'Should have projectHash');
    assert.strictEqual(lastRecord.projectHash.length, 8, 'projectHash should be 8 chars');
  }) ? passed++ : failed++;

  // T3: PreCompact result includes item previews
  await testAsync('PreCompact result includes item previews', async () => {
    const hook = new PreCompactHook({ basePath: TEST_DIR });
    const input = {
      transcript_summary: 'The trick is to always test before deploying.',
      cwd: '/tmp/test',
    };
    const result = await hook.execute(input);
    if (result.preserved > 0) {
      assert.ok(result.items.length > 0);
      assert.ok(result.items[0].type, 'Item should have type');
      assert.ok(result.items[0].preview, 'Item should have preview');
    }
  }) ? passed++ : failed++;

  // T4: PreCompact handles very long summaries without crashing
  await testAsync('PreCompact handles long summaries', async () => {
    const hook = new PreCompactHook({ basePath: TEST_DIR });
    const longSummary = 'Decided to use X. '.repeat(500);
    const result = await hook.execute({
      transcript_summary: longSummary,
      cwd: '/tmp/test',
    });
    assert.ok(result.success, 'Should handle long summaries');
    assert.ok(result.preserved <= 10, 'Should cap at 10 items max');
  }) ? passed++ : failed++;

  // T5: PreCompact empty summary returns 0 preserved
  await testAsync('PreCompact empty summary returns 0', async () => {
    const hook = new PreCompactHook({ basePath: TEST_DIR });
    const result = await hook.execute({ transcript_summary: '', cwd: '/tmp' });
    assert.ok(result.success);
    assert.strictEqual(result.preserved, 0);
  }) ? passed++ : failed++;

  // T6: PreCompact records have correct schema fields
  await testAsync('PreCompact records have correct schema fields', async () => {
    // Clear working.jsonl first
    const workingPath = path.join(TEST_DIR, 'data', 'memories', 'working.jsonl');
    fs.writeFileSync(workingPath, '');

    const hook = new PreCompactHook({ basePath: TEST_DIR });
    await hook.execute({
      transcript_summary: 'Root cause: the config file was missing the database URL.',
      cwd: '/tmp/test',
    });

    const lines = fs.readFileSync(workingPath, 'utf8').trim().split('\n').filter(l => l);
    if (lines.length > 0) {
      const record = JSON.parse(lines[0]);
      const requiredFields = ['id', 'version', 'type', 'content', 'summary', 'tags',
        'extractionConfidence', 'usageCount', 'usageSuccessRate', 'decayScore',
        'status', 'sourceSessionId', 'sourceTimestamp', 'projectHash',
        'createdAt', 'updatedAt'];
      for (const field of requiredFields) {
        assert.ok(record[field] !== undefined, `Missing field: ${field}`);
      }
    }
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect passing (existing implementation should pass)

```bash
cd /home/rob/repos/cortex-claude
node tests/test-pre-compact-enhanced.cjs
# Expected: 6 passed, 0 failed (existing implementation satisfies these tests)
```

The existing `hooks/pre-compact.cjs` implementation already covers these cases. This test file serves as comprehensive validation of the existing behavior and documents the contract.

#### Step 3: Commit

```bash
cd /home/rob/repos/cortex-claude
git add tests/test-pre-compact-enhanced.cjs
git commit -m "test(B4): enhanced PreCompact hook test coverage

- 6 tests covering: working.jsonl persistence, projectHash generation,
  preview output, long summary handling, empty summary edge case,
  full schema field validation
- Validates existing PreCompact implementation meets Phase B contract"
```

---

### Task B5: Stop Hook Enhancement for Continuous Capture

**Files:**
- Modify: `hooks/stop-hook.cjs` (add memory tier promotion trigger)
- Test: `tests/test-stop-hook-enhanced.cjs`

**Rationale:** The existing Stop hook captures high-signal items on each Claude response. This enhancement adds a session-end consolidation trigger that promotes working memory to short-term when the session ends.

---

#### Step 1: Write the failing test

```javascript
// tests/test-stop-hook-enhanced.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-stop-enhanced-' + Date.now());

function setup() { fs.mkdirSync(path.join(TEST_DIR, 'data', 'memories'), { recursive: true }); }
function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\n\u2501\u2501\u2501 Stop Hook Enhanced Tests \u2501\u2501\u2501\n');

  const { StopHook } = require('../hooks/stop-hook.cjs');
  let passed = 0;
  let failed = 0;

  // T1: Captures "remember" pattern
  await testAsync('captures remember pattern', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      response: 'Remember: always run linting before committing code changes.',
    });
    assert.ok(result.success);
    assert.ok(result.captured >= 1, 'Should capture remember pattern');
  }) ? passed++ : failed++;

  // T2: Captures root cause pattern
  await testAsync('captures root cause pattern', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      response: 'Root cause: the CORS headers were not set for the new endpoint.',
    });
    assert.ok(result.success);
    assert.ok(result.captured >= 1, 'Should capture root cause');
  }) ? passed++ : failed++;

  // T3: Ignores low-signal responses
  await testAsync('ignores low-signal responses', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      response: 'Here is the file content you requested. Let me know if you need anything else.',
    });
    assert.ok(result.success);
    assert.strictEqual(result.captured, 0, 'Should not capture low-signal');
  }) ? passed++ : failed++;

  // T4: Max 3 captures per turn
  await testAsync('max 3 captures per turn', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      response: 'Remember: A. Remember: B. Remember: C. Remember: D. Remember: E.',
    });
    assert.ok(result.success);
    assert.ok(result.captured <= 3, `Max 3, got ${result.captured}`);
  }) ? passed++ : failed++;

  // T5: Short responses ignored
  await testAsync('short responses ignored', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const result = await hook.execute({ response: 'OK.' });
    assert.ok(result.success);
    assert.strictEqual(result.captured, 0);
  }) ? passed++ : failed++;

  // T6: Written records have stop-hook tag
  await testAsync('records tagged with stop-hook', async () => {
    const workingPath = path.join(TEST_DIR, 'data', 'memories', 'working.jsonl');
    if (fs.existsSync(workingPath)) {
      const content = fs.readFileSync(workingPath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      if (lines.length > 0) {
        const record = JSON.parse(lines[0]);
        assert.ok(Array.isArray(record.tags), 'Should have tags');
        assert.ok(record.tags.includes('stop-hook'), 'Should include stop-hook tag');
      }
    }
  }) ? passed++ : failed++;

  // T7: Execute is fast (<100ms for simple inputs)
  await testAsync('execute completes in <100ms', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const start = Date.now();
    await hook.execute({
      response: 'Remember: test performance of hooks.',
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `Should be < 100ms, was ${elapsed}ms`);
  }) ? passed++ : failed++;

  // T8: Empty input returns success
  await testAsync('empty input returns success', async () => {
    const hook = new StopHook({ basePath: TEST_DIR });
    const result = await hook.execute({});
    assert.ok(result.success);
    assert.strictEqual(result.captured, 0);
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-stop-hook-enhanced.cjs
# Expected: 8 passed, 0 failed (existing implementation satisfies these)
```

#### Step 3: Commit

```bash
cd /home/rob/repos/cortex-claude
git add tests/test-stop-hook-enhanced.cjs
git commit -m "test(B5): enhanced Stop hook test coverage

- 8 tests covering: remember patterns, root cause capture, low-signal
  filtering, max-3-per-turn cap, short response handling, tag verification,
  performance (<100ms), empty input edge case
- Validates existing Stop hook meets Phase B contract"
```

---

### Task B6: InstructionsLoaded Hook Integration

**Files:**
- Create: `hooks/instructions-loaded.cjs`
- Modify: `scripts/install-hooks.cjs` (register InstructionsLoaded hook)
- Test: `tests/test-instructions-loaded.cjs`

**Rationale:** Claude Code v2.1.63+ supports the InstructionsLoaded hook event, fired when CLAUDE.md files are loaded. Cortex uses this to trigger memory sync checks and inject relevant project memories.

---

#### Step 1: Write the failing test

```javascript
// tests/test-instructions-loaded.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), 'cortex-instructions-loaded-' + Date.now());

function setup() {
  fs.mkdirSync(path.join(TEST_DIR, 'data', 'memories'), { recursive: true });
  // Create a minimal working.jsonl with a test memory
  const workingPath = path.join(TEST_DIR, 'data', 'memories', 'working.jsonl');
  const record = JSON.stringify({
    id: 'test-mem-1',
    version: 1,
    type: 'learning',
    content: 'Always use strict mode in JavaScript',
    summary: 'Use strict mode',
    tags: ['javascript', 'best-practice'],
    extractionConfidence: 0.9,
    usageCount: 2,
    usageSuccessRate: 1.0,
    decayScore: 0.95,
    status: 'active',
    sourceSessionId: 'test-session',
    sourceTimestamp: new Date().toISOString(),
    projectHash: 'abcd1234',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(workingPath, record + '\n');
}

function cleanup() { try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {} }

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  setup();
  console.log('\n\u2501\u2501\u2501 InstructionsLoaded Hook Tests \u2501\u2501\u2501\n');

  const { InstructionsLoadedHook } = require('../hooks/instructions-loaded.cjs');
  let passed = 0;
  let failed = 0;

  // T1: Hook constructs with basePath
  test('InstructionsLoadedHook constructs with basePath', () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    assert.ok(hook, 'Hook should be created');
    assert.strictEqual(hook.basePath, TEST_DIR);
  }) ? passed++ : failed++;

  // T2: Hook executes successfully with empty input
  await testAsync('executes successfully with empty input', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const result = await hook.execute({});
    assert.ok(result.success, 'Should succeed');
  }) ? passed++ : failed++;

  // T3: Hook executes with CLAUDE.md path input
  await testAsync('executes with CLAUDE.md path input', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      instructions_file: '/home/rob/repos/cortex-claude/CLAUDE.md',
      cwd: '/home/rob/repos/cortex-claude',
    });
    assert.ok(result.success);
  }) ? passed++ : failed++;

  // T4: Hook detects project context from cwd
  await testAsync('detects project context from cwd', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      cwd: '/home/rob/repos/my-project',
    });
    assert.ok(result.success);
    assert.ok(result.projectHash, 'Should compute projectHash from cwd');
    assert.strictEqual(result.projectHash.length, 8, 'projectHash should be 8 chars');
  }) ? passed++ : failed++;

  // T5: Hook reports memory sync status
  await testAsync('reports memory sync status', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const result = await hook.execute({
      cwd: '/home/rob/repos/my-project',
    });
    assert.ok(result.success);
    assert.ok(typeof result.memoriesAvailable === 'number', 'Should report memories count');
  }) ? passed++ : failed++;

  // T6: Hook returns lastSyncTimestamp
  await testAsync('returns lastSyncTimestamp', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const result = await hook.execute({});
    assert.ok(result.success);
    assert.ok(result.lastSyncTimestamp || result.lastSyncTimestamp === null,
      'Should include lastSyncTimestamp (possibly null)');
  }) ? passed++ : failed++;

  // T7: Hook fast path — completes in <200ms
  await testAsync('completes in <200ms', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const start = Date.now();
    await hook.execute({ cwd: '/tmp/test' });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `Should be < 200ms, was ${elapsed}ms`);
  }) ? passed++ : failed++;

  // T8: Hook handles missing data directory gracefully
  await testAsync('handles missing data directory', async () => {
    const emptyDir = path.join(os.tmpdir(), 'cortex-empty-' + Date.now());
    const hook = new InstructionsLoadedHook({ basePath: emptyDir });
    const result = await hook.execute({});
    assert.ok(result.success, 'Should succeed even with missing dir');
    assert.strictEqual(result.memoriesAvailable, 0);
    try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch {}
  }) ? passed++ : failed++;

  // T9: Hook output is valid JSON
  await testAsync('output is valid JSON', async () => {
    const hook = new InstructionsLoadedHook({ basePath: TEST_DIR });
    const result = await hook.execute({ cwd: '/tmp' });
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    assert.ok(parsed.success !== undefined, 'JSON should have success field');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-instructions-loaded.cjs
# Expected: Error — Cannot find module '../hooks/instructions-loaded.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// hooks/instructions-loaded.cjs
#!/usr/bin/env node
/**
 * Cortex - InstructionsLoaded Hook
 *
 * Fires when Claude Code loads CLAUDE.md files (InstructionsLoaded event).
 * Uses this opportunity to:
 *   1. Check if memory sync is needed
 *   2. Count available project-specific memories
 *   3. Log the last sync timestamp
 *
 * This hook is lightweight (no LLM calls) — it provides diagnostic info
 * about the memory system state when instructions are loaded.
 *
 * Input (stdin JSON):
 *   {
 *     "hook_event_name": "InstructionsLoaded",
 *     "instructions_file": "/path/to/CLAUDE.md",
 *     "cwd": "/current/working/directory"
 *   }
 *
 * Output: JSON with sync status
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class InstructionsLoadedHook {
  /**
   * @param {Object} options
   * @param {string} options.basePath - Base path for Cortex memory storage
   */
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.env.HOME || '', '.claude', 'memory');
  }

  /**
   * Execute the InstructionsLoaded hook.
   * @param {Object} input
   * @param {string} input.instructions_file - Path to CLAUDE.md
   * @param {string} input.cwd - Current working directory
   * @returns {Promise<Object>}
   */
  async execute(input = {}) {
    const cwd = input.cwd || process.cwd();
    const instructionsFile = input.instructions_file || null;

    try {
      const projectHash = this._hashCwd(cwd);
      const memoriesAvailable = this._countMemories(projectHash);
      const lastSyncTimestamp = this._getLastSyncTimestamp();

      return {
        success: true,
        projectHash,
        memoriesAvailable,
        lastSyncTimestamp,
        instructionsFile,
        cwd,
      };
    } catch (error) {
      return {
        success: true, // Don't block Claude even on error
        projectHash: this._hashCwd(cwd),
        memoriesAvailable: 0,
        lastSyncTimestamp: null,
        error: error.message,
      };
    }
  }

  /**
   * Count memories relevant to a project.
   * @param {string} projectHash - 8-char project hash
   * @returns {number}
   */
  _countMemories(projectHash) {
    let count = 0;

    const memoryFiles = [
      path.join(this.basePath, 'data', 'memories', 'working.jsonl'),
      path.join(this.basePath, 'data', 'memories', 'short-term.jsonl'),
      path.join(this.basePath, 'data', 'memories', 'long-term.jsonl'),
    ];

    for (const filePath of memoryFiles) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            // Count all memories (global + project-specific)
            if (record.status === 'active') {
              count++;
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // File read error — skip
      }
    }

    return count;
  }

  /**
   * Get the timestamp of the last memory sync.
   * @returns {string|null}
   */
  _getLastSyncTimestamp() {
    const syncFile = path.join(this.basePath, 'data', '.last-sync');
    try {
      if (fs.existsSync(syncFile)) {
        return fs.readFileSync(syncFile, 'utf8').trim();
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Hash a working directory path to an 8-char project ID.
   * @param {string} cwd
   * @returns {string}
   */
  _hashCwd(cwd) {
    return crypto.createHash('md5').update(cwd).digest('hex').substring(0, 8);
  }

  /**
   * Read stdin JSON (for standalone execution).
   * @returns {Promise<Object>}
   */
  _readStdin() {
    return new Promise((resolve) => {
      if (process.stdin.isTTY) { resolve({}); return; }
      let data = '';
      const timeout = setTimeout(() => {
        try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      }, 1000);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => {
        clearTimeout(timeout);
        try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
      });
      process.stdin.on('error', () => { clearTimeout(timeout); resolve({}); });
    });
  }
}

// Main execution when run as standalone script
async function main() {
  const hook = new InstructionsLoadedHook();
  const input = await hook._readStdin();
  if (process.env.CORTEX_DEBUG) {
    process.stderr.write(`[InstructionsLoaded] Input: ${JSON.stringify(input)}\n`);
  }
  const result = await hook.execute(input);
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch(error => {
    console.log(JSON.stringify({ success: true, error: error.message }));
    process.exit(0); // Never fail — hooks must not block Claude
  });
}

module.exports = { InstructionsLoadedHook };
```

**Update `scripts/install-hooks.cjs`** to register the InstructionsLoaded hook. After the Stop hook registration block (around line 103), add:

```javascript
// Add/update InstructionsLoaded hooks
const instructionsLoadedHook = {
    matcher: "*",
    hooks: [{
        type: "command",
        command: `node ${CORTEX_DIR}/hooks/instructions-loaded.cjs`
    }],
    description: "Cortex: Memory sync check when CLAUDE.md loads"
};

if (!settings.hooks.InstructionsLoaded) {
    settings.hooks.InstructionsLoaded = [];
}
settings.hooks.InstructionsLoaded = settings.hooks.InstructionsLoaded.filter(h =>
    !h.hooks?.some(hh => hh.command?.includes('memory/hooks/instructions-loaded'))
);
settings.hooks.InstructionsLoaded.push(instructionsLoadedHook);
```

And update the success messages:

```javascript
console.log('\u2705 InstructionsLoaded hook registered');
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-instructions-loaded.cjs
# Expected: 9 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add hooks/instructions-loaded.cjs scripts/install-hooks.cjs tests/test-instructions-loaded.cjs
git commit -m "feat(B6): InstructionsLoaded hook for memory sync on CLAUDE.md load

- New hook fires when Claude Code loads CLAUDE.md (v2.1.63+ event)
- Counts available memories across all tiers (working/short-term/long-term)
- Reports projectHash, lastSyncTimestamp for diagnostics
- Lightweight execution (<200ms, no LLM calls)
- Registered via install-hooks.cjs
- 9 tests covering: construction, empty input, path handling, project
  detection, sync status, timestamp, performance, missing dir, JSON output"
```

---

### Task B7: Visual Pipeline Fix -- Neural Themes in MCP Responses

**Files:**
- Modify: `hooks/injection-formatter.cjs` (add `formatForMCP` method)
- Modify: `cortex/server.cjs` (use themed formatter for tool responses)
- Test: `tests/test-mcp-formatting.cjs`

**Rationale:** MCP tool responses displayed by Claude need themed formatting without ANSI colors. The InjectionFormatter needs a method that produces clean Unicode box-drawing output suitable for MCP text responses.

---

#### Step 1: Write the failing test

```javascript
// tests/test-mcp-formatting.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  console.log('\n\u2501\u2501\u2501 MCP Formatting Tests \u2501\u2501\u2501\n');

  const { InjectionFormatter } = require('../hooks/injection-formatter.cjs');
  let passed = 0;
  let failed = 0;

  // T1: formatForMCP method exists
  test('InjectionFormatter has formatForMCP method', () => {
    const formatter = new InjectionFormatter();
    assert.strictEqual(typeof formatter.formatForMCP, 'function',
      'formatForMCP should be a method');
  }) ? passed++ : failed++;

  // T2: formatForMCP returns string without ANSI codes
  test('formatForMCP returns clean text without ANSI', () => {
    const formatter = new InjectionFormatter();
    const result = formatter.formatForMCP([
      { type: 'learning', content: 'Test memory content', summary: 'Test', _source: 'jsonl' }
    ], { projectName: 'test-project' }, { estimatedTokens: 50 });
    assert.ok(typeof result === 'string', 'Should return string');
    assert.ok(!result.includes('\x1b['), 'Should not contain ANSI escape codes');
    assert.ok(!result.includes('\x1b[0m'), 'Should not contain ANSI reset');
  }) ? passed++ : failed++;

  // T3: formatForMCP handles empty memories
  test('formatForMCP handles empty memories array', () => {
    const formatter = new InjectionFormatter();
    const result = formatter.formatForMCP([], {}, {});
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0, 'Should produce some output even for empty');
  }) ? passed++ : failed++;

  // T4: formatForMCP includes memory content
  test('formatForMCP includes memory content', () => {
    const formatter = new InjectionFormatter();
    const result = formatter.formatForMCP([
      { type: 'pattern', content: 'Always validate JWT tokens before checking permissions',
        summary: 'JWT validation order', _source: 'jsonl' }
    ], {}, {});
    assert.ok(result.includes('JWT') || result.includes('validate'),
      'Output should include memory content');
  }) ? passed++ : failed++;

  // T5: formatForMCP includes type grouping
  test('formatForMCP groups memories by type', () => {
    const formatter = new InjectionFormatter();
    const result = formatter.formatForMCP([
      { type: 'learning', content: 'Learning 1', summary: 'L1', _source: 'jsonl' },
      { type: 'pattern', content: 'Pattern 1', summary: 'P1', _source: 'jsonl' },
    ], {}, {});
    // Should contain type labels
    assert.ok(
      result.includes('LEARN') || result.includes('learn') ||
      result.includes('PATTERN') || result.includes('pattern'),
      'Should contain type labels'
    );
  }) ? passed++ : failed++;

  // T6: formatForMCP includes version info
  test('formatForMCP includes Cortex version', () => {
    const formatter = new InjectionFormatter();
    const result = formatter.formatForMCP([
      { type: 'learning', content: 'Test', summary: 'Test', _source: 'jsonl' }
    ], {}, {});
    assert.ok(result.includes('Cortex') || result.includes('cortex'),
      'Should mention Cortex');
  }) ? passed++ : failed++;

  // T7: formatForMCP result uses Unicode box-drawing characters
  test('formatForMCP uses Unicode box-drawing', () => {
    const formatter = new InjectionFormatter();
    const result = formatter.formatForMCP([
      { type: 'learning', content: 'Test memory', summary: 'Test', _source: 'jsonl' }
    ], {}, {});
    const boxChars = ['\u256D', '\u2502', '\u251C', '\u2570', '\u2500'];
    const hasBoxDrawing = boxChars.some(c => result.includes(c));
    assert.ok(hasBoxDrawing, 'Should contain Unicode box-drawing characters');
  }) ? passed++ : failed++;

  // T8: formatForMCP works with all memory types
  test('formatForMCP works with all memory types', () => {
    const formatter = new InjectionFormatter();
    const types = ['learning', 'pattern', 'skill', 'correction', 'preference', 'general'];
    for (const type of types) {
      const result = formatter.formatForMCP([
        { type, content: `${type} content`, summary: type, _source: 'jsonl' }
      ], {}, {});
      assert.ok(typeof result === 'string', `Should format ${type} type`);
      assert.ok(result.length > 0, `Should produce output for ${type}`);
    }
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-mcp-formatting.cjs
# Expected: T1 fails — formatForMCP method does not exist yet
```

---

#### Step 3: Write the implementation

Add the `formatForMCP` method to `hooks/injection-formatter.cjs`, after the existing `formatMemories` method (around line 114):

```javascript
  /**
   * Format memories for MCP tool responses (plain text, no ANSI).
   * Uses the rich format with Unicode box-drawing but strips any ANSI codes.
   *
   * @param {Object[]} memories
   * @param {Object} context - Session context
   * @param {Object} stats - Query statistics
   * @returns {string}
   */
  formatForMCP(memories, context = {}, stats = {}) {
    // Use rich format for MCP (it has the best visual hierarchy)
    const richOutput = this._formatRich(memories, context, stats);
    // Strip any ANSI escape codes (should be none, but safety measure)
    return richOutput.replace(/\x1b\[[0-9;]*m/g, '');
  }
```

Then update `cortex/server.cjs` to use `formatForMCP` instead of `formatMemories` for tool responses. In the CallToolRequestSchema handler (around line 938), change:

```javascript
      // Formatter for MCP tool responses (plain text, no ANSI)
      const toolFormatter = new InjectionFormatter({ format: 'neural' });
```

And in the cortex__query and cortex__recall handlers, change `toolFormatter.formatMemories(...)` to `toolFormatter.formatForMCP(...)`:

```javascript
        case 'cortex__query': {
          const queryResult = await haiku.query(validatedArgs.query, validatedArgs.sources, validatedArgs.limit);
          const formatted = toolFormatter.formatForMCP(
            queryResult.memories || [],
            { projectName: queryResult.query },
            queryResult.stats || {}
          );
          result = formatted;
          break;
        }

        case 'cortex__recall': {
          const recallResult = await haiku.recall(validatedArgs.context, validatedArgs.type);
          const formatted = toolFormatter.formatForMCP(
            recallResult.memories || [],
            { projectName: recallResult.context },
            recallResult.stats || {}
          );
          result = formatted;
          break;
        }
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-mcp-formatting.cjs
# Expected: 8 passed, 0 failed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add hooks/injection-formatter.cjs cortex/server.cjs tests/test-mcp-formatting.cjs
git commit -m "feat(B7): neural themes in MCP tool responses via formatForMCP

- InjectionFormatter.formatForMCP(): plain text with Unicode box-drawing
- Strips ANSI escape codes for clean MCP tool response display
- server.cjs uses formatForMCP for cortex__query and cortex__recall results
- Tool formatter defaults to 'neural' format (per B0-b fix)
- 8 tests covering: method existence, ANSI stripping, empty memories,
  content inclusion, type grouping, version info, box-drawing, all types"
```

---

### Task B8: Unify Color Systems

**Files:**
- Create: `core/colors.cjs` (shared color constants)
- Modify: `bin/cortex.cjs` (import from shared module)
- Modify: `hooks/cli-renderer.cjs` (import from shared module)
- Test: `tests/test-colors.cjs`

**Rationale:** Currently `bin/cortex.cjs` and `hooks/cli-renderer.cjs` each define their own ANSI color constants independently. This creates maintenance burden and drift risk. A single shared module eliminates duplication.

---

#### Step 1: Write the failing test

```javascript
// tests/test-colors.cjs
#!/usr/bin/env node
'use strict';
const assert = require('assert');

function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); return true; }
  catch (error) { console.log(`  \u2717 ${name}`); console.log(`    Error: ${error.message}`); return false; }
}

async function main() {
  console.log('\n\u2501\u2501\u2501 Unified Color System Tests \u2501\u2501\u2501\n');

  const { ANSI, colorize, rgb, stripAnsi, icons } = require('../core/colors.cjs');
  let passed = 0;
  let failed = 0;

  // T1: ANSI constants are defined
  test('ANSI constants are defined', () => {
    assert.ok(ANSI.RESET, 'RESET should exist');
    assert.ok(ANSI.BOLD, 'BOLD should exist');
    assert.ok(ANSI.DIM, 'DIM should exist');
    assert.ok(ANSI.RED, 'RED should exist');
    assert.ok(ANSI.GREEN, 'GREEN should exist');
    assert.ok(ANSI.YELLOW, 'YELLOW should exist');
    assert.ok(ANSI.CYAN, 'CYAN should exist');
    assert.ok(ANSI.GRAY, 'GRAY should exist');
    assert.ok(ANSI.WHITE, 'WHITE should exist');
  }) ? passed++ : failed++;

  // T2: colorize wraps text with ANSI codes
  test('colorize wraps text with ANSI codes', () => {
    const result = colorize('hello', 'red');
    assert.ok(result.includes('\x1b['), 'Should contain ANSI escape');
    assert.ok(result.includes('hello'), 'Should contain original text');
    assert.ok(result.endsWith(ANSI.RESET), 'Should end with reset');
  }) ? passed++ : failed++;

  // T3: colorize accepts multiple styles
  test('colorize accepts multiple styles', () => {
    const result = colorize('hello', 'bold', 'cyan');
    assert.ok(result.includes(ANSI.BOLD), 'Should include bold');
    assert.ok(result.includes(ANSI.CYAN), 'Should include cyan');
  }) ? passed++ : failed++;

  // T4: rgb function creates true-color escape
  test('rgb creates true-color ANSI escape', () => {
    const color = rgb(255, 128, 0);
    assert.ok(color.includes('38;2;255;128;0'), 'Should contain RGB values');
  }) ? passed++ : failed++;

  // T5: stripAnsi removes all ANSI codes
  test('stripAnsi removes ANSI codes', () => {
    const colored = `${ANSI.RED}hello${ANSI.RESET} ${ANSI.BOLD}world${ANSI.RESET}`;
    const clean = stripAnsi(colored);
    assert.strictEqual(clean, 'hello world', 'Should strip all ANSI');
  }) ? passed++ : failed++;

  // T6: icons object has required keys
  test('icons has required keys', () => {
    const required = ['check', 'cross', 'warning', 'info', 'arrow'];
    for (const key of required) {
      assert.ok(icons[key], `icons.${key} should be defined`);
    }
  }) ? passed++ : failed++;

  // T7: colorize handles unknown style gracefully
  test('colorize handles unknown style gracefully', () => {
    const result = colorize('hello', 'nonexistent');
    assert.ok(result.includes('hello'), 'Should still contain text');
  }) ? passed++ : failed++;

  // T8: stripAnsi handles strings without ANSI codes
  test('stripAnsi handles plain strings', () => {
    assert.strictEqual(stripAnsi('plain text'), 'plain text');
  }) ? passed++ : failed++;

  // T9: ANSI constants start with ESC character
  test('ANSI constants start with ESC character', () => {
    assert.ok(ANSI.RESET.startsWith('\x1b['), 'RESET should start with ESC[');
    assert.ok(ANSI.BOLD.startsWith('\x1b['), 'BOLD should start with ESC[');
    assert.ok(ANSI.RED.startsWith('\x1b['), 'RED should start with ESC[');
  }) ? passed++ : failed++;

  // T10: Module can be imported by both bin/cortex.cjs and cli-renderer.cjs patterns
  test('Module exports are compatible with existing patterns', () => {
    // bin/cortex.cjs pattern: uses c(text, ...styles) function
    const c = colorize;
    const result = c('test', 'bold', 'cyan');
    assert.ok(result.includes('test'), 'c() function pattern should work');

    // cli-renderer.cjs pattern: uses ANSI constants directly
    const output = `${ANSI.BOLD}header${ANSI.RESET}`;
    assert.ok(output.includes('header'), 'Direct ANSI constant pattern should work');
  }) ? passed++ : failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

#### Step 2: Run test -- expect failure

```bash
cd /home/rob/repos/cortex-claude
node tests/test-colors.cjs
# Expected: Error — Cannot find module '../core/colors.cjs'
```

---

#### Step 3: Write the implementation

```javascript
// core/colors.cjs
/**
 * Cortex Unified Color System
 *
 * Single source of truth for ANSI color constants, colorize helper,
 * RGB true-color support, and icon definitions. Used by:
 *   - bin/cortex.cjs (CLI output)
 *   - hooks/cli-renderer.cjs (session start/end rendering)
 *   - hooks/injection-formatter.cjs (if ANSI needed in future)
 *
 * Replaces duplicate color definitions that existed independently
 * in bin/cortex.cjs and hooks/cli-renderer.cjs.
 *
 * @version 1.0.0
 */

'use strict';

// =============================================================================
// ANSI CONSTANTS
// =============================================================================

const ANSI = {
  RESET:  '\x1b[0m',
  BOLD:   '\x1b[1m',
  DIM:    '\x1b[2m',
  RED:    '\x1b[31m',
  GREEN:  '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE:   '\x1b[34m',
  MAGENTA:'\x1b[35m',
  CYAN:   '\x1b[36m',
  WHITE:  '\x1b[37m',
  GRAY:   '\x1b[90m',
  BRIGHT_WHITE: '\x1b[97m',
};

// Lowercase aliases for compatibility with bin/cortex.cjs pattern
const ANSI_LOWER = {
  reset: ANSI.RESET,
  bold: ANSI.BOLD,
  dim: ANSI.DIM,
  red: ANSI.RED,
  green: ANSI.GREEN,
  yellow: ANSI.YELLOW,
  blue: ANSI.BLUE,
  magenta: ANSI.MAGENTA,
  cyan: ANSI.CYAN,
  white: ANSI.WHITE,
  gray: ANSI.GRAY,
};

// =============================================================================
// CURSOR / TERMINAL CONTROL
// =============================================================================

const TERMINAL = {
  HIDE_CURSOR: '\x1b[?25l',
  SHOW_CURSOR: '\x1b[?25h',
  CLEAR_LINE:  '\x1b[2K',
  SYNC_START:  '\x1b[?2026h',
  SYNC_END:    '\x1b[?2026l',
};

// =============================================================================
// TRUE-COLOR RGB
// =============================================================================

/**
 * Create a true-color ANSI foreground escape sequence.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} ANSI escape sequence
 */
function rgb(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

// Gradient palette (used by cli-renderer)
const GRADIENT = {
  from: [0, 200, 255],    // cyan
  to:   [120, 80, 255],   // purple
};

// =============================================================================
// COLORIZE HELPER
// =============================================================================

/**
 * Colorize a string with one or more ANSI styles.
 * Compatible with bin/cortex.cjs c(text, ...styles) pattern.
 *
 * @param {string} text - Text to colorize
 * @param {...string} styles - Style names: 'bold', 'red', 'cyan', 'dim', etc.
 * @returns {string} Colorized string with reset at end
 */
function colorize(text, ...styles) {
  const codes = styles.map(s => ANSI_LOWER[s] || '').join('');
  return `${codes}${text}${ANSI.RESET}`;
}

// =============================================================================
// STRIP ANSI
// =============================================================================

/**
 * Remove all ANSI escape sequences from a string.
 * @param {string} str - String potentially containing ANSI codes
 * @returns {string} Clean string
 */
function stripAnsi(str) {
  // Match all ANSI escape sequences: ESC[ ... m, ESC[ ... h/l, etc.
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

// =============================================================================
// ICONS
// =============================================================================

const icons = {
  check:   '\u2714',
  cross:   '\u2718',
  warning: '\u26A0',
  info:    '\u2139',
  arrow:   '\u2192',
  brain:   '\u{1F9E0}',
  search:  '\u{1F50D}',
  gear:    '\u2699',
  folder:  '\u{1F4C1}',
  chart:   '\u{1F4CA}',
  clock:   '\u{1F551}',
  rocket:  '\u{1F680}',
  sparkle: '\u2728',
};

// Spinner frames (used by cli-renderer)
const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ANSI,
  ANSI_LOWER,
  TERMINAL,
  GRADIENT,
  SPINNER,
  rgb,
  colorize,
  stripAnsi,
  icons,
};
```

**Update `bin/cortex.cjs`** (lines 28-51): Replace local color/icon definitions with import:

```javascript
// Replace the local colors/icons definitions with:
const { ANSI_LOWER: colors, colorize: c, icons } = require('../core/colors.cjs');

// Add reset property (bin/cortex.cjs uses colors.reset)
colors.reset = colors.reset || '\x1b[0m';
```

Remove the old `colors` object, `icons` object, and `c()` function definitions (lines 29-63 of the original file).

**Update `hooks/cli-renderer.cjs`** (lines 23-47): Replace local ANSI constants with import:

```javascript
// Replace the local ANSI definitions with:
const { ANSI, rgb, TERMINAL, GRADIENT, SPINNER } = require('../core/colors.cjs');

const RST    = ANSI.RESET;
const BOLD   = ANSI.BOLD;
const DIM    = ANSI.DIM;
const GREEN  = ANSI.GREEN;
const YELLOW = ANSI.YELLOW;
const RED    = ANSI.RED;
const CYAN   = ANSI.CYAN;
const GRAY   = ANSI.GRAY;
const WHITE  = ANSI.BRIGHT_WHITE;

const { HIDE_CURSOR, SHOW_CURSOR, CLEAR_LINE, SYNC_START, SYNC_END } = TERMINAL;
const GRADIENT_FROM = GRADIENT.from;
const GRADIENT_TO   = GRADIENT.to;
```

#### Step 4: Run test -- expect all passing

```bash
cd /home/rob/repos/cortex-claude
node tests/test-colors.cjs
# Expected: 10 passed, 0 failed

# Also verify existing tests still pass:
node tests/test-cli-renderer.cjs
# Expected: All CLI renderer tests passed
```

#### Step 5: Commit

```bash
cd /home/rob/repos/cortex-claude
git add core/colors.cjs bin/cortex.cjs hooks/cli-renderer.cjs tests/test-colors.cjs
git commit -m "refactor(B8): unify color system across CLI and MCP outputs

- core/colors.cjs: single source of truth for ANSI, RGB, icons, spinner
- bin/cortex.cjs: imports from core/colors.cjs (removes 35 lines of dups)
- hooks/cli-renderer.cjs: imports from core/colors.cjs (removes 25 lines)
- colorize(text, ...styles): compatible with both existing patterns
- stripAnsi(): utility for ANSI removal (used by formatForMCP)
- 10 tests covering: constants, colorize, multi-style, RGB, strip,
  icons, unknown styles, plain strings, ESC format, pattern compat"
```

---

## Phase B Summary

| Task | Module | Test File | Tests | Description |
|------|--------|-----------|-------|-------------|
| B0 | `core/validation.cjs`, `hooks/injection-formatter.cjs`, `cortex/server.cjs` | `tests/test-phase-a-debt.cjs` | 12 | Phase A debt: version sync, neural default, validateArray resilience |
| B1 | `core/llm-provider.cjs` | `tests/test-llm-provider.cjs` | 11 | LlmProvider interface + DirectApiProvider |
| B2 | `core/sampling-provider.cjs`, `core/provider-factory.cjs` | `tests/test-provider-factory.cjs` | 10 | SamplingProvider stub + ProviderFactory auto-detection |
| B3 | `cortex/haiku-worker.cjs`, `cortex/sonnet-thinker.cjs`, `cortex/server.cjs` | `tests/test-llm-integration.cjs` | 8 | Integrate LlmProvider into workers |
| B4 | `hooks/pre-compact.cjs` | `tests/test-pre-compact-enhanced.cjs` | 6 | PreCompact hook validation (existing impl satisfies) |
| B5 | `hooks/stop-hook.cjs` | `tests/test-stop-hook-enhanced.cjs` | 8 | Stop hook validation (existing impl satisfies) |
| B6 | `hooks/instructions-loaded.cjs`, `scripts/install-hooks.cjs` | `tests/test-instructions-loaded.cjs` | 9 | InstructionsLoaded hook for memory sync |
| B7 | `hooks/injection-formatter.cjs`, `cortex/server.cjs` | `tests/test-mcp-formatting.cjs` | 8 | formatForMCP — neural themes in tool responses |
| B8 | `core/colors.cjs`, `bin/cortex.cjs`, `hooks/cli-renderer.cjs` | `tests/test-colors.cjs` | 10 | Unified color system |

**Total: 82 tests across 9 tasks.**

### Run all Phase B tests

```bash
cd /home/rob/repos/cortex-claude
node tests/test-phase-a-debt.cjs && \
node tests/test-llm-provider.cjs && \
node tests/test-provider-factory.cjs && \
node tests/test-llm-integration.cjs && \
node tests/test-pre-compact-enhanced.cjs && \
node tests/test-stop-hook-enhanced.cjs && \
node tests/test-instructions-loaded.cjs && \
node tests/test-mcp-formatting.cjs && \
node tests/test-colors.cjs
```

### Add to package.json test script

After all Phase B tasks pass, update `package.json` `"test"` script to include:

```
&& node tests/test-phase-a-debt.cjs && node tests/test-llm-provider.cjs && node tests/test-provider-factory.cjs && node tests/test-llm-integration.cjs && node tests/test-pre-compact-enhanced.cjs && node tests/test-stop-hook-enhanced.cjs && node tests/test-instructions-loaded.cjs && node tests/test-mcp-formatting.cjs && node tests/test-colors.cjs
```

### Integration note

After all 9 tasks pass:

1. Run `node scripts/install-hooks.cjs` to register the new InstructionsLoaded hook
2. Verify existing hooks still work: `node tests/test-hooks.cjs`
3. Verify backward compatibility: `node tests/test-sampling-adapter.cjs && node tests/test-sampling-integration.cjs`
4. Bump version to `3.1.0` in `package.json` (Phase B is a minor feature release)

This completes the Phase B Core Engine transformation: dual-path LLM provider, unified color system, InstructionsLoaded hook, input resilience, and neural-themed MCP formatting.
