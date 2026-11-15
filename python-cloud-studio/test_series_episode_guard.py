"""Metadata-only regression for the real Qrmzi multi-tab episode layout.

No streams, CDN requests, Supabase access, or changes to media extraction.
"""
import unittest

from alezz_fetchv_importer import pull_html
from title_cleaner import content_description, content_title
from series_episode_guard import SeriesEpisodeGuard
from bs4 import BeautifulSoup


ROOT = ("https://v2.qrmzi.monster/episode/"
        "%D9%85%D8%B3%D9%84%D8%B3%D9%84-%D8%A7%D9%84%D9%83%D8%B1%D8%A7%D9%85%D8%A9-"
        "%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1/")


def markup():
    correct = "".join(
        '<article class="postEp"><div class="block-post">'
        '<a title="مسلسل الكرامة الحلقة {i} قرمزي" '
        'href="/episode/مسلسل-الكرامة-الحلقة-{i}/">'
        '<div class="episodeNum">حلقة <span>{i}</span></div>'
        '<div class="title">مسلسل الكرامة الحلقة {i}</div>'
        '</a></div></article>'.format(i=i)
        for i in range(9, 0, -1)
    )
    unrelated = "".join(
        '<article class="postEp"><a title="مسلسل المعلم أومور الحلقة {i} قرمزي" '
        'href="/episode/مسلسل-المعلم-أومور-الحلقة-{i}/">'
        'مسلسل المعلم أومور الحلقة {i}</a></article>'.format(i=i)
        for i in range(1, 10)
    )
    new = '<a href="/episode/مسلسل-المنظمة-الحلقة-193/">مسلسل المنظمة الحلقة 193</a>'
    return f'''<html><head><title>مسلسل الكرامة الحلقة 1 - موقع قرمزي</title>
<meta property="og:site_name" content="موقع قرمزي">
<meta property="og:description" content="الحلقة الأولى على موقع قرمزي"></head>
<body><h1>مسلسل الكرامة الحلقة 1</h1>
<div class="singleSeries"><div class="info"><h2>
<a href="/series/مسلسل-الكرامة/">مسلسل الكرامة</a></h2>
<div class="series-story">تدور أحداث مسلسل الكرامة حول عائلة كارليوفا، على موقع قرمزي.</div>
</div></div>
<div class="tab-pane" id="relevants-tab">{unrelated}</div>
<div class="tab-pane" id="new-tab">{new}</div>
<div class="tab-pane" id="episodes-tab">{correct}</div></body></html>'''


class Client:
    def __init__(self, source): self.source=source; self.calls=[]
    def get(self, url):
        self.calls.append(url)
        return url, "text/html", self.source


class SameSeriesRegression(unittest.TestCase):
    def test_episode_page_only_adds_own_nine_episodes(self):
        client=Client(markup())
        cat=pull_html(ROOT,client,kind="auto",max_pages=25)
        self.assertEqual(cat.kind,"series")
        self.assertEqual(cat.title,"مسلسل الكرامة")
        self.assertNotIn("قرمزي",cat.title)
        self.assertNotIn("قرمزي",cat.description)
        self.assertIn("كارليوفا",cat.description)
        self.assertEqual(len(cat.episodes),9)
        self.assertEqual([e.number for e in cat.episodes],list(range(1,10)))
        self.assertTrue(all("الكرامة" in e.page_url for e in cat.episodes))
        self.assertTrue(all(e.title == "الحلقة "+str(e.number) for e in cat.episodes))
        self.assertFalse(any("المعلم" in e.page_url or "المنظمة" in e.page_url for e in cat.episodes))
        self.assertEqual(client.calls,[ROOT])

    def test_mixed_related_links_are_rejected_even_without_tabs(self):
        soup = BeautifulSoup(markup().replace('id="relevants-tab"','id="other"')
                                  .replace('id="episodes-tab"','id="other2"'), "html.parser")
        guard = SeriesEpisodeGuard(ROOT, "مسلسل الكرامة الحلقة 1",soup,"موقع قرمزي")
        self.assertFalse(guard.matches("https://v2.qrmzi.monster/episode/مسلسل-المعلم-أومور-الحلقة-1/",
                                       "مسلسل المعلم أومور الحلقة 1"))
        self.assertFalse(guard.matches("https://other.example/episode/مسلسل-الكرامة-الحلقة-2/",
                                       "مسلسل الكرامة الحلقة 2"))
        self.assertTrue(guard.matches("https://v2.qrmzi.monster/episode/مسلسل-الكرامة-الحلقة-2/",
                                      "مسلسل الكرامة الحلقة 2"))

    def test_no_unrelated_resume_checkpoint_episodes(self):
        old = dict(season=1,number=2,title="الحلقة 2",
                   page_url="https://v2.qrmzi.monster/episode/مسلسل-المعلم-أومور-الحلقة-2/")
        good = dict(season=1,number=5,title="الحلقة 5",
                   page_url="https://v2.qrmzi.monster/episode/مسلسل-الكرامة-الحلقة-5/")
        cat=pull_html(ROOT,Client(markup()),kind="series",
                      resume_progress={"episodes":[old,good],"seen_pages":[],"queued":[]})
        self.assertEqual(len(cat.episodes),9)
        self.assertTrue(all("الكرامة" in x.page_url for x in cat.episodes))

    def test_generic_episode_pages_restricted_to_own_episode_tab(self):
        soup=BeautifulSoup(markup(), "html.parser")
        guard=SeriesEpisodeGuard(ROOT, "مسلسل الكرامة الحلقة 1", soup)
        url="https://v2.qrmzi.monster/episode-3/"
        self.assertFalse(guard.matches(url,"الحلقة 3",episode_group=False))
        self.assertTrue(guard.matches(url,"الحلقة 3",episode_group=True))
        self.assertFalse(guard.matches(url,"مسلسل الحسد الحلقة 3",episode_group=True))

    def test_movie_title_and_description_drop_site_name(self):
        self.assertEqual(content_title("فيلم لا يعقل قرمزي",ROOT,"موقع قرمزي"),"فيلم لا يعقل")
        self.assertEqual(content_title("فيلم لا يعقل - موقع قرمزي",ROOT),"فيلم لا يعقل")
        description=content_description("قصة مشوّقة في هذا الفيلم على موقع قرمزي، شاهد الآن",ROOT,"موقع قرمزي")
        self.assertIn("قصة مشوّقة",description)
        self.assertNotIn("قرمزي",description)

    def test_other_show_names_in_structured_episode_data_rejected(self):
        guard=SeriesEpisodeGuard(ROOT,"مسلسل الكرامة الحلقة 1",BeautifulSoup(markup(),"html.parser"))
        valid="https://v2.qrmzi.monster/episode/مسلسل-الكرامة-الحلقة-6/"
        self.assertFalse(guard.matches(valid,"الحلقة 6",episode_group=True,
              data={"episodeNumber":6,"partOfSeries":{"name":"مسلسل آخر"}}))
        self.assertTrue(guard.matches(valid,"الحلقة 6",episode_group=True,
              data={"episodeNumber":6,"partOfSeries":{"name":"مسلسل الكرامة"}}))


if __name__ == "__main__":
    unittest.main()
