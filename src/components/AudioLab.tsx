import { useEffect, useState } from 'react';
import type { AudioManifest } from '../domain/audio.ts';
import { loadPollyManifest } from '../providers/pollyManifest.ts';
import { pronunciation } from '../providers/pronunciation.ts';
import { useAudioSettings } from './Pronunciation.tsx';

export function AudioLab() {
  const settings = useAudioSettings();
  const [data, setData] = useState<AudioManifest>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    let active = true;
    loadPollyManifest().then(value => { if (active) setData(value); }).catch(() => { if (active) setError('音频清单加载失败，请刷新后重试。'); });
    return () => { active = false; pronunciation.stop(); };
  }, []);
  const resources = data?.resources.filter(r => r.voice === settings.voice && r.text.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return <section className="audio-lab">
    <p className="eyebrow">M2 · AUDIO CHECK</p><h1>双音色与资源诊断</h1>
    <p>Joanna — Female / Stephen — Male · en-US · Neural · MP3 24 kHz。音色已由你选定，此页检查现有内容的播放和资源状态。</p>
    <div className="card lab-intro"><p>顶部音色和速度设置与词典共用。点击后才加载音频，诊断播放失败不会替换成浏览器 TTS。</p><p>实际合成与逐条 iPhone 验收分别记录；“已生成”不代表该文件已通过真机验收。</p></div>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">正在加载音频清单…</p> : <>
      <p className="lab-count">已生成 {data.resources.filter(r => r.generation.status === 'ready').length} / {data.resources.length} 个资源 · 当前 {settings.voice}</p>
      <label>筛选英语文本 <input aria-label="筛选音频文本" value={query} onChange={e => { setQuery(e.target.value); setLimit(20); }} /></label>
      {resources.slice(0, limit).map(r => <article className="card lab-sample" key={r.id}>
        <h2 lang="en">{r.text}</h2><p>{r.target.kind} · {r.voice} · {r.generation.status === 'ready' ? '已生成' : r.generation.status === 'failed' ? `失败：${r.generation.error}` : '尚未生成'}</p>
        <button className="play-audio" disabled={r.generation.status !== 'ready' || !r.asset || r.review.status === 'rejected'} aria-label={`播放 ${r.voice}：${r.text}`} onClick={() => { void pronunciation.playResource(r, settings.rate); }}>▷ 播放 {r.voice}</button>
        <details className="lab-source"><summary>来源与资源信息</summary><p>{r.license.attribution}</p><p><a href={r.license.url} target="_blank" rel="noopener noreferrer">Polly 输出使用说明 ↗</a> · <a href={r.license.sourceUrl} target="_blank" rel="noopener noreferrer">文本原文 ↗</a> · <a href={r.license.textLicenseUrl} target="_blank" rel="noopener noreferrer">{r.license.textLicense}</a></p>
          <p>读音：{r.target.pronunciationId}；配方：{r.recipeVersion}；听审：{r.review.status}。</p><p>{r.asset ? `${r.asset.path} · ${r.asset.bytes} bytes · SHA-256 ${r.asset.sha256}` : '暂无文件，未伪造播放资源。'}</p>
        </details>
      </article>)}
      {resources.length > limit && <button className="play-audio" onClick={() => setLimit(limit + 20)}>再显示 20 条</button>}
      {!resources.length && <p>没有匹配的音频记录。</p>}
    </>}
  </section>;
}
