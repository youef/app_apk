"""Conservative title/description cleanup: strip site branding, preserve real names."""
import html
import os
import re
from urllib.parse import urlsplit


def _aliases(url='', site_name=''):
    host = (urlsplit(url).hostname or '').removeprefix('www.')
    labels = [x for x in host.split('.')[:-1]
              if x and not re.fullmatch(r'(?:www|v?\d+|watch|video)', x)]
    names = ['قرمزي', 'qrmzi', host, site_name, *labels,
             *os.getenv('ALEZZ_SITE_NAMES', '').split(',')]
    return sorted(set(
        re.sub(r'^(?:موقع|شبكة|منصة)\s+', '', x.strip(), flags=re.I)
        for x in names if x.strip()
    ), key=len, reverse=True)


def content_title(value, url='', site_name='', fallback=''):
    text = re.sub(r'<[^>]+>', '', html.unescape(str(value or '')))
    text = re.sub(r'[\u200b-\u200f\ufeff]', '', text)
    aliases = _aliases(url, site_name)
    brand = '(?:' + '|'.join(re.escape(a) for a in aliases) + ')' if aliases else r'(?!)'
    for _ in range(4):
        previous = text
        text = re.sub(r'^\s*(?:(?:موقع|شبكة|منصة)\s+)?'+brand+r'\s*[|｜–—:-]\s*', '', text, flags=re.I)
        text = re.sub(r'\s*[|｜–—-]\s*(?:(?:موقع|شبكة|منصة)\s+)?'+brand+r'(?:\s*[-–—|].*)?\s*$', '', text, flags=re.I)
        text = re.sub(r'\s+(?:موقع|شبكة|منصة)\s+'+brand+r'\s*$', '', text, flags=re.I)
        # Bare site credits also occur after the title without a dash.
        if re.search(r'(?:فيلم|مسلسل|movie|film|series)\s+[^\s]+', text, re.I):
            text = re.sub(r'\s+'+brand+r'\s*$', '', text, flags=re.I)
        text = re.sub(r'^\s*(?:مشاهدة|تحميل|شاهد|watch(?: online)?|download)\s+', '', text, flags=re.I)
        text = re.sub(r'\s+(?:مشاهدة\s+مباشرة|اون\s*لاين|online|بجودة\s*\w+|HD|FHD|FULL\s*HD|1080p|720p)\s*$', '', text, flags=re.I)
        if text == previous:
            break
    text = ' '.join(text.split()).strip(' |｜–—:-')
    if re.fullmatch(r'(?:(?:موقع|شبكة|منصة)\s+)?'+brand, text, flags=re.I):
        text = ''
    return (text or fallback)[:250]


def content_description(value, url='', site_name=''):
    """Remove source-site credits/URLs from summaries without dropping the story."""
    description = re.sub(r'<[^>]+>', ' ', html.unescape(str(value or '')))
    description = re.sub(r'[\u200b-\u200f\ufeff]', '', description)
    aliases = [x for x in _aliases(url, site_name) if len(x) >= 3]
    if aliases:
        brand = '(?:' + '|'.join(re.escape(x) for x in aliases) + ')'
        description = re.sub(
            r'(?<![\w])(?:(?:على|في|من)\s+)?(?:(?:موقع|شبكة|منصة)\s+)?'
            + brand + r'(?![\w])', ' ', description, flags=re.I)
    description = re.sub(r'https?://[^\s،؛]+', ' ', description, flags=re.I)
    description = re.sub(r'\s+([،؛,.])', r'\1', description)
    description = re.sub(r'([،؛,.])\s*\1+', r'\1', description)
    return ' '.join(description.split()).strip(' ،؛.:-')[:3000]
