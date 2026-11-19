import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseKaikkiDataset } from '../src/providers/kaikkiAdapter.ts';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const recipeVersion = 'audition-v1';
export const candidates = [
  ['azure', 'en-US', 'en-US-JennyNeural'], ['azure', 'en-US', 'en-US-GuyNeural'],
  ['google', 'en-US', 'en-US-Chirp3-HD-Aoede'], ['google', 'en-US', 'en-US-Chirp3-HD-Charon'],
  ['azure', 'en-GB', 'en-GB-SoniaNeural'], ['azure', 'en-GB', 'en-GB-RyanNeural'],
  ['google', 'en-GB', 'en-GB-Chirp3-HD-Aoede'], ['google', 'en-GB', 'en-GB-Chirp3-HD-Charon'],
].map(([provider, locale, voice]) => ({ provider, locale, voice, model: provider === 'azure' ? 'Neural' : 'Chirp3-HD' }));

export const terms = {
  azure: 'https://www.microsoft.com/licensing/terms/product/MicrosoftAzure/all',
  google: 'https://cloud.google.com/terms/',
};
export function buildPlan() {
  const entries = parseKaikkiDataset(JSON.parse(readFileSync(new URL('../public/data/kaikki-subset.json', import.meta.url), 'utf8')));
  const samples = ['create', 'creative', 'creativity', 'make-sense'].map(id => {
    const e = entries.find(e => e.id === id);
    return { id, target: { contentId: id, kind: e.kind, pronunciationId: 'entry-default' }, text: e.headword, note: id === 'make-sense' ? '短语连读与尾辅音' : '单词清晰度、音节与重音', source: e.source };
  });
  for (const [entryId, exampleId, note] of [
    ['creation', 'creation:noun:4:2cad546e:0:example:9e601935', '常规例句、缩写与句尾语调'],
    ['create', 'create:verb:0:69902ac:4:example:b56c6a5c', '长句、分号停顿、专有名词；不改写来源原文'],
  ]) {
    const entry = entries.find(e => e.id === entryId);
    const sense = entry.senses.find(s => s.examples.some(x => x.id === exampleId));
    const example = sense?.examples.find(x => x.id === exampleId);
    if (!example) throw new Error('Pinned M1 example changed; review audition plan before updating.');
    samples.push({ id: example.id, target: { contentId: example.id, kind: 'example', senseId: sense.id, pronunciationId: 'sentence-default' }, text: example.text, note, source: example.source });
  }
  // Authored test material only: these never enter the dictionary provider or search index.
  for (const d of [
    { id: 'record-noun-context', text: 'This is a record of our work.', note: '上下文自动判断：record 名词，第一音节重读' },
    { id: 'record-verb-context', text: 'Please record the next sentence.', note: '上下文自动判断：record 动词，第二音节重读' },
    { id: 'record-noun', text: 'record', ipa: { 'en-US': 'ˈrɛkɚd', 'en-GB': 'ˈrɛkɔːd' }, note: '强制音素诊断：record 名词，第一音节重读' },
    { id: 'record-verb', text: 'record', ipa: { 'en-US': 'rɪˈkɔrd', 'en-GB': 'rɪˈkɔːd' }, note: '强制音素诊断：record 动词，第二音节重读' },
    { id: 'read-present', text: 'read', ipa: { 'en-US': 'riːd', 'en-GB': 'riːd' }, note: '强制音素诊断：read 原形 /riːd/' },
    { id: 'read-past', text: 'read', ipa: { 'en-US': 'rɛd', 'en-GB': 'rɛd' }, note: '强制音素诊断：read 过去式 /rɛd/' },
  ]) samples.push({ ...d, id: `diagnostic:${d.id}`, target: { contentId: `diagnostic:${d.id}`, kind: 'diagnostic', pronunciationId: d.id }, source: { title: '项目自编试听诊断；非词典词条', attribution: '本项目自编评测文本', license: 'Project-authored evaluation text', isTestData: true } });
  const resources = samples.flatMap(sample => candidates.map(candidate => {
    const identity = { target: sample.target, text: sample.text, ipa: sample.ipa?.[candidate.locale] ?? null, ...candidate, recipeVersion, output: 'mp3' };
    return {
      id: sha256(JSON.stringify(identity)), target: sample.target, text: sample.text, textSha256: sha256(sample.text),
      ...candidate, source: 'neural', voiceVersion: null, recipeVersion,
      license: { name: candidate.provider === 'azure' ? 'Azure paid-tier TTS output terms' : 'Google Cloud TTS output terms', url: terms[candidate.provider], attribution: `AI 合成语音 · ${candidate.provider} ${candidate.voice}；文本：${sample.source.attribution}`, sourceUrl: sample.source.referenceUrl, textLicense: sample.source.license, textLicenseUrl: sample.source.licenseUrl, termsCheckedAt: '2026-11-11' },
      generation: { status: 'planned', attempts: 0 }, review: { status: 'pending' },
    };
  }));
  return { schemaVersion: 1, stage: 'audition-only', recipeVersion, samples, candidates, resources };
}

const xml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function synthesisBody(resource, sample) {
  const ipa = sample.ipa?.[resource.locale];
  const body = ipa ? `<phoneme alphabet="ipa" ph="${xml(ipa)}">${xml(resource.text)}</phoneme>` : xml(resource.text);
  if (resource.provider === 'azure') return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${resource.locale}"><voice name="${resource.voice}">${body}</voice></speak>`;
  // Chirp HD SSML is Preview. Use it only for the four explicit phoneme tests.
  return { input: ipa ? { ssml: `<speak>${body}</speak>` } : { text: resource.text }, voice: { languageCode: resource.locale, name: resource.voice }, audioConfig: { audioEncoding: 'MP3' } };
}
