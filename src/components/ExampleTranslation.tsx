import translations from '../../content/example-translations-v2.json';
import type { Example } from '../domain/dictionary.ts';
import { Translation } from './Translation.tsx';

const byExample = new Map(translations.records.map(record => [record.exampleId, record]));

export function ExampleTranslation({ entryId, senseId, example }: {entryId: string; senseId: string; example: Example}) {
  const record = byExample.get(example.id);
  if (record?.status === 'ai_approved' && record.entryId === entryId && record.senseId === senseId && record.englishText === example.text) {
    return <Translation label="查看例句译文">{record.translation}
      <small className="muted" style={{display: 'block'}}>AI 辅助翻译 · AI 复核通过 · 据 <a href={record.sourceUrl} target="_blank" rel="noreferrer">Wiktionary 原句</a>译写 · <a href={example.source.licenseUrl}>CC BY-SA 4.0</a></small>
    </Translation>;
  }
  return example.translation ? <Translation label="查看例句译文">{example.translation}</Translation>
    : <p className="missing-field">暂无可靠中文译文，待补充。</p>;
}
