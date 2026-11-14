"""Offline tests: no external website or Supabase account required."""
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import alezz_fetchv_importer as mod

HTML = '''<html><head><script type="application/ld+json">
{"@context":"https://schema.org", "@graph":[{"@type":"TVSeries","name":"مسلسل اختبار - موقع قرمزي","description":"دراما رومانسية تركية", "image":"/poster.jpg", "datePublished":"2026-04-01", "genre":["دراما", "رومانسي"]},
{"@type":"TVEpisode","name":"الحلقة 1", "url":"/episode-1", "episodeNumber":1, "partOfSeason":{"seasonNumber":1}}]}
</script><meta property="og:image" content="/poster.jpg"></head>
<body><a href="/episode-1">الحلقة 1</a><a href="/episode-2">الحلقة 2</a><a href="/season-2">الموسم 2</a></body></html>'''
SEASON = '<html><body><a href="/s02e01">الموسم 2 الحلقة 1</a></body></html>'

class FakeClient:
    def get(self, url):
        if "season-2" in url:return url,"text/html",SEASON
        return url,"text/html",HTML
    def media_verified(self, url):return (url.endswith(".m3u8"),"OK")

class FakeDB:
    def __init__(self):self.rows={"aseel_series":[],"aseel_movies":[],"aseel_seasons":[],"aseel_episodes":[]}
    def single(self,table,query):
        for row in self.rows[table]:
            if all(str(row.get(k))==v[3:] for k,v in query.items() if k not in ("select","limit") and v.startswith("eq.")):
                return row
        return None
    def insert(self,table,payload):
        x={"id":f"{table}-{len(self.rows[table])+1}",**payload}
        self.rows[table].append(x)
        return x
    def patch(self,table,id,payload):
        for row in self.rows[table]:
            if row["id"]==id:
                row.update(payload);return row
        raise ValueError("Unknown id")

class Tests(unittest.TestCase):
    def test_lazy_work_cover_uses_full_image_and_preserves_redirect_sources(self):
        original='https://old.example.org/movies/test/'
        final='https://new.example.org/movies/test/'
        html='''<html><h1>فيلم اختبار</h1><div class="cover"><img class="lazy"
          src="/placeholder.gif" data-src="/full-cover-1290x1000.jpg"></div>
          <div class="related"><img src="/unrelated.jpg"></div></html>'''
        client=type('Document',(),{'get':lambda self,url:(final,'text/html',html)})()
        cat=mod.pull_html(original,client)
        self.assertEqual(cat.poster_url,'https://new.example.org/full-cover-1290x1000.jpg')
        self.assertEqual(cat.source_pages,[original,final])

    def test_parse_series_and_metadata(self):
        cat=mod.pull_html("https://public.example.com/series",FakeClient())
        self.assertEqual(cat.kind,"series")
        self.assertEqual(cat.year,2026)
        self.assertIn("drama",cat.genres)
        self.assertEqual(cat.poster_url,"https://public.example.com/poster.jpg")
        self.assertEqual([(e.season,e.number) for e in cat.episodes],[(1,1),(1,2),(2,1)])


    def test_series_automatically_follows_episode_index_without_related_titles(self):
        from urllib.parse import quote
        root='https://www.qrmzi.tv/series/مسلسل-الكرامة/'
        first='https://www.qrmzi.tv/episode/مسلسل-الكرامة-الحلقة-1/'
        related='https://www.qrmzi.tv/episode/مسلسل-حب-أعمى-الحلقة-5/'
        listing=f"""<html><head><title>مسلسل الكرامة</title></head><body>
            <h1>مسلسل الكرامة</h1>
            <a href="{first}">الحلقة 1</a>
            <aside><a href="{related}">مسلسل حب أعمى الحلقة 5</a></aside>
            </body></html>"""
        episodes=''.join(
            f'<a href="https://www.qrmzi.tv/episode/مسلسل-الكرامة-الحلقة-{i}/">مسلسل الكرامة الحلقة {i}</a>'
            for i in range(1,10))
        detail=f'<html><h1>مسلسل الكرامة الحلقة 1</h1>{episodes}<a href="{related}">مسلسل حب أعمى الحلقة 5</a></html>'
        class Source:
            def __init__(self):self.visited=[]
            def get(self,url):
                self.visited.append(url)
                if url.rstrip('/')==root.rstrip('/'):return url,'text/html',listing
                if url.rstrip('/')==first.rstrip('/'):return url,'text/html',detail
                raise ValueError('Unexpected other series crawl')
        client=Source()
        result=mod.pull_html(root,client,kind='series',max_pages=3)
        self.assertEqual([(ep.season,ep.number) for ep in result.episodes],[(1,n) for n in range(1,10)])
        self.assertIn(first,client.visited)
        self.assertNotIn(related,client.visited)
        self.assertTrue(all('الكرامة' in ep.page_url for ep in result.episodes))
        self.assertTrue(all('حب-أعمى' not in ep.page_url for ep in result.episodes))

    def test_static_player_links_and_escaped_scripts(self):
        soup = mod.BeautifulSoup('''
          <html><body>
            <video data-src="https://cdn.example.org/main.m3u8"></video>
            <script>const player = {"src": "https:\\/\\/cdn.example.org/episode.mp4"};</script>
            <iframe src="https://cdn.example.org/embedded.m3u8"></iframe>
          </body></html>
        ''', "html.parser")
        links = mod.find_static_media(soup, "https://public.example.org/episode")
        self.assertIn("https://cdn.example.org/main.m3u8", links)
        self.assertIn("https://cdn.example.org/embedded.m3u8", links)
        self.assertIn("https://cdn.example.org/episode.mp4", links)
        self.assertTrue(all(link.startswith("https://") for link in links))

    def test_fetchv_links(self):
        cat=mod.pull_html("https://public.example.com/series",FakeClient())
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"links.txt"
            p.write_text("S01E01|https://media.example.com/video.m3u8\nS01E02|https://media.example.com/two.mp4\n")
            self.assertEqual(mod.load_fetchv_links(p,cat),2)
            self.assertTrue(cat.episodes[0].media_url.endswith("m3u8"))

    def test_saves_drafts_even_without_video(self):
        cat=mod.pull_html("https://public.example.com/series",FakeClient())
        db=FakeDB()
        first=mod.store(cat,db,publish=False,rights=False)
        self.assertEqual(first["episodes_new"],3)
        self.assertEqual(first["metadata_only"],3)
        self.assertEqual(db.rows["aseel_episodes"][0]["rights_status"],"pending")
        second=mod.store(cat,db,publish=False,rights=False)
        self.assertEqual(second["episodes_updated"],3)
        self.assertEqual(len(db.rows["aseel_series"]),1)
        self.assertEqual(len(db.rows["aseel_episodes"]),3)

    def test_ok_ru_embed_is_saved_as_unverified_source_with_rights_guard(self):
        source='https://ok.ru/videoembed/16115671698037'
        cat=mod.Catalogue('movie','Approved test','https://source.example.org/film/1',media_url=source)
        db=FakeDB()
        result=mod.store(cat,db,publish=False,rights=False)
        self.assertEqual(result['embed_reachable'],1)
        self.assertEqual(db.rows['aseel_movies'][0]['stream_url'],source)
        self.assertEqual(db.rows['aseel_movies'][0]['link_health_status'],'suspect')
        self.assertEqual(db.rows['aseel_movies'][0]['status'],'draft')
        with self.assertRaises(ValueError):
            mod.store(cat,db,publish=True,rights=False)

    def test_rights_requirement_for_public_publish(self):
        cat=mod.pull_html("https://public.example.com/series",FakeClient())
        db=FakeDB()
        with self.assertRaises(ValueError):mod.store(cat,db,publish=True,rights=False)
        cat.episodes[0].media_url="https://cdn.example.com/e01.m3u8"
        cat.episodes[0].verified=True
        result=mod.store(cat,db,publish=True,rights=True,license_holder="Owner",license_reference="contract-2026")
        self.assertEqual(result["media_verified"],1)
        self.assertEqual(db.rows["aseel_episodes"][0]["stream_url"],cat.episodes[0].media_url)
        self.assertEqual(db.rows["aseel_series"][0]["rights_status"],"approved")

    def test_auto_category(self):
        cats=[{"id":"drama-id","name_ar":"دراما"},{"id":"action-id","name_ar":"أكشن"}]
        self.assertEqual(mod.category_for_genres(cats,["drama","romance"]),"drama-id")
        self.assertEqual(mod.category_for_genres(cats,["romance"]),"")

    def test_ssrf_rejection(self):
        for url in ("http://example.com", "https://localhost/", "https://10.1.2.3/a.m3u8", "https://a.internal/x"):
            with self.assertRaises(ValueError,msg=url):mod.public_url(url)

if __name__=="__main__":unittest.main()
