/** Schema 2 is independent of the frozen v1 migration history and of audio schemas. */
export interface TranslationProvenance {
  type: 'dictionary' | 'human' | 'ai';
  name: string;
  recordIds: string[];
  datasetVersion: string;
  licenseStatus: 'cleared' | 'upstream_unresolved';
  license: string | null;
  attribution: string;
  urls: string[];
  transformations: string[];
}

export interface SenseTranslation {
  id: string;
  senseId: string;
  entryId: string;
  locale: 'zh-Hans';
  englishText: string;
  partOfSpeech: string;
  sourceFingerprint: string;
  glosses: string[];
  explanation: string | null;
  source: TranslationProvenance | null;
  matching: { method: 'source-exact' | 'manual-context' | 'ecdict-evidence' | 'none'; confidence: number | null; evidence: string[] };
  review: { status: 'pending' | 'approved' | 'ai_approved' | 'rejected'; reviewer: string | null; reviewedAt: string | null; note: string };
  translationStatus: 'missing' | 'candidate' | 'complete';
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SenseTranslationHistory {
  schemaVersion: 2;
  dictionaryVersion: string;
  revision: number;
  records: SenseTranslation[];
  currentRecordIds: string[];
}

export interface PublishedSenseTranslation {
  senseId: string;
  entryId: string;
  englishText: string;
  partOfSpeech: string;
  sourceFingerprint: string;
  locale: 'zh-Hans';
  explanationReview?: {status: 'ai_approved'; revision: number; requestId: string; model: string};
  /** Candidate text is deliberately excluded from the static publication. */
  glosses: string[];
  explanation: string | null;
  source: TranslationProvenance | null;
  reviewStatus: 'pending' | 'approved' | 'ai_approved' | 'rejected';
  translationStatus: 'missing' | 'candidate' | 'complete';
  version: number;
}

export interface PublishedTranslations {
  schemaVersion: 2;
  dictionaryVersion: string;
  revision: number;
  locale: 'zh-Hans';
  senses: PublishedSenseTranslation[];
}

export const senseTranslationId = (senseId: string, version: number) => `zh-Hans:${senseId}:v${version}`;
