import type { ContentReference, TranslationContext } from './chineseContent.ts';

export interface ChineseSample {
  senseId: string; entryId: string; englishText: string; sourceFingerprint: string;
  context: TranslationContext; sourceRefs: ContentReference[];
  glosses: string[]; explanation: string; version: number;
}
export interface SampleReview {
  senseId: string; contentHash: string; status: 'self_checked' | 'needs_review' | 'rejected';
  rationale: string; reviewedOn: string;
}
export interface SamplePublication {
  schemaVersion: 1; batchId: string; dictionaryVersion: string; locale: 'zh-Hans'; scope: 'sample-only';
  generator: { provider: string; model: string; promptVersion: string; generatedOn: string; datePrecision: 'day' };
  reviewer: { kind: 'same-agent-second-pass'; independentReview: 'pending'; humanReview: 'pending' | 'approved' };
  records: (ChineseSample & { review: SampleReview })[];
}

/** Samples never imply human approval or independent model approval. */
export function canPreviewSample(record: SamplePublication['records'][number]): boolean {
  return record.review.status === 'self_checked' && record.glosses.length > 0 && !!record.explanation;
}

export function parseSamplePublication(value: unknown): SamplePublication {
  const data = value as SamplePublication;
  const text = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
  const texts = (x: unknown): x is string[] => Array.isArray(x) && x.every(text);
  if (!data || data.schemaVersion !== 1 || data.scope !== 'sample-only' || data.batchId !== 'm33-sample-12-v1' || data.locale !== 'zh-Hans' || data.dictionaryVersion !== '86232c6d48967970aa7203283a316f6f76879ceeea6dc4264e3f1ff923e84147' || data.reviewer?.kind !== 'same-agent-second-pass' || data.reviewer.independentReview !== 'pending' || !['pending', 'approved'].includes(data.reviewer.humanReview) || !text(data.generator?.provider) || !Array.isArray(data.records) || data.records.length !== 12) throw new Error('Wrong sample version');
  const ids = new Set<string>();
  for (const r of data.records) {
    if (!r || !text(r.senseId) || ids.has(r.senseId) || !text(r.entryId) || !text(r.englishText) || !text(r.context?.headword) || !text(r.context.partOfSpeech) || !texts(r.context.tags) || !texts(r.context.examples) || !texts(r.glosses) || !r.glosses.length || r.glosses.length > 4 || !text(r.explanation) || !r.review || r.review.senseId !== r.senseId || !['self_checked', 'needs_review', 'rejected'].includes(r.review.status) || !text(r.review.rationale) || !Array.isArray(r.sourceRefs) || !r.sourceRefs.length || r.sourceRefs.some(s => !text(s.attribution) || !text(s.referenceUrl) || !s.referenceUrl.startsWith('https://en.wiktionary.org/'))) throw new Error('Malformed sample');
    ids.add(r.senseId);
  }
  return data;
}
