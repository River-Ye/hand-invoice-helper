import { getLaborRules, LATEST_LABOR_YEAR } from './labor-rules.mjs';
export const MAX_AMOUNT = 999_999_999;
export const LABOR_YEAR = LATEST_LABOR_YEAR;

function wholeAmount(value) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value).trim())) {
    throw new Error("金額請填非負整數，不接受小數、逗號或科學記號。");
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > MAX_AMOUNT) throw new Error("金額上限為 999,999,999 元。");
  return amount;
}

function laborOptions({ category = "9A", residency = "resident", nhiStatus = residency === "nonresident" ? "unknown" : "general", singlePayment = false, year = LABOR_YEAR }) {
  const rules = getLaborRules(year);
  if (!rules) throw new Error("給付年度規則尚未核實啟用，請另行核算。");
  if (!["9A", "9B", "50", "92"].includes(category)) throw new Error("請選擇有效的所得類別。");
  if (!["resident", "nonresident"].includes(residency)) throw new Error("請選擇有效的稅務居住身分。");
  if (!["unknown", "general", "none", "lowIncome", "union", "professional", "category2", "vulnerable"].includes(nhiStatus)
    || (["union", "professional"].includes(nhiStatus) && !["9A", "9B"].includes(category))
    || (nhiStatus === "category2" && category !== "50")) {
    throw new Error("健保資格不適用於所選所得類別，請重新確認。");
  }
  if (category === "50" && residency === "nonresident" && singlePayment !== true) {
    throw new Error("非居住者薪資須確認當月僅一次給付；多次給付請另行核算。");
  }
  return { category, residency, nhiStatus, rules };
}

function professionalThreshold(rules) {
  return Math.ceil((rules.residentTaxExemption + 1) * 10_000 / rules.residentProfessionalRate);
}

function laborRates(gross, { category, residency, nhiStatus, rules }) {
  let taxRate = 0;
  if (category !== "92") {
    if (residency === "resident") {
      taxRate = category === "50"
        ? (gross >= rules.salaryThreshold ? rules.residentSalaryRate : 0)
        : (gross >= professionalThreshold(rules) ? rules.residentProfessionalRate : 0);
    } else if (category === "50") {
      taxRate = gross <= rules.nonresidentSalaryThreshold ? rules.nonresidentSalaryLowRate : rules.nonresidentSalaryHighRate;
    } else {
      taxRate = category === "9B" && gross <= rules.nonresidentRoyaltyExemption ? 0 : rules.nonresidentProfessionalRate;
    }
  }
  const nhiThreshold = category === "50" || nhiStatus === "vulnerable" ? rules.minimumWage : rules.nhiThreshold;
  const nhiRate = category !== "92" && ["general", "vulnerable"].includes(nhiStatus) && gross >= nhiThreshold ? rules.nhiRate : 0;
  return { taxRate, nhiRate };
}

function laborResult(gross, options) {
  const { taxRate, nhiRate } = laborRates(gross, options);
  const tax = Math.floor(gross * taxRate / 10_000);
  if (options.category !== "92" && options.nhiStatus === "unknown") return { gross, tax, nhi: null, net: null };
  const nhi = Math.floor((Math.min(gross, options.rules.nhiCap) * nhiRate + 5_000) / 10_000);
  return { gross, tax, nhi, net: gross - tax - nhi };
}

export function calculateLabor(input = {}) {
  return laborResult(wholeAmount(input.gross), laborOptions(input));
}

export function reverseLabor(input = {}) {
  const net = wholeAmount(input.net);
  const options = laborOptions(input);
  if (options.category !== "92" && options.nhiStatus === "unknown") throw new Error("請先確認健保資格，再進行實領反算。");
  const rules = options.rules;
  const boundaries = [...new Set([0, rules.nonresidentRoyaltyExemption + 1, rules.nhiThreshold,
    professionalThreshold(rules), rules.minimumWage, rules.nonresidentSalaryThreshold + 1,
    rules.salaryThreshold, rules.nhiCap, MAX_AMOUNT + 1])].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index++) {
    const low = boundaries[index];
    const high = boundaries[index + 1] - 1;
    const { taxRate, nhiRate } = laborRates(low, options);
    const cappedNhi = low >= rules.nhiCap ? rules.nhiCap * nhiRate / 10_000 : 0;
    const nhiSlope = low >= rules.nhiCap ? 0 : nhiRate;
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

export function calculateAllowanceRow({ quantity, refundAmount, taxType = "tax" } = {}) {
  if (!["tax", "zero", "free"].includes(taxType)) throw new Error("請選擇有效的課稅別。");
  const count = decimal(quantity, "數量");
  const refund = decimal(refundAmount, "退款金額");
  if (!refund) return null;
  if (count?.value === 0n && refund.value > 0n) throw new Error("有退款金額時，數量不可為零；未知數量可留空。");
  const total = (refund.value * 2n + refund.scale) / (refund.scale * 2n);
  if (refund.value > BigInt(MAX_AMOUNT) * refund.scale || total > BigInt(MAX_AMOUNT)) {
    throw new Error("每列含稅金額上限為 999,999,999 元。");
  }
  const tax = taxType === "tax" ? (total + 10n) / 21n : 0n;
  return { net: Number(total - tax), tax: Number(tax), total: Number(total) };
}

export function allowanceUnitPrice(net, quantity) {
  const count = decimal(quantity, "數量");
  if (net == null || !count || count.value === 0n) return "";
  const amount = BigInt(wholeAmount(net));
  const scale = count.scale * 1_000_000n;
  const numerator = amount * scale;
  const rounded = (numerator * 2n + count.value) / (count.value * 2n);
  // ponytail: six-decimal prices can lose a dollar at large quantities; leave blank
  // until the PDF layout supports greater precision rather than print a conflicting total.
  if ((rounded * count.value * 2n + scale) / (scale * 2n) !== amount) return "";
  const fraction = String(rounded % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return `${rounded / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
