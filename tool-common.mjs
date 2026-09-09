export function todayISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function validateDate(value, label = '日期') {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}格式不正確。`);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期。`);
  return true;
}

export function legacyInvoiceURL(search, hash) {
  if (hash.length > 1800 || new URLSearchParams(hash.slice(1)).get('v') !== '1') return null;
  return `./invoice.html${search}${hash}`;
}

export async function fetchCompanyData(url, signal) {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('公司查詢暫時無法使用。');
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || !('data' in payload)) throw new Error('公司資料格式不符。');
  return payload.data;
}

export function bindCompanyLookup({ vat, name, address, status, onChange }) {
  let controller;
  let timer;
  let revision = 0;
  let automaticName = '';
  let automaticAddress = '';
  const cancel = () => {
    revision++;
    controller?.abort();
    clearTimeout(timer);
    automaticName = automaticAddress = '';
  };
  const changed = () => {
    if (automaticName && name.value === automaticName) name.value = '';
    if (automaticAddress && address?.value === automaticAddress) address.value = '';
    cancel();
    const id = vat.value.trim();
    status.textContent = id && !/^\d{8}$/.test(id) ? '統編需為 8 碼半形數字；也可手動填寫公司資料。' : '';
    if (!/^\d{8}$/.test(id)) return;
    const expected = revision;
    const oldName = name.value;
    const oldAddress = address?.value;
    timer = setTimeout(async () => {
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 8000);
      status.textContent = '正在查詢公司資料…';
      try {
        const record = await fetchCompanyData(`https://company.g0v.ronny.tw/api/show/${id}`, requestController.signal);
        if (revision !== expected || vat.value.trim() !== id) return;
        if (!record || Array.isArray(record)) throw new Error('查無資料');
        const first = (...values) => values.flat().find(value => typeof value === 'string' && value.trim())?.trim() || '';
        const company = first(record['公司名稱'], record['商業名稱'], record['名稱'], record['財政部']?.['營業人名稱'], record.name);
        const location = first(record['公司所在地'], record['商業所在地'], record['所在地'], record['營業地址'], record['地址'], record['公司地址'], record['財政部']?.['營業地址'], record.address);
        if (!company) throw new Error('查無名稱');
        if (!oldName && name.value === oldName) name.value = automaticName = company.slice(0, 120);
        if (address && !oldAddress && address.value === oldAddress && location) address.value = automaticAddress = location.slice(0, 180);
        status.textContent = '已查詢公司資料，請確認名稱及地址；未帶入的欄位可直接手填。';
        onChange?.();
      } catch {
        if (revision === expected) status.textContent = '查不到公司資料，請直接手動填寫。';
      } finally { clearTimeout(timeout); }
    }, 350);
  };
  vat.addEventListener('input', changed);
  return cancel;
}
