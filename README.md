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
python3 -m unittest discover -s scripts -p 'test_*.py'
git diff --check
```

測試涵蓋發票換算、勞報扣繳／健保門檻與反算、折讓小數四捨五入、日期、舊連結相容及公司查詢競態。發布前另以桌面／手機 Chrome 核對表單、下載 PDF 與實際頁面排版。

## 計算與輸出邊界

- 勞報依實際給付日期選用 `labor-rules.mjs` 已確認的年度規則，目前啟用民國 115 年（2026 年），涵蓋 9A、9B、50、92。國籍採國稅局代碼表下拉選單，與稅務居住身分、健保資格分開判斷。50 限兼職且非給付單位投保情境；非居住者薪資還須確認當月僅一次給付。
- 未填給付日期、年度尚未確認或情境不在範圍時，不沿用其他年度試算，金額留白，仍可下載部分填寫表單。畫面、說明、檔名與 PDF 年度隨給付日期更新；未公布的 116 年數值不預填。
- 非居住者必須明確確認健保資格：已確認無投保資格才免扣；有資格者依所得種類及免扣證明判斷。尚未確認時，給付總額與所得稅可正算，補充保費及實領留白，停止實領反算；92 其他所得不計補充保費。
- 勞報預覽加粗提醒非居住者申報期限，並附官方稅款與補充保費繳款書連結。10 日期限的起算、例外及 92 所得說明見站內教學；產生表單不代表完成申報或繳納。
- 勞報金額為 0 至 999,999,999 元整數。折讓數量及退款金額最多 6 位小數，退款填**整列含稅總額，不再乘以數量**。先四捨五入退款至元，再依課稅別拆分：應稅稅額為退款 × 5 / 105 四捨五入，未稅為退款減稅額；零稅率與免稅的稅額為零。各列加總不得超過 999,999,999 元。
- 折讓 PDF 未稅單價依數量反推至最多 6 位小數；未知數量或精度不足以回算同一未稅金額時，單價留空供核對，金額與稅額維持正確。數量 2、退款 1,050 元的應稅列，未稅 1,000、稅額 50、合計 1,050，單價 500。
- 折讓所有明細沿用明細 1 的原發票聯式，買方填有統編就固定三聯式。原二聯式輸出二聯／1 張 A4，原三聯式輸出四聯／2 張 A4，聯數自動決定。
- 空白／部分填寫可下載；空白金額不當作零，明細未填完整時合計留白。無效輸入或文字超出 PDF 欄位會提示修正，避免靜默改值或裁字。
- PDF 為高解析影像，供列印、核對與簽章，文字無法直接選取。折讓 PDF 適用紙本發票；電子發票仍須透過原電子系統辦理開立及上傳。

## 年度規則監測與核准

`.github/workflows/annual-rules.yml` 每週二臺北時間 09:17 檢查官方來源，也可在 Actions →「年度規則檢查」手動執行。僅 `River-Ye/hand-invoice-helper` 執行，客戶鏡像不重複通知；不存取表單個資。

監測財政部扣繳率標準、政府開放資料最新薪資扣繳 CSV、勞動部最低工資歷程、健保署共同補充費率／單次上限，以及全國法規資料庫現行健保扣取辦法（門檻、免扣、證明及期限）。只比對已確認基準的正文與資料，來源變動或讀取失敗時建立／更新同一則「年度規則待確認」Issue，附官方連結與差異；相同狀態不重複通知。法規資料庫與來源網站可能延後整理，監測不等於即時法規服務。

**自動監測，人工確認後啟用新年度。** 程式不會把網站文字自動轉成稅率，也不會以舊年度規則推測新年度。確認流程：

1. 核對官方公告、生效日及本工具適用情境，在 `labor-rules.mjs` 新增或修正年度，保留仍需使用的已確認年度，補上門檻與反算測試。
2. 執行 `python3 scripts/monitor_annual_rules.py --snapshot /tmp/annual-rules-candidate.json` 產生候選基準。人工檢視完整來源及差異，填入 `reviewed_at` 日期，再替換 `scripts/annual-rules-baseline.json`。不得直接核准無關或未生效的變動。
3. 執行全部測試與表單／PDF 驗收，將同一 commit 同步發布兩站，確認後人工關閉 Issue。日後不同變動會重新開啟同一則 Issue。

唯讀檢查：`python3 scripts/monitor_annual_rules.py`；正式 Issue 寫入由上述 GitHub workflow 處理。監測只信任帶有本工具標記且由 `github-actions[bot]` 建立的 Issue，避免同名外部 Issue 干擾。

GitHub 公開 repo **連續 60 天無活動會自動停用排程**，排程也可能延遲；停用時須在 Actions 重新啟用。維護者應定期查看最近成功執行時間。[GitHub 排程限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

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

文件更新：2026-09-12。
