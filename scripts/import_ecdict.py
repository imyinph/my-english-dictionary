"""Bounded, reproducible local ECDICT import. No data is written to public/ or dist/."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = '39cfb9672c0906b63569e0453c2e6abfb9ab182a'
CSV_BYTES = 66009548
CSV_BLOB = '0e527e22e0e0d22f012b0ed251a8dddd5891773b'
BASE = f'https://raw.githubusercontent.com/skywind3000/ECDICT/{COMMIT}/'
CACHE = ROOT / 'artifacts/ecdict'
POS = {'n': 'noun', 'v': 'verb', 'vt': 'verb', 'vi': 'verb', 'a': 'adjective', 'adj': 'adjective', 's': 'adjective', 'adv': 'adverb', 'ad': 'adverb', 'r': 'adverb', 'prep': 'preposition', 'pron': 'pronoun', 'conj': 'conjunction', 'int': 'interjection'}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def file_hash(path, algorithm='sha256', git_blob=False):
    digest = hashlib.new(algorithm)
    if git_blob:
        digest.update(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def download(name, maximum):
    destination = CACHE / 'source' / name
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + '.partial')
    request = urllib.request.Request(BASE + name, headers={'User-Agent': 'PersonalDictionary-ecdict-import'})
    total = 0
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
        for block in iter(lambda: response.read(256 * 1024), b''):
            total += len(block)
            if total > maximum:
                raise ValueError(f'{name}: download exceeds bound')
            output.write(block)
    if name == 'ecdict.csv' and (total != CSV_BYTES or file_hash(temporary, 'sha1', True) != CSV_BLOB):
        raise ValueError('ECDICT blob/size mismatch; partial download retained, existing data untouched')
    os.replace(temporary, destination)
    return destination


def normalize_word(value):
    # Preserve punctuation and phrase spaces; do not conflate lemmas or strip hyphens.
    return ' '.join(value.split()).casefold()


def split_sections(value):
    """POS-qualified segments only; English and Chinese arrays remain unaligned."""
    sections = []
    for number, raw in enumerate(value.replace('\\n', '\n').splitlines(), 1):
        value = ' '.join(raw.split())
        if not value:
            continue
        marker = re.match(r'^\(?([a-z]+(?:\s*(?:/|&|,)\s*[a-z]+)*)\.?\)?[.\s]+(.*)$', value, re.I)
        names, body = [], value
        if marker:
            tokens = re.split(r'\s*(?:/|&|,)\s*', marker.group(1).lower())
            if all(token in POS for token in tokens):
                names, body = sorted({POS[token] for token in tokens}), marker.group(2).strip()
        sections.append({'sourceLine': number, 'text': body, 'partOfSpeech': names, 'originalText': raw})
    return sections


def import_dataset(path, words, version, source_url=None):
    if path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('CSV exceeds 100 MiB limit')
    digest = file_hash(path)
    selected, seen, duplicates, anomalies = [], {}, [], []
    scanned = invalid = blank = 0
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.reader(stream, strict=True)
        header = next(reader)
        if len(set(header)) != len(header) or not {'word', 'definition', 'translation', 'pos'}.issubset(header):
            raise ValueError('Unsupported ECDICT CSV header')
        for record_number, values in enumerate(reader, 1):
            scanned += 1
            if len(values) != len(header):
                invalid += 1
                if len(anomalies) < 30:
                    anomalies.append({'dataRecordNumber': record_number, 'physicalEndLine': reader.line_num, 'reason': 'column_count', 'columns': len(values)})
                continue
            raw = dict(zip(header, values))
            word = normalize_word(raw['word'])
            if not word:
                blank += 1
                continue
            if word not in words:
                continue
            payload = json.dumps(raw, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            row_hash = hashlib.sha256(payload.encode()).hexdigest()
            locator = {'dataRecordNumber': record_number, 'physicalEndLine': reader.line_num, 'recordSha256': row_hash}
            definitions = split_sections(raw['definition'])
            translations = split_sections(raw['translation'])
            canonical = {'word': word, 'definition': [(item['partOfSpeech'], item['text']) for item in definitions],
                         'translation': [(item['partOfSpeech'], item['text']) for item in translations]}
            canonical_hash = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            if canonical_hash in seen:
                selected[seen[canonical_hash]]['duplicateLocations'].append(locator)
                duplicates.append(locator)
                continue
            errors = []
            if not definitions:
                errors.append('missing_english_definition')
            if not translations:
                errors.append('missing_chinese_translation')
            if any(not section['partOfSpeech'] for section in definitions + translations):
                errors.append('unlabelled_pos_segments')
            seen[canonical_hash] = len(selected)
            selected.append({
                'recordId': f'ecdict:{version}:data-row:{record_number}',
                'word': word, 'raw': raw, 'locator': locator, 'duplicateLocations': [],
                'definitions': definitions, 'translations': translations,
                'corpusPos': raw['pos'], 'issues': errors,
                'bilingualAlignment': 'not_provided', 'upstreamRecordOrigin': 'not_provided',
            })
    index = {}
    for record in selected:
        index.setdefault(record['word'], []).append(record['recordId'])
    return {
        'schemaVersion': 1, 'datasetVersion': version,
        'source': {'name': 'ECDICT', 'url': source_url, 'sha256': digest, 'bytes': path.stat().st_size,
                   'repositoryLicense': 'MIT', 'contentLicenseStatus': 'upstream_unresolved',
                   'distribution': 'local-review-only', 'recordIdConvention': 'one-based data row excluding CSV header; not a semantic sense ID'},
        'scope': sorted(words), 'index': index, 'records': selected,
        'statistics': {'csvRecordsScanned': scanned, 'invalidColumnRows': invalid, 'blankWords': blank,
                       'selectedUniqueRecords': len(selected), 'duplicateSelectedRows': len(duplicates),
                       'selectedRecordsWithIssues': sum(bool(record['issues']) for record in selected),
                       'duplicateScope': 'current-headwords-only'},
        'duplicates': duplicates, 'anomalies': anomalies,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true', help='Download the pinned CSV and repository notices once')
    parser.add_argument('--input', type=Path, help='Read a local ECDICT CSV; no implicit network request')
    parser.add_argument('--dataset-version', help='Required label for a custom input file')
    parser.add_argument('--verify', action='store_true', help='Re-derive the index and compare without writing it')
    args = parser.parse_args()
    if args.fetch and args.input:
        parser.error('--fetch and --input are mutually exclusive')
    if args.input and not args.dataset_version:
        parser.error('--input requires --dataset-version')
    if args.fetch:
        for name, limit in [('LICENSE', 32768), ('README.md', 65536), ('ecdict.csv', CSV_BYTES)]:
            download(name, limit)
    path = args.input or CACHE / 'source/ecdict.csv'
    if not args.input and (path.stat().st_size != CSV_BYTES or file_hash(path, 'sha1', True) != CSV_BLOB):
        raise ValueError('Cached CSV does not match pinned Git blob; no output changed')
    source = json.loads((ROOT / 'public/data/kaikki-subset.json').read_text(encoding='utf-8'))
    result = import_dataset(path, {normalize_word(word) for word in source['words']}, args.dataset_version or COMMIT, None if args.input else BASE + 'ecdict.csv')
    # Keep raw selected fields inside the index so every normalized segment can be re-derived.
    if args.verify:
        previous = json.loads((CACHE / 'index.json').read_text(encoding='utf-8'))
        if result != previous:
            raise ValueError('Index differs from reproducible CSV import; existing index retained')
    else:
        write_json(CACHE / 'index.json', result)
    print(json.dumps({'verifiedWithoutWrites': args.verify, 'datasetVersion': result['datasetVersion'], 'sha256': result['source']['sha256'], 'coveredWords': len(result['index']), **result['statistics']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
