'use strict';
const assert = require('assert');

function testBitemporalFields() {
  // Test 1: Types include bi-temporal fields
  const types = require('../src/core/types.cjs');

  // Check that generateId and getTimestamp still work
  const id = types.generateId();
  assert(id, 'generateId works');
  const ts = types.getTimestamp();
  assert(ts, 'getTimestamp works');
  assert(typeof ts === 'string', 'Timestamp is a string');

  // Test 2: Bi-temporal helpers exist
  assert(typeof types.createBitemporalFields === 'function', 'createBitemporalFields exists');

  const fields = types.createBitemporalFields();
  assert(fields.validFrom, 'validFrom is set');
  assert(fields.validTo === null, 'validTo starts as null (still valid)');
  assert(fields.ingestedAt, 'ingestedAt is set');

  // Test 3: Custom validFrom
  const customDate = '2024-01-15T10:00:00.000Z';
  const customFields = types.createBitemporalFields(customDate);
  assert.strictEqual(customFields.validFrom, customDate, 'Custom validFrom is preserved');
  assert(customFields.validTo === null, 'validTo still null with custom validFrom');
  assert(customFields.ingestedAt, 'ingestedAt still auto-set with custom validFrom');
  assert(customFields.ingestedAt !== customDate, 'ingestedAt differs from custom validFrom');

  // Test 4: Invalidation helper
  assert(typeof types.invalidateMemory === 'function', 'invalidateMemory exists');

  const invalidated = types.invalidateMemory({ validTo: null });
  assert(invalidated.validTo !== null, 'validTo set after invalidation');
  assert(typeof invalidated.validTo === 'string', 'validTo is an ISO string after invalidation');

  // Verify invalidation preserves other fields
  const original = { id: 'test-1', content: 'hello', validTo: null, validFrom: customDate };
  const inv = types.invalidateMemory(original);
  assert.strictEqual(inv.id, 'test-1', 'Invalidation preserves id');
  assert.strictEqual(inv.content, 'hello', 'Invalidation preserves content');
  assert.strictEqual(inv.validFrom, customDate, 'Invalidation preserves validFrom');
  assert(inv.validTo !== null, 'Invalidation sets validTo');

  // Test 5: isValid helper
  assert(typeof types.isMemoryValid === 'function', 'isMemoryValid exists');
  assert(types.isMemoryValid({ validTo: null }), 'Null validTo means valid');
  assert(!types.isMemoryValid({ validTo: '2020-01-01T00:00:00.000Z' }), 'Past validTo means invalid');

  // Future validTo should be valid
  const futureDate = new Date(Date.now() + 86400000).toISOString(); // +24 hours
  assert(types.isMemoryValid({ validTo: futureDate }), 'Future validTo means valid');

  // Test 6: ingestedAt and validFrom are close to current time
  const before = new Date();
  const autoFields = types.createBitemporalFields();
  const after = new Date();
  const validFromDate = new Date(autoFields.validFrom);
  const ingestedAtDate = new Date(autoFields.ingestedAt);
  assert(validFromDate >= before && validFromDate <= after, 'validFrom is approximately now');
  assert(ingestedAtDate >= before && ingestedAtDate <= after, 'ingestedAt is approximately now');

  console.log('All bi-temporal tests passed');
}

testBitemporalFields();
