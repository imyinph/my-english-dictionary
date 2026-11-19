import { useEffect, useState, type MouseEvent } from 'react';
import type { SamplePublication } from '../domain/chineseSamples.ts';
import { canPreviewSample, parseSamplePublication } from '../domain/chineseSamples.ts';
import { Translation } from './Translation.tsx';

export function ChineseSampleLab({ onNavigate }: { onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void }) {
  const [data, setData] = useState<SamplePublication>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    setFailed(false);
    fetch(`${import.meta.env.BASE_URL}data/chinese-samples.json`, { signal: controller.signal, cache: 'no-cache' })
      .then(async response => { if (!response.ok) throw new Error('Sample unavailable'); return response.json() as Promise<SamplePublication>; })
      .then(value => {
        const parsed = parseSamplePublication(value);
        if (active) setData(parsed);
      }).catch(() => { if (active) setFailed(true); }).finally(() => window.clearTimeout(timer));
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [attempt]);
  return <section className="chinese-sample-lab">
    <h1>中文释义 · 12 个样本</h1>
    <p>AI 根据具体英文义项生成；当前 AI 已做第二轮自检，程序已核对义项关联。{data?.reviewer.humanReview === 'approved' ? '这 12 条已由用户人工审核，并接入正式词条。' : '独立模型复核与人工审核尚未完成。'}</p>
    <p>请比较简释是否自然、不同义项是否清楚、解释长度是否合适。保留样本对照，后续内容不继承这 12 条的审核结论。</p>
    {failed ? <p role="alert">样本加载失败。<button onClick={() => setAttempt(x => x + 1)}>重试样本</button></p> : !data ? <p role="status">正在加载样本…</p> : data.records.map((record, index) => <article className="card sample-card" key={record.senseId}>
      <h2>{index + 1}. <span lang="en">{record.context.headword}</span> <small>{record.context.partOfSpeech}</small></h2>
      <p className="sample-english" lang="en">{record.englishText}</p>
      {record.context.tags.length > 0 && <p>源用法标签：{record.context.tags.join(' · ')}</p>}
      {canPreviewSample(record) ? <section aria-label="AI 中文样本">
        <p className="translation-note">AI 辅助释义 · {data.reviewer.humanReview === 'approved' ? '已人工审核' : '自检样本 · 未人工审核'}</p>
        <p className="chinese-glosses">{record.glosses.join('；')}</p>
        <Translation label="展开中文解释">{record.explanation}</Translation>
      </section> : <p>此样本待复核，暂不展示中文。</p>}
      <details className="translation-credit"><summary>查看原例句、来源和复核记录</summary>
        {record.context.examples.length ? record.context.examples.map((example, i) => <p lang="en" key={i}>{example}</p>) : <p>本义项暂无源例句；未补造。</p>}
        <p>{record.review.rationale}</p>
        <p>生成：{data.generator.provider}；具体模型版本未提供。自检：同一 AI 第二轮；独立复核：待完成；人工审核：{data.reviewer.humanReview === 'approved' ? '用户已确认' : '待完成'}。</p>
        <p>英文及中文改编：{record.sourceRefs[0].attribution} · CC BY-SA 4.0。中文为 AI 翻译与解释，并非源站提供的中文。</p>
        <a href={record.sourceRefs[0].referenceUrl} target="_blank" rel="noopener noreferrer">英文来源 ↗</a>
        <p className="sample-id">Sense ID：{record.senseId}</p>
      </details>
      <a href={`#/entry/${encodeURIComponent(record.entryId)}`} onClick={event => onNavigate(event, `#/entry/${encodeURIComponent(record.entryId)}`)}>查看完整词条与发音 →</a>
    </article>)}
  </section>;
}
