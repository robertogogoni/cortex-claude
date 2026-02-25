'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testPreCompact() {
  const { PreCompactHook } = require('../hooks/pre-compact.cjs');

  const hook = new PreCompactHook({
    basePath: path.join(__dirname, 'fixtures/precompact'),
  });

  const input = {
    transcript_summary: 'Working on authentication system. Decided to use JWT with refresh tokens. Key insight: always validate expiry before checking permissions.',
    cwd: '/tmp/test-project',
  };

  const result = await hook.execute(input);
  assert(result.success, 'Hook executes successfully');
  assert(result.preserved > 0, 'Preserved at least one item');
  assert(result.items.length > 0, 'Has preserved items');

  const emptyResult = await hook.execute({});
  assert(emptyResult.success, 'Empty input handled gracefully');
  assert.strictEqual(emptyResult.preserved, 0);

  console.log('All PreCompact hook tests passed');
}

const fixturesDir = path.join(__dirname, 'fixtures/precompact/data/memories');
fs.mkdirSync(fixturesDir, { recursive: true });

testPreCompact().then(() => {
  fs.rmSync(path.join(__dirname, 'fixtures/precompact'), { recursive: true, force: true });
}).catch(err => {
  fs.rmSync(path.join(__dirname, 'fixtures/precompact'), { recursive: true, force: true });
  console.error(err);
  process.exit(1);
});
