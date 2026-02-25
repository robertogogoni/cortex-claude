'use strict';
const assert = require('assert');

async function testElicitation() {
  // Test 1: Elicitation helper creates correct schema
  const { createElicitationSchema } = require('../cortex/elicitation-helper.cjs');

  const schema = createElicitationSchema('Test insight', 0.85);
  assert(schema.message, 'Schema has message');
  assert(schema.message.includes('Test insight'), 'Message includes the insight');
  assert(schema.requestedSchema, 'Schema has requestedSchema');
  assert(schema.requestedSchema.properties.action, 'Schema has action property');
  assert.deepStrictEqual(
    schema.requestedSchema.properties.action.enum,
    ['save', 'edit', 'discard'],
    'Action enum is correct'
  );
  assert(schema.requestedSchema.properties.edited, 'Schema has edited property');

  // Test 2: Process elicitation result - save
  const { processElicitationResult } = require('../cortex/elicitation-helper.cjs');

  const saveResult = processElicitationResult(
    { action: 'save' },
    'Original insight'
  );
  assert.strictEqual(saveResult.action, 'save');
  assert.strictEqual(saveResult.content, 'Original insight');

  // Test 3: Process elicitation result - edit
  const editResult = processElicitationResult(
    { action: 'edit', edited: 'Edited insight' },
    'Original insight'
  );
  assert.strictEqual(editResult.action, 'edit');
  assert.strictEqual(editResult.content, 'Edited insight');

  // Test 4: Process elicitation result - discard
  const discardResult = processElicitationResult(
    { action: 'discard' },
    'Original insight'
  );
  assert.strictEqual(discardResult.action, 'discard');
  assert.strictEqual(discardResult.content, null);

  // Test 5: Handle missing/null elicitation response (fallback to save)
  const nullResult = processElicitationResult(null, 'Original insight');
  assert.strictEqual(nullResult.action, 'save');
  assert.strictEqual(nullResult.content, 'Original insight');

  console.log('All elicitation tests passed');
}

testElicitation().catch(err => { console.error(err); process.exit(1); });
