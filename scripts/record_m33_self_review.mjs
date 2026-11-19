// Transcript of this conversation's second-pass review, not an automatic semantic judge.
// Run once; never re-sign changed drafts with an old assessment.
import { readFileSync, writeFileSync } from 'node:fs';
import { sampleHash } from './chineseSamples.ts';
const drafts = JSON.parse(readFileSync(new URL('../content/m33-samples.json', import.meta.url), 'utf8'));
const assessments = [
  ['create:verb:0:b41d3520:0', '总义保留 bring into existence；原例混合红黄产生橙色，不能限定为凭空创造。'],
  ['creative:adj:2:7b1dafdb:0', '保留创造倾向/能力及源文多个可选特点，不把出色、新颖和经常创造全部设为必要条件。'],
  ['creation:noun:4:f628e272:1', '名词行为义；原例服务创设、密码创建支持动作过程，不复用已人工审核的成果义“创作品”。'],
  ['creator:noun:5:56c12aa1:1', '保留社交媒体、经常发布和尤其可变现限定；不混入另一个 deity 义项。'],
  ['creatively:adv:6:f8aa136f:0', '副词方式义，与 creativity 的能力名词区分；无源例句，未编造例句。'],
  ['creativity:noun:7:e7f52eed:0', '保留想象力、新颖想法或产品、能力三个要素；没有添加成功或艺术领域限制。'],
  ['make:verb:1:cb285157:12', 'appear/represent 是呈现义；Homer 例句支持“描绘为”，避免混同 cause to be 的实际致使义。'],
  ['make:noun:1:39483fde:6', '名词软件工具及其实现；保留自动构建应用程序，不扩展为编程语言或具体实现品牌。'],
  ['make:verb:1:fdd5aa4:28', '只覆盖写诗，并保留源标签 obsolete/intransitive；不误示为现代常见用法。'],
  ['destroy:verb:13:e4aa6981:2', 'put down/euthanize 与狗的原例一致；不混入物品毁坏义，也未指定处置方法。'],
  ['make-sense:verb:14:4763a134:0', '不及物合理/连贯义；不与另一个主动 decipher/understand 义项合并。'],
  ['sense:noun:15:415ec60f:4', '聚焦词或表达的某一含义，源 car 多义例支持；没有将父级泛义或感官义混入。'],
];
const records = assessments.map(([senseId, rationale]) => {
  const record = drafts.records.find(r => r.senseId === senseId);
  if (!record) throw new Error('Missing reviewed sense');
  return { senseId, contentHash: sampleHash(record), status: 'self_checked', rationale, reviewedOn: '2026-11-14' };
});
writeFileSync(new URL('../content/m33-sample-reviews.json', import.meta.url), JSON.stringify({ schemaVersion: 1, batchId: drafts.batchId, reviewer: { kind: 'same-agent-second-pass', independentReview: 'pending', humanReview: 'pending' }, records }, null, 2) + '\n', { flag: 'wx' });
