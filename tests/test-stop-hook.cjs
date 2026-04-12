'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testStopHook() {
  const { StopHook } = require('../src/hooks/stop-hook.cjs');

  const hook = new StopHook({ basePath: '/tmp/cortex-test-stop' });

  // Test 1: Captures explicit "remember" signals
  const input = {
    stop_hook_active: true,
    response: 'All 142 tests passed. Remember: always run tests before committing.',
  };
  const result = await hook.execute(input);
  assert(result.success, 'Hook executes');
  assert(result.captured >= 1, 'Captured the remember signal');

  // Test 2: Ignores low-signal content
  const lowSignal = await hook.execute({
    response: 'OK, I will read the file now.',
  });
  assert(lowSignal.success, 'Low signal handled');
  assert.strictEqual(lowSignal.captured, 0, 'Nothing captured for low signal');

  // Test 3: Empty input
  const empty = await hook.execute({});
  assert(empty.success, 'Empty input handled');
  assert.strictEqual(empty.captured, 0);

  // Test 4: Captures error fix patterns
  const errorFix = await hook.execute({
    response: 'The issue was a missing semicolon in the config. Fixed by adding it back.',
  });
  assert(errorFix.success, 'Error fix handled');
  assert(errorFix.captured >= 1, 'Captured error fix pattern');

  // Test 5: Captures insight patterns
  const insight = await hook.execute({
    response: 'Important: never deploy on Fridays without a rollback plan.',
  });
  assert(insight.success, 'Insight handled');
  assert(insight.captured >= 1, 'Captured insight pattern');

  // Test 6: Captures "note to self" pattern
  const noteToSelf = await hook.execute({
    response: 'Note to self: the API rate limit resets every 15 minutes.',
  });
  assert(noteToSelf.success, 'Note to self handled');
  assert(noteToSelf.captured >= 1, 'Captured note to self pattern');

  // Test 7: Captures root cause pattern
  const rootCause = await hook.execute({
    response: 'Root cause: the environment variable was not set in production.',
  });
  assert(rootCause.success, 'Root cause handled');
  assert(rootCause.captured >= 1, 'Captured root cause pattern');

  // Test 8: Max 5 captures per turn (raised to accommodate insight blocks)
  const manySignals = await hook.execute({
    response: 'Remember: use async/await. Remember: validate inputs. Remember: log errors. Remember: test edge cases. Remember: document APIs. Remember: one too many.',
  });
  assert(manySignals.success, 'Many signals handled');
  assert(manySignals.captured <= 5, 'Max 5 captures per turn');

  // Test 9: Short response ignored
  const shortResp = await hook.execute({
    response: 'OK done.',
  });
  assert(shortResp.success, 'Short response handled');
  assert.strictEqual(shortResp.captured, 0, 'Short response ignored');

  // Test 10: Verify working.jsonl file was created and contains valid JSONL
  const workingPath = path.join('/tmp/cortex-test-stop', 'data', 'memories', 'working.jsonl');
  assert(fs.existsSync(workingPath), 'working.jsonl was created');
  const content = fs.readFileSync(workingPath, 'utf8');
  const lines = content.trim().split('\n').filter(l => l.trim());
  assert(lines.length > 0, 'working.jsonl has content');
  for (const line of lines) {
    const record = JSON.parse(line);
    assert(record.id, 'Record has id');
    assert(record.type, 'Record has type');
    assert(record.content, 'Record has content');
    assert(record.createdAt, 'Record has createdAt');
    assert(Array.isArray(record.tags), 'Record has tags array');
    assert(record.tags.includes('stop-hook'), 'Record tagged with stop-hook');
  }

  fs.rmSync('/tmp/cortex-test-stop', { recursive: true, force: true });
  console.log('All stop hook tests passed');
}

testStopHook().catch(err => { console.error(err); process.exit(1); });
