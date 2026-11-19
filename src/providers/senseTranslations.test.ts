import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSenseTranslationProvider, parsePublishedTranslations } from './senseTranslations.ts';
import { parseKaikkiDataset } from './kaikkiAdapter.ts';

const snapshot = JSON.parse(readFileSync(new URL('../../public/data/kaikki-subset.json', import.meta.url), 'utf8'));
const publication = JSON.parse(readFileSync(new URL('../../public/data/chinese-senses.json', import.meta.url), 'utf8'));
const entries = parseKaikkiDataset(snapshot);
const creation = entries.find(entry => entry.id === 'creation')!;

test('runtime Chinese provider loads once and matches all real senses by exact identity', async () => {
  let calls = 0; const provider = createSenseTranslationProvider(async () => { calls++; return publication; });
  for (const entry of entries) assert.equal((await provider.forEntry(entry.id, entry.senses)).size, entry.senses.length);
  assert.equal(calls, 1);
});

test('runtime rejects unreviewed content, stale versions, duplicates and unresolved license', () => {
  for (const mutate of [
    (data: typeof publication) => { data.dictionaryVersion = 'bad'; },
    (data: typeof publication) => { data.senses.push(data.senses[0]); },
    (data: typeof publication) => { data.senses[0].glosses = ['未经审核']; data.senses[0].reviewStatus = 'pending'; data.senses[0].translationStatus = 'candidate'; },
    (data: typeof publication) => { data.senses.find((record: { source: unknown }) => record.source).source.licenseStatus = 'upstream_unresolved'; },
  ]) { const data = structuredClone(publication); mutate(data); assert.throws(() => parsePublishedTranslations(data)); }
});

test('runtime Chinese network failure and context mismatch both permit retry', async () => {
  let calls = 0; const bad = structuredClone(publication); bad.senses.find((record: { entryId: string }) => record.entryId === 'creation').englishText = 'Wrong sense';
  const provider = createSenseTranslationProvider(async () => { calls++; if (calls === 1) throw new Error('network'); return calls === 2 ? bad : publication; });
  await assert.rejects(provider.forEntry(creation.id, creation.senses), /network/u);
  await assert.rejects(provider.forEntry(creation.id, creation.senses), /对应/u);
  assert.equal((await provider.forEntry(creation.id, creation.senses)).size, 3); assert.equal(calls, 3);
});

test('runtime does not accept the same spelling under a different parent or POS', async () => {
  for (const field of ['entryId', 'partOfSpeech']) {
    const bad = structuredClone(publication); bad.senses.find((record: { entryId: string }) => record.entryId === 'creation')[field] = 'other';
    const provider = createSenseTranslationProvider(async () => bad);
    await assert.rejects(provider.forEntry(creation.id, creation.senses), /对应/u);
  }
});
