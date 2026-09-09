// jsPDF 4.2.1 is vendored from the official v4.2.1 tag; see vendor/LICENSE.jspdf.
const FONT = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
const WIDTH = 2480;
const HEIGHT = 3508;

function page() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器無法建立 PDF 預覽，請重新整理或更換瀏覽器。');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.setTransform(WIDTH / 210, 0, 0, HEIGHT / 297, 0, 0);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#172439';
  ctx.strokeStyle = '#526071';
  ctx.lineWidth = 0.22;
  return { canvas, ctx };
}

function text(ctx, value, x, y, width, height, field, options = {}) {
  const { size = 3.55, lineHeight = 4.4, bold = false, align = 'left' } = options;
  ctx.font = `${bold ? '600 ' : ''}${size}px ${FONT}`;
  const input = String(value ?? '').replace(/\r\n?/g, '\n');
  const overflow = () => { throw new Error(`「${field}」文字超出 PDF 欄位，請縮短內容或移除多餘換行。`); };
  if (input.length > 3000) overflow();
  const lines = [];
  for (const paragraph of input.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (ctx.measureText(char).width > width) overflow();
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
  }
  const usedHeight = (lines.length - 1) * lineHeight + size;
  if (usedHeight > height + 0.01) overflow();
  ctx.textAlign = align;
  const left = align === 'center' ? x + width / 2 : align === 'right' ? x + width : x;
  lines.forEach((line, index) => ctx.fillText(line, left, y + (height - usedHeight) / 2 + index * lineHeight));
  ctx.textAlign = 'left';
}

function box(ctx, x, y, width, height, fill = null) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#172439';
  }
  ctx.strokeRect(x, y, width, height);
}

function cell(ctx, value, x, y, width, height, field, options = {}) {
  const { padding = 1.4, fill = null, ...textOptions } = options;
  box(ctx, x, y, width, height, fill);
  text(ctx, value, x + padding, y + padding, width - padding * 2, height - padding * 2, field, textOptions);
}

function field(ctx, label, value, x, y, width, height = 11) {
  cell(ctx, `${label}：${value ?? ''}`, x, y, width, height, label);
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  if (!Number.isFinite(Number(value))) throw new Error('PDF 金額必須是有效數字。');
  return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

function date(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('PDF 日期格式無效，請重新選擇日期。');
  return `${Number(match[1]) - 1911}/${match[2]}/${match[3]}`;
}

function imageBox(ctx, image, label, x, y, width, height) {
  box(ctx, x, y, width, height);
  text(ctx, label, x + 1.5, y + 1.1, width - 3, 4.4, label, { size: 3.55 });
  if (!image) return;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error(`「${label}」圖片尚未載入或已損毀。`);
  const availableWidth = width - 4;
  const availableHeight = height - 8;
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + 6 + (availableHeight - drawHeight) / 2, drawWidth, drawHeight);
}

/** Render one A4 labor receipt. Call after document.fonts.ready and image decoding. */
export function renderLabor(data, result, images = {}) {
  const { canvas, ctx } = page();
  text(ctx, '勞務報酬單', 12, 9, 186, 9, '標題', { size: 7, bold: true, align: 'center' });
  text(ctx, '適用民國 115 年（2026 年）給付｜金額單位：新臺幣元', 12, 20, 186, 5, '年度', { align: 'center' });
  field(ctx, '給付單位', data.payerName, 12, 28, 128);
  field(ctx, '統一編號', data.payerVat, 140, 28, 58);
  field(ctx, '單位地址', data.payerAddress, 12, 39, 186);
  text(ctx, '所得人與給付資料', 12, 53, 186, 5, '段落標題', { bold: true });
  field(ctx, '姓名', data.name, 12, 60, 62);
  field(ctx, '身分證／居留證號', data.idNumber, 74, 60, 70);
  field(ctx, '國籍', data.nationality, 144, 60, 54);
  field(ctx, '稅務身分', data.residencyLabel, 12, 71, 93);
  field(ctx, '所得類別', data.categoryLabel, 105, 71, 93);
  field(ctx, '電子信箱', data.email, 12, 82, 120);
  field(ctx, '聯絡電話', data.phone, 132, 82, 66);
  field(ctx, '通訊地址', data.address, 12, 93, 186);
  field(ctx, '執行業務代號／名稱', data.businessLabel, 12, 104, 186);
  field(ctx, '勞務內容', data.description, 12, 115, 186, 17);
  field(ctx, '勞務期間起日', date(data.startDate), 12, 132, 93);
  field(ctx, '勞務期間迄日', date(data.endDate), 105, 132, 93);
  field(ctx, '實際給付日期', date(data.payDate), 12, 143, 93);
  field(ctx, '製表日期', date(data.documentDate), 105, 143, 93);
  field(ctx, '付款方式', data.paymentMethod, 12, 154, 48);
  field(ctx, '銀行', data.bank, 60, 154, 82);
  field(ctx, '分行', data.branch, 142, 154, 56);
  field(ctx, '戶名', data.accountName, 12, 165, 62);
  field(ctx, '帳號', data.accountNumber, 74, 165, 124);
  field(ctx, '健保計費／免扣資格', data.nhiLabel, 12, 176, 186, 12);
  const amounts = [['給付總額', result?.gross], ['代扣所得稅', result?.tax], ['補充保險費', result?.nhi], ['實領金額', result?.net]];
  amounts.forEach(([label, value], index) => {
    const x = 12 + index * 46.5;
    box(ctx, x, 188, 46.5, 13, '#f0f5fa');
    text(ctx, label, x + 1.5, 189, 43.5, 4, label, { bold: true, align: 'center' });
    text(ctx, money(value), x + 1.5, 194.5, 43.5, 5, label, { size: 4.1, bold: true, align: 'center' });
  });
  cell(ctx, '茲收到上述勞務報酬，所填資料及附件均屬實。\n所得人請核對給付內容及實領金額後簽章。', 12, 201, 116, 20, '收款聲明');
  imageBox(ctx, images.signature, '所得人簽章', 128, 201, 70, 20);
  imageBox(ctx, images.front, '身分證／居留證正面影本黏貼處', 12, 224, 93, 57);
  imageBox(ctx, images.back, '身分證／居留證背面影本黏貼處', 105, 224, 93, 57);
  text(ctx, data.notice || '本單供核對、簽章及留存；扣繳、補充保險費繳納與所得申報仍須另行辦理。', 12, 283, 186, 10, '注意事項');
  return canvas;
}

const COPY_LABELS = [
  '第一聯：銷貨人扣抵銷項稅額用',
  '第二聯：銷貨人記帳用',
  '第三聯：買受人扣減進項稅額用',
  '第四聯：買受人記帳用',
];

function allowanceCopy(ctx, data, rows, totals, offset, copy) {
  ctx.save();
  ctx.translate(0, offset);
  text(ctx, '營業人銷貨退回進貨退出或折讓證明單', 8, 5, 194, 8, '標題', { size: 5.2, bold: true, align: 'center' });
  text(ctx, COPY_LABELS[copy], 8, 15, 118, 5, '聯別', { bold: true });
  text(ctx, `折讓日期：${date(data.date)}`, 126, 15, 76, 5, '折讓日期', { align: 'right' });
  field(ctx, '銷貨人', data.sellerName, 8, 23, 97, 10);
  field(ctx, '買受人', data.buyerName, 105, 23, 97, 10);
  field(ctx, '統一編號', data.sellerVat, 8, 33, 97, 9);
  field(ctx, '統一編號', data.buyerVat, 105, 33, 97, 9);
  field(ctx, '地址', data.sellerAddress, 8, 42, 97, 12);
  field(ctx, '地址', data.buyerAddress, 105, 42, 97, 12);
  const columns = [
    ['原票\n聯式', 12], ['原票\n日期', 19], ['原票號碼', 24], ['退回／折讓品名', 43],
    ['數量', 14], ['未稅單價', 21], ['未稅金額', 22], ['課稅別', 20], ['營業稅額', 19],
  ];
  let x = 8;
  for (const [label, width] of columns) {
    cell(ctx, label, x, 56, width, 11, label, { padding: 0.5, size: 3.5, lineHeight: 3.85, bold: true, align: 'center', fill: '#f0f5fa' });
    x += width;
  }
  for (let index = 0; index < 7; index++) {
    const row = rows[index] || {};
    const taxLabel = { tax: '應稅', zero: '零稅率', free: '免稅' }[row.taxType] || '';
    const values = [
      { three: '三聯', two: '二聯' }[row.invoiceType] || '', date(row.invoiceDate), row.invoiceNumber || '',
      row.description || '', row.quantity ?? '', row.unitPrice ?? '', money(row.net), taxLabel, money(row.tax),
    ];
    x = 8;
    columns.forEach(([label, width], column) => {
      cell(ctx, values[column], x, 67 + index * 8.4, width, 8.4, `第 ${index + 1} 筆${label.replaceAll('\n', '')}`, {
        padding: 0.5, size: 3.5, lineHeight: 3.85, align: column === 3 ? 'left' : column >= 4 && column !== 7 ? 'right' : 'center',
      });
      x += width;
    });
  }
  cell(ctx, '合計（新臺幣元）', 8, 125.8, 133, 8, '合計標籤', { align: 'right', bold: true });
  cell(ctx, money(totals?.net), 141, 125.8, 22, 8, '未稅合計', { padding: 0.5, align: 'right', bold: true });
  cell(ctx, '稅額合計', 163, 125.8, 20, 8, '稅額合計標籤', { padding: 0.5, align: 'center' });
  cell(ctx, money(totals?.tax), 183, 125.8, 19, 8, '稅額合計', { padding: 0.5, align: 'right', bold: true });
  text(ctx, '買受人簽章：', 8, 136, 91, 7, '買受人簽章', { bold: true });
  text(ctx, '二聯式原發票：依適用規定取回收執聯。', 99, 136, 103, 7, '簽章說明');
  ctx.restore();
}

/** Two copies on each A4: one page for 2 copies; two pages for 4 copies. */
export function renderAllowance(data, rows, totals) {
  if (!Array.isArray(rows) || rows.length > 7) throw new Error('折讓明細最多 7 筆。');
  if (!['2', '4'].includes(String(data.copies))) throw new Error('請選擇二聯或四聯 PDF。');
  const pages = [];
  for (let copy = 0; copy < Number(data.copies); copy += 2) {
    const { canvas, ctx } = page();
    allowanceCopy(ctx, data, rows, totals, 0, copy);
    allowanceCopy(ctx, data, rows, totals, 148.5, copy + 1);
    ctx.setLineDash([2, 1.5]);
    ctx.beginPath();
    ctx.moveTo(8, 148.5);
    ctx.lineTo(202, 148.5);
    ctx.stroke();
    pages.push(canvas);
  }
  return pages;
}

/** Create an image-only PDF in memory without transmitting document data. */
export async function createPdfBlob(canvases, { isCurrent = () => true } = {}) {
  if (!Array.isArray(canvases) || !canvases.length) throw new Error('PDF 尚無可輸出的頁面。');
  await import('./vendor/jspdf.umd.min.js');
  if (!isCurrent()) throw new Error('資料已清除，已取消 PDF 下載。');
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) throw new Error('PDF 元件載入失敗，請重新整理後再試。');
  const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  canvases.forEach((canvas, index) => {
    if (index) pdf.addPage('a4', 'portrait');
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  });
  return pdf.output('blob');
}

/** Download the generated PDF through the browser's native save flow. */
export async function downloadPdf(canvases, filename, options = {}) {
  const blob = await createPdfBlob(canvases, options);
  if (options.isCurrent && !options.isCurrent()) throw new Error('資料已清除，已取消 PDF 下載。');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}
