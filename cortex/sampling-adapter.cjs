'use strict';

const { getApiKey } = require('../core/api-key.cjs');

/**
 * SamplingAdapter - Unified LLM completion interface
 *
 * Prefers MCP Sampling (zero-cost, uses host Claude) with automatic
 * fallback to direct Anthropic API (paid, requires ANTHROPIC_API_KEY).
 */
class SamplingAdapter {
  constructor(options = {}) {
    this.mcpContext = options.mcpContext || null;
    this.apiKey = options.apiKey || getApiKey();
    this.mode = this.mcpContext ? 'sampling' : (this.apiKey ? 'api' : 'none');
  }

  async complete(prompt, options = {}) {
    const { speed = 'fast', maxTokens = 1024, systemPrompt = null } = options;
    if (this.mode === 'sampling') {
      return this._viaSampling(prompt, { speed, maxTokens, systemPrompt });
    } else if (this.mode === 'api') {
      return this._viaAPI(prompt, { speed, maxTokens, systemPrompt });
    } else {
      throw new Error('No LLM backend available: set MCP context or ANTHROPIC_API_KEY');
    }
  }

  async _viaSampling(prompt, { speed, maxTokens, systemPrompt }) {
    const messages = [{ role: 'user', content: { type: 'text', text: prompt } }];
    const modelPreferences = speed === 'deep'
      ? { hints: [{ name: 'claude-sonnet' }], intelligencePriority: 0.9, speedPriority: 0.3 }
      : { hints: [{ name: 'claude-haiku' }], intelligencePriority: 0.3, speedPriority: 0.9 };
    const params = { messages, modelPreferences, maxTokens };
    if (systemPrompt) params.systemPrompt = systemPrompt;
    const result = await this.mcpContext.requestSampling(params);
    const text = typeof result.content === 'string'
      ? result.content
      : (result.content?.text || JSON.stringify(result.content));
    return { text, model: result.model || 'unknown', mode: 'sampling' };
  }

  async _viaAPI(prompt, { speed, maxTokens, systemPrompt }) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey: this.apiKey });
    const model = speed === 'deep' ? 'claude-sonnet-4-6-20250627' : 'claude-haiku-4-5-20251001';
    const params = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (systemPrompt) params.system = systemPrompt;
    const response = await client.messages.create(params);
    const text = response.content[0]?.text || '';
    return { text, model: response.model, mode: 'api' };
  }
}

module.exports = { SamplingAdapter };
