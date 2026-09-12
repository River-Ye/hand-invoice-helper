// Add a year only after checking all official sources and the boundary tests.
// Monitoring reports changes; it never edits or activates financial rules.
export const LABOR_RULES = {
  2026: {
    year: 2026,
    checkedAt: '2026-09-12',
    minimumWage: 29_500,
    salaryThreshold: 90_501,
    nonresidentSalaryThreshold: 44_250,
    residentProfessionalRate: 1_000,
    residentSalaryRate: 500,
    residentTaxExemption: 2_000,
    nonresidentProfessionalRate: 2_000,
    nonresidentRoyaltyExemption: 5_000,
    nonresidentSalaryLowRate: 600,
    nonresidentSalaryHighRate: 1_800,
    nhiRate: 211,
    nhiThreshold: 20_000,
    nhiCap: 10_000_000,
    sources: [
      'https://law-out.mof.gov.tw/LawContent.aspx?id=FL005962',
      'https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/individual-income-tax/withheld-rule/rule/n3x6znM',
      'https://www.nhi.gov.tw/ch/cp-3283-34642-2589-1.html',
      'https://www.mol.gov.tw/1607/28162/28166/28180/70460/76761/76833/post',
    ],
  },
};

// Rates are in basis points (211 = 2.11%). No fallback to another payment year.
export const LATEST_LABOR_YEAR = Math.max(...Object.keys(LABOR_RULES).map(Number));
export function getLaborRules(year) {
  return Number.isInteger(year) ? LABOR_RULES[year] ?? null : null;
}
