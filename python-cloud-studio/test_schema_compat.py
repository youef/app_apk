"""Regression checks against the real Al Ezz Supabase per-table column shape.

No external network access, credentials or writes are needed.
"""
import unittest

from alezz_fetchv_importer import Catalogue, Episode, store, playback_variants, MAX_PLAYBACK_VARIANTS
from test_importer import FakeDB


class SchemaCheckedDB(FakeDB):
    # Columns submitted by this importer and verified against production schema.
    WORK_FIELDS = {
        'title_ar', 'title_original', 'description', 'release_year', 'poster_url',
        'backdrop_url', 'country_code', 'language_code', 'genre_tags', 'category_id',
        'status', 'rights_status', 'rights_holder', 'license_reference', 'source_id',
        'stream_url', 'stream_variants', 'link_health_status', 'source_page_url',
    }
    EPISODE_FIELDS = {
        'season_id', 'number', 'title_ar', 'description', 'poster_url',
        'status', 'rights_status', 'license_reference', 'source_id',
        'stream_url', 'stream_variants', 'link_health_status', 'source_page_url',
    }
    SEASON_FIELDS = {'series_id', 'number', 'title_ar'}

    def _validate(self, table, payload):
        allowed = (self.EPISODE_FIELDS if table == 'aseel_episodes' else
                   self.SEASON_FIELDS if table == 'aseel_seasons' else self.WORK_FIELDS)
        invalid = set(payload) - allowed
        if invalid:
            raise AssertionError(f'Unexpected columns for {table}: {sorted(invalid)}')

    def insert(self, table, payload):
        self._validate(table, payload)
        return super().insert(table, payload)

    def patch(self, table, id, payload):
        self._validate(table, payload)
        return super().patch(table, id, payload)



class VariantConstraintDB(SchemaCheckedDB):
    """Mirror production constraints to catch overlong playback arrays offline."""
    def _validate(self, table, payload):
        super()._validate(table, payload)
        if table in ('aseel_movies', 'aseel_episodes') and 'stream_variants' in payload:
            variants = payload['stream_variants']
            if not isinstance(variants, list) or len(variants) > MAX_PLAYBACK_VARIANTS:
                raise ValueError('aseel_episode_variants_array / aseel_movie_variants_array')


def series():
    return Catalogue(kind='series', title='مسلسل اختبار الحقوق',
                     url='https://content.example.org/series',
                     description='مسلسل مصرح به', poster_url='https://content.example.org/poster.jpg',
                     year=2026, genres=['drama'], episodes=[
                         Episode(season=1, number=1, title='الحلقة 1',
                                 page_url='https://content.example.org/e1',
                                 media_url='https://video.example.org/e1.m3u8', verified=True),
                         Episode(season=1, number=2, title='الحلقة 2',
                                 page_url='https://content.example.org/e2'),
                     ])


class SchemaCompatTests(unittest.TestCase):
    def test_new_draft_episodes_do_not_receive_series_only_fields(self):
        db = SchemaCheckedDB()
        result = store(series(), db, publish=False, rights=False)
        self.assertEqual(result['episodes_new'], 2)
        self.assertEqual(len(db.rows['aseel_episodes']), 2)
        for episode in db.rows['aseel_episodes']:
            self.assertNotIn('rights_holder', episode)
            self.assertEqual(episode['rights_status'], 'pending')

    def test_published_episode_uses_supported_rights_columns(self):
        db = SchemaCheckedDB()
        result = store(series(), db, publish=True, rights=True,
                       license_holder='Media Rights Owner',
                       license_reference='licensed-work-2026')
        self.assertEqual(result['episodes_new'], 2)
        self.assertEqual(db.rows['aseel_series'][0]['rights_holder'], 'Media Rights Owner')
        for episode in db.rows['aseel_episodes']:
            self.assertNotIn('rights_holder', episode)
            self.assertEqual(episode['license_reference'], 'licensed-work-2026')

    def test_existing_episode_update_no_extra_columns(self):
        db = SchemaCheckedDB()
        store(series(), db, publish=False, rights=False)
        result = store(series(), db, publish=True, rights=True,
                       license_holder='Media Rights Owner', license_reference='licensed-work-2026')
        self.assertEqual(result['episodes_updated'], 2)
        self.assertEqual(len(db.rows['aseel_episodes']), 2)
        self.assertEqual(len(db.rows['aseel_series']), 1)

    def test_movie_keeps_its_supported_rights_holder_column(self):
        db = SchemaCheckedDB()
        cat = Catalogue(kind='movie', title='فيلم تجريبي',
                        url='https://content.example.org/movie')
        result = store(cat, db, publish=True, rights=True,
                       license_holder='Movie Rights Owner', license_reference='movie-licensed-2026')
        self.assertEqual(result['works_new'], 1)
        self.assertEqual(db.rows['aseel_movies'][0]['rights_holder'], 'Movie Rights Owner')

    def test_many_episode_sources_do_not_violate_live_jsonb_check(self):
        cat = series()
        ep = cat.episodes[0]
        ep.sources = [dict(url=f'https://video.example.org/e1-alternative-{i}.m3u8',
                           kind='direct', label=f'Player {i}', verified=True)
                      for i in range(16)]
        db = VariantConstraintDB()
        first = store(cat, db, publish=False, rights=False)
        self.assertEqual(first['episodes_new'], 2)
        self.assertEqual(len(db.rows['aseel_episodes'][0]['stream_variants']), MAX_PLAYBACK_VARIANTS)
        second = store(cat, db, publish=False, rights=False)
        self.assertEqual(second['episodes_updated'], 2)
        self.assertEqual(len(db.rows['aseel_episodes'][0]['stream_variants']), MAX_PLAYBACK_VARIANTS)
        self.assertEqual(len(ep.sources), 16)  # Remaining sources still available to AutoSync.

    def test_many_movie_sources_do_not_violate_live_jsonb_check(self):
        cat = Catalogue(kind='movie', title='Film with player failovers',
                        url='https://content.example.org/movie-many-players',
                        media_url='https://video.example.org/main.mp4', verified=True)
        cat.sources = [dict(url=f'https://video.example.org/movie-{i}.mp4',
                            kind='direct', label=f'Player {i}', verified=True)
                       for i in range(16)]
        db = VariantConstraintDB()
        first = store(cat, db, publish=False, rights=False)
        self.assertEqual(first['works_new'], 1)
        self.assertEqual(len(db.rows['aseel_movies'][0]['stream_variants']), MAX_PLAYBACK_VARIANTS)
        again = store(cat, db, publish=False, rights=False)
        self.assertEqual(again['works_updated'], 1)
        self.assertEqual(len(db.rows['aseel_movies'][0]['stream_variants']), MAX_PLAYBACK_VARIANTS)
        self.assertEqual(len(cat.sources), 16)
        self.assertEqual(len(playback_variants(cat)), MAX_PLAYBACK_VARIANTS)


if __name__ == '__main__':
    unittest.main()
