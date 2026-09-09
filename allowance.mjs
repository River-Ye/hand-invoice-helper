import { calculateAllowanceRow, MAX_AMOUNT } from './calculations.mjs';
import { todayISO, validateDate, bindCompanyLookup } from './tool-common.mjs';
import { renderAllowance, downloadPdf } from './pdf.mjs';

const $ = (id) => document.getElementById(id);
const form = $('allowance-form');
const rowContainer = $('rows');
const error = $('form-error');
const preview = $('document-preview');
const money = (value) => value === null ? '—' : new Intl.NumberFormat('zh-TW').format(value);
let rowId = 0;
let timer;
let exporting = false;
let resetRevision = 0;

function addRow() {
  if (rowContainer.children.length >= 7) return;
  const row = $('row-template').content.firstElementChild.cloneNode(true);
  const id = ++rowId;
  for (const input of row.querySelectorAll('[data-key]')) {
    input.id = `row-${id}-${input.dataset.key}`;
    input.name = input.id;
    row.querySelector(`[data-for="${input.dataset.key}"]`).htmlFor = input.id;
  }
  rowContainer.append(row);
  labelRows();
}

function labelRows() {
  [...rowContainer.children].forEach((row, index) => {
    row.querySelector('h3').textContent = `明細 ${index + 1}`;
    row.querySelector('[data-remove]').setAttribute('aria-label', `刪除明細 ${index + 1}`);
  });
  $('add-row').disabled = rowContainer.children.length === 7;
  $('row-limit').textContent = `已填 ${rowContainer.children.length} / 7 列`;
}

function readForm() {
  for (const input of form.querySelectorAll('input')) {
    if (input.validity.badInput || (input.type === 'date' && input.value && !input.validity.valid)) {
      throw new Error(`${input.labels?.[0]?.textContent || '欄位'}格式不正確，請修正或清空。`);
    }
  }
  const value = (id) => $(id).value.trim();
  for (const prefix of ['seller', 'buyer']) {
    if (value(`${prefix}-vat`) && !/^\d{8}$/.test(value(`${prefix}-vat`))) throw new Error(`${prefix === 'seller' ? '賣方' : '買方'}統編需為 8 碼半形數字。`);
  }
  const data = {
    sellerName: value('seller-name'), sellerVat: value('seller-vat'), sellerAddress: value('seller-address'),
    buyerName: value('buyer-name'), buyerVat: value('buyer-vat'), buyerAddress: value('buyer-address'),
    date: value('allowance-date'), copies: value('copies'),
  };
  validateDate(data.date, '折讓日期');
  let net = 0;
  let tax = 0;
  let hasAmount = false;
  let incomplete = false;
  const rows = [...rowContainer.children].map((row, index) => {
    const fields = Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value.trim()]));
    validateDate(fields.invoiceDate, `明細 ${index + 1} 的原發票日期`);
    if (data.date && fields.invoiceDate > data.date) throw new Error(`明細 ${index + 1} 的原發票日期不可晚於折讓日期。`);
    if (fields.invoiceNumber && !/^[A-Za-z]{2}\d{8}$/.test(fields.invoiceNumber)) throw new Error(`明細 ${index + 1} 的發票號碼需為 2 碼英文字母及 8 碼數字。`);
    fields.invoiceNumber = fields.invoiceNumber.toUpperCase();
    let result;
    try { result = calculateAllowanceRow(fields); }
    catch (cause) { throw new Error(`明細 ${index + 1}：${cause.message}`); }
    const active = ['invoiceDate', 'invoiceNumber', 'description', 'quantity', 'unitPrice'].some(key => fields[key]);
    if (active && !result) incomplete = true;
    if (result) { net += result.net; tax += result.tax; hasAmount = true; }
    row.querySelector('[data-net]').textContent = money(result?.net ?? null);
    row.querySelector('[data-tax]').textContent = money(result?.tax ?? null);
    return { ...fields, net: result?.net ?? null, tax: result?.tax ?? null };
  });
  if (net + tax > MAX_AMOUNT) throw new Error('整張折讓單含稅合計不可超過 999,999,999 元。');
  const totals = hasAmount && !incomplete ? { net, tax } : { net: null, tax: null };
  return { data, rows, totals, incomplete };
}

function updatePreview() {
  clearTimeout(timer);
  error.textContent = '';
  try {
    const current = readForm();
    const canvases = renderAllowance(current.data, current.rows, current.totals);
    for (const [index, canvas] of canvases.entries()) {
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `折讓證明單第 ${index + 1} 頁；各列資料見左側表單，合計見下方。`);
    }
    preview.replaceChildren(...canvases);
    $('net-total').textContent = money(current.totals.net);
    $('tax-total').textContent = money(current.totals.tax);
    if (current.incomplete) error.textContent = '尚有明細未填數量或單價，合計留白供另行核算；仍可下載部分填寫的表單。';
    $('download-pdf').disabled = exporting;
    return canvases;
  } catch (cause) {
    preview.replaceChildren();
    $('net-total').textContent = '—';
    $('tax-total').textContent = '—';
    for (const item of rowContainer.querySelectorAll('[data-net], [data-tax]')) item.textContent = '—';
    error.textContent = cause.message;
    $('download-pdf').disabled = true;
    return null;
  }
}

const cancelLookups = ['seller', 'buyer'].map(prefix => bindCompanyLookup({
  vat: $(`${prefix}-vat`), name: $(`${prefix}-name`), address: $(`${prefix}-address`), status: $(`${prefix}-status`), onChange: updatePreview,
}));

function clearAll(render = true) {
  resetRevision++;
  clearTimeout(timer);
  cancelLookups.forEach(cancel => cancel());
  form.reset();
  $('allowance-date').value = '';
  rowContainer.replaceChildren();
  addRow();
  error.textContent = '';
  for (const id of ['download-status', 'seller-status', 'buyer-status']) $(id).textContent = '';
  preview.replaceChildren();
  $('net-total').textContent = '—';
  $('tax-total').textContent = '—';
  if (render) updatePreview();
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', () => {
  clearTimeout(timer);
  $('download-status').textContent = '';
  timer = setTimeout(updatePreview, 120);
});
form.addEventListener('change', updatePreview);
$('add-row').addEventListener('click', () => { addRow(); updatePreview(); rowContainer.lastElementChild.querySelector('select').focus(); });
rowContainer.addEventListener('click', event => {
  const remove = event.target.closest('[data-remove]');
  if (!remove) return;
  remove.closest('.allowance-row').remove();
  if (!rowContainer.children.length) addRow();
  labelRows();
  updatePreview();
  $('add-row').focus();
});
$('clear-form').addEventListener('click', () => { clearAll(); $('seller-vat').focus(); });
$('download-pdf').addEventListener('click', async () => {
  if (exporting) return;
  const revision = resetRevision;
  const canvases = updatePreview();
  if (!canvases) return;
  exporting = true;
  $('download-pdf').disabled = true;
  $('clear-form').disabled = true;
  $('download-status').textContent = '正在產生 PDF…';
  try {
    await downloadPdf(canvases, `折讓證明單-${$('allowance-date').value || '空白'}.pdf`, { isCurrent: () => revision === resetRevision });
    if (revision === resetRevision) $('download-status').textContent = '已送出 PDF 下載，請查看下載項目並核對後簽章。';
  } catch (cause) {
    if (revision === resetRevision) $('download-status').textContent = `PDF 無法產生：${cause.message}`;
  } finally {
    exporting = false;
    $('clear-form').disabled = false;
    updatePreview();
  }
});
window.addEventListener('pagehide', () => clearAll(false));
window.addEventListener('pageshow', event => { if (event.persisted) clearAll(); });
addRow();
$('allowance-date').value = todayISO();
await document.fonts.ready;
updatePreview();
