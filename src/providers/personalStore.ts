import {emptyData, type PersonalData} from '../domain/personalData.ts';

export interface Snapshot { revision: number; data: PersonalData }
const name = 'dictionary.personal';
const store = 'personal-v1';
const key = 'current';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    let blocked = false;
    req.onupgradeneeded = event => {
      if (event.oldVersion === 0) req.result.createObjectStore(store);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { blocked = true; reject(Error('请关闭其他打开词典的标签页后重试。')); };
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return; }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
  });
}

// Keep the read, revision check and replacement in the same IndexedDB transaction.
export async function personalSnapshot(update?: (snapshot: Snapshot) => PersonalData): Promise<Snapshot> {
  const db = await openDatabase();
  try {
    return await new Promise<Snapshot>((resolve, reject) => {
      const tx = db.transaction(store, update ? 'readwrite' : 'readonly');
      const records = tx.objectStore(store);
      const read = records.get(key);
      let result: Snapshot, reason: unknown;
      read.onsuccess = () => {
        try {
          result = read.result ?? {revision: 0, data: emptyData()};
          if (update) {
            const next = update(result);
            if (next !== result.data) {
              result = {revision: result.revision + 1, data: next};
              records.put(result, key);
            }
          }
        } catch (error) { reason = error; tx.abort(); }
      };
      tx.onabort = () => reject(reason ?? tx.error ?? Error('个人数据写入失败。'));
      tx.oncomplete = () => resolve(result);
    });
  } finally { db.close(); }
}

export function restoreData(expectedRevision: number, incoming: PersonalData) {
  return personalSnapshot(current => {
    if (current.revision !== expectedRevision) throw Error('本机数据已变化，请重新选择备份并核对差异。');
    return incoming;
  });
}
