import {useEffect, useState, type ChangeEvent} from 'react';
import {backupOf, changes, parseBackup, saveWord, type Intent, type PersonalData} from '../domain/personalData.ts';
import {dictionary} from '../providers/dictionary.ts';
import {normalizeQuery} from '../providers/kaikkiAdapter.ts';
import {personalSnapshot, restoreData, type Snapshot} from '../providers/personalStore.ts';
import type {DictionaryEntry} from '../domain/dictionary.ts';

const learningLabel = {none:'未加入学习', queued:'待学', known:'熟词', skipped:'暂不学习'};
type Preview = {incoming:PersonalData; base:Snapshot; filename:string};

export function PersonalBackup() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [catalogError, setCatalogError] = useState(false);
  const [spelling, setSpelling] = useState('');
  const [intent, setIntent] = useState<Intent>('favorite');
  const [preview, setPreview] = useState<Preview>();
  const [download, setDownload] = useState<{url:string; filename:string}>();
  useEffect(() => {
    let active = true;
    dictionary.search('').then(matches => {
      if (active) { setEntries(matches.map(m => m.entry)); setCatalogError(false); }
    }).catch(() => { if (active) setCatalogError(true); });
    personalSnapshot().then(current => {
      if (active) setSnapshot(current);
    }).catch(() => { if (active) setError('无法读取本机个人数据，请重试。'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice(''); setDownload(undefined);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  }

  function add() {
    void run(async () => {
      const key = normalizeQuery(spelling);
      const exact = entries.filter(e => normalizeQuery(e.headword) === key);
      const matches = exact.length ? exact : entries.filter(e => e.wordForms.some(f => normalizeQuery(f.label) === key));
      if (matches.length > 1) throw Error('此拼写对应多个词条，请输入目标词条的完整词头。');
      const entry = matches[0];
      const current = await personalSnapshot(s => saveWord(s.data, spelling, entry?.id, intent));
      setSnapshot(current); setSpelling('');
      setNotice(entry ? '已保存到「' + entry.headword + '」。' : '已保留原始拼写和加入意向，等待匹配。');
    });
  }
  function prepareDownload() {
    void run(async () => {
      const current = await personalSnapshot();
      const backup = backupOf(current.data);
      const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
      setSnapshot(current);
      setDownload({url:URL.createObjectURL(blob),filename:'个人词汇备份-' + backup.exportedAt.replace(/:/g,'-') + '.json'});
    });
  }
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPreview(undefined);
    void run(async () => {
      const text = await file.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text.replace(/^\uFEFF/u,'')); } catch { throw Error('文件不是有效的 JSON 备份。'); }
      const incoming = parseBackup(parsed, new Set(entries.map(e => e.id)));
      const base = await personalSnapshot();
      setSnapshot(base); setPreview({incoming,base,filename:file.name});
    });
  }
  function confirmRestore() {
    if (!preview) return;
    void run(async () => {
      setPreview(undefined);
      setSnapshot(await restoreData(preview.base.revision, preview.incoming));
      setNotice('备份已恢复。');
    });
  }
  const diff = preview && changes(preview.base.data,preview.incoming);
  return <section className="personal-backup">
    <h1>个人数据与备份</h1>
    <p>数据保存在当前浏览器。换设备或清理浏览器数据前，请将 JSON 备份保存到文件中。</p>
    {error && <p role="alert">{error}</p>}
    {catalogError && <p role="alert">词典加载失败，可先导出备份。<button onClick={() => {setCatalogError(false); setAttempt(n => n+1);}}>重试词典</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!snapshot ? busy ? <p>正在读取…</p> : <button onClick={() => {setError('');setBusy(true);setAttempt(n => n+1);}}>重试读取</button> : <>
      <section className="card"><h2>本机记录</h2>
        <p>已匹配 {snapshot.data.entries.length} 条 · 待匹配 {snapshot.data.pending.length} 条</p>
        <details><summary>查看保存内容</summary>
          {!snapshot.data.entries.length && !snapshot.data.pending.length && <p>当前没有记录。</p>}
          <ul>{snapshot.data.entries.map(r => <li key={r.entryId}>{entries.find(e => e.id === r.entryId)?.headword ?? r.entryId} · {r.favorite ? '已收藏 · ' : ''}{learningLabel[r.learning]}</li>)}
          {snapshot.data.pending.map(r => <li key={'pending:'+r.spelling}>{r.spelling} · 待匹配{r.favorite && ' · 匹配后收藏'}{r.queueWhenMatched && ' · 匹配后加入待学'}</li>)}</ul>
        </details>
        <form onSubmit={e => {e.preventDefault(); add();}}><fieldset disabled={busy || !!preview || !entries.length}>
          <legend>保存一条记录</legend>
          <label>单词或短语<input value={spelling} onChange={e=>setSpelling(e.target.value)} placeholder="例如 create 或 make sense" required /></label>
          <label>保存方式<select value={intent} onChange={e=>setIntent(e.target.value as Intent)}><option value="favorite">收藏</option><option value="queue">加入待学</option></select></label>
          <button disabled={!spelling.trim()}>保存记录</button>
        </fieldset></form>
      </section>
      <section className="card"><h2>备份与恢复</h2>
        <button disabled={busy || !!preview} onClick={prepareDownload}>准备 JSON 备份</button>
        {download && <a href={download.url} download={download.filename}>下载 JSON 文件</a>}
        <label>选择备份文件<input type="file" accept=".json,application/json" disabled={busy || !entries.length} onChange={chooseFile}/></label>
        {preview && diff && <div className="restore-preview"><h3>恢复预览</h3>
          <p>{preview.filename} · 已匹配 {preview.incoming.entries.length} 条 · 待匹配 {preview.incoming.pending.length} 条</p>
          <p>新增 {diff.added} 条 · 更新 {diff.updated} 条 · 移除 {diff.removed} 条</p>
          <p>确认后将用此文件替换本机全部个人词汇记录。</p>
          <button disabled={busy} onClick={() => {setPreview(undefined);setNotice('已取消恢复。');}}>取消恢复</button>
          <button disabled={busy} onClick={confirmRestore}>确认整库恢复</button>
        </div>}
      </section>
    </>}
  </section>;
}
