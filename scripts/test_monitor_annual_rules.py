import json
import os
import unittest
from unittest.mock import patch

import monitor_annual_rules as monitor


class AnnualRulesTests(unittest.TestCase):
    def source(self, text="approved content", **extra):
        return {"id": "test", "title": "Test", "url": monitor.SOURCES[0]["url"],
                "text": text, "sha256": monitor.digest(text), **extra}

    def test_article_ignores_footer_counters_controls_and_formatting(self):
        source = {"selector": "cp", "requires": ["每月最低工資"]}
        content = "每月最低工資為29,500元。" * 5
        before = f'<section class="cp"><ul class="publish_info_top"><li>昨天</li></ul><p>{content}</p></section><footer>100</footer>'
        after = f'<section class="cp"><ul class="publish_info_top"><li>今天</li></ul><p> {content} </p><select><option>116</option></select><script>changed()</script></section><footer>101</footer>'
        self.assertEqual(monitor.article_text(before, source), monitor.article_text(after, source))
        with self.assertRaises(monitor.MonitorError):
            monitor.article_text("<main>網站維護中</main>", source)

    def test_current_catalog_discovers_new_csv_and_checks_filename_and_data(self):
        url = "https://www.ntbt.gov.tw/download/new-year"
        data = [{"file_format": 1, "url": 2}, "CSV", url]
        html = '<script id="__NUXT_DATA__">' + json.dumps(data) + '</script>'
        calls = []

        def fetcher(value):
            calls.append(value)
            return '每月薪資所得,配偶及受扶養親屬計0人(元)\r\n"90,501",2020\r\n', 'filename="116年度.csv"'

        text = monitor.salary_text(html, fetcher)
        self.assertEqual(calls, [url])
        self.assertIn("116年度.csv", text)
        self.assertIn("90,501 | 2020", text)
        with self.assertRaises(monitor.MonitorError):
            monitor.salary_text(html, lambda _: ("<html>login</html>", ""))

    def test_only_approved_public_https_urls_are_fetched(self):
        for url in ["http://www.ntbt.gov.tw/file", "https://www.ntbt.gov.tw.evil.example/",
                    "https://127.0.0.1/", "https://user:password@www.ntbt.gov.tw/", "https://www.ntbt.gov.tw:8443/"]:
            with self.assertRaises(monitor.MonitorError):
                monitor.validate_url(url)
        monitor.validate_url("https://www.ntbt.gov.tw/download/file")

    def test_failures_are_not_treated_as_unchanged(self):
        baseline = {"sources": [self.source()]}
        failed = self.source(error="http-403")
        self.assertEqual(monitor.changes_from(baseline, [failed]), [failed])
        self.assertEqual(monitor.fingerprint([failed]), monitor.fingerprint([failed]))
        self.assertNotEqual(monitor.fingerprint([failed]), monitor.fingerprint([self.source()]))

    def test_unchanged_baseline_does_not_create_issue(self):
        source = self.source()
        calls = []

        def api(*args):
            calls.append(args)
            return []

        with patch.dict(os.environ, GITHUB_REPOSITORY=monitor.REPOSITORY):
            monitor.publish({"sources": [source]}, [source], api)
        self.assertEqual(len(calls), 1)

    def test_changed_content_creates_one_issue_and_deduplicates(self):
        baseline = {"sources": [self.source()]}
        current = [self.source("new amount 30000")]
        stored = []
        comments = []
        writes = []

        def api(endpoint, method="GET", payload=None):
            if method == "GET":
                return comments if "/comments?" in endpoint else stored
            writes.append((endpoint, method, payload))
            if not stored:
                stored.append({"number": 7, "html_url": "https://github.com/example/7", "user": {"login": "github-actions[bot]"}, **payload})
            elif method == "PATCH":
                stored[0].update(payload)
            else:
                comments.append({"user": {"login": "github-actions[bot]"}, **payload})
            return stored[0]

        with patch.dict(os.environ, GITHUB_REPOSITORY=monitor.REPOSITORY):
            monitor.publish(baseline, current, api)
            monitor.publish(baseline, current, api)
            self.assertEqual(len(writes), 1)
            monitor.publish(baseline, [self.source("next amount 31000")], api)
            self.assertEqual([entry[1] for entry in writes], ["POST", "POST", "PATCH"])
            self.assertTrue(writes[2][0].endswith("/issues/7"))
            monitor.publish(baseline, [self.source("next amount 31000")], api)
            self.assertEqual(len(writes), 3)

    def test_outsider_issue_cannot_spoof_the_monitor_fingerprint(self):
        source = self.source("changed")
        outsider = {"number": 1, "title": monitor.TITLE,
                    "body": monitor.MARKER + f"<!-- fingerprint:{monitor.fingerprint([source])} -->",
                    "user": {"login": "untrusted-user"}}
        writes = []

        def api(endpoint, method="GET", payload=None):
            if method == "GET":
                return [outsider]
            writes.append((method, endpoint))
            return {"html_url": "https://github.com/example/2"}

        with patch.dict(os.environ, GITHUB_REPOSITORY=monitor.REPOSITORY):
            monitor.publish({"sources": [self.source()]}, [source], api)
        self.assertEqual(writes, [("POST", f"repos/{monitor.REPOSITORY}/issues")])

    def test_notification_failure_is_retried_without_repeating_a_sent_comment(self):
        old, current = self.source(), self.source("changed")
        baseline = {"sources": [old]}
        issue = {"number": 7, "title": monitor.TITLE, "body": monitor.issue_body(baseline, [old]),
                 "html_url": "https://github.com/example/7", "user": {"login": "github-actions[bot]"}}
        comments, failures = [], {"comment": True, "patch": True}

        def api(endpoint, method="GET", payload=None):
            if method == "GET":
                return comments if "/comments?" in endpoint else [issue]
            if method == "POST":
                if failures["comment"]:
                    failures["comment"] = False
                    raise RuntimeError("comment unavailable")
                comments.append({"user": {"login": "github-actions[bot]"}, **payload})
            else:
                if failures["patch"]:
                    failures["patch"] = False
                    raise RuntimeError("issue edit unavailable")
                issue.update(payload)
            return issue

        with patch.dict(os.environ, GITHUB_REPOSITORY=monitor.REPOSITORY):
            for _ in range(2):
                with self.assertRaises(RuntimeError):
                    monitor.publish(baseline, [current], api)
            monitor.publish(baseline, [current], api)
            monitor.publish(baseline, [current], api)
        self.assertEqual(len(comments), 1)
        self.assertIn(monitor.fingerprint([current]), issue["body"])

    def test_mirror_cannot_publish_and_source_text_cannot_ping(self):
        with patch.dict(os.environ, GITHUB_REPOSITORY="goodfaith319/hand-invoice-helper"):
            with self.assertRaises(monitor.MonitorError):
                monitor.publish({"sources": []}, [], lambda *_: self.fail("must not call API"))
        excerpt = monitor.safe_excerpt("@all ``` <script>alert(1)</script>")
        self.assertNotIn("@", excerpt)
        self.assertNotIn("```", excerpt)
        self.assertNotIn("<script>", excerpt)

    def test_checked_in_baseline_hashes_are_intact(self):
        baseline = json.loads(monitor.BASELINE.read_text())
        self.assertNotEqual(baseline["reviewed_at"], "REQUIRES HUMAN REVIEW")
        self.assertEqual([item["id"] for item in baseline["sources"]], [item["id"] for item in monitor.SOURCES])
        for source in baseline["sources"]:
            self.assertNotIn("error", source)
            self.assertEqual(source["sha256"], monitor.digest(source["text"]))


if __name__ == "__main__":
    unittest.main()
