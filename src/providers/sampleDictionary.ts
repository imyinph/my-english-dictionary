import { sampleEntries } from '../data/samples.ts';
import type { DictionaryProvider, ExampleProvider, SearchMatch } from '../domain/dictionary.ts';

// Only case and whitespace normalization. Derivations and phrases keep their own identity.
export const normalizeQuery = (query: string) => query.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
const byId = new Map(sampleEntries.map(entry => [entry.id, entry]));

export const sampleDictionary: DictionaryProvider & ExampleProvider = {
  async search(query) {
    const normalized = normalizeQuery(query);
    return sampleEntries.flatMap(entry => {
      const matchedForm = entry.wordForms.find(form => normalizeQuery(form.label) === normalized)?.label;
      if (!normalized || normalizeQuery(entry.headword).includes(normalized) || matchedForm) {
        const match: SearchMatch = { entry, ...(matchedForm ? { matchedForm } : {}) };
        return [match];
      }
      return [];
    }).sort((a, b) => Number(normalizeQuery(b.entry.headword) === normalized) - Number(normalizeQuery(a.entry.headword) === normalized));
  },
  async getEntry(id) { return byId.get(id); },
  resolveSurface(surface) {
    const normalized = normalizeQuery(surface);
    const exact = sampleEntries.find(entry => normalizeQuery(entry.headword) === normalized);
    if (exact) return { entryId: exact.id, label: surface };
    for (const entry of sampleEntries) {
      if (entry.wordForms.some(form => normalizeQuery(form.label) === normalized)) return { entryId: entry.id, label: surface };
    }
    return undefined;
  },
  async getExamples(senseId) {
    return sampleEntries.flatMap(entry => entry.senses).find(sense => sense.id === senseId)?.examples ?? [];
  },
};
