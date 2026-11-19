import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleDictionary, normalizeQuery } from './sampleDictionary.ts';
import { externalVideoProvider } from './externalVideo.ts';
import { sampleEntries } from '../data/samples.ts';

test('case and whitespace normalize without merging phrases or derivations', async () => {
  assert.equal(normalizeQuery('  MAKE   sense  '), 'make sense');
  assert.equal((await sampleDictionary.search(' MAKE   sense '))[0].entry.id, 'make-sense');
  assert.equal((await sampleDictionary.search('creative'))[0].entry.id, 'creative');
  assert.equal(sampleDictionary.resolveSurface('creation')?.entryId, 'creation');
  assert.equal((await sampleDictionary.search('make-senses')).length, 0);
});

test('inflections resolve to lemma and retain the original form', async () => {
  const [result] = await sampleDictionary.search('CREATED');
  assert.equal(result.entry.id, 'create');
  assert.equal(result.matchedForm, 'created');
  assert.equal(sampleDictionary.resolveSurface('made')?.entryId, 'make');
  assert.equal(sampleDictionary.resolveSurface('unlisted'), undefined);
});

test('all lexical links resolve, with unique entry / sense / example identities', () => {
  const ids = new Set(sampleEntries.map(entry => entry.id));
  assert.equal(ids.size, 10);
  const allIds: string[] = [];
  for (const entry of sampleEntries) {
    assert.equal(entry.source.isTestData, true);
    const links = [...entry.wordFamily, ...entry.wordForms, ...entry.phrases, ...entry.keywords];
    for (const sense of entry.senses) {
      allIds.push(sense.id, ...sense.examples.map(example => example.id));
      assert.ok(sense.examples.length >= 2 && sense.examples.length <= 4);
      assert.equal(sense.source.isTestData, true);
      for (const example of sense.examples) assert.equal(example.source.isTestData, true);
      links.push(...sense.synonyms, ...sense.antonyms);
    }
    for (const link of links) assert.ok(ids.has(link.entryId), `${entry.id} has broken link ${link.entryId}`);
  }
  assert.equal(new Set(allIds).size, allIds.length);
});

test('family, forms, sense relations and phrase identity remain separate', async () => {
  const create = (await sampleDictionary.getEntry('create'))!;
  assert.ok(create.wordFamily.some(link => link.entryId === 'creative'));
  assert.ok(!create.wordForms.some(link => link.entryId === 'creative'));
  assert.deepEqual(create.senses[1].synonyms, []);
  assert.ok(create.senses[0].synonyms.some(link => link.entryId === 'make'));
  const phrase = (await sampleDictionary.getEntry('make-sense'))!;
  assert.equal(phrase.kind, 'phrase');
  assert.equal(phrase.headword, 'make sense');
  assert.notEqual(phrase.id, 'make');
});

test('examples are fetched per sense, missing data is explicit', async () => {
  assert.equal((await sampleDictionary.getExamples('create:cause')).length, 2);
  assert.deepEqual(await sampleDictionary.getExamples('missing:sense'), []);
  assert.equal(await sampleDictionary.getEntry('missing'), undefined);
  assert.deepEqual(await sampleDictionary.search('<script>'), []);
});

test('video adapter exposes an encoded external URL, with explicit accent and no embed claim', () => {
  const result = externalVideoProvider.getVideo('make sense', 'US');
  assert.equal(result.status, 'external-only');
  if (result.status === 'external-only') assert.equal(result.url, 'https://youglish.com/pronounce/make%20sense/english/us');
  const uk = externalVideoProvider.getVideo('create', 'UK');
  if (uk.status === 'external-only') assert.ok(uk.url.endsWith('/uk'));
  assert.equal(externalVideoProvider.getVideo(' ', 'US').status, 'unavailable');
});
