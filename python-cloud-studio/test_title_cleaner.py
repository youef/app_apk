"""Titles must identify the content rather than the host site's brand."""
import unittest
from unittest.mock import patch

from title_cleaner import content_title
from alezz_fetchv_importer import pull_html


class TitleTests(unittest.TestCase):
    def test_arabic_and_latin_brand_prefix_and_suffix(self):
        url = 'https://v3.qrmzi.buzz/series/a'
        for value in ('مسلسل اختبار - موقع قرمزي', 'قرمزي | مسلسل اختبار',
                      'مسلسل اختبار | qrmzi', 'مشاهدة مسلسل اختبار HD - موقع قرمزي'):
            self.assertEqual(content_title(value, url), 'مسلسل اختبار', value)

    def test_custom_brand_comes_from_site_metadata_or_configuration(self):
        self.assertEqual(content_title('الحلقة 12 | شبكة الاختبار', site_name='شبكة الاختبار'), 'الحلقة 12')
        with patch.dict('os.environ', {'ALEZZ_SITE_NAMES': 'موقعي,My Video Site'}):
            self.assertEqual(content_title('فيلم جديد - موقعي'), 'فيلم جديد')

    def test_actual_name_hyphen_and_unicode_are_preserved(self):
        self.assertEqual(content_title('مسلسل نهاية - البداية', 'https://source.example.org/'), 'مسلسل نهاية - البداية')
        self.assertEqual(content_title('قصة عشق', 'https://source.example.org/'), 'قصة عشق')
        self.assertEqual(content_title('Çirkin &amp; Güzel'), 'Çirkin & Güzel')

    def test_brand_only_uses_safe_episode_fallback(self):
        self.assertEqual(content_title('موقع قرمزي', 'https://qrmzi.buzz/e1', fallback='الحلقة 1'), 'الحلقة 1')

    def test_web_site_json_is_not_chosen_as_movie_title(self):
        class Site:
            def get(self, url):
                return url, 'text/html', '''<html><head><title>موقع قرمزي</title>
                <meta property="og:site_name" content="موقع قرمزي">
                <script type="application/ld+json">{"@type":"WebSite","name":"موقع قرمزي"}</script>
                </head><body><h1>فيلم الاختبار</h1></body></html>'''
        cat = pull_html('https://qrmzi.buzz/movie/test', Site(), kind='movie')
        self.assertEqual(cat.title, 'فيلم الاختبار')


if __name__ == '__main__': unittest.main()
