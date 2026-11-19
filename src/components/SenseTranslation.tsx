import type { PublishedSenseTranslation } from '../domain/senseTranslation.ts';
import { Translation } from './Translation.tsx';

/** This language layer is separate from English senses and from example translations. */
export function SenseTranslation({ record, loading = false, failed = false }: { record?: PublishedSenseTranslation; loading?: boolean; failed?: boolean }) {
  if (loading) return <p className="missing-field" role="status">正在加载中文辅助…</p>;
  if (failed) return <p className="missing-field">中文辅助暂不可用，英文内容仍可阅读。</p>;
  if (!record || !['approved', 'ai_approved'].includes(record.reviewStatus) || record.translationStatus !== 'complete' || record.source?.licenseStatus !== 'cleared') return <p className="missing-field">{record?.translationStatus === 'candidate' && record.reviewStatus !== 'rejected' ? '中文释义待审核，暂不展示。' : '暂无可靠中文释义，待补充。'}</p>;
  return <section className="sense-translation" lang="zh-Hans" aria-label="中文辅助">
    <p className="chinese-glosses">{record.glosses.join('；')}</p>
    {record.reviewStatus === 'ai_approved' && <p className="translation-note">AI 辅助释义 · AI 复核通过</p>}
    {record.explanation ? <Translation label="展开中文解释">{record.explanation}{record.explanationReview && <small className="translation-note" style={{display: 'block'}}>扩展解释 · AI 辅助生成 · AI 复核通过</small>}</Translation> : <p className="translation-note">暂无中文扩展解释。</p>}
    <details className="translation-credit"><summary>中文来源与审核</summary>{record.explanationReview && <p>扩展解释由 AI 根据英文义项编写，经 {record.explanationReview.model} 复核。以下为中文简释的来源与审核记录。</p>}<p>{record.reviewStatus === 'ai_approved' ? 'AI 辅助生成 · AI 复核通过 · 未经人工审核' : record.source.type === 'ai' ? 'AI 辅助生成 · 已人工审核' : '已审核'} · {record.source.name}</p><p>{record.source.attribution}</p><p>{record.source.license}</p>{record.source.urls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">来源记录 ↗</a>)}</details>
  </section>;
}
