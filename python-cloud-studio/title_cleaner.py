"""Conservative title cleanup: strip site branding, preserve actual work names."""
import html
import os
import re
from urllib.parse import urlsplit


def content_title(value, url='', site_name='', fallback=''):
    text = re.sub(r'<[^>]+>', '', html.unescape(str(value or '')))
    text = re.sub(r'[\u200b-\u200f\ufeff]', '', text)
    host = (urlsplit(url).hostname or '').removeprefix('www.')
    labels = [x for x in host.split('.')[:-1] if not re.fullmatch(r'(?:www|v?\d+|watch|video)', x)]
    aliases = ['قرمزي', 'qrmzi', host, site_name, *labels,
               *os.getenv('ALEZZ_SITE_NAMES', '').split(',')]
    aliases = [re.sub(r'^(?:موقع|شبكة|منصة)\s+', '', a.strip(), flags=re.I) for a in aliases if a.strip()]
    brand = '(?:' + '|'.join(re.escape(a) for a in sorted(set(aliases), key=len, reverse=True)) + ')' if aliases else r'(?!)'
    for _ in range(4):
        previous = text
        text = re.sub(r'^\s*(?:(?:موقع|شبكة|منصة)\s+)?'+brand+r'\s*[|｜–—:-]\s*', '', text, flags=re.I)
        text = re.sub(r'\s*[|｜–—-]\s*(?:(?:موقع|شبكة|منصة)\s+)?'+brand+r'(?:\s*[-–—|].*)?\s*$', '', text, flags=re.I)
        text = re.sub(r'\s+(?:موقع|شبكة|منصة)\s+'+brand+r'\s*$', '', text, flags=re.I)
        text = re.sub(r'^\s*(?:مشاهدة|تحميل|شاهد|watch(?: online)?|download)\s+', '', text, flags=re.I)
        text = re.sub(r'\s+(?:مشاهدة\s+مباشرة|اون\s*لاين|online|بجودة\s*\w+|HD|FHD|FULL\s*HD|1080p|720p)\s*$', '', text, flags=re.I)
        if text == previous: break
    text = ' '.join(text.split()).strip(' |｜–—:-')
    if re.fullmatch(r'(?:(?:موقع|شبكة|منصة)\s+)?'+brand, text, flags=re.I): text = ''
    return (text or fallback)[:250]
