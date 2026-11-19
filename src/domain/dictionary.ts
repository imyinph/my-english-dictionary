export type EntryId = string;
export type Accent = 'US' | 'UK';

export interface ContentSource {
  id: string;
  title: string;
  license: string;
  attribution: string;
  referenceUrl?: string;
  licenseUrl?: string;
  extractionUrl?: string;
  historyUrl?: string;
  retrievedAt?: string;
  modifications?: string;
  isTestData: boolean;
}

export interface Example {
  id: string;
  text: string;
  translation?: string;
  /** Explicit surface forms to highlight, not a stem or fuzzy match. */
  highlights: string[];
  source: ContentSource;
}

export interface EntryLink {
  entryId: EntryId;
  label: string;
  note?: string;
  externalUrl?: string;
}

export interface Sense {
  id: string;
  partOfSpeech: string;
  definition: string;
  explanation?: string;
  translation?: string;
  tags?: string[];
  examples: Example[];
  synonyms: EntryLink[];
  antonyms: EntryLink[];
  source: ContentSource;
}

export interface Recording {
  file: string;
  accent: Accent;
  urls: string[];
  author: string;
  license: string;
  licenseUrl: string;
  pageUrl: string;
  verifiedAt: string;
}

export interface WordForm extends EntryLink {
  grammaticalForm: string;
}

export interface DictionaryEntry {
  id: EntryId;
  kind: 'word' | 'phrase';
  headword: string;
  senses: Sense[];
  wordFamily: EntryLink[];
  wordForms: WordForm[];
  phrases: EntryLink[];
  keywords: EntryLink[];
  source: ContentSource;
  pronunciations?: { ipa: string; accents: Accent[]; labels: string[] }[];
  recordings?: Recording[];
}

export interface SearchMatch {
  entry: DictionaryEntry;
  matchedForm?: string;
}

export interface DictionaryProvider {
  search(query: string): Promise<SearchMatch[]>;
  getEntry(id: EntryId): Promise<DictionaryEntry | undefined>;
  resolveSurface(surface: string): EntryLink | undefined;
}

export interface ExampleProvider {
  getExamples(senseId: string): Promise<Example[]>;
}

export interface PronunciationRequest {
  text: string;
  accent: Accent;
  rate: number;
  recordings?: Recording[];
  target?: import('./audio.ts').AudioTarget;
  allowBrowserTts?: boolean;
  voice?: import('./audio.ts').PollyVoice;
}

export interface PronunciationProvider {
  play(request: PronunciationRequest): Promise<void>;
  stop(): void;
}

export type VideoResult =
  | { status: 'external-only'; url: string; reason: string }
  | { status: 'unavailable'; reason: string };

export interface VideoProvider {
  getVideo(term: string, accent: Accent): VideoResult;
}
