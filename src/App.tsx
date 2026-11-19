import { PersonalBackup } from './components/PersonalBackup.tsx';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { DictionaryEntry, EntryLink as LinkedEntry, Example, SearchMatch } from './domain/dictionary.ts';
import { dictionary } from './providers/dictionary.ts';
import { externalVideoProvider } from './providers/externalVideo.ts';
import { AudioProvider, AudioSettings, PlayButton, SensePronunciation, useAudioSettings } from './components/Pronunciation.tsx';
import { pronunciation } from './providers/pronunciation.ts';
import { ExampleTranslation } from './components/ExampleTranslation.tsx';
import { AudioLab } from './components/AudioLab.tsx';
import { ChineseSampleLab } from './components/ChineseSampleLab.tsx';
import { SenseTranslation } from './components/SenseTranslation.tsx';
import { senseTranslations } from './providers/senseTranslations.ts';
import type { PublishedSenseTranslation } from './domain/senseTranslation.ts';

function navigate(hash: string) {
  window.history.pushState({ dictionaryDepth: (window.history.state?.dictionaryDepth ?? 0) + 1 }, '', hash);
  window.dispatchEvent(new Event('hashchange'));
}

function intercept(event: MouseEvent<HTMLAnchorElement>, hash: string) {
  if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    navigate(hash);
  }
}

function entryHref(id: string, surface?: string) {
  return `#/entry/${encodeURIComponent(id)}${surface ? `?form=${encodeURIComponent(surface)}` : ''}`;
}

function EntryLink({ entryId, label, note, externalUrl, className = '', surface }: LinkedEntry & { className?: string; surface?: string }) {
  if (externalUrl) return <a className={className} href={externalUrl} lang="en" target="_blank" rel="noopener noreferrer" title="本阶段未收录；前往 Wiktionary">{label} ↗</a>;
  const href = entryHref(entryId, surface);
  return <a className={className} href={href} lang="en" onClick={event => intercept(event, href)} title={note}>{label}</a>;
}

function ExampleText({ example }: { example: Example }) {
  const escaped = example.highlights.filter(Boolean).sort((a, b) => b.length - a.length).map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${[...escaped.map(value => `\\b${value}\\b`), "[A-Za-z]+(?:['’][A-Za-z]+)?"].join('|')})`, 'gi');
  return <span lang="en">{example.text.split(pattern).map((part, index) => {
    const target = dictionary.resolveSurface(part);
    const isHighlight = example.highlights.some(text => text.toLowerCase() === part.toLowerCase());
    const content = target ? <EntryLink {...target} surface={part.toLowerCase() !== target.entryId ? part : undefined} className="inline-word" /> : part;
    return isHighlight ? <mark key={index}>{content}</mark> : <span key={index}>{content}</span>;
  })}</span>;
}

function RelationList({ links }: { links: LinkedEntry[] }) {
  return <div className="chips">{links.map(link => <EntryLink key={`${link.entryId}:${link.label}`} {...link} className="chip" />)}</div>;
}

function Detail({ entry, surface }: { entry: DictionaryEntry; surface?: string }) {
  const [chinese, setChinese] = useState<{ status: 'loading' | 'ready' | 'failed'; records: Map<string, PublishedSenseTranslation> }>({ status: 'loading', records: new Map() });
  const [chineseRetry, setChineseRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setChinese({ status: 'loading', records: new Map() });
    senseTranslations.forEntry(entry.id, entry.senses).then(records => { if (active) setChinese({ status: 'ready', records }); }).catch(() => { if (active) setChinese({ status: 'failed', records: new Map() }); });
    return () => { active = false; };
  }, [entry, chineseRetry]);
  const { accent } = useAudioSettings();
  const video = externalVideoProvider.getVideo(entry.headword, accent);
  const ipa = entry.pronunciations?.filter(item => item.accents.includes(accent) || (!item.accents.length && !item.labels.length)) ?? [];
  const groups = [...new Set(entry.senses.map(sense => sense.partOfSpeech))];
  return <>
    <div className="entry-heading">
      <p className="eyebrow">{entry.kind === 'phrase' ? 'PHRASE · 短语' : 'WORD · 单词'}</p>
      <h1 lang="en">{entry.headword}</h1>
      <div className="pronunciation-line"><PlayButton text={entry.headword} recordings={entry.recordings} target={{ contentId: entry.id, kind: entry.kind, pronunciationId: 'entry-default' }} /><span lang="en">{ipa.length ? ipa.map(item => `${item.ipa}${item.accents.length ? ` (${accent})` : ' (region unspecified)'}`).join(' · ') : 'No matching IPA supplied by source.'}</span></div>
      {surface && surface.toLowerCase() !== entry.headword && <p className="surface-note">查询形式 <strong lang="en">{surface}</strong> → 词元 <strong lang="en">{entry.headword}</strong></p>}
      <p className="muted">英文释义优先，中文简释辅助；扩展解释按需展开。</p>
      {chinese.status === 'failed' && <p className="chinese-load-error" role="status">中文辅助加载失败。<button onClick={() => setChineseRetry(value => value + 1)}>重试中文加载</button></p>}
    </div>
    <div className="detail-layout">
      <div>
        <section className="card definitions" aria-label="释义与例句">
          <div className="section-title"><h2>Meaning & examples</h2><span className="small-label">Wiktionary</span></div>
          {!entry.senses.length && <p className="empty-note">来源未提供可解析的英文义项。</p>}
          {groups.map(pos => <section key={pos} aria-label={pos}>
            <p className="part-of-speech" lang="en">{pos}</p>
            {entry.senses.filter(sense => sense.partOfSpeech === pos).map((sense, index) => <article className="sense" key={sense.id}>
              <div className="sense-top"><span className="sense-number">{String(index + 1).padStart(2, '0')}</span><div>
                <h3 lang="en">{sense.definition}</h3>
                <SensePronunciation entryId={entry.id} senseId={sense.id} text={entry.headword} kind={entry.kind} />
                {!!sense.tags?.length && <p className="sense-tags" lang="en">{sense.tags.join(' · ')}</p>}
                {sense.explanation && <p className="explanation" lang="en">{sense.explanation}</p>}
                <SenseTranslation record={chinese.records.get(sense.id)} loading={chinese.status === 'loading'} failed={chinese.status === 'failed'} />
              </div></div>
              <ol className="examples">{sense.examples.map(example => <li key={example.id}>
                <p><ExampleText example={example} /></p>
                <PlayButton text={example.text} target={{ contentId: example.id, kind: 'example', senseId: sense.id, pronunciationId: 'sentence-default' }} example />
                <ExampleTranslation entryId={entry.id} senseId={sense.id} example={example} />
              </li>)}</ol>
              {sense.examples.length < 2 && <p className="missing-field">{sense.examples.length ? '此义项仅有 1 条可复用例句。' : '此义项暂无已确认可复用的例句。'}</p>}
              <div className="sense-relations">
                <h4>Synonyms / Antonyms <span>· 此义项</span></h4>
                {sense.synonyms.length > 0 && <div className="relation-row"><span>近义</span><RelationList links={sense.synonyms} /></div>}
                {sense.antonyms.length > 0 && <div className="relation-row"><span>反义</span><RelationList links={sense.antonyms} /></div>}
                {!sense.synonyms.length && !sense.antonyms.length && <p className="muted small">来源未提供此义项的近反义词。</p>}
                {[...sense.synonyms, ...sense.antonyms].filter(link => link.note).map(link => <p className="small muted" key={link.entryId} lang="en">{link.label}: {link.note}</p>)}
              </div>
            </article>)}
          </section>)}
        </section>
        <section className="card phrases" aria-labelledby="phrases-title">
          <h2 id="phrases-title">{entry.kind === 'phrase' ? 'Words in this phrase' : 'Phrases & collocations'}</h2>
          <p className="muted small">{entry.kind === 'phrase' ? '继续探索短语中的关键词。' : '短语有独立的详情页。'}</p>
          {(entry.kind === 'phrase' ? entry.keywords : entry.phrases).length ? <RelationList links={entry.kind === 'phrase' ? entry.keywords : entry.phrases} /> : <p className="empty-note">本阶段收录范围内暂无来源明确的搭配。</p>}
        </section>
        <details className="card video">
          <summary><span>Real-world English <small>真实语境 · YouGlish</small></span><span className="small-label">外部查看 ↗</span></summary>
          <p className="muted">{video.reason}</p>
          {video.status === 'external-only' && <a className="external-link" href={video.url} target="_blank" rel="noopener noreferrer">在 YouGlish 查看「{entry.headword}」· {accent} ↗</a>}
          <p className="small muted">仅点击链接后访问第三方网站；不加载内嵌播放器。</p>
        </details>
      </div>
      <aside className="relations-sidebar" aria-label="词汇关联">
        <section className="card"><p className="eyebrow">EXPLORE THE CONNECTIONS</p><h2>Word Family</h2><p className="muted small">派生词 · 相关但独立的词条</p>
          {entry.wordFamily.length ? <ul className="family-list">{entry.wordFamily.map(link => <li key={link.entryId}><EntryLink {...link} /><span lang="en">{link.note}</span><span aria-hidden="true">↗</span></li>)}</ul> : <p className="empty-note">本阶段收录范围内暂无来源明确的派生词。</p>}
        </section>
        <section className="card"><h2>Word Forms</h2><p className="muted small">屈折变化 · 可返回词元</p>
          {entry.wordForms.length ? <ul className="forms-list">{entry.wordForms.map(form => <li key={`${form.label}:${form.grammaticalForm}`}><EntryLink {...form} surface={form.label} /><span lang="en">{form.grammaticalForm}</span></li>)}</ul> : <p className="empty-note">来源未提供可用的屈折变化。</p>}
        </section>
        <details className="source"><summary>内容来源、许可与录音署名</summary><p>{entry.source.title}</p><p>{entry.source.attribution}</p><p><a href={entry.source.referenceUrl} target="_blank" rel="noopener noreferrer">词条原文 ↗</a> · <a href={entry.source.historyUrl} target="_blank" rel="noopener noreferrer">贡献历史 ↗</a></p><p><a href={entry.source.licenseUrl} target="_blank" rel="noopener noreferrer">{entry.source.license}</a> · <a href={entry.source.extractionUrl} target="_blank" rel="noopener noreferrer">Kaikki JSONL ↗</a></p><p>{entry.source.modifications}</p><p>收录时间：{entry.source.retrievedAt?.slice(0, 10)}</p>
          <h3>真人录音</h3>{entry.recordings?.length ? entry.recordings.map(recording => <p key={`${recording.file}:${recording.accent}`}><a href={recording.pageUrl} target="_blank" rel="noopener noreferrer">{recording.file}</a><br />{recording.accent} · {recording.author}<br /><a href={recording.licenseUrl} target="_blank" rel="noopener noreferrer">{recording.license}</a> · 未剪辑；按需播放源站文件。</p>) : <p>暂无已核验可用的录音；浏览器 TTS 仅作备用，iOS 需要主动选择。</p>}
        </details>
        <p className="sidebar-note">词族与短语仅展示本阶段收录的关联。<br />标记 ↗ 的范围外近反义词在 Wiktionary 查看。<br />当前查询不会创建学习记录。</p>
      </aside>
    </div>
  </>;
}

function EntryPage({ id, surface }: { id: string; surface?: string }) {
  const [state, setState] = useState<{ loading: boolean; entry?: DictionaryEntry; error?: boolean }>({ loading: true });
  useEffect(() => {
    let active = true;
    dictionary.getEntry(id).then(entry => { if (active) setState({ loading: false, entry }); }).catch(() => { if (active) setState({ loading: false, error: true }); });
    return () => { active = false; };
  }, [id]);
  if (state.loading) return <p role="status">正在加载词条…</p>;
  if (!state.entry) return <section className="card missing"><h1>{state.error ? '词条加载失败' : '未找到这个词条'}</h1><p>返回首页搜索，或查看本阶段收录的 10 个词条。加载失败时可刷新后重试。</p><a href="#/" onClick={event => intercept(event, '#/')}>返回词典首页 →</a></section>;
  return <Detail entry={state.entry} surface={surface} />;
}

function Home({ query, setQuery }: { query: string; setQuery: (query: string) => void }) {
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    setStatus('loading');
    dictionary.search(query).then(matches => { if (active) { setResults(matches); setStatus('ready'); } }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [query]);
  return <>
    <section className="hero">
      <p className="eyebrow">A LITTLE CURIOSITY, EVERY DAY</p>
      <h1>从一个词，<br /><span>读懂更多英文。</span></h1>
      <p>先看英文解释，沿着词族与短语探索。<br className="mobile-break" />中文简释辅助，扩展解释按需展开。</p>
      <form className="search" role="search" onSubmit={event => { event.preventDefault(); if (status === 'ready' && results.length === 1) navigate(entryHref(results[0].entry.id, results[0].matchedForm)); }}>
        <span className="search-symbol" aria-hidden="true">⌕</span>
        <label className="sr-only" htmlFor="query">搜索单词或短语</label>
        <input id="query" value={query} onChange={event => setQuery(event.target.value)} placeholder="试试 create、created 或 make sense" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" />
        {query && <button className="clear-search" type="button" onClick={() => { setQuery(''); document.getElementById('query')?.focus(); }} aria-label="清空搜索">×</button>}
        <button className="search-submit" type="submit">搜索 <span aria-hidden="true">↗</span></button>
      </form>
      <p className="search-caption">本阶段收录 10 个真实词条及其词形，尚未接入完整词典。</p>
    </section>
    <section className="sample-section" aria-labelledby="sample-title">
      <div className="section-title"><div><p className="eyebrow">YOUR FIRST EXPLORATION</p><h2 id="sample-title">{query.trim() ? '搜索结果' : '从这些词开始'}</h2></div><span className="result-count" role="status">{status === 'loading' ? '搜索中…' : status === 'error' ? '搜索失败' : `${results.length} 个词条`}</span></div>
      {status === 'ready' && results.length === 0 && <div className="card no-results"><h3>暂时没有这个词条</h3><p>当前仅收录 10 个词条。试试 <button onClick={() => setQuery('create')}>create</button> 或 <button onClick={() => setQuery('make sense')}>make sense</button>。</p></div>}
      {status === 'error' && <p role="alert">未能加载词典数据，请刷新后重试。</p>}
      <div className="entry-grid">{status === 'ready' && results.map(({ entry, matchedForm }, index) => <a key={entry.id} className="entry-card" href={entryHref(entry.id, matchedForm)} onClick={event => intercept(event, entryHref(entry.id, matchedForm))}>
        <div className="entry-card-top"><span className="card-index">{String(index + 1).padStart(2, '0')}</span><span className="entry-kind">{entry.kind === 'phrase' ? 'PHRASE' : entry.senses[0]?.partOfSpeech}</span><span className="card-arrow" aria-hidden="true">↗</span></div>
        <h3 lang="en">{entry.headword}</h3>
        {matchedForm && <p className="matched-form" lang="en">{matchedForm} → {entry.headword}</p>}
        <p lang="en">{entry.senses[0]?.definition ?? 'No definition supplied.'}</p>
      </a>)}</div>
    </section>
    <section className="prototype-note"><span aria-hidden="true">◇</span><div><h2>真实出处，保留缺失。</h2><p>M1 小范围验证：内容来自 English Wiktionary，经 Kaikki / Wiktextract 提取。缺少的例句和中文不会自动补写。</p><p><a href="https://en.wiktionary.org/" target="_blank" rel="noopener noreferrer">Wiktionary contributors</a> · <a href="https://kaikki.org/" target="_blank" rel="noopener noreferrer">Kaikki / Wiktextract</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">文本 CC BY-SA 4.0</a></p></div></section>
    <details className="install-help"><summary>在 iPhone 上体验</summary><p>同一 Wi-Fi 下可以先访问电脑的局域网地址查看页面。正式安装验收请使用 HTTPS 地址，在 Safari 分享菜单中选择“添加到主屏幕”，并检查是否以独立窗口打开。</p><p>当前不承诺离线查询；M2 音频已由用户验收，本次中文展示仍需真机验收。</p></details>
  </>;
}

function parseRoute(hash: string) {
  if (!hash || hash === '#' || hash === '#/') return { home: true as const };
  try {
    const [path, query = ''] = hash.slice(1).split('?');
    const match = /^\/entry\/([^/]+)$/.exec(path);
    if (match) return { home: false as const, id: decodeURIComponent(match[1]), surface: new URLSearchParams(query).get('form') ?? undefined };
  } catch { /* Malformed routes render a recoverable missing-entry state. */ }
  return { home: false as const, id: '__missing__' };
}

export function App() {
  const [location, setLocation] = useState({ hash: window.location.hash, revision: 0 });
  const [query, setQuery] = useState('');
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () => setLocation(previous => ({ hash: window.location.hash, revision: previous.revision + 1 }));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    pronunciation.stop();
    if (location.revision) { main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }, [location.revision]);
  const route = parseRoute(location.hash);
  return <AudioProvider>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>跳到主要内容</a>
    <header className="site-header"><div className="header-inner">
      <a href="#/" onClick={event => intercept(event, '#/')} className="brand"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /><span>英语词典 <small>个人原型</small></span></a>
      <span className="stage-badge"><span /> M3 · 中文辅助</span>
    </div></header>
    <main id="main-content" ref={main} tabIndex={-1} className="main-container">
      <AudioSettings />
      {!route.home && <nav className="entry-nav" aria-label="词条导航"><button onClick={() => { if (window.history.state?.dictionaryDepth > 0) window.history.back(); else navigate('#/'); }}>← 返回</button><a href="#/" onClick={event => intercept(event, '#/')}>搜索词典</a><span>英文优先 · 简释辅助</span></nav>}
      {location.hash === '#/personal-backup' ? <PersonalBackup /> : location.hash === '#/chinese-samples' ? <ChineseSampleLab onNavigate={intercept} /> : location.hash === '#/audio-lab' ? <AudioLab /> : route.home ? <Home query={query} setQuery={setQuery} /> : <EntryPage key={`${location.hash}:${location.revision}`} id={route.id} surface={route.surface} />}
    </main>
    <footer className="site-footer"><span>英语词典 · M3</span><a href="#/personal-backup" onClick={event => intercept(event, '#/personal-backup')}>个人数据与备份</a><a href="#/chinese-samples" onClick={event => intercept(event, '#/chinese-samples')}>中文释义样本（12 条）</a><a href="#/audio-lab" onClick={event => intercept(event, '#/audio-lab')}>双音色与资源诊断</a><span>名称与视觉方案为临时草案</span></footer>
  </AudioProvider>;
}
