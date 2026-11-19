"""Small network probe for approved audio URLs. Does not play or retain audio."""
from pathlib import Path
from urllib.request import Request, urlopen
from datetime import datetime, timezone
import json
import time
import sys
from urllib.error import HTTPError

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parent.parent
data = json.loads((root / 'public/data/kaikki-subset.json').read_text(encoding='utf-8'))
licensed = {item['file'] for item in data['audioLicenses']}
files = {sound['audio']: sound for record in data['records'] for sound in record.get('sounds', []) if sound.get('audio') in licensed}
results = []
rate_limited = False
for filename, sound in files.items():
    if rate_limited:
        results.append({'file': filename, 'reachable': False, 'attempts': [], 'skipped': 'Stopped after HTTP 429; not tested.'})
        continue
    attempts = []
    for url in [sound.get('mp3_url'), sound.get('ogg_url')]:
        if not url:
            continue
        try:
            request = Request(url, headers={'User-Agent': 'PersonalDictionaryM1/0.1', 'Range': 'bytes=0-63'})
            with urlopen(request, timeout=10) as response:
                first_bytes = response.read(64)
                kind = response.headers.get('Content-Type', '')
                success = response.status in [200, 206] and ('audio' in kind or 'ogg' in kind) and bool(first_bytes)
                attempts.append({'url': url, 'status': response.status, 'contentType': kind, 'bytesInspected': len(first_bytes), 'success': success})
                if success:
                    break
        except HTTPError as error:
            attempts.append({'url': url, 'success': False, 'error': str(error)})
            if error.code == 429:
                rate_limited = True
                break
        except Exception as error:
            attempts.append({'url': url, 'success': False, 'error': str(error)})
        time.sleep(1)
    results.append({'file': filename, 'reachable': any(item['success'] for item in attempts), 'attempts': attempts})
    print(filename, 'reachable' if results[-1]['reachable'] else 'unavailable', flush=True)
    time.sleep(1)
out = root / 'artifacts' / 'audio-network.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), 'limitation': 'HTTP and content-type check only; not an audible playback or iPhone test.', 'results': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(sum(item['reachable'] for item in results), '/', len(results), 'reachable', flush=True)
