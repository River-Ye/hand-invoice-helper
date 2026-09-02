import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateInvoice,
  decodeState,
  encodeState,
  getInvoiceDate,
  isValidVat,
  parseAmount,
  toFinancialDigits,
} from "./app.mjs";

test("calculates taxable amounts from net and gross", () => {
  assert.deepEqual(calculateInvoice({ tax: "tax", basis: "net", amount: 10 }), {
    net: 10,
    tax: 1,
    gross: 11,
  });
  assert.deepEqual(calculateInvoice({ tax: "tax", basis: "net", amount: 1000 }), {
    net: 1000,
    tax: 50,
    gross: 1050,
  });
  assert.deepEqual(calculateInvoice({ tax: "tax", basis: "gross", amount: 1000 }), {
    net: 952,
    tax: 48,
    gross: 1000,
  });
});

test("calculates zero-rated and tax-free amounts", () => {
  for (const tax of ["zero", "free"]) {
    for (const basis of ["net", "gross"]) {
      assert.deepEqual(calculateInvoice({ tax, basis, amount: 1000 }), {
        net: 1000,
        tax: 0,
        gross: 1000,
      });
    }
  }
});

test("rejects invalid amounts and enums", () => {
  assert.equal(parseAmount(0), 0);
  for (const value of ["", "   ", -1, 1.5, "abc", "1e3", "0x10", "+1", Infinity, 1_000_000_000]) {
    assert.equal(parseAmount(value), null);
  }
  assert.equal(parseAmount(999_999_999), 999_999_999);
  assert.equal(calculateInvoice({ tax: "other", basis: "net", amount: 1 }), null);
  assert.equal(calculateInvoice({ tax: "tax", basis: "other", amount: 1 }), null);
  assert.equal(calculateInvoice({ tax: "tax", basis: "net", amount: 999_999_999 }), null);
});

test("uses Taipei date and invoice periods", () => {
  assert.deepEqual(getInvoiceDate(new Date("2025-12-31T16:30:00Z")), {
    rocYear: 115,
    month: 1,
    day: 1,
    period: "1–2月",
  });
  assert.equal(getInvoiceDate(new Date("2026-02-20T00:00:00Z")).period, "1–2月");
  assert.equal(getInvoiceDate(new Date("2026-03-20T00:00:00Z")).period, "3–4月");
  assert.equal(getInvoiceDate(new Date("invalid")), null);
});

test("round-trips share state and ignores invalid fields", () => {
  const state = {
    type: "three",
    vat: "24536806",
    name: "台灣谷歌人才資源管理顧問有限公司",
    tax: "tax",
    basis: "gross",
    amount: 1000,
  };
  const hash = encodeState(state);
  assert.equal(hash.startsWith("#v=1&type=three&vat=24536806&name="), true);
  assert.deepEqual(decodeState(hash), state);
  assert.deepEqual(decodeState(""), {});
  assert.deepEqual(decodeState("#v=2&type=three"), {});
  assert.deepEqual(
    decodeState("#v=1&type=bad&vat=123&name=&tax=tax&basis=net&amount=-1"),
    { name: "", tax: "tax", basis: "net" },
  );
  assert.equal(decodeState(`#v=1&name=${"長".repeat(121)}`).name.length, 120);
  assert.deepEqual(decodeState(`#v=1&name=${"長".repeat(2000)}`), {});
});

test("accepts only eight ASCII digits as a VAT number", () => {
  assert.equal(isValidVat("24536806"), true);
  for (const value of ["", "1234567", "123456789", "1234abcd", "１２３４５６７８"]) {
    assert.equal(isValidVat(value), false);
  }
});

test("renders totals in financial Chinese with place values", () => {
  assert.equal(toFinancialDigits(0), "零");
  assert.equal(toFinancialDigits(10), "壹拾");
  assert.equal(toFinancialDigits(1000), "壹仟");
  assert.equal(toFinancialDigits(1050), "壹仟零伍拾");
  assert.equal(toFinancialDigits(10005), "壹萬零伍");
  assert.equal(toFinancialDigits(100000001), "壹億零壹");
});
