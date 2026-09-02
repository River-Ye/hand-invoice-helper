const TYPES = new Set(["three", "two"]);
const TAXES = new Set(["tax", "zero", "free"]);
const BASES = new Set(["gross", "net"]);
const MAX_AMOUNT = 999_999_999;
const MAX_NAME_LENGTH = 120;
const MAX_HASH_LENGTH = 1800;

export function parseAmount(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT ? amount : null;
}

export function isValidVat(value) {
  return /^\d{8}$/.test(String(value));
}

export function toFinancialDigits(value) {
  const amount = parseAmount(value);
  if (amount === null || amount === 0) return "零";
  const digits = "零壹貳參肆伍陸柒捌玖";
  const smallUnits = ["", "拾", "佰", "仟"];
  const largeUnits = ["", "萬", "億"];
  const groups = [];
  for (let rest = amount; rest > 0; rest = Math.floor(rest / 10000)) groups.push(rest % 10000);

  const renderGroup = (group) => {
    let text = "";
    let pendingZero = false;
    for (let position = 3; position >= 0; position -= 1) {
      const digit = Math.floor(group / 10 ** position) % 10;
      if (digit === 0) {
        if (text && group % 10 ** position !== 0) pendingZero = true;
        continue;
      }
      if (pendingZero) text += "零";
      text += digits[digit] + smallUnits[position];
      pendingZero = false;
    }
    return text;
  };

  let result = "";
  let pendingZero = false;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) {
      if (result && groups.slice(0, index).some(Boolean)) pendingZero = true;
      continue;
    }
    if (result && (pendingZero || group < 1000)) result += "零";
    result += renderGroup(group) + largeUnits[index];
    pendingZero = false;
  }
  return result;
}

export function calculateInvoice({ tax: taxType, basis, amount: rawAmount }) {
  const amount = parseAmount(rawAmount);
  if (amount === null || !TAXES.has(taxType) || !BASES.has(basis)) return null;

  if (taxType !== "tax") return { net: amount, tax: 0, gross: amount };
  if (basis === "net") {
    const tax = Math.round(amount * 0.05);
    const gross = amount + tax;
    return gross <= MAX_AMOUNT ? { net: amount, tax, gross } : null;
  }

  const net = Math.round(amount / 1.05);
  return { net, tax: amount - net, gross: amount };
}

export function getInvoiceDate(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  const periodStart = parts.month % 2 === 0 ? parts.month - 1 : parts.month;
  return {
    rocYear: parts.year - 1911,
    month: parts.month,
    day: parts.day,
    period: `${periodStart}–${periodStart + 1}月`,
  };
}

export function encodeState(state) {
  const params = new URLSearchParams();
  params.set("v", "1");
  params.set("type", state.type);
  params.set("vat", state.vat);
  params.set("name", state.name);
  params.set("tax", state.tax);
  params.set("basis", state.basis);
  params.set("amount", String(state.amount));
  return `#${params}`;
}

export function decodeState(hash) {
  if (String(hash).length > MAX_HASH_LENGTH) return {};
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  if (params.get("v") !== "1") return {};

  const state = {};
  if (TYPES.has(params.get("type"))) state.type = params.get("type");
  if (isValidVat(params.get("vat"))) state.vat = params.get("vat");
  if (params.has("name")) state.name = params.get("name").slice(0, MAX_NAME_LENGTH);
  if (TAXES.has(params.get("tax"))) state.tax = params.get("tax");
  if (BASES.has(params.get("basis"))) state.basis = params.get("basis");
  const amount = parseAmount(params.get("amount"));
  if (amount !== null) state.amount = amount;
  return state;
}

if (typeof document !== "undefined") {
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    typeButtons: [...document.querySelectorAll("[data-type]")],
    buyerPanel: $("#buyer-panel"),
    vat: $("#company-vat"),
    name: $("#company-name"),
    suggestions: $("#company-suggestions"),
    lookupStatus: $("#lookup-status"),
    gross: $("#gross-amount"),
    net: $("#net-amount"),
    taxType: $("#tax-type"),
    taxAmount: $("#tax-amount"),
    amountError: $("#amount-error"),
    todayChip: $("#today-chip"),
    invoiceSheet: $("#invoice-sheet"),
    invoiceHeading: $("#invoice-heading"),
    invoiceNote: $("#invoice-note"),
    buyerPreview: $("#buyer-preview"),
    previewName: $("#preview-name"),
    previewVat: $("#preview-vat"),
    periodYear: $("#period-year"),
    periodRange: $("#period-range"),
    dateYear: $("#date-year"),
    dateMonth: $("#date-month"),
    dateDay: $("#date-day"),
    previewUnit: $("#preview-unit"),
    previewLineTotal: $("#preview-line-total"),
    previewNet: $("#preview-net"),
    previewTaxType: $("#preview-tax-type"),
    previewTax: $("#preview-tax"),
    previewGross: $("#preview-gross"),
    previewChinese: $("#preview-chinese"),
    clearButton: $("#clear-button"),
    shareButton: $("#share-button"),
    actionStatus: $("#action-status"),
  };

  const defaults = { type: "three", vat: "", name: "", tax: "tax", basis: "gross", amount: 0 };
  const state = { ...defaults, ...decodeState(location.hash) };
  if (!calculateInvoice(state)) state.amount = 0;
  let lookupController;
  let searchTimer;
  let suggestionRecords = [];
  let autoFilledName = "";
  let invalidAmountInput = null;

  const firstText = (...values) => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, MAX_NAME_LENGTH);
      if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
        return value[0].trim().slice(0, MAX_NAME_LENGTH);
      }
    }
    return "";
  };

  const companyNameFrom = (record = {}) =>
    firstText(
      record["商業名稱"],
      record["公司名稱"],
      record["名稱"],
      record["財政部"]?.["營業人名稱"],
      record["財政部"]?.["單位名稱"],
    );

  const vatFrom = (record = {}) => {
    const vat = firstText(record["統一編號"]);
    return isValidVat(vat) ? vat : "";
  };
  const formatAmount = (value) => new Intl.NumberFormat("zh-TW").format(value ?? 0);

  function renderDate() {
    const date = getInvoiceDate();
    if (!date) return;
    ui.todayChip.textContent = `民國 ${date.rocYear} 年 ${date.month} 月 ${date.day} 日`;
    ui.periodYear.textContent = date.rocYear;
    ui.periodRange.textContent = date.period;
    ui.dateYear.textContent = date.rocYear;
    ui.dateMonth.textContent = date.month;
    ui.dateDay.textContent = date.day;
  }

  function renderType() {
    const isThree = state.type === "three";
    for (const button of ui.typeButtons) button.setAttribute("aria-pressed", String(button.dataset.type === state.type));
    ui.buyerPanel.hidden = !isThree;
    ui.buyerPanel.setAttribute("aria-hidden", String(!isThree));
    ui.buyerPreview.hidden = !isThree;
    ui.invoiceHeading.textContent = `統一發票（${isThree ? "三" : "二"}聯式）`;
    ui.invoiceSheet.setAttribute("aria-label", `${isThree ? "三" : "二"}聯式發票填寫示意`);
    ui.invoiceSheet.classList.toggle("invoice-sheet--two", !isThree);
    ui.invoiceNote.textContent = isThree
      ? "第一聯存根聯留在發票本上，第二聯扣抵聯與第三聯收執聯交給客戶。"
      : "第一聯存根聯留在發票本上，第二聯收執聯交給一般消費者。";
  }

  function renderPreview(calculation = calculateInvoice(state)) {
    const values = calculation ?? { net: 0, tax: 0, gross: 0 };
    ui.previewName.textContent = state.name.trim() || "請填公司抬頭";
    ui.previewVat.textContent = isValidVat(state.vat) ? [...state.vat].join(" ") : "────────";
    const lineAmount = state.type === "three" ? values.net : values.gross;
    ui.previewUnit.textContent = formatAmount(lineAmount);
    ui.previewLineTotal.textContent = formatAmount(lineAmount);
    ui.previewNet.textContent = formatAmount(values.net);
    ui.previewTax.textContent = formatAmount(values.tax);
    ui.previewGross.textContent = formatAmount(values.gross);
    ui.previewChinese.textContent = toFinancialDigits(values.gross);
    ui.previewTaxType.textContent = { tax: "應稅 ✓", zero: "零稅率 ✓", free: "免稅 ✓" }[state.tax];
  }

  function renderAmounts() {
    const calculation = calculateInvoice(state);
    if (!calculation) return;
    ui.gross.setAttribute("aria-invalid", "false");
    ui.net.setAttribute("aria-invalid", "false");
    ui.amountError.textContent = "";
    invalidAmountInput = null;
    ui.gross.value = calculation.gross;
    ui.net.value = calculation.net;
    ui.taxAmount.textContent = formatAmount(calculation.tax);
    renderPreview(calculation);
  }

  function updateFromAmount(basis, rawValue) {
    state.basis = basis;
    const amount = parseAmount(rawValue);
    const source = basis === "gross" ? ui.gross : ui.net;
    source.setAttribute("aria-invalid", String(amount === null));
    ui.amountError.textContent = amount === null ? "請輸入 0 至 999,999,999 的整數金額。" : "";
    if (amount === null) {
      invalidAmountInput = source;
      (basis === "gross" ? ui.net : ui.gross).setAttribute("aria-invalid", "false");
      ui.taxAmount.textContent = "—";
      (basis === "gross" ? ui.net : ui.gross).value = "";
      renderPreview(null);
      return;
    }
    ui.gross.setAttribute("aria-invalid", "false");
    ui.net.setAttribute("aria-invalid", "false");
    ui.amountError.textContent = "";
    state.amount = amount;
    const calculation = calculateInvoice(state);
    if (!calculation) {
      invalidAmountInput = source;
      source.setAttribute("aria-invalid", "true");
      ui.amountError.textContent = "計算後總額不可超過 999,999,999 元。";
      ui.taxAmount.textContent = "—";
      (basis === "gross" ? ui.net : ui.gross).value = "";
      renderPreview(null);
      return;
    }
    if (basis === "gross") ui.net.value = calculation.net;
    else ui.gross.value = calculation.gross;
    invalidAmountInput = null;
    ui.taxAmount.textContent = formatAmount(calculation.tax);
    renderPreview(calculation);
  }

  function hideSuggestions() {
    suggestionRecords = [];
    ui.suggestions.replaceChildren();
    ui.suggestions.hidden = true;
  }

  function showSuggestions(records) {
    suggestionRecords = records.slice(0, 8);
    const buttons = suggestionRecords.map((record, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(index);
      button.textContent = companyNameFrom(record);
      const vat = vatFrom(record);
      if (vat) {
        const small = document.createElement("small");
        small.textContent = `統編 ${vat}`;
        button.append(small);
      }
      return button;
    });
    ui.suggestions.replaceChildren(...buttons);
    ui.suggestions.hidden = buttons.length === 0;
  }

  async function fetchCompanies(url) {
    lookupController?.abort();
    const controller = new AbortController();
    lookupController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("invalid response");
      return payload.data;
    } catch (error) {
      if (timedOut) throw new Error("timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function lookupByVat(vat) {
    ui.lookupStatus.textContent = "正在查詢公司名稱…";
    hideSuggestions();
    try {
      const record = await fetchCompanies(`https://company.g0v.ronny.tw/api/show/${vat}`);
      if (ui.vat.value.trim() !== vat || !record || Array.isArray(record) || typeof record !== "object") return;
      const name = companyNameFrom(record);
      if (!name) throw new Error("not found");
      state.name = name;
      autoFilledName = name;
      ui.name.value = name;
      ui.lookupStatus.textContent = "已帶入公司名稱；請仍確認抬頭是否正確。";
      renderPreview();
    } catch (error) {
      if (error.name === "AbortError") return;
      ui.lookupStatus.textContent = "查不到公司資料，請手動輸入公司名稱。";
    }
  }

  async function lookupByName(name) {
    ui.lookupStatus.textContent = "正在查詢公司資料…";
    try {
      const records = await fetchCompanies(`https://company.g0v.ronny.tw/api/search?q=${encodeURIComponent(name)}`);
      if (ui.name.value.trim() !== name) return;
      if (!Array.isArray(records) || records.length === 0) {
        hideSuggestions();
        ui.lookupStatus.textContent = "沒有相符結果，仍可直接手動輸入。";
        return;
      }
      showSuggestions(records.filter((record) => companyNameFrom(record)));
      ui.lookupStatus.textContent = "請從下方結果選擇，或繼續手動輸入。";
    } catch (error) {
      if (error.name === "AbortError") return;
      hideSuggestions();
      ui.lookupStatus.textContent = "公司查詢暫時無法使用，請手動輸入。";
    }
  }

  function clearAll() {
    lookupController?.abort();
    clearTimeout(searchTimer);
    Object.assign(state, defaults);
    autoFilledName = "";
    ui.vat.value = "";
    ui.name.value = "";
    ui.taxType.value = state.tax;
    ui.lookupStatus.textContent = "";
    ui.amountError.textContent = "";
    ui.actionStatus.textContent = "資料已清除。";
    hideSuggestions();
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    renderType();
    renderAmounts();
    ui.vat.focus();
  }

  async function copyShareLink() {
    if (invalidAmountInput) {
      ui.actionStatus.textContent = "請先修正金額，再複製分享連結。";
      invalidAmountInput.focus();
      return;
    }
    state.vat = ui.vat.value.trim();
    state.name = ui.name.value.trim();
    const hash = encodeState(state);
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    try {
      await navigator.clipboard.writeText(location.href);
      ui.actionStatus.textContent = "分享連結已複製。";
    } catch {
      ui.actionStatus.textContent = "無法自動複製，請從瀏覽器網址列複製。";
    }
  }

  for (const button of ui.typeButtons) {
    button.addEventListener("click", () => {
      state.type = button.dataset.type;
      renderType();
      renderPreview();
    });
  }

  ui.vat.addEventListener("input", () => {
    state.vat = ui.vat.value.trim();
    if (autoFilledName && ui.name.value === autoFilledName) {
      state.name = "";
      ui.name.value = "";
      autoFilledName = "";
    }
    renderPreview();
    if (isValidVat(state.vat)) lookupByVat(state.vat);
    else {
      lookupController?.abort();
      ui.lookupStatus.textContent = state.vat ? "統編需為 8 碼半形數字。" : "";
    }
  });

  ui.name.addEventListener("input", () => {
    lookupController?.abort();
    autoFilledName = "";
    state.name = ui.name.value;
    renderPreview();
    clearTimeout(searchTimer);
    if (state.name.trim().length < 2) {
      hideSuggestions();
      lookupController?.abort();
      ui.lookupStatus.textContent = state.name ? "再輸入一些公司名稱即可查詢。" : "";
      return;
    }
    const query = state.name.trim();
    searchTimer = setTimeout(() => {
      if (ui.name.value.trim() === query) lookupByName(query);
    }, 350);
  });

  ui.suggestions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    const record = suggestionRecords[Number(button.dataset.index)];
    state.name = companyNameFrom(record);
    state.vat = vatFrom(record);
    autoFilledName = state.name;
    ui.name.value = state.name;
    ui.vat.value = state.vat;
    hideSuggestions();
    ui.lookupStatus.textContent = "已帶入公司名稱與統編；請確認資料正確。";
    renderPreview();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".field--suggestions")) hideSuggestions();
  });

  ui.gross.addEventListener("input", () => updateFromAmount("gross", ui.gross.value));
  ui.net.addEventListener("input", () => updateFromAmount("net", ui.net.value));
  ui.taxType.addEventListener("change", () => {
    state.tax = ui.taxType.value;
    renderAmounts();
  });
  ui.clearButton.addEventListener("click", clearAll);
  ui.shareButton.addEventListener("click", copyShareLink);

  ui.vat.value = state.vat;
  ui.name.value = state.name;
  ui.taxType.value = state.tax;
  renderDate();
  renderType();
  renderAmounts();
  if (isValidVat(state.vat) && !state.name) lookupByVat(state.vat);
}
