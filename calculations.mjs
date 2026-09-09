export const MAX_AMOUNT = 999_999_999;
export const LABOR_YEAR = 2026;

function wholeAmount(value) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value).trim())) {
    throw new Error("金額請填非負整數，不接受小數、逗號或科學記號。");
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > MAX_AMOUNT) throw new Error("金額上限為 999,999,999 元。");
  return amount;
}

function laborOptions({ category = "9A", residency = "resident", nhiStatus = "general", singlePayment = false }) {
  if (!["9A", "9B", "50", "92"].includes(category)) throw new Error("請選擇有效的所得類別。");
  if (!["resident", "nonresident"].includes(residency)) throw new Error("請選擇有效的稅務居住身分。");
  if (!["general", "none", "lowIncome", "union", "professional", "category2", "vulnerable"].includes(nhiStatus)
    || (["union", "professional"].includes(nhiStatus) && !["9A", "9B"].includes(category))
    || (nhiStatus === "category2" && category !== "50")) {
    throw new Error("健保資格不適用於所選所得類別，請重新確認。");
  }
  if (category === "50" && residency === "nonresident" && singlePayment !== true) {
    throw new Error("非居住者薪資須確認當月僅一次給付；多次給付請另行核算。");
  }
  return { category, residency, nhiStatus };
}

function laborRates(gross, { category, residency, nhiStatus }) {
  let taxRate = 0;
  if (category !== "92") {
    if (residency === "resident") {
      taxRate = category === "50" ? (gross >= 90_501 ? 500 : 0) : (gross >= 20_010 ? 1_000 : 0);
    } else if (category === "50") {
      taxRate = gross <= 44_250 ? 600 : 1_800;
    } else {
      taxRate = category === "9B" && gross <= 5_000 ? 0 : 2_000;
    }
  }
  const nhiThreshold = category === "50" || nhiStatus === "vulnerable" ? 29_500 : 20_000;
  const nhiRate = category !== "92" && ["general", "vulnerable"].includes(nhiStatus) && gross >= nhiThreshold ? 211 : 0;
  return { taxRate, nhiRate };
}

function laborResult(gross, options) {
  const { taxRate, nhiRate } = laborRates(gross, options);
  const tax = Math.floor(gross * taxRate / 10_000);
  const nhi = Math.floor((Math.min(gross, 10_000_000) * nhiRate + 5_000) / 10_000);
  return { gross, tax, nhi, net: gross - tax - nhi };
}

export function calculateLabor(input = {}) {
  return laborResult(wholeAmount(input.gross), laborOptions(input));
}

export function reverseLabor(input = {}) {
  const net = wholeAmount(input.net);
  const options = laborOptions(input);
  const boundaries = [0, 5_001, 20_000, 20_010, 29_500, 44_251, 90_501, 10_000_000, MAX_AMOUNT + 1];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const low = boundaries[index];
    const high = boundaries[index + 1] - 1;
    const { taxRate, nhiRate } = laborRates(low, options);
    const cappedNhi = low >= 10_000_000 ? 10_000_000 * nhiRate / 10_000 : 0;
    const nhiSlope = low >= 10_000_000 ? 0 : nhiRate;
    const estimate = (net + cappedNhi) * 10_000 / (10_000 - taxRate - nhiSlope);
    // Tax flooring and NHI rounding shift the exact gross by less than two dollars.
    // Search nearby integers in each rate segment; rounding can make net non-monotonic.
    for (let gross = Math.max(low, Math.floor(estimate) - 3); gross <= Math.min(high, Math.ceil(estimate) + 3); gross++) {
      const result = laborResult(gross, options);
      if (result.net === net) return result;
    }
  }
  return null;
}

function decimal(value, label) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(?:\.\d{1,6})?$/.test(String(value).trim())) {
    throw new Error(`${label}請填非負數，最多 6 位小數，不接受逗號或科學記號。`);
  }
  const [integer, fraction = ""] = String(value).trim().split(".");
  return { value: BigInt(integer + fraction), scale: 10n ** BigInt(fraction.length) };
}

export function calculateAllowanceRow({ quantity, unitPrice, taxType = "tax" } = {}) {
  if (!["tax", "zero", "free"].includes(taxType)) throw new Error("請選擇有效的課稅別。");
  const count = decimal(quantity, "數量");
  const price = decimal(unitPrice, "未稅單價");
  if (!count || !price) return null;
  const scale = count.scale * price.scale;
  const net = (count.value * price.value + scale / 2n) / scale;
  const tax = taxType === "tax" ? (net + 10n) / 20n : 0n;
  if (net + tax > BigInt(MAX_AMOUNT)) throw new Error("每列含稅金額上限為 999,999,999 元。");
  return { net: Number(net), tax: Number(tax), total: Number(net + tax) };
}
