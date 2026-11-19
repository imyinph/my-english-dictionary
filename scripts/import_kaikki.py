"""Import only the ten M0 headwords. Standard-library Python; no database dump.

Run `python scripts/import_kaikki.py` to refresh the bounded source snapshot.
Original downloads are kept in ignored artifacts/import for audit, not shipped.
"""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote, urlencode
from html import unescape
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
WORDS = ['create', 'creative', 'creation', 'creator', 'creatively', 'creativity', 'make', 'destroy', 'make sense', 'sense']
LIMIT = 2_000_000


def fetch(url, limit=LIMIT):
    request = Request(url, headers={'User-Agent': 'PersonalDictionaryM1/0.1 (bounded 10-word research importer)'})
    with urlopen(request, timeout=45) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError(f'Response exceeds {limit} bytes: {url}')
        return data


def download():
    out = ROOT / 'artifacts' / 'import'
    out.mkdir(parents=True, exist_ok=True)
    for word in WORDS:
        url = f'https://kaikki.org/dictionary/English/meaning/{word[0]}/{word[:2]}/{quote(word, safe="")}.jsonl'
        data = fetch(url)
        filename = word.replace(' ', '-')
        (out / f'{filename}.jsonl').write_bytes(data)
        records = [json.loads(line) for line in data.decode().splitlines() if line.strip()]
        print(word, len(data), 'bytes', [(r.get('pos'), len(r.get('senses', []))) for r in records], flush=True)
        provenance = {'word': word, 'url': url, 'retrievedAt': datetime.now(timezone.utc).isoformat(), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        (out / f'{filename}.meta.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')


def project():
    """Keep source fields, never generate content or copy external quotations."""
    records, provenance, sounds = [], [], {}
    dropped = 0
    def pick(obj, keys):
        return {key: obj[key] for key in keys if key in obj}
    def translations(items):
        return [pick(t, ['word', 'code', 'sense', 'tags']) for t in items if t.get('code') in ['zh', 'cmn']]
    def relations(items):
        return [pick(x, ['word', 'sense', 'tags']) for x in items]
    for word in WORDS:
        filename = word.replace(' ', '-')
        folder = ROOT / 'artifacts' / 'import'
        meta = json.loads((folder / f'{filename}.meta.json').read_text(encoding='utf-8'))
        data = (folder / f'{filename}.jsonl').read_bytes()
        if hashlib.sha256(data).hexdigest() != meta['sha256']:
            raise ValueError(f'Raw snapshot checksum mismatch: {word}')
        provenance.append(meta)
        for r in [json.loads(x) for x in data.decode().splitlines() if x.strip()]:
            if r.get('word') != word or r.get('lang_code') != 'en':
                raise ValueError(f'Unexpected entry identity: {word}')
            result = pick(r, ['word', 'lang_code', 'pos', 'etymology_number'])
            result['sounds'] = [pick(s, ['ipa', 'tags', 'audio', 'mp3_url', 'ogg_url']) for s in r.get('sounds', []) if s.get('ipa') or s.get('audio')]
            for s in result['sounds']:
                if s.get('audio'):
                    sounds[s['audio']] = s
            result['forms'] = [pick(f, ['form', 'tags']) for f in r.get('forms', [])]
            for key in ['derived', 'related', 'synonyms', 'antonyms']:
                result[key] = relations(r.get(key, []))
            result['translations'] = translations(r.get('translations', []))
            result['senses'] = []
            for s in r.get('senses', []):
                sense = pick(s, ['glosses', 'tags', 'senseid', 'id'])
                sense['examples'] = []
                for ex in s.get('examples', []):
                    if ex.get('type') == 'example' and not ex.get('ref'):
                        sense['examples'].append(pick(ex, ['text', 'type', 'bold_text_offsets', 'tags']))
                    else:
                        dropped += 1
                for key in ['synonyms', 'antonyms']:
                    sense[key] = relations(s.get(key, []))
                sense['translations'] = translations(s.get('translations', []))
                result['senses'].append(sense)
            records.append(result)

    # Commons metadata is individual to every file. Never apply the text license to audio.
    licenses = []
    for filename, sound in sounds.items():
        if not set(sound.get('tags', [])).intersection(['US', 'General-American', 'UK', 'Received-Pronunciation', 'Southern-England', 'British']):
            continue
        cache = ROOT / 'artifacts' / 'import' / (hashlib.sha256(filename.encode()).hexdigest()[:16] + '.commons.json')
        query = urlencode({'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'titles': 'File:' + filename})
        if '--cached' in sys.argv and not cache.exists():
            raise FileNotFoundError(f'Cached mode is offline; missing metadata cache: {filename}')
        if '--cached' not in sys.argv:
            time.sleep(1.5)
            cache.write_bytes(fetch('https://commons.wikimedia.org/w/api.php?' + query))
        response = json.loads(cache.read_bytes())
        for page in response.get('query', {}).get('pages', {}).values():
            if not page.get('imageinfo'):
                continue
            info = page['imageinfo'][0]
            ext = info.get('extmetadata', {})
            def value(key):
                return unescape(re.sub('<[^>]*>', '', str(ext.get(key, {}).get('value', '')))).strip()
            license_url = value('LicenseUrl').replace('http://', 'https://')
            author = value('Artist')
            public_domain = value('License') == 'pd' and value('Copyrighted').lower() == 'false'
            cc0 = value('License') == 'cc0' and license_url.startswith('https://creativecommons.org/publicdomain/zero/1.0')
            if public_domain:
                license_url = info['descriptionurl']
            cc = re.fullmatch(r'https://creativecommons.org/licenses/by(?:-sa)?/(?:[1-4]\.0|2\.5)(?:/|/us/deed.en)?', license_url)
            if not (cc or cc0 or public_domain) or not author or 'assumed' in author.lower() or value('Restrictions'):
                print('SKIP unverified/restricted audio', filename, flush=True)
                continue
            licenses.append({'file': filename, 'author': author, 'license': value('LicenseShortName'), 'licenseUrl': license_url, 'pageUrl': info['descriptionurl'], 'description': value('ImageDescription'), 'credit': value('Credit'), 'verifiedAt': datetime.now(timezone.utc).isoformat(), 'metadataUrl': 'https://commons.wikimedia.org/w/api.php?' + query, 'metadataSha256': hashlib.sha256(cache.read_bytes()).hexdigest()})
            print('AUDIO', filename, author, value('LicenseShortName'), flush=True)

    output = ROOT / 'public' / 'data'
    output.mkdir(parents=True, exist_ok=True)
    dataset = {'schemaVersion': 1, 'words': WORDS, 'license': 'CC BY-SA 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/', 'attribution': 'English Wiktionary contributors; extracted by Wiktextract / Kaikki.org (Tatu Ylonen and contributors).', 'modifications': 'Ten-headword subset; fields projected; external quotations removed; Chinese translations retained only for explicit mapping. No generated definitions or translations.', 'provenance': provenance, 'excludedExamples': dropped, 'records': records, 'audioLicenses': licenses}
    # Atomic replace: a failed refresh never leaves a partially imported production file.
    temporary = output / 'kaikki-subset.json.tmp'
    temporary.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(output / 'kaikki-subset.json')
    print('Saved', len(records), 'records;', len(licenses), 'verified audio licenses;', dropped, 'quotations/ambiguous examples excluded', flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if '--cached' not in sys.argv:
        download()
    project()
