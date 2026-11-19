import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCurrentExamples, verifyExamples, readJson} from './exampleTranslations.mjs';
import {verifyContent} from './chineseContent.ts';

test('all display examples have a reviewed translation and retain the ten pilot records', () => {
  assert.deepEqual(verifyCurrentExamples(), {checked:95, reviewed:95, missing:0});
});

test('example pilot is bound to frozen examples and exact approved revisions', () => {
  const bundle = readJson('content/example-translations-v1.json');
  const batches = readJson('content/reviews/example-pilot-v1.json');
  const {registry} = verifyContent().inventory;
  assert.deepEqual(verifyExamples(bundle,batches,registry), {checked:95,reviewed:10,missing:85});
  for (const key of ['senseId','translation','englishText','status','reviewId']) {
    const changed = structuredClone(bundle);
    changed.records[0][key] += 'changed';
    assert.throws(() => verifyExamples(changed,batches,registry));
  }
});
