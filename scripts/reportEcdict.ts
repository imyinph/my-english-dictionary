import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { SenseMatch } from './ecdictMatching.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const report = JSON.parse(readFileSync(join(root, 'content/ecdict-match-summary.json'), 'utf8')) as {
  dictionaryVersion: string; ecdictDatasetVersion: string; ecdictSha256: string;
  statistics: Record<string, number | string | null>; senses: SenseMatch[];
};
const names = { high_confidence_candidate: '高可信候选/待审核', ambiguous_candidate: '歧义候选/待审核', no_reliable_candidate: '无可靠候选' };
const reasons: Record<string, string> = {
  word_not_found: '未找到词头', missing_english_definition: '源缺英文定义', no_pos_aligned_bilingual_evidence: '缺同词性英中证据',
  insufficient_semantic_evidence_or_conflict: '语义证据不足或冲突', strong_english_evidence_single_pos_group_still_requires_review: '英文强匹配；双语对齐与许可待审',
  english_evidence_found_bilingual_alignment_requires_review: '有英文线索；双语对齐待审',
};
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  '# M3.2 ECDICT 真实导入与义项匹配质量报告', '',
  '报告日期：2026-11-14。按最新任务书编号，本模块是 ECDICT 导入与匹配。表格由 `pnpm ecdict:report` 从真实运行的元数据报告生成，不是人工质量审核结论。', '',
  '## 1. 输入与授权边界', '',
  `- ECDICT 固定提交：\`${report.ecdictDatasetVersion}\`。CSV 66,009,548 字节，SHA-256：\`${report.ecdictSha256}\`。`,
  `- 本项目英文快照 SHA-256：\`${report.dictionaryVersion}\`。全部 10 词/113 义项参与，无删减低频、专业或罕见义项。`,
  '- 本地缓存 `artifacts/ecdict/source/ecdict.csv` 保留原始数据；`index.json` 只索引十词并保留原字段、CSV 数据行号、物理结束行和逐记录哈希。行号是位置标识，不是语义 ID。',
  '- 仓库 LICENSE 为 MIT；README 与“ 双解释义 ”Wiki 记载多种上游，缺少逐条授权和英中对齐链。此次许可状态为 upstream_unresolved；ECDICT 原文仅本地审查，不进入 public/dist，不作“全部上游均为 MIT”的推断。',
  `- 来源：[固定 README](https://github.com/skywind3000/ECDICT/blob/${report.ecdictDatasetVersion}/README.md)、[固定 LICENSE](https://github.com/skywind3000/ECDICT/blob/${report.ecdictDatasetVersion}/LICENSE)、[上游说明](https://github.com/skywind3000/ECDICT/wiki/%E5%8F%8C%E8%A7%A3%E9%87%8A%E4%B9%89)。`, '',
  '## 2. 实际统计', '', '| 指标 | 结果 |', '| --- | ---: |',
  ...[
    ['总词条', 'totalEntries'], ['总英文义项', 'totalSenses'], ['ECDICT 覆盖词条', 'coveredEntries'], ['找到候选的义项', 'candidateSenses'],
    ['高可信候选', 'highConfidence'], ['歧义候选', 'ambiguous'], ['待审核候选义项', 'awaitingReview'], ['无可靠候选', 'noReliableCandidate'],
    ['无同词性双语证据的义项（包含缺英文/词性）', 'posMismatchSenses'], ['当前十词重复行', 'duplicateSelectedRows'], ['当前十词带异常/缺字段的记录', 'abnormalSelectedRecords'],
    ['原 CSV 扫描记录', 'importedCsvRows'], ['原 CSV 列数异常', 'invalidCsvRows'], ['自动批准', 'automaticApprovals'], ['已发布 ECDICT 译文', 'publishedEcdictTranslations'],
  ].map(([label, key]) => `| ${label} | ${report.statistics[key]} |`), '',
  `候选覆盖率为 ${report.statistics.candidateSenses}/113（${(Number(report.statistics.candidateSenses) / 113 * 100).toFixed(2)}%）。**候选覆盖率 ≠ 正确匹配率**；没有人工标注真值集，正确匹配率未知，不能用 1 个高可信候选推导准确率。`, '',
  '三条异常记录：creation 含无词性标记的专业中文组；make sense 没有英文定义、中文也无词性标记；sense 含无词性标记的专业中文组。十词 pos 频率字段均为空，实际采用各释义文本中的 n./v./vt./vi./a./s./r./adv. 标记。未臆造缺失词性。', '',
  '## 3. 方法与分数含义', '',
  '算法 conservative-evidence-v1：精确词头（仅规范大小写/空白）→ 分别筛选英文与中文的显式词性 → 比较当前英文义项的词项重合、少量可审计英语概念规则 → 用例句重合提供有限辅助、用罕见/古旧标签降低高可信判断。否定、神祇/人的冲突会排除。完整 gloss 链、用法标签和例句保留在本地审核报告。', '',
  '分数是未校准的检索分数，不是正确概率，也不是模型语义判断。候选门槛 0.45；高可信另要求至少 0.88、无相近竞争定义、该词性单英文定义和单中文组，并排除部分特殊语域。高可信仍 pending，仍无双语对齐证明。', '',
  '候选只存源记录 ID、英文行引用与中文上下文组引用；不按两个数组的位置配对，不复制整条中文到不同 Sense。一个中文组可能横跨多个含义，不能因只有一行就视作一个 Sense。当前保守算法存在漏召回和潜在误召回，需后续人工/AI 辅助逐义项补全，不声称完成全面语义理解。', '',
  '## 4. 代表性候选与错误案例', '',
  '- creatively：英文 In a creative manner. 与源英文一致；唯一英文与中文副词组，得 1.0。仍只是高可信候选，未批准，授权链也待核实。',
  '- create“授予爵位/头衔”义项：英文 invest/rank/title 等线索命中；源中文整组同时覆盖其他意义，保持歧义，不把源整组直接写成该义项译文。',
  '- make 的使役义项：有 cause/result 线索，但来源多义、中文组宽泛；它与本项目原有且用户已审核的 Wiktionary 中文是两条不同来源路径，不用原审核替 ECDICT 背书。',
  '- creator 的 deity 义项：源英文指人，其中文组却混入神祇用语。人/神祇上下文冲突被排除，不能仅见中文“上帝”便匹配成功。',
  '- make 的名词、creative 的名词、sense 的动词：对应词头有数据，但源英文缺相应词性证据，不借用其他词性翻译。',
  '- make sense：源有中文文本但缺英文定义；4 个义项都无可靠候选，禁止以词头命中冒充匹配。',
  '- 潜在误召回：make 的“使显得像”与一般使役含义可能共享 cause/be 线索；报告保留为歧义供查错，不把检索相似当作已判定同义。', '',
  '## 5. 全部 113 个义项结果', '',
  '下表英文为项目原词典义项；ECDICT 具体原文仅在本地 index 中查看。最高分为空表示未达到可靠候选检索门槛。所有候选审核状态为 pending。', '',
  '| Sense ID | 词性 | 原英文义项 | 匹配状态 | 最高分 | 原因 |', '| --- | --- | --- | --- | ---: | --- |',
  ...report.senses.map(sense => `| ${escape(sense.senseId)} | ${sense.partOfSpeech} | ${escape(sense.englishText)} | ${names[sense.category]} | ${sense.candidates[0]?.score ?? '—'} | ${reasons[sense.reason] ?? sense.reason} |`), '',
  '## 6. 复现与后续清单', '',
  '```powershell', 'pnpm ecdict:import --fetch', 'pnpm ecdict:match', 'pnpm ecdict:verify', 'pnpm ecdict:report', '```', '',
  '`--fetch` 只取固定版本一次；已有缓存核验 Git blob/字节数。默认 import 使用缓存、无网络。verify 从真实 CSV 重新解析并逐字段比对索引，再从索引重算全部匹配，与保存结果一致才通过；不写输出。不同输入文件可用 `--input 路径 --dataset-version 标识`，仍按十词范围处理。', '',
  '机器可读报告：`content/ecdict-match-summary.json`（不含 ECDICT 定义/中文原文，保留全部 ID/分数/歧义）；完整本地报告：`artifacts/ecdict/matches.json`；原文索引：`artifacts/ecdict/index.json`。', '',
  '无可靠候选的 102 个 Sense ID 已完整列于表格和 JSON，留给后续逐义项补全。11 个候选还需语义审核与来源授权核查。M3.3 可用冻结的完整英文上下文产生明确标记的草稿，仍须审核后发布；本次未调用 AI 或付费服务。', '',
];
writeFileSync(join(root, 'docs/M3.2-ECDICT匹配质量报告.md'), lines.join('\n'));
console.log(`Wrote complete ${report.senses.length}-sense matching report.`);
