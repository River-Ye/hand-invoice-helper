import { calculateLabor, reverseLabor, MAX_AMOUNT } from './calculations.mjs';
import { getLaborRules, LATEST_LABOR_YEAR } from './labor-rules.mjs';
import { COUNTRIES } from './countries.mjs';
import { renderLabor, downloadPdf } from './pdf.mjs';
import { todayISO, validateDate, bindCompanyLookup } from './tool-common.mjs';

const $ = id => document.getElementById(id);
const form = $('labor-form');
const images = {};
const imageErrors = {};
const imageRevisions = { front: 0, back: 0, signature: 0 };
const pendingImages = new Set();
let previewTimer;
let downloadRevision = 0;
const imageLabels = { front: '身分證明正面', back: '身分證明反面', signature: '所得人簽名' };
const businessTypes = [
  ['10', '律師'], ['11', '會計師'], ['12', '精算師'], ['13', '地政士'], ['14', '記帳士'],
  ['15', '仲裁人'], ['16', '民間公證人'], ['17', '不動產估價師'], ['18', '代辦國有財產申請'],
  ['19', '記帳及報稅代理人'], ['20', '技師'], ['21', '建築師'], ['22', '公共安全檢查人員'],
  ['23', '未具資格辦理工商登記'], ['24', '工匠－工資收入'], ['25', '工匠－工料收入'], ['26', '引水人'],
  ['27', '法律扶助／義務辯護'], ['28', '美術工藝家－工資'], ['29', '美術工藝家－工料'],
  ['30', '內科醫師'], ['31', '外科醫師'], ['32', '小兒科醫師'], ['33', '婦產科醫師'],
  ['34', '眼科醫師'], ['35', '耳鼻喉科醫師'], ['36', '牙科醫師'], ['37', '精神科醫師'],
  ['38', '骨科醫師'], ['39', '其他科別醫師'], ['41', '藥師'], ['42', '醫事檢驗師'],
  ['45', '營養師'], ['47', '獸醫師'], ['48', '皮膚科醫師'], ['49', '家庭醫學科醫師'],
  ['50', '中醫師'], ['53', '物理治療師'], ['54', '職能治療師'], ['55', '心理師'],
  ['56', '牙體技術師'], ['61', '書畫家、版畫家'], ['62', '命理卜卦'], ['70', '表演人'],
  ['71', '保險經紀人'], ['72', '節目製作人'], ['73', '公益彩券立即型經銷商'], ['76', '一般經紀人'],
  ['90', '其他'], ['91', '商標代理人'], ['92', '程式設計師'], ['93', '專利師及專利代理人'],
  ['94', '未具律師資格辦理訴訟'], ['95', '未具建築師資格辦理設計'], ['96', '未具地政士資格辦理登記'],
  ['98', '稿費／講演鐘點－非自行出版'], ['99', '稿費／版稅－自行出版'],
];
for (const [code, label] of businessTypes) $('business').add(new Option(`${code} ${label}`, code));
for (const [code, label] of COUNTRIES) $('nationality').add(new Option(`${label}（${code}）`, code));

const nhiQualifications = {
  unknown: ['尚未確認健保投保資格', '請先向所得人及健保署確認資格；確認前不計算補充保費與實領金額，也不進行實領反算。'],
  general: ['一般計費資格', '依本次給付金額與所得類別計算。稅務非居住者或外籍人士，只要有健保投保資格仍須依法判斷扣費。'],
  none: ['已確認無健保投保資格', '由所得人主動告知，給付單位須向健保署確認無投保資格；僅未持健保卡、未投保或具有外籍身分，不足以認定免扣。'],
  lowIncome: ['第 5 類被保險人（低收入戶）', '須確認本人為第 5 類被保險人，並取得鄉、鎮、市、區公所核發，在所得給付期間有效的低收入戶證明；不是中低收入戶。'],
  union: ['無一定雇主或自營作業而在工會投保的本人', '限依法以無一定雇主或自營作業身分參加職業工會健保的本人（第 2 類第 1 目），其執行業務收入適用；須有給付期間有效的在保或繳費證明，眷屬不適用。'],
  professional: ['自行執業專技人員本人（第 1 類第 5 目）', '本人須以執行業務所得為健保投保金額，取得投保單位出具的在保證明；具有執業資格但未以此身分投保、或只是眷屬，不適用。'],
  category2: ['第 2 類被保險人本人', '兼職薪資免扣限第 2 類被保險人本人；取得投保單位出具的在保或繳費證明，眷屬不適用。'],
  vulnerable: ['法定弱勢資格（未達最低工資免扣）', '限中低收入戶、中低收入老人、接受生活扶助的弱勢兒少、領身心障礙生活補助者、特殊境遇家庭受扶助者，或健保法第 100 條經濟困難者；須有給付期間有效的主管機關證明。單次未達給付年度最低工資免扣，達門檻仍計收。'],
};
const nhiByCategory = {
  '9A': ['general', 'none', 'lowIncome', 'union', 'professional', 'vulnerable'],
  '9B': ['general', 'none', 'lowIncome', 'union', 'professional', 'vulnerable'],
  '50': ['general', 'none', 'lowIncome', 'category2'],
  '92': ['general'],
};
const selectedText = id => $(id).selectedOptions[0]?.textContent || '';
const value = id => $(id).value.trim();
const fieldMap = {
  payerName: 'payer-name', payerVat: 'payer-vat', payerAddress: 'payer-address', name: 'recipient-name',
  nationality: 'nationality', idNumber: 'id-number', email: 'email', phone: 'phone', address: 'address',
  description: 'description', startDate: 'start-date', endDate: 'end-date', payDate: 'pay-date', documentDate: 'document-date',
  paymentMethod: 'payment-method', bank: 'bank', branch: 'branch', accountName: 'account-name', accountNumber: 'account-number',
};

function syncChoices(resetNhi = false) {
  const category = value('category');
  const nhiStatus = resetNhi ? 'unknown' : value('nhi-status');
  const allowed = ['unknown', ...nhiByCategory[category]];
  $('nhi-status').replaceChildren(...allowed.map(key => new Option(nhiQualifications[key][0], key)));
  $('nhi-status').value = allowed.includes(nhiStatus) ? nhiStatus : (value('residency') === 'nonresident' || nhiStatus ? 'unknown' : 'general');
  $('nhi-status').disabled = category === '92';
  $('nhi-help').textContent = category === '92' ? '一般個人其他所得不列入個人補充保費的六類計費項目。' : nhiQualifications[value('nhi-status')][1];
  $('business-field').hidden = category !== '9A';
  $('salary-field').hidden = category !== '50';
  $('single-payment-field').hidden = category !== '50' || value('residency') !== 'nonresident';
  $('amount-label').textContent = value('amount-mode') === 'gross' ? '給付總額（新臺幣元）' : '希望實領金額（新臺幣元）';
  $('nonresident-notice').hidden = value('residency') !== 'nonresident';
}

function readCurrent() {
  for (const input of form.querySelectorAll('input, textarea')) {
    if (!input.validity.valid) {
      const label = input.labels[0]?.textContent || '欄位';
      throw new Error(`${label}格式不正確，請修正後再下載。`);
    }
  }
  if (value('payer-vat') && !/^\d{8}$/.test(value('payer-vat'))) throw new Error('統一編號請填 8 碼半形數字。');
  for (const id of ['start-date', 'end-date', 'pay-date', 'document-date']) validateDate(value(id), $(id).labels[0].textContent);
  if (value('start-date') && value('end-date') && value('start-date') > value('end-date')) throw new Error('勞務結束日期不得早於開始日期。');
  if (Object.keys(imageErrors).length) throw new Error(Object.values(imageErrors)[0]);
  if (pendingImages.size) throw new Error('附件正在處理，完成後即可下載。');
  const data = Object.fromEntries(Object.entries(fieldMap).map(([key, id]) => [key, value(id)]));
  data.nationality = COUNTRIES.find(([code]) => code === data.nationality)?.[1] || '';
  const year = data.payDate ? Number(data.payDate.slice(0, 4)) : null;
  const rules = year ? getLaborRules(year) : null;
  data.yearLabel = year ? `民國 ${year - 1911} 年（${year}）${rules ? '' : '・規則待確認，不試算'}` : '給付年度未填，不試算';
  $('year-label').textContent = `LABOR PAYMENT · ${data.yearLabel}`;
  $('preview-year').textContent = data.yearLabel;
  data.residencyLabel = selectedText('residency');
  data.categoryLabel = selectedText('category');
  data.businessLabel = value('category') === '9A' && value('business') ? selectedText('business') : '';
  data.nhiLabel = value('category') === '92' ? '其他所得不計費' : selectedText('nhi-status');
  data.notice = '';
  const rawAmount = value('amount');
  if (rawAmount && (!/^\d+$/.test(rawAmount) || Number(rawAmount) > MAX_AMOUNT)) throw new Error('金額請輸入 0 至 999,999,999 的半形整數。');
  let result = null;
  if (rawAmount) {
    if (!data.payDate) data.notice = '實際給付日期未填；金額未試算，請核算後填寫。';
    else if (!rules) data.notice = `${year - 1911} 年規則尚未確認啟用；不沿用其他年度試算，仍可下載部分填寫表單。`;
    else if (value('category') === '50' && value('salary-scope') !== 'part-time') data.notice = '尚未確認兼職且非本單位投保；金額須另行核算。';
    else if (value('category') === '50' && value('residency') === 'nonresident' && value('single-payment') !== 'yes') data.notice = '非居住者當月多次或未確認給付次數；金額須另行核算。';
    else if (value('category') !== '92' && value('nhi-status') === 'unknown' && value('amount-mode') === 'net') data.notice = '健保資格尚未確認，無法反算；確認前補充保費與實領金額維持空白。';
    else {
      const options = { year, category: value('category'), residency: value('residency'), nhiStatus: value('nhi-status'), singlePayment: value('single-payment') === 'yes' };
      result = value('amount-mode') === 'gross'
        ? calculateLabor({ ...options, gross: Number(rawAmount) })
        : reverseLabor({ ...options, net: Number(rawAmount) });
      if (!result) throw new Error('指定實領金額在本工具範圍內無精確解，請調整金額或另行核算。');
      if (result.nhi === null) data.notice = '健保資格尚未確認；先列出給付總額與所得稅，補充保費與實領金額待確認後計算。';
    }
  }
  return { data, result };
}

function setSummary(result) {
  const list = document.createElement('dl');
  list.className = 'summary-grid';
  for (const [key, label] of [['gross', '給付總額'], ['tax', '代扣所得稅'], ['nhi', '補充保費'], ['net', '實領金額']]) {
    const group = document.createElement('div');
    group.className = 'summary-item';
    const term = document.createElement('dt');
    term.textContent = label;
    const amount = document.createElement('dd');
    amount.textContent = result?.[key] != null ? `${result[key].toLocaleString('zh-TW')} 元` : '未計算';
    group.append(term, amount);
    list.append(group);
  }
  $('calculation-summary').replaceChildren(list);
}

function renderCurrent() {
  clearTimeout(previewTimer);
  $('form-error').textContent = '';
  $('document-preview').replaceChildren();
  $('calculation-notice').hidden = true;
  $('calculation-notice').textContent = '';
  setSummary(null);
  try {
    const { data, result } = readCurrent();
    const canvas = renderLabor(data, result, images);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '勞務報酬單 A4 預覽；表單欄位與上方文字列出完整資料與試算結果。');
    $('document-preview').replaceChildren(canvas);
    setSummary(result);
    $('calculation-notice').textContent = data.notice;
    $('calculation-notice').hidden = !data.notice;
    return canvas;
  } catch (error) {
    $('form-error').textContent = error.message || '無法產生預覽，請確認輸入。';
    return null;
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  $('action-status').textContent = '';
  $('document-preview').replaceChildren();
  setSummary(null);
  previewTimer = setTimeout(renderCurrent, 100);
}

const cancelCompanyLookup = bindCompanyLookup({ vat: $('payer-vat'), name: $('payer-name'), address: $('payer-address'), status: $('lookup-status'), onChange: schedulePreview });
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', schedulePreview);
for (const id of ['category', 'residency', 'nhi-status', 'amount-mode']) $(id).addEventListener('change', () => { syncChoices(id === 'residency' && value('residency') === 'nonresident'); schedulePreview(); });

function removeImage(key) {
  imageRevisions[key]++;
  pendingImages.delete(key);
  delete images[key];
  delete imageErrors[key];
  $(`${key}-file`).value = '';
  $(`${key}-preview`).replaceChildren();
  $(`${key}-status`).textContent = '';
}

function showImage(key, source) {
  const thumbnail = document.createElement('canvas');
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const ratio = Math.min(1, 420 / sourceWidth, 180 / sourceHeight);
  thumbnail.width = Math.max(1, Math.round(sourceWidth * ratio));
  thumbnail.height = Math.max(1, Math.round(sourceHeight * ratio));
  thumbnail.getContext('2d').drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
  thumbnail.setAttribute('role', 'img');
  thumbnail.setAttribute('aria-label', `${imageLabels[key]}已載入`);
  $(`${key}-preview`).replaceChildren(thumbnail);
  $(`${key}-status`).textContent = '已載入，僅保留於目前頁面。';
}

async function loadImage(key) {
  const file = $(`${key}-file`).files[0];
  removeImage(key);
  if (!file) { renderCurrent(); return; }
  const revision = imageRevisions[key];
  pendingImages.add(key);
  $(`${key}-status`).textContent = '正在讀取圖片…';
  let url;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('僅接受 PNG、JPEG 或 WebP 圖片。');
    if (file.size > 10 * 1024 * 1024 || file.size === 0) throw new Error('圖片須大於 0 且不超過 10 MB。');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (revision !== imageRevisions[key]) return;
    const isPNG = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
    const isJPEG = header[0] === 255 && header[1] === 216 && header[2] === 255;
    const isWebP = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    if (!(isPNG || isJPEG || isWebP)) throw new Error('檔案內容不是有效的 PNG、JPEG 或 WebP 圖片。');
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('無法讀取圖片，請上傳有效的 PNG、JPEG 或 WebP 檔案。'); }
    if (revision !== imageRevisions[key]) return;
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 20_000_000) throw new Error('圖片超過 2,000 萬畫素或尺寸無效。');
    images[key] = img;
    showImage(key, img);
  } catch (error) {
    if (revision !== imageRevisions[key]) return;
    imageErrors[key] = `${imageLabels[key]}：${error.message || '無法解碼，請改用有效圖片。'} 請重新上傳或移除。`;
    $(`${key}-status`).textContent = imageErrors[key];
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (revision === imageRevisions[key]) { pendingImages.delete(key); renderCurrent(); }
  }
}
for (const key of Object.keys(imageLabels)) $(`${key}-file`).addEventListener('change', () => loadImage(key));
for (const button of document.querySelectorAll('[data-remove-image]')) button.addEventListener('click', () => { removeImage(button.dataset.removeImage); renderCurrent(); });

const dialog = $('signature-dialog');
const pad = $('signature-pad');
const context = pad.getContext('2d');
let activePointer = null;
let padDrawn = false;
function clearPad() {
  context.clearRect(0, 0, pad.width, pad.height);
  context.beginPath();
  activePointer = null;
  padDrawn = false;
  $('signature-pad-status').textContent = '';
}
$('open-signature').addEventListener('click', () => { clearPad(); dialog.showModal(); });
$('close-signature').addEventListener('click', () => dialog.close());
$('clear-signature').addEventListener('click', clearPad);
dialog.addEventListener('close', clearPad);
function padPoint(event) {
  const bounds = pad.getBoundingClientRect();
  return [(event.clientX - bounds.left) * pad.width / bounds.width, (event.clientY - bounds.top) * pad.height / bounds.height];
}
pad.addEventListener('pointerdown', event => {
  if (activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  activePointer = event.pointerId;
  pad.setPointerCapture(event.pointerId);
  const [x, y] = padPoint(event);
  context.lineWidth = 6;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#172a3b';
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + 0.1, y + 0.1);
  context.stroke();
  padDrawn = true;
});
pad.addEventListener('pointermove', event => {
  if (activePointer !== event.pointerId) return;
  context.lineTo(...padPoint(event));
  context.stroke();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(type, event => { if (activePointer === event.pointerId) activePointer = null; });
$('apply-signature').addEventListener('click', () => {
  if (!padDrawn) { $('signature-pad-status').textContent = '請先簽名，或關閉後改用上傳圖片。'; return; }
  const signature = document.createElement('canvas');
  signature.width = pad.width;
  signature.height = pad.height;
  signature.getContext('2d').drawImage(pad, 0, 0);
  removeImage('signature');
  images.signature = signature;
  showImage('signature', signature);
  dialog.close();
  renderCurrent();
});

function clearAll(render = true) {
  downloadRevision++;
  clearTimeout(previewTimer);
  cancelCompanyLookup();
  form.reset();
  for (const key of Object.keys(imageLabels)) removeImage(key);
  for (const id of ['pay-date', 'document-date']) $(id).value = '';
  if (dialog.open) dialog.close();
  clearPad();
  $('lookup-status').textContent = '';
  $('action-status').textContent = '';
  syncChoices();
  if (render) renderCurrent();
  else {
    $('document-preview').replaceChildren();
    $('calculation-notice').textContent = '';
    $('calculation-notice').hidden = true;
    $('form-error').textContent = '';
    setSummary(null);
  }
}
$('clear-button').addEventListener('click', () => { clearAll(); $('action-status').textContent = '已清除全部填寫資料、附件與簽名。'; });
$('download-button').addEventListener('click', async () => {
  const button = $('download-button');
  if (button.disabled) return;
  const canvas = renderCurrent();
  if (!canvas) { $('form-error').scrollIntoView({ block: 'center' }); return; }
  const revision = ++downloadRevision;
  button.disabled = true;
  $('action-status').textContent = '正在製作 PDF…';
  try {
    const year = value('pay-date') ? Number(value('pay-date').slice(0, 4)) - 1911 : null;
    await downloadPdf([canvas], `勞務報酬單${year !== null ? `-${year}年` : ''}.pdf`, { isCurrent: () => revision === downloadRevision });
    if (revision === downloadRevision) $('action-status').textContent = '已送出 PDF 下載，請確認瀏覽器下載項目；尚未完成任何申報或繳納。';
  } catch (error) {
    if (revision === downloadRevision) $('action-status').textContent = `PDF 產生失敗：${error.message || '請重試。'}`;
  } finally { button.disabled = false; }
});
window.addEventListener('pagehide', () => clearAll(false));
window.addEventListener('pageshow', event => { if (event.persisted) clearAll(); });
syncChoices();
$('latest-year').textContent = `${LATEST_LABOR_YEAR - 1911} 年（${LATEST_LABOR_YEAR}）`;
const latestRules = getLaborRules(LATEST_LABOR_YEAR);
const money = amount => amount.toLocaleString('zh-TW');
const rate = points => `${points / 100}%`;
$('reference-year').textContent = LATEST_LABOR_YEAR - 1911;
$('reference-resident-business').textContent = `稅額按 ${rate(latestRules.residentProfessionalRate)} 計算、元以下捨去；算出的稅額不超過 ${money(latestRules.residentTaxExemption)} 元免扣，整數給付自 ${money(Math.ceil((latestRules.residentTaxExemption + 1) * 10_000 / latestRules.residentProfessionalRate))} 元起扣稅。一般健保資格者，單次達 ${money(latestRules.nhiThreshold)} 元另扣 ${rate(latestRules.nhiRate)}。`;
$('reference-resident-salary').textContent = `給付達 ${money(latestRules.salaryThreshold)} 元扣 ${rate(latestRules.residentSalaryRate)}；一般健保資格者單次給付達 ${money(latestRules.minimumWage)} 元另扣 ${rate(latestRules.nhiRate)}。`;
$('reference-nonresident').textContent = `9A 按 ${rate(latestRules.nonresidentProfessionalRate)}；9B 單次不超過 ${money(latestRules.nonresidentRoyaltyExemption)} 元免扣，超過則全額按 ${rate(latestRules.nonresidentProfessionalRate)}。50 須以當月薪資判斷：不超過 ${money(latestRules.nonresidentSalaryThreshold)} 元按 ${rate(latestRules.nonresidentSalaryLowRate)}，超過按 ${rate(latestRules.nonresidentSalaryHighRate)}；本工具僅計算確認當月一次給付的情形。`;
$('reference-nhi-cap').textContent = `元以下四捨五入，單次計費基礎上限 ${money(latestRules.nhiCap)} 元。`;
$('pay-date').value = todayISO();
$('document-date').value = todayISO();
await document.fonts.ready;
renderCurrent();
