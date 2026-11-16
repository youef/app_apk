"""Offline regression coverage for ten-way episode sync and rights-safe auto publishing."""
from concurrent.futures import ThreadPoolExecutor
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from alezz_fetchv_importer import Catalogue, Episode
from auto_sync import AutoSync
from test_auto_sync import FakeDB, FakeResolver, NOW, SERIES, uid


class PerEpisodeResolver:
    def __init__(self, stats, fails=()):
        self.stats=stats
        self.fails=set(fails)

    def extract(self, pages, force_browser=False):
        if len(pages)!=1:
            raise AssertionError("episode extraction must never mix other episode pages")
        number=int(pages[0].rstrip('/').split('/')[-1])
        if number in self.fails:
            raise ValueError("One episode source temporarily unavailable")
        with self.stats['lock']:
            self.stats['active']+=1
            self.stats['maximum']=max(self.stats['maximum'],self.stats['active'])
        try:
            time.sleep(.015)
        finally:
            with self.stats['lock']:
                self.stats['active']-=1
        return [dict(url=f'https://cdn.example.org/episode-{number}.mp4',
                     kind='direct',label=f'Player {number}',page_url=pages[0])],[]

    def check(self, sources):
        return [dict(item,verified=True,error='') for item in sources]


class ParallelEpisodeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db=FakeDB()
        self.stats=dict(lock=threading.Lock(),active=0,maximum=0)
        self.worker=AutoSync(self.temp.name,db_factory=lambda:self.db,
            resolver_factory=lambda:PerEpisodeResolver(self.stats),clock=lambda:NOW)
        self.worker.db=self.db
        self.assertEqual(self.worker.episode_workers,10)

    def parent(self,status='published',rights='approved',licence='licensed-series-123'):
        row=dict(id=uid('ten-way-series'),title_ar='Authorized series',
                 source_page_url=SERIES,stream_url='',stream_variants=[],
                 status=status,rights_status=rights,license_reference=licence)
        self.db.seed('aseel_series',row)
        self.worker.queue.ingest('aseel_series',row)
        return row

    def discover(self, parent, count=14):
        episodes=[Episode(1,i,f'الحلقة {i}',f'https://source.example.org/episode/{i}')
                  for i in range(1,count+1)]
        cat=Catalogue(kind='series',title='Authorized series',url=SERIES,episodes=episodes)
        with patch('auto_sync.pull_html',return_value=cat),patch('auto_sync.hydrate_episode_metadata',return_value=0):
            self.worker.discover_series(self.job(parent))
        return list(self.db.rows['aseel_episodes'].values())

    def job(self, row):
        with self.worker.queue.db() as conn:
            found=conn.execute('select * from auto_jobs where table_name=? and target_id=?',
                ('aseel_series',row['id'])).fetchone()
        return dict(found)

    def test_ten_concurrent_saves_publish_licensed_episodes_by_identity(self):
        parent=self.parent()
        episodes=self.discover(parent,14)
        self.assertEqual(len(episodes),14)
        self.assertGreaterEqual(self.stats['maximum'],2)
        self.assertLessEqual(self.stats['maximum'],10)
        self.assertEqual(len({(ep['season_id'],ep['number']) for ep in episodes}),14)
        for ep in episodes:
            self.assertEqual(ep['stream_url'],f'https://cdn.example.org/episode-{ep["number"]}.mp4')
            self.assertEqual(ep['status'],'published')
            self.assertEqual(ep['rights_status'],'approved')
            self.assertEqual(ep['license_reference'],'licensed-series-123')
            self.assertEqual(ep['link_health_status'],'healthy')
        self.assertEqual(len(self.db.history),29)  # Parent page, plus each episode's page and video.

    def test_unlicensed_work_saves_links_without_publication(self):
        parent=self.parent(status='draft',rights='pending',licence='')
        episodes=self.discover(parent,3)
        self.assertEqual(len(episodes),3)
        self.assertEqual(self.db.rows['aseel_series'][parent['id']]['status'],'draft')
        for ep in episodes:
            self.assertEqual(ep['status'],'draft')
            self.assertEqual(ep['rights_status'],'pending')
            self.assertEqual(ep['link_health_status'],'healthy')
            self.assertIn('episode-',ep['stream_url'])

    def test_draft_licensed_show_is_published_after_first_verified_episode(self):
        parent=self.parent(status='draft')
        episodes=self.discover(parent,3)
        self.assertTrue(all(ep['status']=='published' for ep in episodes))
        self.assertEqual(self.db.rows['aseel_series'][parent['id']]['status'],'published')

    def test_manually_hidden_episode_is_never_republished(self):
        parent=self.parent()
        season=self.db.seed('aseel_seasons',dict(id=uid('hidden-season'),
            series_id=parent['id'],number=1,title_ar='الموسم 1'))
        self.db.seed('aseel_episodes',dict(id=uid('hidden-episode'),
            season_id=season['id'],number=1,title_ar='الحلقة 1',
            status='hidden',rights_status='approved',
            license_reference='licensed-series-123',stream_url='',
            source_page_url='https://source.example.org/episode/1'))
        episodes=self.discover(parent,1)
        self.assertEqual(len(episodes),1)
        self.assertEqual(episodes[0]['status'],'hidden')
        self.assertEqual(episodes[0]['link_health_status'],'healthy')

    def test_delayed_browser_retry_also_auto_publishes_licensed_episode(self):
        parent=self.parent()
        season=self.db.seed('aseel_seasons',dict(id=uid('browser-retry-season'),
            series_id=parent['id'],number=1,title_ar='الموسم 1'))
        page='https://source.example.org/episode/25'
        stream='https://cdn.example.org/browser-25.mp4'
        ep=self.db.seed('aseel_episodes',dict(id=uid('browser-retry-episode'),
            season_id=season['id'],number=25,title_ar='الحلقة 25',
            status='draft',rights_status='approved',license_reference='licensed-series-123',
            source_page_url=page,stream_url=''))
        self.worker.queue.ingest('aseel_episodes',ep)
        self.worker.resolver_factory=lambda:FakeResolver(
            healthy=(stream,),browser=[dict(url=stream,kind='direct',page_url=page)])
        with self.worker.queue.db() as conn:
            job=dict(conn.execute('select * from auto_jobs where table_name=? and target_id=?',
                ('aseel_episodes',ep['id'])).fetchone())
        result=self.worker.check_target(job)
        self.assertEqual(result['status'],'healthy')
        self.assertTrue(result['published'])
        self.assertEqual(self.db.rows['aseel_episodes'][ep['id']]['stream_url'],stream)
        self.assertEqual(self.db.rows['aseel_episodes'][ep['id']]['status'],'published')

    def test_one_episode_failure_does_not_block_sibling_saves(self):
        parent=self.parent()
        self.worker.resolver_factory=lambda:PerEpisodeResolver(self.stats,fails=(3,))
        episodes=self.discover(parent,5)
        by_number={ep['number']:ep for ep in episodes}
        self.assertEqual(len(episodes),5)
        self.assertEqual(by_number[3]['status'],'draft')
        self.assertTrue(by_number[3].get('stream_url') in (None,''))
        self.assertTrue(all(by_number[i]['status']=='published' for i in (1,2,4,5)))
        with self.worker.queue.db() as conn:
            pending=conn.execute('select next_check from auto_jobs where table_name=? and target_id=?',
                ('aseel_episodes',by_number[3]['id'])).fetchone()
        self.assertEqual(pending['next_check'],NOW+60)


if __name__=='__main__':
    unittest.main()
