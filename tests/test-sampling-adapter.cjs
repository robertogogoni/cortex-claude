'use strict';
const assert = require('assert');

class MockMcpContext {
  constructor() {
    this.lastRequest = null;
    this.response = { role: 'assistant', content: { type: 'text', text: 'mock response' }, model: 'claude-haiku' };
  }
  async requestSampling(params) {
    this.lastRequest = params;
    return this.response;
  }
}

async function testSamplingAdapter() {
  const { SamplingAdapter } = require('../cortex/sampling-adapter.cjs');

  const ctx = new MockMcpContext();
  const adapter = new SamplingAdapter({ mcpContext: ctx });
  assert(adapter, 'Adapter created');

  const result = await adapter.complete('Test prompt', { speed: 'fast' });
  assert.strictEqual(ctx.lastRequest.modelPreferences.speedPriority, 0.9);
  assert.strictEqual(ctx.lastRequest.modelPreferences.intelligencePriority, 0.3);
  assert(result.text, 'Got text response');

  await adapter.complete('Deep analysis', { speed: 'deep' });
  assert.strictEqual(ctx.lastRequest.modelPreferences.speedPriority, 0.3);
  assert.strictEqual(ctx.lastRequest.modelPreferences.intelligencePriority, 0.9);

  const fallbackAdapter = new SamplingAdapter({ mcpContext: null, apiKey: 'test-key' });
  assert.strictEqual(fallbackAdapter.mode, 'api');

  await adapter.complete('Test', { speed: 'fast', maxTokens: 256 });
  assert.strictEqual(ctx.lastRequest.maxTokens, 256);

  console.log('All sampling adapter tests passed');
}

testSamplingAdapter().catch(err => { console.error(err); process.exit(1); });
