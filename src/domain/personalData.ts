import { normalizeQuery } from '../providers/kaikkiAdapter.ts';

export type Learning = 'none' | 'queued' | 'known' | 'skipped';
export interface EntryState {
  entryId: string;
  favorite: boolean;
  learning: Learning;
  resumeLearning: 'none' | 'queued' | null;
  createdAt: string;
  updatedAt: string;
}
export interface PendingWord {
  spelling: string;
  favorite: boolean;
  queueWhenMatched: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PersonalData { entries: EntryState[]; pending: PendingWord[] }
export type Intent = 'favorite' | 'queue';
export const emptyData = (): PersonalData => ({ entries: [], pending: [] });
const format = 'personal-english-dictionary';
const version = 1;

export function backupOf(data: PersonalData) {
  return {format, version, exportedAt: new Date().toISOString(), entries: data.entries, pending: data.pending};
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function validDates(row: Record<string, unknown>) {
  return isTimestamp(row.createdAt) && isTimestamp(row.updatedAt) && row.createdAt <= row.updatedAt;
}

export function parseBackup(value: unknown, entryIds: ReadonlySet<string>): PersonalData {
  if (!isRow(value) || value.format !== format) throw Error('请选择本应用导出的 JSON 备份。');
  if (value.version !== version) throw Error('不支持此备份版本。');
  if (!isTimestamp(value.exportedAt) || !Array.isArray(value.entries) || !Array.isArray(value.pending)) throw Error('备份缺少日期或记录列表。');
  const entries: EntryState[] = [], pending: PendingWord[] = [];
  const ids = new Set<string>(), spellings = new Set<string>();
  for (const row of value.entries) {
    if (!isRow(row) || typeof row.entryId !== 'string' || !entryIds.has(row.entryId) || ids.has(row.entryId)
        || typeof row.favorite !== 'boolean' || typeof row.learning !== 'string' || !['none','queued','known','skipped'].includes(row.learning)
        || !validDates(row)) throw Error('备份含未知、重复或无效的词条记录。');
    const suspended = row.learning === 'known' || row.learning === 'skipped';
    if (suspended ? row.resumeLearning !== 'none' && row.resumeLearning !== 'queued' : row.resumeLearning !== null)
      throw Error('学习状态与恢复状态不一致。');
    ids.add(row.entryId);
    entries.push({entryId:row.entryId, favorite:row.favorite, learning:row.learning as Learning,
      resumeLearning:row.resumeLearning as EntryState['resumeLearning'], createdAt:row.createdAt as string, updatedAt:row.updatedAt as string});
  }
  for (const row of value.pending) {
    if (!isRow(row) || typeof row.spelling !== 'string' || !normalizeQuery(row.spelling) || /[\r\n]/u.test(row.spelling)
        || typeof row.favorite !== 'boolean' || typeof row.queueWhenMatched !== 'boolean' || !validDates(row))
      throw Error('待匹配词记录不完整。');
    const key = normalizeQuery(row.spelling);
    if (spellings.has(key)) throw Error('备份含重复的待匹配词。');
    spellings.add(key);
    pending.push({spelling:row.spelling, favorite:row.favorite, queueWhenMatched:row.queueWhenMatched,
      createdAt:row.createdAt as string, updatedAt:row.updatedAt as string});
  }
  return {entries,pending};
}

export function saveWord(data: PersonalData, spelling: string, entryId: string | undefined, intent: Intent): PersonalData {
  const now = new Date().toISOString();
  const favorite = intent === 'favorite';
  if (entryId) {
    const old = data.entries.find(row => row.entryId === entryId);
    if (old && (favorite ? old.favorite : old.learning !== 'none')) return data;
    const row: EntryState = {entryId, favorite:favorite || !!old?.favorite, learning:favorite ? old?.learning ?? 'none' : 'queued',
      resumeLearning:old?.resumeLearning ?? null, createdAt:old?.createdAt ?? now, updatedAt:old && old.updatedAt > now ? old.updatedAt : now};
    return {...data, entries:[...data.entries.filter(r => r !== old), row]};
  }
  const key = normalizeQuery(spelling);
  if (!key || /[\r\n]/u.test(spelling)) throw Error('请输入一个单词或短语。');
  const old = data.pending.find(r => normalizeQuery(r.spelling) === key);
  if (old && (favorite ? old.favorite : old.queueWhenMatched)) return data;
  const row = {spelling:old?.spelling ?? spelling.trim(), favorite:favorite || !!old?.favorite,
    queueWhenMatched:!favorite || !!old?.queueWhenMatched, createdAt:old?.createdAt ?? now, updatedAt:old && old.updatedAt > now ? old.updatedAt : now};
  return {...data, pending:[...data.pending.filter(r => r !== old), row]};
}

export function changes(before: PersonalData, after: PersonalData) {
  const rows = (d: PersonalData) => new Map<string,string>([
    ...d.entries.map(r => ['entry/'+r.entryId, JSON.stringify(r)] as const),
    ...d.pending.map(r => ['pending/'+normalizeQuery(r.spelling), JSON.stringify(r)] as const),
  ]);
  const current = rows(before), incoming = rows(after);
  let added = 0, updated = 0, removed = 0;
  for (const [key, value] of incoming) {
    if (!current.has(key)) added++;
    else if (current.get(key) !== value) updated++;
  }
  for (const key of current.keys()) if (!incoming.has(key)) removed++;
  return {added, updated, removed};
}
