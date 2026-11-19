import type { PublishedSenseTranslation, PublishedTranslations } from '../domain/senseTranslation.ts';
import type { Sense } from '../domain/dictionary.ts';

// Deliberately pinned while M2 IDs/audio are frozen; the build verifies against the real snapshot.
export const TRANSLATION_DICTIONARY_VERSION = '86232c6d48967970aa7203283a316f6f76879ceeea6dc4264e3f1ff923e84147';
const row = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const list = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
const https = (value: unknown): value is string => { try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; } };

export function parsePublishedTranslations(input: unknown): PublishedTranslations {
  const data = row(input);
  if (data.schemaVersion !== 2 || data.dictionaryVersion !== TRANSLATION_DICTIONARY_VERSION || data.locale !== 'zh-Hans' || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || !Array.isArray(data.senses) || data.senses.length > 500) throw new Error('中文数据版本或结构不兼容');
  const ids = new Set<string>();
  for (const value of data.senses) {
    const record = row(value);
    if (!['senseId', 'entryId', 'englishText', 'partOfSpeech'].every(key => nonempty(record[key])) || !/^[a-f0-9]{64}$/u.test(String(record.sourceFingerprint)) || record.locale !== 'zh-Hans' || !Number.isSafeInteger(record.version) || Number(record.version) < 1 || !list(record.glosses) || record.glosses.length > 20 || new Set(record.glosses).size !== record.glosses.length || record.glosses.some(text => text.length > 300) || !(record.explanation === null || (nonempty(record.explanation) && record.explanation.length <= 3000))) throw new Error('中文义项记录不完整');
    if (ids.has(String(record.senseId))) throw new Error('中文义项 ID 重复');
    ids.add(String(record.senseId));
    if (!['pending', 'approved', 'ai_approved', 'rejected'].includes(String(record.reviewStatus)) || !['missing', 'candidate', 'complete'].includes(String(record.translationStatus))) throw new Error('中文状态未知');
    const reviewed = record.reviewStatus === 'approved' || record.reviewStatus === 'ai_approved';
    const released = reviewed && record.translationStatus === 'complete';
    if (!released && (record.glosses.length || record.explanation !== null || record.source !== null)) throw new Error('未审核中文不得进入正式发布文件');
    if ((reviewed || record.translationStatus === 'complete') && !released) throw new Error('审核与翻译状态冲突');
    if (record.explanationReview !== undefined) {
      const review = row(record.explanationReview);
      if (!released || !record.explanation || row(record.source).type !== 'dictionary' || review.status !== 'ai_approved' || review.revision !== 1 || !nonempty(review.model) || !nonempty(review.requestId)) throw new Error('扩展解释的审核记录无效');
    }
    if (released) {
      const source = row(record.source);
      if (record.reviewStatus === 'ai_approved' && source.type !== 'ai') throw new Error('AI 复核状态必须保留 AI 来源');
      if (!record.glosses.length || !['dictionary', 'human', 'ai'].includes(String(source.type)) || !nonempty(source.name) || !list(source.recordIds) || !source.recordIds.length || !nonempty(source.datasetVersion) || source.licenseStatus !== 'cleared' || !nonempty(source.license) || !nonempty(source.attribution) || !Array.isArray(source.urls) || !source.urls.every(https) || !list(source.transformations)) throw new Error('中文来源或发布许可无效');
    }
  }
  return input as PublishedTranslations;
}

export function createSenseTranslationProvider(loader: () => Promise<unknown>) {
  let pending: Promise<Map<string, PublishedSenseTranslation>> | undefined;
  const load = () => pending ??= loader().then(parsePublishedTranslations).then(data => new Map(data.senses.map(record => [record.senseId, record]))).catch(error => { pending = undefined; throw error; });
  return {
    async forEntry(entryId: string, senses: Sense[]) {
      try {
        const records = await load();
        return new Map(senses.map(sense => {
          const record = records.get(sense.id);
          if (!record || record.entryId !== entryId || record.englishText !== sense.definition || record.partOfSpeech !== sense.partOfSpeech) throw new Error('中文与英文义项未能可靠对应');
          return [sense.id, record];
        }));
      } catch (error) { pending = undefined; throw error; }
    },
  };
}

export const senseTranslations = createSenseTranslationProvider(async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/chinese-senses.json`, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('中文数据加载失败');
  return response.json();
});
