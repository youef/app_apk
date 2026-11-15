"""Offline regression tests for durable UUID maintenance and remote outbox writes."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from uuid import NAMESPACE_URL, uuid5

from alezz_fetchv_importer import Catalogue, Episode
from auto_sync import AutoSync, ProcessLock, QueueDB, expires_at, target_key

NOW = 1900000000.0
ROOT = 'https://source.example.org/movie/a'
OLD = 'https://cdn.example.org/old.mp4'
NEW = 'https://cdn.example.org/new.mp4'
SERIES = 'https://source.example.org/series/a'


def uid(name): return str(uuid5(NAMESPACE_URL, name))


class FakeDB:
    def __init__(self):
        self.rows = {name: {} for name in ('aseel_movies', 'aseel_episodes', 'aseel_series', 'aseel_seasons')}
        self.history = {}
        self.patches = []
        self.inserts = []
        self.fail_patches = 0
        self.fail_sources = 0

    def seed(self, table, row):
        self.rows[table][row['id']] = deepcopy(row)
        return deepcopy(row)

    def query(self, table, params):
        rows = list(self.history.values()) if table == 'aseel_media_sources' else list(self.rows[table].values())
        for key, value in params.items():
            if isinstance(value, str) and value.startswith('eq.'):
                rows = [row for row in rows if str(row.get(key)) == value[3:]]
        rows = sorted(rows, key=lambda row: row.get('id', ''))
        start = int(params.get('offset', 0))
        return deepcopy(rows[start:start+int(params.get('limit', 1000))])

    def single(self, table, params):
        rows = self.query(table, {**params, 'limit': 1})
        return rows[0] if rows else None

    def insert(self, table, payload):
        # Simulate the real uniqueness boundaries, rather than hide duplicates.
        if table == 'aseel_seasons': keys = ('series_id', 'number')
        elif table == 'aseel_episodes': keys = ('season_id', 'number')
        else: keys = ('id',)
        if any(all(row.get(k) == payload.get(k) for k in keys) for row in self.rows[table].values()):
            raise AssertionError('duplicate target insertion')
        row = dict(id=uid(table+str(len(self.rows[table])+1)), **deepcopy(payload))
        self.rows[table][row['id']] = row
        self.inserts.append((table, deepcopy(payload)))
        return deepcopy(row)

    def patch(self, table, identifier, payload):
        if self.fail_patches:
            self.fail_patches -= 1
            raise ValueError('Supabase unavailable')
        if identifier not in self.rows[table]: raise ValueError('Missing row')
        self.patches.append((table, identifier, deepcopy(payload)))
        self.rows[table][identifier].update(deepcopy(payload))
        return deepcopy(self.rows[table][identifier])

    def upsert_source(self, payload):
        if self.fail_sources:
            self.fail_sources -= 1
            raise ValueError('Source upload unavailable')
        key = (payload['target_table'], payload['target_id'], hashlib.sha256(payload['source_url'].encode()).hexdigest())
        self.history[key] = deepcopy(dict(id=uid('|'.join(key)), source_key=key[-1], **payload))


class FakeResolver:
    def __init__(self, healthy=(), fresh=(), browser=(), reachable=()):
        self.healthy = set(healthy)
        self.fresh = deepcopy(list(fresh))
        self.browser = deepcopy(list(browser))
        self.reachable = set(reachable)
        self.extractions = []
        self.checked = []

    def extract(self, pages, force_browser=False):
        self.extractions.append((list(pages), force_browser))
        return deepcopy(self.browser if force_browser else self.fresh), []

    def check(self, sources):
        output = []
        for row in sources:
            self.checked.append(row['url'])
            ok = row['url'] in self.healthy and row.get('kind', 'direct') == 'direct'
            output.append(dict(row, verified=ok, reachable=row['url'] in self.reachable,
                               error='' if ok else 'HTTP 403 expired'))
        return output


class AutoSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # These disposable fixtures test committed file state across connections,
        # not physical power-loss durability. Avoid Windows temp-volume fsync cost.
        connect = sqlite3.connect
        def fixture_connection(*args, **kwargs):
            conn = connect(*args, **kwargs)
            conn.execute('pragma synchronous=OFF')
            return conn
        self.connection_patch = patch('auto_sync.sqlite3.connect', side_effect=fixture_connection)
        self.connection_patch.start()
        self.addCleanup(self.connection_patch.stop)
        self.db = FakeDB()
        self.resolver = FakeResolver()
        self.now = NOW
        self.worker = AutoSync(self.tmp.name, db_factory=lambda: self.db,
                               resolver_factory=lambda: self.resolver, clock=lambda: self.now)
        self.worker.db = self.db

    def row(self, table='aseel_movies', name='movie', source=ROOT, stream=OLD, **extra):
        row = dict(id=uid(name), title_ar='عنوان متشابه', source_page_url=source,
                   stream_url=stream, stream_variants=[], status='published', rights_status='approved')
        row.update(extra)
        self.db.seed(table, row)
        self.worker.queue.ingest(table, row)
        return row

    def job(self, row, table='aseel_movies'):
        with self.worker.queue.db() as conn:
            value = conn.execute('select * from auto_jobs where table_name=? and target_id=?', (table,row['id'])).fetchone()
            return dict(value)

    def test_uuid_ingestion_deduplicates_rows_and_preserves_old_sources(self):
        row = self.row()
        self.worker.queue.ingest('aseel_movies', dict(row, source_page_url=ROOT+'/backup', stream_url=NEW))
        self.worker.queue.ingest('aseel_movies', dict(row, source_page_url=ROOT+'/backup', stream_url=NEW))
        same_title_other_uuid = self.row(name='different-uuid')
        self.assertNotEqual(row['id'], same_title_other_uuid['id'])
        self.assertEqual(self.worker.queue.snapshot()['counts']['total'], 2)
        sources = self.worker.queue.sources('aseel_movies', row['id'])
        self.assertEqual({s['url'] for s in sources}, {ROOT,ROOT+'/backup',OLD,NEW})
        self.assertEqual(len(sources), 4)

    def test_target_identifiers_must_be_supported_uuid(self):
        self.assertEqual(target_key('aseel_movies', uid('a').upper()), ('aseel_movies', uid('a')))
        for table, identifier in [('aseel_admins',uid('a')),('aseel_movies','same-title')]:
            with self.assertRaises(ValueError): target_key(table,identifier)

    def test_failed_primary_switches_only_to_verified_backup(self):
        row = self.row(stream_variants=[dict(url=NEW,label='720P'), dict(url=ROOT+'/player',kind='embed')])
        self.resolver = FakeResolver(healthy=[NEW], reachable=[ROOT+'/player'])
        self.worker.check_target(self.job(row))
        remote = self.db.rows['aseel_movies'][row['id']]
        self.assertEqual(remote['stream_url'], NEW)
        self.assertEqual(remote['link_health_status'], 'healthy')
        self.assertEqual(remote['status'], 'published')
        self.assertEqual(remote['rights_status'], 'approved')
        self.assertIn(OLD, {s['url'] for s in self.worker.queue.sources('aseel_movies',row['id'])})
        self.assertTrue(any(s['source_url'] == OLD and s['failures'] > 0 for s in self.db.history.values()))
        _,_,payload = self.db.patches[-1]
        self.assertNotIn('status', payload)
        self.assertNotIn('rights_status', payload)
        self.assertNotIn('title_ar', payload)

    def test_healthy_primary_is_retained_even_if_backup_has_higher_confidence(self):
        row = self.row(stream_variants=[dict(url=NEW,label='backup')])
        self.resolver = FakeResolver(healthy=[OLD,NEW])
        for _ in range(3): self.worker.record_check('aseel_movies',row['id'],dict(url=NEW,kind='direct',verified=True),NOW)
        self.worker.check_target(self.job(row))
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], OLD)

    def test_all_fail_keeps_previous_url_and_variants_and_records_cause(self):
        variants = [dict(url=NEW,label='backup')]
        row = self.row(stream_variants=variants)
        self.worker.check_target(self.job(row))
        remote = self.db.rows['aseel_movies'][row['id']]
        self.assertEqual(remote['stream_url'], OLD)
        self.assertEqual(remote['stream_variants'], variants)
        self.assertEqual(remote['link_health_status'], 'suspect')
        self.assertTrue(remote['link_health_reason'])
        self.assertEqual(self.job(row)['next_check'], NOW+60)
        self.worker.check_target(self.job(row))
        self.assertEqual(self.job(row)['next_check'], NOW+120)
        self.worker.check_target(self.job(row))
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['link_health_status'], 'broken')
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], OLD)
        self.assertEqual(self.job(row)['next_check'], NOW+240)

    def test_embed_page_cannot_become_primary_without_video_verification(self):
        embed = 'https://player.example.org/embed/7'
        row = self.row(stream_variants=[dict(url=embed,kind='embed',label='player')])
        self.resolver = FakeResolver(reachable=[embed])
        self.worker.check_target(self.job(row))
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], OLD)
        self.assertNotEqual(self.job(row)['status'], 'healthy')

    def test_extraction_failure_falls_back_to_browser_candidate(self):
        row = self.row()
        self.resolver = FakeResolver(healthy=[NEW], fresh=[dict(url=OLD,kind='direct')],
                                     browser=[dict(url=NEW,kind='direct',page_url=ROOT)])
        self.worker.check_target(self.job(row))
        self.assertTrue(any(force for _,force in self.resolver.extractions))
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], NEW)

    def test_signed_link_is_due_before_explicit_expiration(self):
        signed = OLD+'?expires='+str(int(NOW+3600))
        row = self.row(stream=signed)
        self.resolver = FakeResolver(healthy=[signed])
        self.worker.check_target(self.job(row))
        job = self.job(row)
        self.assertEqual(job['next_check'], NOW+3300)
        self.assertEqual(job['next_refresh'], NOW+3300)
        self.assertEqual(expires_at(OLD), 0)
        self.assertEqual(expires_at(signed), NOW+3600)

    def test_ordinary_healthy_link_gets_daily_schedule(self):
        row = self.row()
        self.resolver = FakeResolver(healthy=[OLD])
        self.worker.check_target(self.job(row))
        self.assertEqual(self.job(row)['next_check'], NOW+24*3600)

    def test_variant_limit_does_not_discard_full_source_history(self):
        backups = [dict(url=f'https://cdn.example.org/v{n}.mp4',label=str(n),kind='direct') for n in range(14)]
        row = self.row(stream_variants=backups)
        self.resolver = FakeResolver(healthy=[OLD,*[x['url'] for x in backups]])
        self.worker.check_target(self.job(row))
        self.assertEqual(len(self.db.rows['aseel_movies'][row['id']]['stream_variants']), 8)
        self.assertEqual(len(self.worker.queue.sources('aseel_movies',row['id'])), 16) # original + primary + 14 backups
        self.assertEqual(len(self.db.history), 16)

    def test_missing_source_is_flagged_and_no_link_is_fabricated(self):
        row = self.row(source='',stream='')
        self.worker.check_target(self.job(row))
        self.assertEqual(self.worker.queue.snapshot()['counts']['missing_source'], 1)
        self.assertEqual(self.worker.queue.sources('aseel_movies',row['id']), [])
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], '')
        self.assertIn('مفقود', self.job(row)['error'])
        self.assertFalse(self.resolver.extractions)

    def test_outbox_survives_restart_and_retries_without_reprobing(self):
        row = self.row()
        self.resolver = FakeResolver(healthy=[NEW], fresh=[dict(url=NEW,kind='direct')])
        self.db.fail_patches = 1
        with self.assertRaises(ValueError): self.worker.check_target(self.job(row))
        pending = self.job(row)
        self.assertEqual(json.loads(pending['dirty'])['stream_url'], NEW)
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], OLD)
        replacement = AutoSync(self.tmp.name,db_factory=lambda:self.db,resolver_factory=lambda:self.resolver,clock=lambda:self.now)
        replacement.db = self.db
        replacement.flush(pending)
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'], NEW)
        self.assertEqual(self.job(row)['dirty'], '')

    def test_source_outbox_failure_preserves_dirty_payload_and_history(self):
        row = self.row()
        self.resolver = FakeResolver(healthy=[OLD])
        self.db.fail_sources = 1
        with self.assertRaises(ValueError): self.worker.check_target(self.job(row))
        self.assertTrue(self.job(row)['dirty'])
        self.assertFalse(self.db.patches)
        self.worker.flush(self.job(row))
        self.assertFalse(self.job(row)['dirty'])
        self.assertEqual(len(self.db.history), 2)

    def test_stale_remote_snapshot_cannot_overwrite_unflushed_replacement(self):
        row = self.row()
        self.worker.queue.update('aseel_movies',row['id'],stream_url=NEW,dirty=json.dumps({'stream_url':NEW}))
        self.worker.queue.ingest('aseel_movies',row)
        self.assertEqual(self.job(row)['stream_url'],NEW)
        self.assertTrue(self.job(row)['dirty'])

    def test_claim_is_exclusive_and_crashed_claim_becomes_available(self):
        row = self.row()
        first = self.worker.queue.claim(NOW)
        self.assertEqual(first['target_id'], row['id'])
        second = QueueDB(Path(self.tmp.name)/'autosync.sqlite3')
        self.assertIsNone(second.claim(NOW+5))
        recovered = second.claim(NOW+601)
        self.assertEqual(recovered['target_id'], row['id'])

    def test_worker_process_lock_excludes_duplicate_instance(self):
        path = Path(self.tmp.name)/'leader.lock'
        a,b = ProcessLock(path),ProcessLock(path)
        self.addCleanup(a.close);self.addCleanup(b.close)
        self.assertTrue(a.acquire())
        self.assertFalse(b.acquire())
        a.close()
        self.assertTrue(b.acquire())

    def test_pause_resume_setting_survives_restart(self):
        self.worker.control('pause')
        restarted = AutoSync(self.tmp.name,db_factory=lambda:self.db)
        self.assertFalse(restarted.enabled)
        restarted.control('resume')
        self.assertTrue(self.worker.enabled)

    def test_remote_import_restores_complete_source_history_without_duplicate_jobs(self):
        row = self.row()
        self.db.history[('aseel_movies',row['id'],'synthetic')] = dict(id=uid('history'),target_table='aseel_movies',
            target_id=row['id'],source_url=NEW,source_kind='direct',first_seen_at='2026-01-01T00:00:00+00:00',
            last_seen_at='2026-01-02T00:00:00+00:00',status='healthy',successes=7,failures=1,confidence=0.8)
        self.worker.import_remote()
        self.worker.import_remote()
        self.assertEqual(self.worker.queue.snapshot()['counts']['total'],1)
        sources = self.worker.queue.sources('aseel_movies',row['id'])
        self.assertEqual(len(sources),3)
        restored = next(s for s in sources if s['url']==NEW)
        self.assertEqual(restored['successes'],7)
        self.assertEqual(restored['failures'],1)

    def test_new_episode_uses_series_uuid_and_is_draft_without_duplicates(self):
        parent = self.row(table='aseel_series',name='show',source=SERIES,stream='')
        cat = Catalogue(kind='series',title='عنوان مصدر مختلف',url=SERIES,episodes=[
            Episode(2,7,'الحلقة 7 - موقع قرمزي','https://source.example.org/episode/7')])
        with patch('auto_sync.pull_html',return_value=cat):
            self.worker.discover_series(self.job(parent,'aseel_series'))
            self.worker.queue.queue('aseel_series',parent['id'],refresh=True)
            self.worker.discover_series(self.job(parent,'aseel_series'))
        self.assertEqual(len(self.db.rows['aseel_seasons']),1)
        season = next(iter(self.db.rows['aseel_seasons'].values()))
        self.assertEqual(season['series_id'],parent['id'])
        self.assertEqual(len(self.db.rows['aseel_episodes']),1)
        episode = next(iter(self.db.rows['aseel_episodes'].values()))
        self.assertEqual(episode['season_id'],season['id'])
        self.assertEqual(episode['number'],7)
        self.assertEqual(episode['status'],'draft')
        self.assertEqual(episode['rights_status'],'pending')
        self.assertEqual(episode['title_ar'],'الحلقة 7')
        self.assertEqual(episode['source_page_url'],'https://source.example.org/episode/7')
        self.assertEqual(self.db.rows['aseel_series'][parent['id']]['status'],'published')

    def test_existing_episode_does_not_have_its_rights_or_title_overwritten(self):
        parent = self.row(table='aseel_series',name='show',source=SERIES,stream='')
        season = self.db.seed('aseel_seasons',dict(id=uid('season'),series_id=parent['id'],number=1))
        old = self.db.seed('aseel_episodes',dict(id=uid('existing-episode'),season_id=season['id'],number=1,
                           title_ar='اسم محرر يدويًا',status='published',rights_status='approved',stream_url=OLD))
        cat = Catalogue(kind='series',title='عنوان آخر',url=SERIES,episodes=[
            Episode(1,1,'اسم المصدر','https://source.example.org/e1')])
        with patch('auto_sync.pull_html',return_value=cat): self.worker.discover_series(self.job(parent,'aseel_series'))
        updated = self.db.rows['aseel_episodes'][old['id']]
        self.assertEqual(updated['status'],'published')
        self.assertEqual(updated['rights_status'],'approved')
        self.assertEqual(updated['title_ar'],'اسم محرر يدويًا')
        self.assertEqual(updated['stream_url'],OLD)
        self.assertEqual(self.db.patches[-1][2],{'source_page_url':'https://source.example.org/e1'})

    def test_interrupted_series_discovery_resumes_saved_checkpoint(self):
        parent = self.row(table='aseel_series',name='checkpoint-show',source=SERIES,stream='')
        checkpoint = {'episodes': [], 'seen_pages': [SERIES], 'queued': [SERIES+'/page/2']}

        def interrupted(url, client, **kwargs):
            kwargs['progress_hook'](checkpoint)
            raise ValueError('Temporary source outage')

        with patch('auto_sync.pull_html',side_effect=interrupted):
            self.worker.process(self.job(parent,'aseel_series'))
        self.assertEqual(json.loads(self.job(parent,'aseel_series')['checkpoint']),checkpoint)
        self.assertEqual(self.job(parent,'aseel_series')['lease_until'],0)
        self.assertEqual(self.job(parent,'aseel_series')['next_check'],NOW+60)
        self.now += 60
        restarted = AutoSync(self.tmp.name,db_factory=lambda:self.db,resolver_factory=lambda:self.resolver,clock=lambda:self.now)
        restarted.db = self.db
        with patch('auto_sync.pull_html',return_value=Catalogue(kind='series',title='عمل',url=SERIES)) as discover:
            restarted.discover_series(self.job(parent,'aseel_series'))
        self.assertEqual(discover.call_args.kwargs['resume_progress'],checkpoint)
        self.assertEqual(self.job(parent,'aseel_series')['checkpoint'],'{}')

    def test_stale_outbox_revalidates_before_switching_primary(self):
        row=self.row()
        self.worker.queue.remember('aseel_movies',row['id'],dict(url=NEW,kind='direct'))
        self.worker.queue.update('aseel_movies',row['id'],last_check=NOW-1000,
            dirty=json.dumps({'stream_url':NEW}),upload_at=0)
        fresh='https://cdn.example.org/latest.mp4'
        self.resolver=FakeResolver(healthy=[fresh],fresh=[dict(url=fresh,kind='direct')])
        self.worker.process(self.job(row))
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'],fresh)
        self.assertFalse(any(p.get('stream_url')==NEW for _,_,p in self.db.patches))

    def test_process_releases_claim_and_keeps_outbox_after_remote_failure(self):
        row = self.row()
        self.resolver = FakeResolver(healthy=[NEW],fresh=[dict(url=NEW,kind='direct')])
        self.db.fail_sources = 1
        claimed = self.worker.queue.claim(NOW)
        self.worker.process(claimed)
        pending = self.job(row)
        self.assertEqual(pending['lease_until'],0)
        self.assertTrue(pending['dirty'])
        self.assertEqual(pending['upload_at'],NOW+60)
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'],OLD)
        self.worker.flush(pending)
        self.assertFalse(self.job(row)['dirty'])
        self.assertEqual(self.db.rows['aseel_movies'][row['id']]['stream_url'],NEW)


if __name__ == '__main__': unittest.main()
