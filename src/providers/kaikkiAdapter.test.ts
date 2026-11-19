import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKaikkiDataset, accentsFromTags } from './kaikkiAdapter.ts';
import { createDictionaryProvider } from './dictionary.ts';

const snapshot = JSON.parse(readFileSync(new URL('../../public/data/kaikki-subset.json', import.meta.url), 'utf8'));
const fixture = (records: unknown[], extra = {}) => ({ schemaVersion: 1, license: 'CC BY-SA 4.0', records, ...extra });

test('real snapshot has ten traceable entries with separate identities, sources and phrase route', () => {
  const entries = parseKaikkiDataset(snapshot);
  assert.equal(entries.length, 10);
  assert.equal(entries.find(entry => entry.id === 'make-sense')?.kind, 'phrase');
  const ids = entries.flatMap(entry => [entry.id, ...entry.senses.flatMap(sense => [sense.id, ...sense.examples.map(example => example.id)])]);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of entries) {
    assert.equal(entry.source.isTestData, false);
    assert.ok(entry.source.referenceUrl?.startsWith('https://en.wiktionary.org/'));
    assert.ok(entry.source.extractionUrl?.startsWith('https://kaikki.org/'));
    assert.ok(entry.source.historyUrl);
    for (const sense of entry.senses) assert.ok(sense.source.licenseUrl);
    for (const recording of entry.recordings ?? []) assert.ok(recording.author && recording.licenseUrl && recording.pageUrl && recording.verifiedAt);
  }
});

test('missing optional fields remain missing; malformed records never generate content', () => {
  const [entry] = parseKaikkiDataset(fixture([{ word: 'create', lang_code: 'en', pos: 'verb', senses: [{ glosses: ['To bring into existence.'] }, { examples: [{ text: 'no gloss' }] }] }]));
  assert.equal(entry.senses.length, 1);
  assert.equal(entry.senses[0].translation, undefined);
  assert.equal(entry.senses[0].explanation, undefined);
  assert.deepEqual(entry.senses[0].examples, []);
  assert.deepEqual(entry.pronunciations, []);
  assert.deepEqual(entry.recordings, []);
  assert.throws(() => parseKaikkiDataset({ records: [] }));
  assert.throws(() => parseKaikkiDataset(fixture([{ word: 'create', lang_code: 'fr' }])));
});

test('sense mapping is exact: unassigned relations/translations do not leak into every meaning', () => {
  const [entry] = parseKaikkiDataset(fixture([{ word: 'create', lang_code: 'en', pos: 'verb',
    synonyms: [{ word: 'destroy' }, { word: 'make', sense: 'Produce something' }],
    translations: [{ code: 'cmn', word: '制造', sense: 'Produce something' }, { code: 'cmn', word: '不应匹配', sense: 'produce' }],
    senses: [{ glosses: ['Produce something.'] }, { glosses: ['Produce something.', 'Confer a title.'] }],
  } ]));
  assert.equal(entry.senses[0].translation, '制造');
  assert.equal(entry.senses[1].translation, undefined);
  assert.deepEqual(entry.senses[0].synonyms.map(item => item.label), ['make']);
  assert.deepEqual(entry.senses[1].synonyms, []);
});

test('external quotations and ambiguous examples are excluded, code-point highlights survive emoji', () => {
  const [entry] = parseKaikkiDataset(fixture([{ word: 'create', lang_code: 'en', senses: [{ glosses: ['Create.'], examples: [
    { text: 'A quote.', type: 'quotation', ref: 'A contemporary book' },
    { text: 'Unclear.' }, { text: 'Also quoted.', type: 'example', ref: 'A book' },
    { text: '😀 create', type: 'example', bold_text_offsets: [[2, 8]] },
  ] }] }]));
  assert.equal(entry.senses[0].examples.length, 1);
  assert.deepEqual(entry.senses[0].examples[0].highlights, ['create']);
  assert.equal(entry.senses[0].examples[0].translation, undefined);
});

test('word family is source-linked, forms preserve grammar and do not treat alternative spellings as inflections', () => {
  const [entry] = parseKaikkiDataset(fixture([{ word: 'create', lang_code: 'en', pos: 'verb',
    related: [{ word: 'creative' }], forms: [{ form: 'created', tags: ['past'] }, { form: 'creäte', tags: ['alternative'] }, { form: 'no-table-tags', tags: ['table-tags'] }],
    senses: [{ glosses: ['Bring into existence.'], synonyms: [{ word: 'generate' }] }],
  }]));
  assert.equal(entry.wordFamily[0].entryId, 'creative');
  assert.deepEqual(entry.wordForms.map(item => item.label), ['created']);
  assert.equal(entry.senses[0].synonyms[0].externalUrl, 'https://en.wiktionary.org/wiki/generate#English');
});

test('audio needs a verified individual license and safe URLs; unknown region is never called US', () => {
  const [entry] = parseKaikkiDataset(fixture([{ word: 'create', lang_code: 'en', sounds: [
    { ipa: '/example/', tags: ['Australia'] }, { audio: 'unknown.ogg', tags: ['US'], mp3_url: 'https://upload.wikimedia.org/test.mp3' },
    { audio: 'unsafe.ogg', tags: ['US'], mp3_url: 'javascript:alert(1)' },
  ] }], { audioLicenses: [{ file: 'unsafe.ogg', author: 'A', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', pageUrl: 'https://commons.wikimedia.org/wiki/File:unsafe.ogg', verifiedAt: '2026-11-10' }] }));
  assert.deepEqual(entry.recordings, []);
  assert.deepEqual(entry.pronunciations?.[0].accents, []);
  assert.deepEqual(accentsFromTags(['Southern-England']), ['UK']);
  assert.deepEqual(accentsFromTags(['General-American']), ['US']);
  assert.deepEqual(accentsFromTags(['Australia']), []);
});

test('provider loads once, keeps phrase/form navigation and can retry after network failure', async () => {
  let calls = 0;
  const provider = createDictionaryProvider(async () => { calls++; if (calls === 1) throw new Error('network'); return snapshot; });
  await assert.rejects(provider.search('create'));
  const [match] = await provider.search(' CREATED ');
  assert.equal(match.entry.id, 'create');
  assert.equal(match.matchedForm, 'created');
  assert.equal((await provider.search('MAKE   SENSE'))[0].entry.id, 'make-sense');
  assert.equal(provider.resolveSurface('creative')?.entryId, 'creative');
  assert.equal(provider.resolveSurface('made')?.entryId, 'make');
  await provider.getEntry('sense');
  assert.equal(calls, 2);
});

test('snapshot excludes quoted works and retains original file provenance checksums', () => {
  assert.equal(snapshot.provenance.length, 10);
  assert.ok(snapshot.excludedExamples > 0);
  for (const item of snapshot.provenance) assert.match(item.sha256, /^[a-f0-9]{64}$/u);
  for (const record of snapshot.records) for (const sense of record.senses) for (const example of sense.examples) {
    assert.equal(example.type, 'example'); assert.equal(example.ref, undefined);
  }
});
