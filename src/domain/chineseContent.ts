/** Content revision, dictionary snapshot and future personal DB versions are independent. */
export type ChineseStatus = 'source_verified' | 'human_reviewed' | 'ai_draft' | 'needs_review' | 'unavailable';
export type ChineseTarget =
  | { kind: 'sense'; entryId: string; senseId: string }
  | { kind: 'example'; entryId: string; senseId: string; exampleId: string };

export interface TranslationContext {
  headword: string;
  partOfSpeech: string;
  glosses: string[];
  tags: string[];
  examples: string[];
  sourceSenseIds: string[];
  etymologyNumber: string | number | null;
}

/** A pointer always addresses this exact snapshot, not the current remote web page. */
export interface ContentReference {
  snapshotPath: 'data/kaikki-subset.json';
  snapshotSha256: string;
  jsonPointer: string;
  referenceUrl: string;
  extractionUrl: string;
  extractedFileSha256: string;
  license: string;
  licenseUrl: string;
  attribution: string;
}

export interface ContentIdentity {
  target: ChineseTarget;
  englishText: string;
  context: TranslationContext;
  /** SHA-256 over context and target kind/text; excludes array positions and legacy IDs. */
  sourceFingerprint: string;
  englishSourceRefs: ContentReference[];
}

export interface ContentIdentityRegistry {
  schemaVersion: 1;
  dictionaryVersion: string;
  entries: { entryId: string; headword: string; kind: 'word' | 'phrase' }[];
  targets: ContentIdentity[];
}

export interface ChineseRecord {
  id: string;
  revision: number;
  target: ChineseTarget;
  englishText: string;
  context: TranslationContext;
  sourceFingerprint: string;
  sourceSnapshotSha256: string;
  locale: 'zh';
  chineseText: string | null;
  status: ChineseStatus;
  origin: 'source' | 'ai' | 'human' | null;
  sourceRefs: ContentReference[];
  generator: { provider: string; model: string; promptVersion: string; jobId: string; generatedAt: string } | null;
  review: { reviewer: string; reviewedAt: string; decision: 'approved' | 'rejected' } | null;
  publication: 'draft' | 'released';
  updatedAt: string;
  reason: string;
}

/** Revision history is append-only; currentRecordIds selects one revision per target. */
export interface ChineseContentBundle {
  schemaVersion: 1;
  dictionaryVersion: string;
  contentRevision: number;
  currentRecordIds: string[];
  records: ChineseRecord[];
}

export const chineseTargetId = (target: ChineseTarget) => target.kind === 'example' ? target.exampleId : target.senseId;
export const chineseRecordId = (target: ChineseTarget, revision: number) => `zh:${target.kind}:${chineseTargetId(target)}:r${revision}`;
