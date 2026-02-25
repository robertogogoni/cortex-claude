# Cortex CLI Renderer — Design Document

**Date**: 2026-02-25
**Replaces**: `hooks/neural-visuals.cjs` (1066 lines, 4 themed ASCII art displays)
**New file**: `hooks/cli-renderer.cjs`
**Dependencies**: Zero (pure ANSI escape codes)

## Problem

The current `neural-visuals.cjs` is decorative noise — rotating ASCII art themes with pulsing animations and 100+ funny phrases. It shows no real data: no per-adapter timing, no token budget usage, no streaming progress, no error states. The user sees a pretty animation but learns nothing about what Cortex is doing.

## Design Direction: Gradient Clack (A+C Hybrid)

Combine the structural reliability of Clack-style vertical flow (Design A) with the visual flair of gradient accents and inline progress bars (Design C).

### Visual Output (Full Mode — First Query)

```
  C O R T E X                          ← cyan→purple true-color gradient
  Claude's Cognitive Layer · v3.0.0

 ┌
 │  ✓ Initialized 0.3s
 │
 │  ✓ jsonl              ████░░░░░░░░  142  0.1s
 │  ✓ claudemd           █░░░░░░░░░░░   26  0.1s
 │  ✓ gemini             █░░░░░░░░░░░    8  0.4s
 │  ✓ knowledge-graph    █░░░░░░░░░░░   10  0.5s
 │  ✓ warp-sqlite        ███░░░░░░░░░   87  0.6s
 │  ✓ vector             █████░░░░░░░  189  1.5s  ❄
 │  ! episodic-memory    ─ timeout     0.5s
 │
 │  ◇ HyDE expanded query 0.1s
 │  ✓ Selected 47 of 774 0.2s
 │
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ← gradient accent line
 └  47 memories · 1,545 / 4,000 tokens ████████░░░░ · 2.3s
```

### Visual Output (Compact Mode — Subsequent Queries)

```
 ◇ Cortex: 47 memories · 1,545 / 4,000 tokens · 2.3s
```

### Visual Output (Quiet Mode — Hooks)

```
✓ Cortex: 47 memories (1,545 tokens)
```

### Error States

```
 │  ✗ warp-sqlite        ─ timeout 0.5s          ← red ✗, adapter timed out
 │  ! vector             ─ unavailable            ← yellow !, reason shown
 │  ✗ episodic-memory    ─ ENOENT: db missing     ← red ✗, specific error
```

### Cold Start Indicator

```
 │  ✓ vector             █████░░░░░░░  189  3.2s  ❄    ← first run, model loading
```

The `❄` only appears when `adapter._provider?.initialized` was false at query start (cold start). On warm queries it disappears.

## Architecture

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `hooks/cli-renderer.cjs` | **NEW** | Single-class CLI renderer (~300 lines) |
| `hooks/injection-formatter.cjs` | **MODIFY** | Replace `ProgressDisplay` to use `CortexRenderer` |
| `hooks/neural-visuals.cjs` | **DELETE** | Replaced entirely by cli-renderer.cjs |
| `scripts/demo-cli-designs.cjs` | **UPDATE** | Update to show final design |

### Class: CortexRenderer

```javascript
class CortexRenderer {
  /**
   * @param {Object} options
   * @param {'full'|'compact'|'quiet'} options.verbosity - Display mode
   * @param {WritableStream} options.stream - Output stream (default: process.stderr)
   * @param {boolean} options.noColor - Disable all ANSI (respects NO_COLOR env)
   * @param {boolean} options.noAnimation - Disable spinners/progress (non-TTY)
   * @param {number} options.tokenBudget - Max token budget for budget bar
   */
  constructor(options = {})

  // --- Lifecycle ---
  banner()                          // Gradient "C O R T E X" + version
  begin()                           // Open vertical pipe ┌
  end(stats)                        // Close pipe └ with summary footer

  // --- Phases ---
  phaseStart(name)                  // Start spinner: "│  ⠋ Initializing"
  phaseDone(name, ms)               // Complete:      "│  ✓ Initialized 0.3s"

  // --- Adapter Results (streamed) ---
  adapterResult(adapter)            // "│  ✓ jsonl  ████░░ 142  0.1s"
  adapterError(adapter)             // "│  ✗ jsonl  ─ timeout 0.5s"

  // --- Informational ---
  hydeExpanded(ms)                  // "│  ◇ HyDE expanded query 0.1s"
  rankingSummary(selected, total, ms) // "│  ✓ Selected 47 of 774 0.2s"

  // --- Compact (subsequent queries) ---
  compact(stats)                    // Single-line: "◇ Cortex: 47 memories · ..."

  // --- Static helpers ---
  static gradient(text, from, to)   // Per-character true-color gradient
  static progressBar(value, max, width) // Block-char bar with adaptive width
  static formatTime(ms)             // "0.3s" / "1.5s" / "2m 3s"
  static formatTokenBudget(used, total, width) // "1,545 / 4,000 ████████░░░░"
}
```

### Data Flow

```
SessionStartHook.execute()
  │
  ├─ renderer.banner()           ← gradient header (first run only)
  ├─ renderer.begin()            ← open vertical pipe
  ├─ renderer.phaseStart('Initializing')
  │
  ├─ QueryOrchestrator.query()
  │   ├─ AdapterRegistry.queryAll()
  │   │   ├─ Per adapter: Promise.race([query, timeout])
  │   │   │   ├─ Success → renderer.adapterResult({ name, totalRecords, lastQueryTime, wasColdStart })
  │   │   │   └─ Failure → renderer.adapterError({ name, error, lastQueryTime })
  │   │   └─ Returns { results, stats: { [adapterName]: adapterStats } }
  │   │
  │   ├─ Deduplication
  │   ├─ Ranking → renderer.rankingSummary(selected, total, ms)
  │   └─ Token budget → stats.estimatedTokens
  │
  ├─ renderer.end({
  │     memoriesSelected,
  │     estimatedTokens,
  │     tokenBudget,        ← from config.sessionStart.slots.maxTokens
  │     bySource,
  │     duration,
  │     hydeExpanded,
  │     hydeMs,
  │   })
  │
  └─ stdout: JSON hook output (unchanged)
```

### Where Every Number Comes From

| Display Value | Source | Computation |
|---------------|--------|-------------|
| Adapter memory count | `adapterStats[name].totalRecords` | Counted by each adapter's `query()` |
| Adapter query time | `adapterStats[name].lastQueryTime` | `Date.now() - start` inside `_executeQuery()` |
| Total memories queried | `stats.totalQueried` | `allMemories.length` before dedup |
| Total memories selected | `stats.totalSelected` | `finalMemories.length` after budget |
| Estimated tokens used | `stats.estimatedTokens` | `_estimateTokens()` = sum of `ceil((content.length + metadata.length) / 4)` |
| Token budget max | `config.sessionStart.slots.maxTokens` | From `cortex.config.json`, default 2000 |
| Token budget percentage | `estimatedTokens / maxTokens * 100` | Computed in renderer |
| Inline bar per adapter | `adapter.totalRecords / maxRecordsAcrossAdapters` | Proportional to largest adapter result |
| Total duration | `Date.now() - startTime` | Measured in `SessionStartHook.execute()` |
| Cold start indicator | `adapterStats[name].wasColdStart` | Set by vector adapter when `!_provider.initialized` at query start |
| HyDE expansion | `stats.semantic.hydeExpanded` | From HaikuWorker query response |
| HyDE time | `stats.timings.hydeMs` | Measured in HaikuWorker._hydeExpand() |
| Source count | `Object.keys(bySource).length` | Unique adapter sources that returned >0 |
| Budget bar fill | `Math.round(estimatedTokens / maxTokens * barWidth)` | Computed in renderer |

### NO_COLOR and Pipe Detection

```javascript
// Computed once at construction
const isInteractive = stream.isTTY && !process.env.NO_COLOR;

// When !isInteractive:
// - No ANSI escape codes (colors, bold, dim)
// - No spinner animations (show static "..." instead)
// - No gradient (plain text)
// - No cursor hide/show
// - No synchronized rendering
// - Inline bars use ASCII: [####....] instead of █░
```

### Synchronized Rendering

```javascript
const SYNC_START = '\x1b[?2026h';  // Begin synchronized update
const SYNC_END   = '\x1b[?2026l';  // End synchronized update

// Used around multi-line writes:
write(SYNC_START);
// ... multiple lines ...
write(SYNC_END);
// Terminal paints once, zero flicker
```

Supported by: Ghostty, Kitty, WezTerm, iTerm2, foot, Alacritty 0.14+.
Unsupported terminals silently ignore these sequences.

### Adaptive Bar Width

```javascript
const columns = stream.columns || 80;
// Reserve space for: pipe(3) + checkmark(3) + name(18) + count(6) + time(8) + padding(4) = 42
const barWidth = Math.max(6, Math.min(20, columns - 50));
```

### Compact Mode Detection

```javascript
// Track across the process lifetime
class CortexRenderer {
  static _firstRun = true;  // Module-level state

  shouldUseCompact() {
    if (CortexRenderer._firstRun) {
      CortexRenderer._firstRun = false;
      return false;  // Full mode
    }
    return true;  // Compact mode for repeat queries
  }
}
```

For SessionStart hook (runs as separate process each time), compact mode is controlled by:
- `CORTEX_COMPACT=true` env var
- `--compact` / `-c` CLI flag
- Config: `config.sessionStart.compact` (default: false)

### Version String

Read from `package.json` at construction time — never hardcoded.

```javascript
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
this.version = pkg.version;
```

### ANSI Primitives (Zero Dependencies)

```javascript
const RST   = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW= '\x1b[33m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const GRAY  = '\x1b[90m';
const WHITE = '\x1b[97m';

// True-color (24-bit)
const rgb   = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

// Cursor control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE  = '\x1b[2K';

// Spinner frames (braille dots)
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Block characters for sub-character precision
const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
```

### Gradient Function

```javascript
static gradient(text, from, to) {
  if (!this._isInteractive) return text;  // Plain text fallback

  let out = '';
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? i / (text.length - 1) : 0;
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    out += rgb(r, g, b) + text[i];
  }
  return out + RST;
}
```

Gradient palette: `[0, 200, 255]` (cyan) → `[120, 80, 255]` (purple).

### Token Budget Bar

```javascript
static formatTokenBudget(used, total, width = 12) {
  const usedStr = used.toLocaleString();
  const totalStr = total.toLocaleString();
  const pct = Math.min(1, used / total);
  const filled = Math.round(pct * width);
  const empty = width - filled;

  // Color changes based on usage: green < 70%, yellow 70-90%, red > 90%
  let barColor = GREEN;
  if (pct > 0.9) barColor = RED;
  else if (pct > 0.7) barColor = YELLOW;

  const bar = barColor + '█'.repeat(filled) + DIM + GRAY + '░'.repeat(empty) + RST;
  return `${usedStr} / ${totalStr} tokens ${bar}`;
}
```

### Adapter Inline Bar

```javascript
_adapterBar(count, maxCount, width) {
  if (maxCount === 0) return DIM + '░'.repeat(width) + RST;

  const pct = count / maxCount;
  const filled = Math.round(pct * width);
  const empty = width - filled;

  return CYAN + '█'.repeat(filled) + GRAY + '░'.repeat(empty) + RST;
}
```

The `maxCount` is the highest `totalRecords` across all adapters in this query — computed once, then used for all bars. This makes bars proportional to each other.

## Integration Points

### 1. SessionStartHook (hooks/session-start.cjs)

Currently creates `ProgressDisplay` → replace with `CortexRenderer`.

```javascript
// Before
const progress = new ProgressDisplay({ verbose: !compactMode });
progress.init();
progress.step('Analyzing session context...', 'loading');
// ... later ...
progress.summary(result.stats);

// After
const renderer = new CortexRenderer({
  verbosity: compactMode ? 'quiet' : 'full',
  tokenBudget: config.get('sessionStart.slots.maxTokens') || 2000,
});

if (!compactMode) {
  renderer.banner();
  renderer.begin();
  renderer.phaseStart('Initializing');
}

// ... query execution ...
// Adapter results streamed as they complete (requires registry callback)

if (!compactMode) {
  renderer.end(result.stats);
} else {
  renderer.compact(result.stats);
}
```

### 2. AdapterRegistry Streaming Callback

Currently `queryAll()` returns all results at once. To stream adapter results we need a callback:

```javascript
// Add to queryAll() options
async queryAll(context, options = {}) {
  const { onAdapterComplete } = options;

  // ... existing parallel query logic ...
  // After each adapter resolves:
  if (onAdapterComplete) {
    onAdapterComplete({
      name: adapter.name,
      totalRecords: results.length,
      lastQueryTime: Date.now() - adapterStart,
      wasColdStart: adapter.name === 'vector' && !adapter._provider?.initialized,
      error: null,
    });
  }
}
```

### 3. InjectionFormatter (hooks/injection-formatter.cjs)

- Remove `ProgressDisplay` class (replaced by CortexRenderer)
- Remove `NeuralProgressDisplay`, `NeuralFormatter`, `NeuralAnimator`, `ThemeManager` imports
- Keep `InjectionFormatter` class unchanged (it formats injection text, not CLI output)
- Remove neural-visuals.cjs require

### 4. HaikuWorker Integration

The `query()` response already includes:
- `stats.timings.hydeMs` — HyDE expansion time
- `stats.hydeExpanded` — whether HyDE fired
- `hyde.expanded` — boolean
- `hyde.documentLength` — length of hypothetical document

The renderer calls `hydeExpanded(ms)` only when `stats.hydeExpanded === true`.

## What Gets Deleted

| File/Class | Lines | Reason |
|------------|-------|--------|
| `hooks/neural-visuals.cjs` | 1066 | Entire file — decorative themes, no real data |
| `ProgressDisplay` in injection-formatter.cjs | ~140 | Replaced by CortexRenderer |
| `data/theme-state.json` | runtime | Theme rotation state file (no longer needed) |

## What Stays Unchanged

| File/Class | Reason |
|------------|--------|
| `InjectionFormatter` | Formats injection text for Claude context — separate concern |
| `QueryOrchestrator` | Data layer — no rendering, just adds callback support |
| `AdapterRegistry` | Data layer — adds `onAdapterComplete` callback |
| `HaikuWorker` | Already returns all needed stats |
| All adapters | Data layer, no rendering |
| All tests (except neural-visuals tests) | Data contracts unchanged |

## Testing

### Unit Tests: `tests/test-cli-renderer.cjs`

1. **Gradient function**: Output contains correct ANSI true-color sequences
2. **progressBar**: Returns correct width, handles 0%, 50%, 100%, >100%
3. **formatTokenBudget**: Correct number formatting, color thresholds (green/yellow/red)
4. **formatTime**: "0.3s", "1.5s", "2m 3s" boundaries
5. **NO_COLOR mode**: Zero ANSI in output when `NO_COLOR=1`
6. **Pipe mode**: No animations when `stream.isTTY === false`
7. **Adaptive bar width**: Correct calculation for 80/120/200 column terminals
8. **adapterResult**: Correct formatting with proportional bars
9. **adapterError**: Red ✗ with error message
10. **compact mode**: Single-line output format
11. **Version**: Read from package.json, not hardcoded
12. **Token budget bar color thresholds**: Green < 70%, Yellow 70-90%, Red > 90%
13. **Cold start indicator**: ❄ appears when wasColdStart=true
14. **HyDE indicator**: Only shown when expanded=true

### Integration Test: `tests/test-cli-renderer-integration.cjs`

1. **Full render flow**: banner → begin → phaseStart → adapterResult×N → end
2. **Streaming callback**: Verify onAdapterComplete fires per adapter
3. **Real QueryOrchestrator output**: Feed actual stats into renderer, verify output
4. **Token budget accuracy**: Compare renderer display to actual `_estimateTokens()` output

## Implementation Order

1. Create `hooks/cli-renderer.cjs` with CortexRenderer class
2. Write `tests/test-cli-renderer.cjs` unit tests
3. Add `onAdapterComplete` callback to `AdapterRegistry.queryAll()`
4. Modify `hooks/session-start.cjs` to use CortexRenderer instead of ProgressDisplay
5. Modify `hooks/injection-formatter.cjs` — remove ProgressDisplay, remove neural-visuals imports
6. Delete `hooks/neural-visuals.cjs`
7. Update `scripts/demo-cli-designs.cjs` to show final design
8. Run all tests, verify integration
9. Add `wasColdStart` tracking to vector adapter's query path
