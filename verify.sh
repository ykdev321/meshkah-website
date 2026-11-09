#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

node --check assets/app.js
node --check assets/about.js
node --check service-worker.js
bash -n tools/download-hadith-collections.sh
bash -n tools/download-nawawi40.sh
python3 - <<'PY'
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse
import gzip, json, re

root = Path('.')

# Core Quran and page-layout data.
quran = json.loads((root/'data/quran.json').read_text(encoding='utf-8'))
reciters = json.loads((root/'data/reciters.json').read_text(encoding='utf-8'))['reciters']
page_map = json.loads((root/'data/verse-to-page.json').read_text(encoding='utf-8'))
assert len(quran) == 114 and [int(s['id']) for s in quran] == list(range(1,115))
assert sum(len(s['array']) for s in quran) == 6236
assert all(v.get('ar','').strip() for s in quran for v in s['array'])
assert len(page_map) == 604 and page_map[0] == {'surah':1,'ayah':1}
page_files = sorted((root/'data/pages').glob('page-*.json'))
assert len(page_files) == 604
for expected_page, path in enumerate(page_files, 1):
    layout = json.loads(path.read_text(encoding='utf-8'))
    assert path.name == f'page-{expected_page:03d}.json' and layout.get('page') == expected_page
    assert isinstance(layout.get('lines'), list) and layout['lines']
    assert isinstance(layout.get('verses'), list) and layout['verses']
    for verse in layout['verses']:
        sid, aid = int(verse['surah_number']), int(verse['ayah_number'])
        assert 1 <= sid <= 114 and 1 <= aid <= len(quran[sid-1]['array'])
        assert verse.get('words') and all(isinstance(w.get('text'), str) and w['text'].strip() for w in verse['words'])
assert len(reciters) == 12
assert all(r.get('riwayah') == 'hafs_an_asim' for r in reciters)
assert all(set(r.get('audio',{}).get('surah_urls',{})) == {str(i) for i in range(1,115)} for r in reciters)
for reciter in reciters:
    for key in ('word_file','verse_file'):
        rel = (reciter.get('timing') or {}).get(key)
        if rel:
            data = json.loads(gzip.decompress((root/rel).read_bytes()))
            assert data.get('_meta',{}).get('slug') == reciter['id'] and data.get('rows')
print('PASS Quran: 114 surahs / 6,236 ayahs / 604 valid page layouts / 12 reciters / 1,368 audio URLs and timing files')

# HTML integrity, IDs and local resources.
class Parser(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]; self.refs=[]
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'): self.ids.append(attrs['id'])
        for key in ('href','src','poster'):
            if attrs.get(key): self.refs.append(attrs[key])

pages = {}
for name in ('index.html','player.html','about.html','privacy.html'):
    parser = Parser(); parser.feed((root/name).read_text(encoding='utf-8'))
    assert len(parser.ids) == len(set(parser.ids)), f'duplicate IDs in {name}'
    for ref in parser.refs:
        if ref.startswith(('http:','https:','mailto:','tel:','#','data:','javascript:')): continue
        path = urlparse(ref).path
        if path: assert (root/path).exists(), f'missing local resource in {name}: {ref}'
    pages[name] = set(parser.ids)
assert (root/'privacy.html').is_file() and (root/'about.html').is_file()
assert 'home-dashboard' in pages['index.html'] and 'daily-verse-text' in pages['index.html']
assert 'player' in (root/'index.html').read_text(encoding='utf-8')
assert 'player-standalone' in (root/'player.html').read_text(encoding='utf-8')
assert 'studio-reciter-list' in pages['player.html'] and 'studio-surah-list' in pages['player.html']
assert 'privacy.html' in (root/'service-worker.js').read_text(encoding='utf-8')
assert 'mishkat-app-v8-restored-player' in (root/'service-worker.js').read_text(encoding='utf-8')

app = (root/'assets/app.js').read_text(encoding='utf-8')
used = set(re.findall(r"\$\(['\"]#([\w-]+)['\"]\)", app))
# The main page intentionally has no full studio controls; these exist only on player.html.
studio_only = {
    'album-auto-next','album-next-surah','album-open-mushaf','album-play-toggle','album-prev-surah',
    'album-reciter-name','album-repeat','album-surah-name','record-disc','studio-ayah-label',
    'studio-current-time','studio-duration','studio-mute','studio-progress','studio-reciter-count',
    'studio-reciter-list','studio-reciter-search','studio-speed','studio-surah-list',
    'studio-surah-search','studio-volume'
}
assert not (used - pages['index.html'] - studio_only), f'missing index IDs: {sorted(used-pages["index.html"]-studio_only)}'
assert not (used - pages['player.html']), f'missing player IDs: {sorted(used-pages["player.html"])}'
assert 'mishkat.playerLaunchTarget.v1' in app and "location.href = 'player.html'" in app
assert 'markCurrentPageRead' in app and 'selection.isCollapsed' in app
assert 'range.intersectsNode(unit)' in app
assert 'downloadPageImage' in app and 'renderSelectedTafsir' in app
print(f'PASS HTML/navigation: four pages / unique IDs / local resources / all application selectors resolved in the appropriate page')

# Tafsir data: preserve the five selected local sources.
expected = {'التفسير الميسر','تفسير ابن كثير','تفسير السعدي','تفسير القرطبي','تفسير الطبري'}
tafsir_files = sorted((root/'data/tafsir').glob('[0-9][0-9][0-9].json'))
assert len(tafsir_files) == 114
count = 0
for file in tafsir_files:
    data = json.loads(file.read_text(encoding='utf-8'))
    assert int(data['number']) == int(file.stem) and data.get('ayahs')
    count += len(data['ayahs'])
    for ayah in data['ayahs']:
        assert {item['type'] for item in ayah.get('tafsir',[])} == expected
assert count == 6236
print('PASS Tafsir: 114 local files / 6,236 entries / five named sources')

# Hadith metadata is present, but missing downloads are explicitly not treated as bundled texts.
manifest = json.loads((root/'data/hadith/manifest.json').read_text(encoding='utf-8'))
assert len(manifest['collections']) == 7
present = 0
for item in manifest['collections']:
    file = root/'data/hadith'/item['local_file']
    if not file.exists(): continue
    data = json.loads(file.read_text(encoding='utf-8'))
    texts = [x.get('text','').strip() for x in data.get('hadiths',[]) if isinstance(x.get('text'),str)]
    if texts:
        assert len(texts) >= item['expected_minimum'], f'incomplete hadith file: {file}'
        present += 1
print(f'PASS Hadith metadata: seven source editions; {present} non-empty local editions bundled')

# Service worker and stylesheet integrity.
sw = (root/'service-worker.js').read_text(encoding='utf-8')
assert "'./player.html'" in sw and "'./privacy.html'" in sw
assert 'data/pages/' in sw and 'TAFSIR_CACHE' in sw and 'HADITH_CACHE' in sw
css = (root/'assets/styles.css').read_text(encoding='utf-8')
assert '.home-dashboard{display:grid;grid-template-columns:minmax(270px,.82fr) minmax(0,1.55fr)' in css
assert 'body.player-standalone .player-studio-grid' in css
assert '.welcome-screen' not in css and '.feature-shell' not in css
try:
    import tinycss2
    rules = tinycss2.parse_stylesheet(css, skip_comments=True, skip_whitespace=True)
    errors = [rule for rule in rules if rule.type == 'error']
    assert not errors, errors
    print(f'PASS CSS parser: {len(rules)} top-level rules')
except ImportError:
    print('INFO tinycss2 missing; stylesheet parser check skipped')
print('ALL AVAILABLE STATIC AND DATA TESTS PASSED')
PY
