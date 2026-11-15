"""Regression tests for the exact-work episode discovery contract."""
from __future__ import annotations

import unittest
from urllib.parse import quote

from alezz_fetchv_importer import pull_html
from title_cleaner import content_description, content_title


HOST = "https://v2.qrmzi.monster"


def episode_url(show, number):
    return f"{HOST}/episode/{quote('مسلسل-' + show + '-الحلقة-' + str(number))}/"


class StubClient:
    def __init__(self, url, markup):
        self.url, self.markup = url, markup

    def get(self, requested):
        if requested.rstrip("/") != self.url.rstrip("/"):
            raise AssertionError(f"Unexpected cross-work crawl: {requested}")
        return self.url, "text/html; charset=utf-8", self.markup


def document(title, body, *, description="حكاية درامية جميلة على موقع قرمزي"):
    return (
        "<!DOCTYPE html><html lang='ar'><head>"
        f"<title>{title} - موقع قرمزي اون لاين</title>"
        "<meta property='og:site_name' content='موقع قرمزي'>"
        f"<meta name='description' content='{description}'>"
        "</head><body>"
        f"<h1>{title}</h1>"
        "<div class='singleSeries'><div class='info'><h2>"
        f"<a href='/series/{quote('مسلسل-الكرامة')}/'>مسلسل الكرامة</a>"
        "</h2></div></div>"
        f"{body}</body></html>"
    )


class SeriesScopeTests(unittest.TestCase):
    def test_realistic_episode_panel_excludes_other_shows(self):
        source = episode_url("الكرامة", 1)
        own = "".join(
            f"<a href='{episode_url('الكرامة', number)}'>الحلقة {number}</a>"
            for number in range(1, 10)
        )
        foreign = (
            f"<a href='{episode_url('المؤسس-اورهان', 23)}'>الحلقة 23</a>"
            f"<a href='{episode_url('المشردون', 10)}'>مسلسل المشردون الحلقة 10</a>"
        )
        page = document(
            "مسلسل الكرامة الحلقة 1",
            f"<div id='episodes-tab'>{own}{foreign}</div>"
            f"<div id='relevants-tab'>{foreign}</div>"
            f"<div id='new-tab'>{foreign}</div>",
        )
        result = pull_html(source, StubClient(source, page), kind="auto")
        self.assertEqual(result.kind, "series")
        self.assertEqual(result.title, "مسلسل الكرامة")
        self.assertEqual([e.number for e in result.episodes], list(range(1, 10)))
        self.assertTrue(all("الكرامة" in e.page_url for e in result.episodes))
        self.assertNotIn("قرمزي", result.description)
        self.assertNotIn("qrmzi", result.title.casefold())

    def test_full_page_links_never_authorize_generic_or_other_series(self):
        source = episode_url("الكرامة", 1)
        own = f"<a href='{episode_url('الكرامة', 2)}'>الحلقة 2</a>"
        unrelated = f"<a href='{episode_url('المؤسس-اورهان', 23)}'>الحلقة 23</a>"
        generic = "<a href='/episode/episode-17/'>الحلقة 17</a>"
        page = document("مسلسل الكرامة الحلقة 1", own + unrelated + generic)
        result = pull_html(source, StubClient(source, page), kind="series")
        self.assertEqual([(e.season, e.number) for e in result.episodes], [(1, 2)])

    def test_source_slug_overrules_misleading_page_heading(self):
        source = episode_url("الكرامة", 1)
        own = f"<a href='{episode_url('الكرامة', 2)}'>الحلقة 2</a>"
        page = document("مسلسل المشردون الحلقة 1", f"<div id='episodes-tab'>{own}</div>")
        result = pull_html(source, StubClient(source, page), kind="series")
        self.assertEqual(result.title, "مسلسل الكرامة")
        self.assertEqual([e.number for e in result.episodes], [2])

    def test_url_without_series_prefix_can_still_identify_the_work(self):
        name = "هذا-البحر-سوف-يفيض"
        source = f"{HOST}/episode/{name}-الحلقة-1/"
        own = f"<a href='{HOST}/episode/{name}-الحلقة-2/'>الحلقة 2</a>"
        other = f"<a href='{HOST}/episode/مسلسل-الكرامة-الحلقة-3/'>الحلقة 3</a>"
        markup = (
            "<html><head><title>هذا البحر سوف يفيض الحلقة 1 - موقع قرمزي</title>"
            "</head><body><div id='episodes-tab'>"
            f"{own}{other}</div></body></html>"
        )
        result = pull_html(source, StubClient(source, markup), kind="series")
        self.assertEqual(result.title, "هذا البحر سوف يفيض")
        self.assertEqual([e.number for e in result.episodes], [2])

    def test_no_site_branding_in_titles_or_descriptions(self):
        source = episode_url("الكرامة", 1)
        self.assertEqual(
            content_title("مسلسل الكرامة الحلقة 1 - موقع قرمزي اون لاين", source, "موقع قرمزي"),
            "مسلسل الكرامة الحلقة 1",
        )
        description = content_description(
            "حكاية الكرامة من موقع قرمزي TV، تابع الحلقات على qrmzi.tv",
            source, "موقع قرمزي",
        )
        self.assertIn("حكاية الكرامة", description)
        self.assertNotIn("قرمزي", description)
        self.assertNotIn("qrmzi", description.casefold())


if __name__ == "__main__":
    unittest.main()
