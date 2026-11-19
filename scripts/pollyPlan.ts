import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseKaikkiDataset } from '../src/providers/kaikkiAdapter.ts';
import type { DictionaryEntry } from '../src/domain/dictionary.ts';
import type { AudioResource, AudioTarget, PollyVoice } from '../src/domain/audio.ts';
import { sha256 } from './audioFiles.ts';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const voices: PollyVoice[] = ['Joanna', 'Stephen'];
export interface Rule { target: AudioTarget; expectedText: string; version: string; ipa: string; sourceUrl: string; reviewedBy: string; reviewedAt: string }
export const targetKey = (t: AudioTarget) => JSON.stringify([t.kind, t.contentId, t.senseId ?? '', t.pronunciationId]);
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function buildPollyPlan(entries: DictionaryEntry[], rules: Rule[] = []) {
  const contents: { target: AudioTarget; text: string; context: string; source: DictionaryEntry['source'] }[] = [];
  for (const e of entries) {
    const entryTarget: AudioTarget = { contentId: e.id, kind: e.kind, pronunciationId: 'entry-default' };
    contents.push({ target: entryTarget, text: e.headword, context: `lexeme:${e.kind}:${e.id}:${e.headword}`, source: e.source });
    for (const s of e.senses) {
      for (const x of s.examples) contents.push({ target: { contentId: x.id, kind: 'example', senseId: s.id, pronunciationId: 'sentence-default' }, text: x.text, context: JSON.stringify([e.headword, s.partOfSpeech, s.definition, s.tags ?? []]), source: x.source });
      for (const rule of rules.filter(r => r.target.contentId === e.id && r.target.senseId === s.id && r.target.kind === e.kind)) contents.push({ target: rule.target, text: e.headword, context: JSON.stringify([e.headword, s.partOfSpeech, s.definition]), source: e.source });
    }
  }
  const seenRules = new Set<string>();
  for (const r of rules) {
    if (seenRules.has(targetKey(r.target)) || !r.version || !r.ipa || !/^https:\/\//.test(r.sourceUrl) || !r.reviewedBy || !r.reviewedAt) throw new Error('Pronunciation rule requires unique target, source, version and review.');
    seenRules.add(targetKey(r.target));
    if (!contents.some(c => targetKey(c.target) === targetKey(r.target) && c.text === r.expectedText)) throw new Error('Stale or unknown pronunciation rule target/text.');
  }
  const resources = new Map<string, AudioResource>();
  for (const content of contents) {
    const rule = rules.find(r => targetKey(r.target) === targetKey(content.target));
    const requestText = rule ? `<speak><phoneme alphabet="ipa" ph="${escapeXml(rule.ipa)}">${escapeXml(content.text)}</phoneme></speak>` : content.text;
    const recipeVersion = `polly-v1:${rule?.version ?? 'natural'}`;
    if (!content.text.trim() || [...content.text].length > 3000 || [...requestText].length > 6000) throw new Error('Polly synchronous input length exceeded or empty text.');
    for (const voice of voices) {
      const synthesis = { engine: 'neural' as const, languageCode: 'en-US' as const, sampleRate: '24000' as const, textType: rule ? 'ssml' as const : 'text' as const, requestText, billableCharacters: [...content.text].length, contextKey: content.context };
      const id = sha256(JSON.stringify({ voice, ...synthesis, recipeVersion, format: 'mp3' }));
      const previous = resources.get(id);
      if (previous) { if (!previous.targets!.some(t => targetKey(t) === targetKey(content.target))) previous.targets!.push(content.target); continue; }
      resources.set(id, { id, target: content.target, targets: [content.target], publication: 'production', text: content.text, textSha256: sha256(content.text), locale: 'en-US', provider: 'Amazon Polly', source: 'neural', model: 'neural', voice, voiceVersion: null, recipeVersion, synthesis,
        license: { name: 'Amazon Polly output; input text rights retained', url: 'https://aws.amazon.com/polly/faqs/', attribution: `AI 合成语音：Amazon Polly ${voice} Neural；文本：${content.source.attribution}`, sourceUrl: content.source.referenceUrl, textLicense: content.source.license, textLicenseUrl: content.source.licenseUrl, termsCheckedAt: '2026-11-13' }, generation: { status: 'planned', attempts: 0 }, review: { status: 'pending', notes: '用户已选定音色；逐条真机播放验收待完成。' } });
    }
  }
  return { schemaVersion: 1 as const, scannedContents: contents.length, contentTypes: Object.fromEntries(['word', 'phrase', 'example'].map(kind => [kind, contents.filter(c => c.target.kind === kind).length])), resources: [...resources.values()] };
}
export function loadPollyPlan() {
  return buildPollyPlan(parseKaikkiDataset(JSON.parse(readFileSync(new URL('../public/data/kaikki-subset.json', import.meta.url), 'utf8'))), JSON.parse(readFileSync(new URL('../config/polly-pronunciations.json', import.meta.url), 'utf8')).rules);
}
