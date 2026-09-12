import test from "node:test";
import assert from "node:assert/strict";
import { MAX_AMOUNT, LABOR_YEAR, calculateLabor, reverseLabor, calculateAllowanceRow, allowanceUnitPrice } from "./calculations.mjs";

test("labor uses 115-year constants and strictly accepts whole-dollar amounts", () => {
  assert.equal(LABOR_YEAR, 2026);
  assert.equal(MAX_AMOUNT, 999_999_999);
  assert.deepEqual(calculateLabor({ gross: " 0000 " }), { gross: 0, tax: 0, nhi: 0, net: 0 });
  assert.equal(calculateLabor({ gross: MAX_AMOUNT }).gross, MAX_AMOUNT);
  for (const value of [undefined, null, true, false, "", " ", -1, 1.5, "1.0", "1e3", "0x10", "+1", "1,000", "１２", NaN, Infinity, MAX_AMOUNT + 1]) {
    assert.throws(() => calculateLabor({ gross: value }), /金額/);
    assert.throws(() => reverseLabor({ net: value }), /金額/);
  }
});

test("resident 9A and 9B withhold only after the floored tax exceeds 2,000", () => {
  for (const category of ["9A", "9B"]) {
    for (const [gross, tax] of [[19_999, 0], [20_000, 0], [20_009, 0], [20_010, 2_001], [30_009, 3_000]]) {
      assert.equal(calculateLabor({ gross, category }).tax, tax);
    }
  }
});

test("salary and nonresident withholding boundaries are exact", () => {
  const scenarios = [
    ["50", "resident", 90_500, 0], ["50", "resident", 90_501, 4_525],
    ["9A", "nonresident", 1, 0], ["9A", "nonresident", 5_000, 1_000],
    ["9B", "nonresident", 5_000, 0], ["9B", "nonresident", 5_001, 1_000],
    ["50", "nonresident", 44_250, 2_655], ["50", "nonresident", 44_251, 7_965],
  ];
  for (const [category, residency, gross, tax] of scenarios) {
    assert.equal(calculateLabor({ gross, category, residency, singlePayment: true }).tax, tax);
  }
  for (const residency of ["resident", "nonresident"]) {
    assert.deepEqual(calculateLabor({ gross: 100_000, category: "92", residency }), { gross: 100_000, tax: 0, nhi: 0, net: 100_000 });
  }
});

test("nonresident salary requires explicit confirmation of a single monthly payment", () => {
  for (const singlePayment of [undefined, false, "true", 1]) {
    const options = { category: "50", residency: "nonresident", nhiStatus: "general", singlePayment };
    assert.throws(() => calculateLabor({ gross: 40_000, ...options }), /當月.*一次/);
    assert.throws(() => reverseLabor({ net: 40_000, ...options }), /當月.*一次/);
  }
});

test("NHI thresholds, rounding and the single-payment cap use integer arithmetic", () => {
  for (const [gross, nhi] of [[19_999, 0], [20_000, 422], [20_024, 423], [10_000_000, 211_000], [10_000_001, 211_000], [MAX_AMOUNT, 211_000]]) {
    assert.equal(calculateLabor({ gross }).nhi, nhi);
  }
  assert.equal(calculateLabor({ gross: 29_499, category: "50" }).nhi, 0);
  assert.equal(calculateLabor({ gross: 29_500, category: "50" }).nhi, 622);
  assert.equal(calculateLabor({ gross: 20_000, residency: "nonresident", nhiStatus: "general" }).nhi, 422);
});

test("NHI exemptions are explicit and restricted to eligible categories", () => {
  for (const category of ["9A", "9B", "50", "92"]) {
    for (const nhiStatus of ["none", "lowIncome"]) {
      assert.equal(calculateLabor({ gross: 100_000, category, nhiStatus }).nhi, 0);
    }
  }
  for (const category of ["9A", "9B"]) {
    for (const nhiStatus of ["union", "professional"]) {
      assert.equal(calculateLabor({ gross: 100_000, category, nhiStatus }).nhi, 0);
    }
    assert.equal(calculateLabor({ gross: 29_499, category, nhiStatus: "vulnerable" }).nhi, 0);
    assert.equal(calculateLabor({ gross: 29_500, category, nhiStatus: "vulnerable" }).nhi, 622);
    assert.throws(() => calculateLabor({ gross: 100_000, category, nhiStatus: "category2" }), /健保/);
  }
  assert.equal(calculateLabor({ gross: 100_000, category: "50", nhiStatus: "category2" }).nhi, 0);
  assert.equal(calculateLabor({ gross: 29_500, category: "50", nhiStatus: "vulnerable" }).nhi, 622);
  for (const category of ["50", "92"]) {
    for (const nhiStatus of ["union", "professional"]) {
      assert.throws(() => calculateLabor({ gross: 100_000, category, nhiStatus }), /健保/);
    }
  }
});

test("unknown calculation enums fail with customer-readable messages", () => {
  for (const options of [{ category: "bad" }, { residency: "bad" }, { nhiStatus: "bad" }]) {
    assert.throws(() => calculateLabor({ gross: 0, ...options }), /所得|居住|健保/);
    assert.throws(() => reverseLabor({ net: 0, ...options }), /所得|居住|健保/);
  }
});

test("reverse calculation chooses the smallest solution across discontinuities", () => {
  assert.deepEqual(reverseLabor({ net: 19_578 }), { gross: 19_578, tax: 0, nhi: 0, net: 19_578 });
  assert.equal(reverseLabor({ net: 17_587 }).gross, 17_587);
  assert.equal(reverseLabor({ net: 4_001, category: "9B", residency: "nonresident", nhiStatus: "general" }).gross, 4_001);
  assert.equal(reverseLabor({ net: MAX_AMOUNT }), null);
  assert.equal(reverseLabor({ net: MAX_AMOUNT, category: "92" }).gross, MAX_AMOUNT);
});

test("reverse calculation matches exhaustive minimum-gross truth for small amounts", () => {
  for (const options of [
    {}, { category: "9B", residency: "nonresident", nhiStatus: "general" },
    { category: "50", residency: "nonresident", nhiStatus: "general", singlePayment: true },
    { nhiStatus: "vulnerable" },
  ]) {
    const minimums = new Map();
    for (let gross = 0; gross <= 60_000; gross++) {
      const result = calculateLabor({ gross, ...options });
      if (!minimums.has(result.net)) minimums.set(result.net, gross);
    }
    for (const [net, gross] of minimums) {
      if (net <= 5_100 || net % 47 === 0) assert.equal(reverseLabor({ net, ...options })?.gross, gross, JSON.stringify({ net, ...options }));
    }
  }
});

test("reverse calculation verifies results around every threshold and maximum", () => {
  for (const options of [
    {}, { category: "9B", residency: "nonresident", nhiStatus: "general" }, { category: "50" },
    { category: "50", residency: "nonresident", nhiStatus: "general", singlePayment: true },
    { nhiStatus: "none" }, { nhiStatus: "vulnerable" }, { category: "92" },
  ]) {
    for (const threshold of [0, 5_001, 20_000, 20_010, 29_500, 44_251, 90_501, 10_000_000, MAX_AMOUNT]) {
      for (let delta = -3; delta <= 3; delta++) {
        const gross = threshold + delta;
        if (gross < 0 || gross > MAX_AMOUNT) continue;
        const target = calculateLabor({ gross, ...options });
        const result = reverseLabor({ net: target.net, ...options });
        assert.ok(result && result.gross <= gross);
        assert.equal(result.net, target.net);
        assert.deepEqual(result, calculateLabor({ gross: result.gross, ...options }));
      }
    }
  }
});

test("allowance treats refund as the row total, rounds gross first and derives tax exactly", () => {
  for (const quantity of ["", "2", "0.1", "0.000001"]) {
    assert.deepEqual(calculateAllowanceRow({ quantity, refundAmount: "1050" }), { net: 1_000, tax: 50, total: 1_050 });
  }
  assert.deepEqual(calculateAllowanceRow({ refundAmount: "10.499999" }), { net: 10, tax: 0, total: 10 });
  assert.deepEqual(calculateAllowanceRow({ refundAmount: "10.500000" }), { net: 10, tax: 1, total: 11 });
  assert.deepEqual(calculateAllowanceRow({ refundAmount: "0.499999" }), { net: 0, tax: 0, total: 0 });
  assert.deepEqual(calculateAllowanceRow({ refundAmount: "0.500000" }), { net: 1, tax: 0, total: 1 });
  assert.deepEqual(calculateAllowanceRow({ quantity: 0, refundAmount: 0 }), { net: 0, tax: 0, total: 0 });
  for (const taxType of ["zero", "free"]) {
    assert.deepEqual(calculateAllowanceRow({ quantity: "3", refundAmount: "10.5", taxType }), { net: 11, tax: 0, total: 11 });
  }
});

test("partial allowance rows stay blank but entered invalid values still fail", () => {
  for (const blank of [undefined, null, "", " "]) {
    assert.deepEqual(calculateAllowanceRow({ quantity: blank, refundAmount: "1.25" }), { net: 1, tax: 0, total: 1 });
    assert.equal(calculateAllowanceRow({ quantity: "1", refundAmount: blank }), null);
  }
  for (const invalid of [false, true, -1, "-1", "+1", "1e3", "0x10", "1,000", "a", "1.0000001", "1.", ".5", NaN, Infinity]) {
    assert.throws(() => calculateAllowanceRow({ quantity: invalid, refundAmount: "" }), /數量/);
    assert.throws(() => calculateAllowanceRow({ quantity: "", refundAmount: invalid }), /退款金額/);
  }
  assert.throws(() => calculateAllowanceRow({ quantity: "", refundAmount: "", taxType: "bad" }), /課稅/);
  assert.throws(() => calculateAllowanceRow({ quantity: "0.000000", refundAmount: "0.1" }), /數量不可為零/);
});

test("allowance enforces the money limit before and after gross rounding", () => {
  assert.deepEqual(calculateAllowanceRow({ refundAmount: MAX_AMOUNT }), { net: 952_380_951, tax: 47_619_048, total: MAX_AMOUNT });
  assert.equal(calculateAllowanceRow({ refundAmount: "999999998.5", taxType: "free" }).total, MAX_AMOUNT);
  for (const refundAmount of ["999999999.1", "999999999.5", "1000000000", "999999999999999999999"]) {
    assert.throws(() => calculateAllowanceRow({ refundAmount }), /上限/);
  }
});

test("allowance PDF unit price divides untaxed row total by quantity without floating point", () => {
  assert.equal(allowanceUnitPrice(1000, "2"), "500");
  assert.equal(allowanceUnitPrice(1000, "3"), "333.333333");
  assert.equal(allowanceUnitPrice(2, "3"), "0.666667");
  assert.equal(allowanceUnitPrice(1, "0.000001"), "1000000");
  assert.equal(allowanceUnitPrice(MAX_AMOUNT, "0.000001"), "999999999000000");
  assert.equal(allowanceUnitPrice(10, "0.8"), "12.5");
  assert.equal(allowanceUnitPrice(0, "2"), "0");
  assert.equal(allowanceUnitPrice(1, "1000000"), "0.000001");
  assert.equal(allowanceUnitPrice(1, "1499999"), "0.000001");
  for (const quantity of ["1500001", "2000000", "2000001"]) {
    assert.equal(allowanceUnitPrice(1, quantity), "");
  }
  for (const quantity of [undefined, "", "0"]) assert.equal(allowanceUnitPrice(1000, quantity), "");
  assert.equal(allowanceUnitPrice(null, "2"), "");
});
