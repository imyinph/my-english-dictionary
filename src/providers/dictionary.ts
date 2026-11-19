import type { DictionaryEntry, DictionaryProvider, ExampleProvider, SearchMatch } from '../domain/dictionary.ts';
import { normalizeQuery, parseKaikkiDataset } from './kaikkiAdapter.ts';

export function createDictionaryProvider(loader: () => Promise<unknown>): DictionaryProvider & ExampleProvider {
  let entries: DictionaryEntry[] = [];
  let pending: Promise<DictionaryEntry[]> | undefined;
  function load() {
    pending ??= loader().then(data => { entries = parseKaikkiDataset(data); return entries; }).catch(error => { pending = undefined; throw error; });
    return pending;
  }
  return {
    async search(query) {
      const normalized = normalizeQuery(query);
      return (await load()).flatMap(entry => {
        const matchedForm = entry.wordForms.find(form => normalizeQuery(form.label) === normalized)?.label;
        return !normalized || normalizeQuery(entry.headword).includes(normalized) || matchedForm ? [{ entry, ...(matchedForm ? { matchedForm } : {}) } satisfies SearchMatch] : [];
      }).sort((a, b) => Number(normalizeQuery(b.entry.headword) === normalized) - Number(normalizeQuery(a.entry.headword) === normalized));
    },
    async getEntry(id) { return (await load()).find(entry => entry.id === id); },
    resolveSurface(surface) {
      const normalized = normalizeQuery(surface);
      const entry = entries.find(entry => normalizeQuery(entry.headword) === normalized) ?? entries.find(entry => entry.wordForms.some(form => normalizeQuery(form.label) === normalized));
      return entry ? { entryId: entry.id, label: surface } : undefined;
    },
    async getExamples(senseId) { return (await load()).flatMap(entry => entry.senses).find(sense => sense.id === senseId)?.examples ?? []; },
  };
}

export const dictionary = createDictionaryProvider(async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}data/kaikki-subset.json`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`词典加载失败：HTTP ${response.status}`);
  return response.json();
});
