import test from 'node:test';
import assert from 'node:assert/strict';
import { todayISO, validateDate, legacyInvoiceURL, bindCompanyLookup } from './tool-common.mjs';

test('dates are real calendar dates and use Taipei today', () => {
  assert.equal(todayISO(new Date('2025-12-31T16:30:00Z')), '2026-01-01');
  for (const value of ['', '2024-02-29', '2026-09-09']) assert.equal(validateDate(value, '日期'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-1', 'bad']) {
    assert.throws(() => validateDate(value, '日期'), /日期/);
  }
});

test('only legacy v1 links route to the fixed invoice page', () => {
  assert.equal(legacyInvoiceURL('?x=1', '#v=1&type=two&amount=1050'), './invoice.html?x=1#v=1&type=two&amount=1050');
  for (const hash of ['', '#v=2', '#guide', `#v=1&name=${'a'.repeat(1800)}`]) assert.equal(legacyInvoiceURL('', hash), null);
  assert.equal(legacyInvoiceURL('', '#v=1&url=https://evil.example'), './invoice.html#v=1&url=https://evil.example');
});

function companyLookup(t, responses) {
  const timers = new Map();
  let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    timers.set(++timerId, { callback, delay });
    return timerId;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.method(globalThis, 'fetch', async () => {
    const record = await responses.shift()();
    return { ok: true, json: async () => ({ data: record }) };
  });
  const field = () => Object.assign(new EventTarget(), { value: '' });
  const vat = field(), name = field(), address = field(), status = { textContent: '' };
  const cancel = bindCompanyLookup({ vat, name, address, status });
  return {
    vat, name, address, status, cancel,
    changeVat(value) { vat.value = value; vat.dispatchEvent(new Event('input')); },
    runLookup() {
      const entry = [...timers].find(([, timer]) => timer.delay === 350);
      assert.ok(entry, 'company lookup was scheduled');
      timers.delete(entry[0]);
      return entry[1].callback();
    },
  };
}

test('changing VAT clears previous automatic data before missing or failed lookups', async t => {
  const lookup = companyLookup(t, [
    () => ({ 公司名稱: '公司甲', 公司所在地: '地址甲' }),
    () => ({ 公司名稱: '公司乙' }),
    () => { throw new Error('offline'); },
  ]);
  lookup.changeVat('12345678');
  await lookup.runLookup();
  assert.equal(lookup.name.value, '公司甲');
  assert.equal(lookup.address.value, '地址甲');
  lookup.changeVat('87654321');
  assert.equal(lookup.name.value, '');
  assert.equal(lookup.address.value, '');
  await lookup.runLookup();
  assert.equal(lookup.name.value, '公司乙');
  assert.equal(lookup.address.value, '');
  lookup.changeVat('11111111');
  await lookup.runLookup();
  assert.equal(lookup.name.value, '');
  assert.equal(lookup.address.value, '');
  assert.match(lookup.status.textContent, /查不到/);
});

test('VAT edits preserve user changes and current input changes during lookup', async t => {
  let resolve;
  const lookup = companyLookup(t, [
    () => ({ 公司名稱: '公司甲', 公司所在地: '地址甲' }),
    () => new Promise(done => { resolve = done; }),
  ]);
  lookup.changeVat('12345678');
  await lookup.runLookup();
  lookup.name.value = '手填名稱';
  lookup.address.value = '手填地址';
  lookup.changeVat('123');
  assert.equal(lookup.name.value, '手填名稱');
  assert.equal(lookup.address.value, '手填地址');
  lookup.changeVat('87654321');
  const pending = lookup.runLookup();
  lookup.address.value = '新的手填地址';
  resolve({ 公司名稱: '公司乙', 公司所在地: '地址乙' });
  await pending;
  assert.equal(lookup.name.value, '手填名稱');
  assert.equal(lookup.address.value, '新的手填地址');
});

test('clear cancels an in-flight lookup even if its response ignores abort', async t => {
  let resolve;
  const lookup = companyLookup(t, [() => new Promise(done => { resolve = done; })]);
  lookup.changeVat('12345678');
  const pending = lookup.runLookup();
  lookup.cancel();
  lookup.vat.value = lookup.name.value = lookup.address.value = lookup.status.textContent = '';
  resolve({ 公司名稱: '不應帶回', 公司所在地: '不應帶回' });
  await pending;
  assert.equal(lookup.name.value, '');
  assert.equal(lookup.address.value, '');
  assert.equal(lookup.status.textContent, '');
});
