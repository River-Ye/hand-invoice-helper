#!/usr/bin/env python3
"""Compare public official sources with a reviewed baseline; never change tax rules.

Default: read-only comparison. --publish: update the one approved GitHub Issue.
After human review, --snapshot PATH writes a candidate baseline for code review.
Uses only Python's standard library, curl, and (for publishing) GitHub CLI.
"""

import argparse
import csv
import difflib
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import unquote, urljoin, urlsplit

REPOSITORY = "River-Ye/hand-invoice-helper"
TITLE = "年度規則待確認"
MARKER = "<!-- annual-rules-monitor -->"
BASELINE = Path(__file__).with_name("annual-rules-baseline.json")
HOSTS = {"law-out.mof.gov.tw", "data.gov.tw", "www.ntbt.gov.tw",
         "www.mol.gov.tw", "cloudicweb.nhi.gov.tw", "law.moj.gov.tw"}
SOURCES = [
    {"id": "withholding", "title": "財政部：各類所得扣繳率標準",
     "url": "https://law-out.mof.gov.tw/LawContent.aspx?id=FL005962",
     "selector": "law-reg-content", "requires": ["執行業務", "扣繳"]},
    {"id": "salary", "title": "政府資料開放平臺：薪資所得扣繳稅額表及最新 CSV",
     "url": "https://data.gov.tw/dataset/25627"},
    {"id": "minimum-wage", "title": "勞動部：歷年最低工資調整",
     "url": "https://www.mol.gov.tw/1607/28162/28166/28180/70460/76761/76833/post",
     "selector": "cp", "requires": ["每月最低工資", "實施"]},
    {"id": "nhi-rate", "title": "健保署：補充保費共同費率及個人單次上限",
     "url": "https://cloudicweb.nhi.gov.tw/esrv/trialbill/countinsurance.aspx",
     "selector": "Panel1", "requires": ["補充保險費率", "費基"]},
    {"id": "nhi-deduction", "title": "全國法規資料庫：全民健康保險扣取及繳納補充保險費辦法",
     "url": "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060027",
     "selector": "law-reg-content", "requires": ["補充保險費", "扣費義務人", "證明文件"]},
]


class MonitorError(Exception):
    """Stable failure code, so repeated failures do not send repeated notices."""


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in HOSTS
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise MonitorError("unapproved-source-url")


def fetch(url):
    # Check every redirect; never send GitHub credentials to an official source.
    for _ in range(6):
        validate_url(url)
        with tempfile.NamedTemporaryFile() as header_file:
            result = subprocess.run([
                "curl", "--disable", "--silent", "--show-error", "--retry", "2",
                "--retry-delay", "2", "--connect-timeout", "10", "--max-time", "30",
                "--max-filesize", "2000000", "--user-agent", "Mozilla/5.0",
                "--dump-header", header_file.name, "--write-out", "\n%{http_code}", url,
            ], capture_output=True, timeout=100)
            headers = Path(header_file.name).read_text(errors="replace")
        if result.returncode:
            raise MonitorError(f"fetch-failed-curl-{result.returncode}")
        body, code = result.stdout.rsplit(b"\n", 1)
        if code in (b"301", b"302", b"303", b"307", b"308"):
            location = re.findall(r"^location:\s*(.+)$", headers, re.I | re.M)
            if not location:
                raise MonitorError("redirect-without-location")
            url = urljoin(url, location[-1].strip())
            continue
        if code != b"200":
            raise MonitorError("http-" + code.decode("ascii", errors="replace"))
        return body.decode("utf-8-sig"), headers
    raise MonitorError("too-many-redirects")


class MainText(HTMLParser):
    """Extract the known article only, excluding counters, dates and controls."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"}
    SKIP = {"script", "style", "select", "button", "nav", "footer"}

    def __init__(self, selector):
        super().__init__(convert_charrefs=True)
        self.selector, self.stack, self.parts = selector, [], []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        classes = attrs.get("class", "").split()
        inside = (self.stack[-1][1] if self.stack else False) or self.selector in classes or attrs.get("id") == self.selector
        skip = (self.stack[-1][2] if self.stack else False) or tag in self.SKIP or any(c.startswith("publish_info") for c in classes)
        if tag not in self.VOID:
            self.stack.append((tag, inside, skip))
        if inside and not skip and tag in {"p", "li", "div", "tr", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if self.stack and self.stack[-1][1] and not self.stack[-1][2]:
            self.parts.append(re.sub(r"\s+", "", data))

    def text(self):
        text = re.sub(r"([。；])", r"\1\n", "".join(self.parts))
        return "\n".join(line for line in text.splitlines() if line)


def article_text(html, source):
    parser = MainText(source["selector"])
    parser.feed(html)
    text = parser.text()
    if len(text) < 50 or not all(word in text for word in source["requires"]):
        raise MonitorError("article-missing-or-layout-changed")
    return text


def salary_text(html, fetcher):
    match = re.search(r'<script[^>]+id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise MonitorError("salary-catalog-layout-changed")
    data = json.loads(match.group(1))
    urls = set()
    for item in data:
        if isinstance(item, dict) and {"file_format", "url"} <= item.keys():
            if data[item["file_format"]] == "CSV":
                url = data[item["url"]]
                validate_url(url)
                urls.add(url)
    if not 1 <= len(urls) <= 5:
        raise MonitorError("salary-csv-link-missing-or-ambiguous")
    parts = []
    for url in sorted(urls):
        content, headers = fetcher(url)
        rows = list(csv.reader(io.StringIO(content)))
        if len(rows) < 2 or rows[0][0] != "每月薪資所得" or any(len(row) != len(rows[0]) for row in rows):
            raise MonitorError("salary-csv-invalid")
        filename = re.findall(r'filename="?([^"\r\n;]+)', headers, re.I)
        parts += [url, "檔名：" + unquote(filename[-1] if filename else "未提供"),
                  *[" | ".join(cell.strip() for cell in row) for row in rows]]
    return "\n".join(parts)


def collect(fetcher=fetch):
    results = []
    for source in SOURCES:
        result = dict(source)
        try:
            html, _ = fetcher(source["url"])
            result["text"] = salary_text(html, fetcher) if source["id"] == "salary" else article_text(html, source)
            result["sha256"] = digest(result["text"])
        except (MonitorError, subprocess.TimeoutExpired, UnicodeError, ValueError, KeyError, IndexError, TypeError) as error:
            result["error"] = str(error) if isinstance(error, MonitorError) else type(error).__name__
        results.append(result)
    return results


def changes_from(baseline, current):
    old = {source["id"]: source for source in baseline["sources"]}
    return [source for source in current if source.get("error") or source["sha256"] != old.get(source["id"], {}).get("sha256")]


def fingerprint(current):
    return digest(json.dumps([(source["id"], source.get("error") or source["sha256"]) for source in current]))


def safe_excerpt(text):
    # Treat official text as untrusted data: no mentions or executable Markdown.
    return text.replace("@", "＠").replace("`", "ˋ").replace("<", "＜").replace(">", "＞")


def issue_body(baseline, current):
    changes = changes_from(baseline, current)
    old = {source["id"]: source for source in baseline["sources"]}
    lines = [MARKER, f"<!-- fingerprint:{fingerprint(current)} -->", "# 年度規則待確認", "",
             "官方來源有更新或無法讀取，請人工核對適用年度、生效日及工具計算規則。" if changes else "官方來源已恢復，與已確認基準一致。", "",
             "此監測不會自動修改或啟用稅率。確認後請更新年度規則、回歸測試與監測基準，再同步發布兩站。", ""]
    for source in changes:
        lines += [f"## {source['title']}", "", f"[官方來源]({source['url']})", ""]
        if source.get("error"):
            lines += [f"讀取失敗：`{source['error']}`。請檢查來源連線及正文格式，不能視為規則無變動。", ""]
        else:
            diff = "\n".join(difflib.unified_diff(old.get(source["id"], {}).get("text", "").splitlines(), source["text"].splitlines(), fromfile="已確認基準", tofile="目前官方內容", n=2))
            lines += ["```diff", safe_excerpt(diff[:6000]), "```", ""]
            if len(diff) > 6000:
                lines += ["差異較長，以上顯示前 6,000 字；請開啟官方來源完整核對。", ""]
    lines += ["每週只在來源狀態改變時更新這一則 Issue；相同變動或失敗不重複通知。",
              "公開 repo 連續 60 天無活動時 GitHub 可能停用排程，請至 Actions 重新啟用。"]
    return "\n".join(lines)


def github(endpoint, method="GET", payload=None):
    command = ["gh", "api", endpoint, "--method", method]
    if payload is not None:
        command += ["--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=True, timeout=60)
    return json.loads(result.stdout)


def publish(baseline, current, api=github):
    if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise MonitorError("publishing-is-restricted-to-source-repository")
    issue = None
    page = 1
    while True:
        batch = api(f"repos/{REPOSITORY}/issues?state=all&per_page=100&page={page}")
        matches = [entry for entry in batch if "pull_request" not in entry
                   and entry.get("user", {}).get("login") == "github-actions[bot]"
                   and MARKER in (entry.get("body") or "")]
        if matches:
            issue = min(matches, key=lambda entry: entry["number"])
            break
        if len(batch) < 100:
            break
        page += 1
    marker = f"<!-- fingerprint:{fingerprint(current)} -->"
    if issue and marker in (issue.get("body") or ""):
        return "unchanged; no notification"
    if not issue and not changes_from(baseline, current):
        return "baseline matches; no issue needed"
    body = issue_body(baseline, current)
    if not issue:
        created = api(f"repos/{REPOSITORY}/issues", "POST", {"title": TITLE, "body": body})
        return created["html_url"]
    endpoint = f"repos/{REPOSITORY}/issues/{issue['number']}"
    # A sent comment is the retry checkpoint if the following issue edit fails.
    page = 1
    while True:
        comments = api(f"{endpoint}/comments?per_page=100&page={page}")
        if any(comment.get("user", {}).get("login") == "github-actions[bot]"
               and marker in (comment.get("body") or "") for comment in comments):
            break
        if len(comments) < 100:
            api(endpoint + "/comments", "POST", {"body": "官方來源狀態有新變動，請查看 Issue 內更新的差異與來源。\n\n" + marker})
            break
        page += 1
    # Update the fingerprint only after notifying; transient failures remain retryable.
    api(endpoint, "PATCH", {"title": TITLE, "body": body, "state": "open"})
    return issue["html_url"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--publish", action="store_true")
    modes.add_argument("--snapshot", metavar="PATH", help="write candidate baseline for human review; never enable new rules")
    args = parser.parse_args()
    current = collect()
    if args.snapshot:
        if any(source.get("error") for source in current):
            raise SystemExit("Cannot snapshot failed sources: " + json.dumps({source["id"]: source["error"] for source in current if source.get("error")}, ensure_ascii=False))
        Path(args.snapshot).write_text(json.dumps({"reviewed_at": "REQUIRES HUMAN REVIEW", "sources": current}, ensure_ascii=False, indent=2) + "\n")
        return
    baseline = json.loads(BASELINE.read_text())
    changes = changes_from(baseline, current)
    print(json.dumps({"changed_sources": [source["id"] for source in changes],
                      "failures": {source["id"]: source["error"] for source in current if source.get("error")},
                      "fingerprint": fingerprint(current)}, ensure_ascii=False))
    if args.publish:
        print(publish(baseline, current))
    if any(source.get("error") for source in current) and not args.publish:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
