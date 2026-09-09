# 宸浥稅務小幫手

純靜態、手機適用的繁體中文表單工具，無後端、無建置步驟。

- [工具首頁](https://goodfaith319.github.io/hand-invoice-helper/)：三工具入口。
- `invoice.html`：手開發票二／三聯式填寫示意、含稅／未稅換算及分享連結。舊根網址的 `#v=1` 分享連結會導向此頁並保留資料。
- `labor.html`：勞務報酬試算、實領反算、證件圖片與手寫簽名，下載一張 A4 PDF。
- `allowance.html`：紙本折讓證明單，最多 7 筆明細；每頁上下各一聯，二聯一張 A4、四聯兩張 A4。
- `guide.html`：操作說明、規則適用範圍及官方依據。

## 本機啟動與測試

需要 Python 3 及 Node.js 20 以上；不需安裝 npm 套件。在 repo 根目錄執行：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

瀏覽 `http://127.0.0.1:8000/`。ES module 須透過 HTTP 載入，請勿直接開啟本機 HTML 檔。

```sh
node --test *.test.mjs
git diff --check
```

測試涵蓋發票換算、勞報扣繳／健保門檻與反算、折讓小數四捨五入、日期、舊連結相容及公司查詢競態。發布前另以桌面／手機 Chrome 核對表單、下載 PDF 與實際頁面排版。

## 計算與輸出邊界

- 勞報規則限民國 115 年（2026 年）實際給付，涵蓋 9A、9B、50、92 及境內／非境內居住者；國籍與稅務居住身分分開填寫。50 限兼職且非給付單位投保情境，非居住者薪資還須確認當月僅一次給付。
- 未填實際給付日期、年度不符或情境不在試算範圍時，顯示原因並保留金額空白，可下載後另行核算。健保免扣須依具體資格及證明判斷；完整條件見頁面說明。
- 勞報金額為 0 至 999,999,999 元整數；折讓數量及未稅單價最多 6 位小數。折讓每列先將數量乘單價四捨五入至元，再將該列應稅金額的 5% 四捨五入；合計加總各列，含稅總額不得超過 999,999,999 元。
- 空白／部分填寫可下載；空白金額不當作零，明細未填完整時合計留白。無效輸入或文字超出 PDF 欄位會提示修正，避免靜默改值或裁字。
- PDF 為高解析影像，供列印、核對與簽章，文字無法直接選取。折讓 PDF 適用紙本發票；電子發票仍須透過原電子系統辦理開立及上傳。
- 年度規則集中於 `calculations.mjs`；更新時須同步調整 `labor.mjs` 的適用判斷、頁面說明、PDF 年度文字及邊界測試。產生表單不代表完成申報或繳納。

## 資料與依賴

勞報及折讓的文字、附件、簽名只留在目前頁面記憶體；清除或離開頁面會移除，不使用 localStorage、sessionStorage、Cookie 或伺服器保存草稿。已下載至電腦的 PDF 由使用者自行保管。

公司查詢是外部連線例外：勞報／折讓輸入完整 8 碼統編時，會向 `company.g0v.ronny.tw` 查詢；原手開發票工具也會送出輸入的統編或公司名稱進行查詢。查詢失敗可手填。手開發票的「複製分享連結」另會把公司名稱、統編及金額放入網址片段，請只分享給需要的人。

PDF 使用同源 `vendor/jspdf.umd.min.js`，固定為 [jsPDF 4.2.1](https://github.com/parallax/jsPDF/releases/tag/v4.2.1)，MIT 授權全文保留於 `vendor/LICENSE.jspdf`。執行時不向 CDN 載入腳本；Canvas、圖片處理及 PDF 產生皆在瀏覽器內完成。

## 同步發布 GitHub Pages

原始碼 repo 為 `River-Ye/hand-invoice-helper`，客戶站 repo 為 `goodfaith319/hand-invoice-helper`。兩者 Pages 均使用 **main 分支根目錄 `/`**，沒有額外 build workflow。

1. 執行測試、`git diff --check`，完成桌面／手機操作與 PDF 驗收，再提交版本。
2. 重新取得兩個 repo 的 main，確認可 fast-forward；若任一遠端有新增修改，先檢視及整合，不使用 force push。
3. 將同一個已驗收 commit 推到兩個 repo：

   ```sh
   git push https://github.com/River-Ye/hand-invoice-helper.git HEAD:main
   git push https://github.com/goodfaith319/hand-invoice-helper.git HEAD:main
   ```

4. 以 `gh api repos/OWNER/hand-invoice-helper/pages/builds/latest` 分別確認 build 為 `built` 且 commit 等於本次發布 SHA。
5. 核對兩站 HTML、CSS、JS、logo、vendored PDF 腳本皆 HTTP 200 且雜湊與該 commit 相同，再於公開網址驗證舊分享連結、三工具切換及 PDF 下載。

公開站點：[客戶站](https://goodfaith319.github.io/hand-invoice-helper/) · [原始 repo 站點](https://river-ye.github.io/hand-invoice-helper/)

文件更新：2026-09-09。
