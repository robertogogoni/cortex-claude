'use strict';
const assert = require('assert');

async function testHaikuUseSampling() {
  const { HaikuWorker } = require('../cortex/haiku-worker.cjs');
  const mockAdapter = {
    complete: async (prompt, opts) => ({
      text: JSON.stringify({ intent: 'search', keywords: ['test'] }),
      model: 'haiku-mock',
      mode: 'sampling'
    })
  };
  const worker = new HaikuWorker({ samplingAdapter: mockAdapter });
  assert(worker.samplingAdapter, 'Worker accepts sampling adapter');
  assert.strictEqual(worker.client, null, 'Direct client not created when adapter provided');
  console.log('HaikuWorker sampling integration test passed');
}

async function testSonnetUseSampling() {
  const { SonnetThinker } = require('../cortex/sonnet-thinker.cjs');
  const mockAdapter = {
    complete: async (prompt, opts) => ({
      text: JSON.stringify({ quality: 8, value: 'test', suggestedTags: [], isDuplicate: false, priority: 'high', enhancedInsight: 'test' }),
      model: 'sonnet-mock',
      mode: 'sampling'
    })
  };
  const thinker = new SonnetThinker({ samplingAdapter: mockAdapter });
  assert(thinker.samplingAdapter, 'Thinker accepts sampling adapter');
  assert.strictEqual(thinker.client, null, 'Direct client not created when adapter provided');
  console.log('SonnetThinker sampling integration test passed');
}

async function main() {
  await testHaikuUseSampling();
  await testSonnetUseSampling();
  console.log('All sampling integration tests passed');
}

main().catch(err => { console.error(err); process.exit(1); });
