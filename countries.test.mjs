import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, COUNTRY_SOURCE } from './countries.mjs';

test('nationality choices retain the official list without duplicate codes', () => {
  const names = new Map(COUNTRIES);
  assert.ok(COUNTRIES.length > 240);
  assert.equal(names.size, COUNTRIES.length);
  assert.deepEqual(COUNTRIES[0], ['TW', '中華民國（臺灣）']);
  for (const [code, name] of [['JP', '日本'], ['US', '美國'], ['CN', '中國大陸'], ['HK', '香港'], ['MO', '澳門'], ['ZZ', '其他國家']]) assert.equal(names.get(code), name);
  assert.ok(COUNTRIES.every(([code, name]) => /^[A-Z]{2}$/.test(code) && name.trim()));
  assert.equal(new URL(COUNTRY_SOURCE).hostname, 'www.ntbt.gov.tw');
});
