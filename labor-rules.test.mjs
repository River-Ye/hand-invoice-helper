import test from 'node:test';
import assert from 'node:assert/strict';
import { getLaborRules, LATEST_LABOR_YEAR } from './labor-rules.mjs';
import { calculateLabor, reverseLabor } from './calculations.mjs';

test('unverified payment years cannot silently use the previous year', () => {
  assert.equal(LATEST_LABOR_YEAR, 2026);
  assert.equal(getLaborRules(2026).minimumWage, 29_500);
  for (const year of [2025, 2027, NaN, '2026', null]) {
    assert.equal(getLaborRules(year), null);
    assert.throws(() => calculateLabor({ gross: 50_000, year }), /年度/);
    assert.throws(() => reverseLabor({ net: 50_000, year }), /年度/);
  }
});

test('nonresident NHI must be confirmed; tax can be shown before confirmation', () => {
  const base = { gross: 50_000, residency: 'nonresident', year: 2026 };
  assert.deepEqual(calculateLabor(base), { gross: 50_000, tax: 10_000, nhi: null, net: null });
  assert.deepEqual(calculateLabor({ ...base, nhiStatus: 'unknown' }), { gross: 50_000, tax: 10_000, nhi: null, net: null });
  assert.deepEqual(calculateLabor({ ...base, nhiStatus: 'none' }), { gross: 50_000, tax: 10_000, nhi: 0, net: 40_000 });
  assert.deepEqual(calculateLabor({ ...base, nhiStatus: 'general' }), { gross: 50_000, tax: 10_000, nhi: 1_055, net: 38_945 });
  assert.throws(() => reverseLabor({ net: 40_000, residency: 'nonresident' }), /健保/);
  const result = reverseLabor({ net: 40_000, residency: 'nonresident', nhiStatus: 'none' });
  // Flooring 49,999 × 20% to 9,999 yields the same net as 50,000; choose the minimum.
  assert.equal(result.gross, 49_999);
  assert.deepEqual(result, calculateLabor({ ...base, gross: result.gross, nhiStatus: 'none' }));
  assert.deepEqual(calculateLabor({ ...base, category: '92' }), { gross: 50_000, tax: 0, nhi: 0, net: 50_000 });
});
