import type { Accent, ContentSource, DictionaryEntry, EntryLink, Example, Recording, Sense, WordForm } from '../domain/dictionary.ts';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const unique = <T,>(values: T[], key: (value: T) => string): T[] => [...new Map(values.map(value => [key(value), value])).values()];
export const normalizeQuery = (value: string) => value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
const matchGloss = (value: string) => normalizeQuery(value).replace(/[.;:]+$/u, '');
const entryId = (word: string) => word === 'make sense' ? 'make-sense' : word;
export const M1_WORDS = ['create', 'creative', 'creation', 'creator', 'creatively', 'creativity', 'make', 'destroy', 'make sense', 'sense'];
const posNames: Record<string, string> = { adj: 'adjective', adv: 'adverb', noun: 'noun', verb: 'verb', phrase: 'phrase' };

// A stable content fingerprint, not a security hash. Source snapshot SHA-256 is retained separately.
function hash(value: string) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0)!, 16777619);
  return (result >>> 0).toString(16);
}

export function accentsFromTags(tags: string[]): Accent[] {
  const result: Accent[] = [];
  if (tags.some(tag => ['US', 'General-American'].includes(tag))) result.push('US');
  if (tags.some(tag => ['UK', 'Received-Pronunciation', 'Southern-England', 'British'].includes(tag))) result.push('UK');
  return result;
}

function allowedUrl(value: unknown, host: string): string | undefined {
  try { const url = new URL(text(value)); return url.protocol === 'https:' && url.hostname === host ? url.href : undefined; } catch { return undefined; }
}

function link(word: string, note?: string): EntryLink {
  return { entryId: entryId(word), label: word, note, ...(!M1_WORDS.includes(word) ? { externalUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replaceAll(' ', '_'))}#English` } : {}) };
}

function linked(items: unknown, glosses?: string[]) {
  return unique(rows(items).filter(item => !glosses || (text(item.sense) && glosses.some(gloss => matchGloss(gloss) === matchGloss(text(item.sense))))).flatMap(item => text(item.word) ? [link(text(item.word))] : []), x => x.label);
}

function chinese(items: unknown, glosses?: string[]) {
  return unique(rows(items).filter(item => ['cmn', 'zh'].includes(text(item.code)) && (!glosses || (text(item.sense) && glosses.some(gloss => matchGloss(gloss) === matchGloss(text(item.sense)))))).map(item => text(item.word)).filter(Boolean), x => x).join('；') || undefined;
}

/** Optional import-time observer; never changes the IDs or runtime parsing policy. */
export interface SenseLocation { entryId: string; recordIndex: number; senseIndex: number }
export function parseKaikkiDataset(input: unknown, onSense?: (sense: Sense, location: SenseLocation) => void): DictionaryEntry[] {
  const data = object(input);
  if (data.schemaVersion !== 1 || !Array.isArray(data.records) || data.license !== 'CC BY-SA 4.0') throw new Error('不支持的词典数据格式或许可元数据。');
  const provenance = rows(data.provenance);
  const licenseRows = rows(data.audioLicenses);
  const entries = new Map<string, DictionaryEntry>();
  rows(data.records).forEach((record, recordIndex) => {
    const word = text(record.word);
    if (!M1_WORDS.includes(word) || record.lang_code !== 'en') return;
    const id = entryId(word);
    const originalUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replaceAll(' ', '_'))}`;
    const meta = provenance.find(item => item.word === word);
    const source: ContentSource = {
      id: `wiktionary:${word}`, title: 'English Wiktionary · Kaikki / Wiktextract', license: 'CC BY-SA 4.0',
      attribution: 'English Wiktionary contributors; Wiktextract / Kaikki.org (Tatu Ylonen and contributors).',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', referenceUrl: `${originalUrl}#English`,
      historyUrl: `https://en.wiktionary.org/w/index.php?title=${encodeURIComponent(word.replaceAll(' ', '_'))}&action=history`,
      extractionUrl: allowedUrl(meta?.url, 'kaikki.org'), retrievedAt: text(meta?.retrievedAt),
      modifications: '仅截取本阶段词条；字段映射；移除外部引文；按原义项组织。未生成或改写释义、例句、翻译。', isTestData: false,
    };
    const entry: DictionaryEntry = entries.get(id) ?? { id, kind: word.includes(' ') ? 'phrase' : 'word', headword: word, senses: [], wordFamily: [], wordForms: [], phrases: [], keywords: [], pronunciations: [], recordings: [], source };
    const forms: WordForm[] = rows(record.forms).flatMap(form => {
      const label = text(form.form), tags = strings(form.tags);
      if (!label || label === word || ['-', '—', 'no-table-tags'].includes(label) || tags.some(tag => ['table-tags', 'alternative', 'romanization', 'canonical'].includes(tag))) return [];
      if (!tags.some(tag => ['past', 'present', 'participle', 'plural', 'comparative', 'superlative', 'possessive'].includes(tag))) return [];
      return [{ entryId: id, label, grammaticalForm: tags.join(' · ') }];
    });
    entry.wordForms = unique([...entry.wordForms, ...forms], form => `${form.label}:${form.grammaticalForm}`);
    rows(record.senses).forEach((raw, senseIndex) => {
      const glosses = strings(raw.glosses);
      if (!glosses.length) return; // A malformed/missing gloss is not an invitation to generate one.
      const senseId = `${id}:${text(record.pos)}:${record.etymology_number ?? recordIndex}:${hash(glosses.join('|'))}:${senseIndex}`;
      const examples: Example[] = rows(raw.examples).filter(example => example.type === 'example' && !text(example.ref) && text(example.text)).map(example => {
        const sentence = text(example.text);
        // Wiktextract offsets count Unicode code points, not UTF-16 code units.
        const chars = Array.from(sentence);
        const highlights = Array.isArray(example.bold_text_offsets) ? example.bold_text_offsets.flatMap(range => {
          if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[1] > chars.length || range[1] <= range[0]) return [];
          return [chars.slice(range[0], range[1]).join('')];
        }) : [];
        return { id: `${senseId}:example:${hash(sentence)}`, text: sentence, highlights: highlights.length ? highlights : [word], source };
      });
      const sense: Sense = {
        id: senseId, partOfSpeech: posNames[text(record.pos)] ?? (text(record.pos) || 'unspecified'),
        definition: glosses.at(-1)!, explanation: glosses.length > 1 ? glosses.slice(0, -1).join(' ') : undefined,
        translation: chinese(raw.translations) ?? chinese(record.translations, [glosses.at(-1)!]), tags: strings(raw.tags),
        examples: unique(examples, example => example.text).sort((a, b) => a.text.split(/\s+/u).length - b.text.split(/\s+/u).length).slice(0, 4),
        synonyms: unique([...linked(raw.synonyms), ...linked(record.synonyms, [glosses.at(-1)!])], item => item.label),
        antonyms: unique([...linked(raw.antonyms), ...linked(record.antonyms, [glosses.at(-1)!])], item => item.label), source,
      };
      entry.senses.push(sense);
      onSense?.(sense, { entryId: id, recordIndex, senseIndex });
    });
    // In the bounded M1 corpus, only source-listed related/derived links are exposed as family.
    const relations = [...linked(record.derived), ...linked(record.related)].filter(item => M1_WORDS.includes(item.label) && item.label !== word);
    entry.wordFamily = unique([...entry.wordFamily, ...relations.filter(item => !item.label.includes(' '))], item => item.entryId);
    entry.phrases = unique([...entry.phrases, ...relations.filter(item => item.label.includes(' '))], item => item.entryId);
    if (entry.kind === 'phrase') entry.keywords = word.split(' ').filter(part => M1_WORDS.includes(part)).map(part => link(part));
    for (const sound of rows(record.sounds)) {
      const accents = accentsFromTags(strings(sound.tags));
      if (text(sound.ipa)) entry.pronunciations!.push({ ipa: text(sound.ipa), accents, labels: strings(sound.tags) });
      const license = licenseRows.find(item => item.file === sound.audio);
      const urls = [allowedUrl(sound.mp3_url, 'upload.wikimedia.org'), allowedUrl(sound.ogg_url, 'upload.wikimedia.org')].filter((url): url is string => !!url);
      const pageUrl = allowedUrl(license?.pageUrl, 'commons.wikimedia.org');
      const licenseUrl = allowedUrl(license?.licenseUrl, 'creativecommons.org') ?? (license?.license === 'Public domain' ? allowedUrl(license.licenseUrl, 'commons.wikimedia.org') : undefined);
      if (!license || !pageUrl || !licenseUrl || !text(license.author) || !text(license.license) || !text(license.verifiedAt) || !urls.length) continue;
      for (const accent of accents) {
        const recording: Recording = { file: text(sound.audio), accent, urls, author: text(license.author), license: text(license.license), licenseUrl, pageUrl, verifiedAt: text(license.verifiedAt) };
        entry.recordings!.push(recording);
      }
    }
    entry.pronunciations = unique(entry.pronunciations!, p => `${p.ipa}:${p.labels.join(',')}`);
    entry.recordings = unique(entry.recordings!, r => `${r.file}:${r.accent}`);
    entries.set(id, entry);
  });
  if (!entries.size) throw new Error('词典数据中没有可识别的英语词条。');
  return M1_WORDS.map(word => entries.get(entryId(word))).filter((entry): entry is DictionaryEntry => !!entry);
}
