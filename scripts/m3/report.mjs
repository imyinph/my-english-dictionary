import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './model.mjs';
import { stats } from './pipeline.mjs';

export function acceptanceHash(task) {
  return digest({ jobKey: task.jobKey, azure: task.azure, gemini: task.gemini, comparison: task.comparison, postRecheckComparison: task.postRecheckComparison ?? null, recheck: task.recheck, status: task.status, accepted_content: task.accepted_content, candidateMetadata: task.candidateMetadata, sourceContext: task.sourceContext, editorialReview: task.editorialReview, editorialDecision: task.editorialDecision });
}
export function exportReport(root, job, directory) {
  const destination = join(root, 'artifacts/m3-dual'); mkdirSync(destination, { recursive: true });
  const ledger = existsSync(join(directory, 'calls.json')) ? JSON.parse(readFileSync(join(directory, 'calls.json'), 'utf8')) : { calls: [] };
  const data = { schemaVersion: 1, datasetVersion: job.datasetVersion, generatedAt: new Date().toISOString(), statistics: stats(job, ledger), rows: job.tasks.map(t => ({ ...t, acceptanceHash: acceptanceHash(t) })) };
  writeFileSync(join(destination, 'report.json'), JSON.stringify(data, null, 2) + '\n');
  writeFileSync(join(destination, 'exceptions.json'), JSON.stringify(data.rows.filter(r => ['needs_review', 'failed'].includes(r.status)), null, 2) + '\n');
  const embedded = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const script = `const data=${embedded};
const decisions=new Map();const cards=document.getElementById('cards');const status=document.getElementById('status');
const add=(parent,tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;parent.append(e);return e};
document.getElementById('stats').textContent=JSON.stringify(data.statistics,null,2);
function render(){cards.replaceChildren();for(const row of data.rows){if(document.getElementById('filter').value==='exceptions'&&!['needs_review','failed'].includes(row.status))continue;
const card=add(cards,'article','');add(card,'h2',row.word+' · '+row.pos);add(card,'p',row.english_definition,'english');add(card,'p','状态：'+row.status+' · '+row.quality_flags.join('；'));
const refs=add(card,'details','');add(refs,'summary','原例句、相邻义项与 ECDICT 候选（仅参考）');add(refs,'pre',JSON.stringify({examples:row.examples,adjacent:row.adjacent_senses,ecdict:row.ecdict_candidates},null,2));
add(card,'p','Azure：'+(row.azure?.text||'未调用或缺失'));const value=row.accepted_content||row.gemini;const decision=decisions.get(row.sense_id);
const gloss=add(card,'textarea','');gloss.value=(decision?.glosses||value?.glosses||[]).join('；');gloss.setAttribute('aria-label','中文简释');
const explanation=add(card,'textarea','');explanation.value=decision?.explanation??value?.explanation??'';explanation.setAttribute('aria-label','中文扩展解释');
const record=add(card,'details','');add(record,'summary','自动检查与冲突复核依据');add(record,'pre',JSON.stringify({generation:row.gemini,sourceContext:row.sourceContext,editorialReview:row.editorialReview,editorialDecision:row.editorialDecision,comparison:row.comparison,recheck:row.recheck,finalComparison:row.postRecheckComparison,events:row.events},null,2));
const indicator=add(card,'p',decision?'已选择：'+decision.decision:'未选择验收结果');
if(row.status==='user_accepted'){gloss.disabled=true;explanation.disabled=true;add(card,'p','此前用户已接受，保持原样。');continue;}
const accept=add(card,'button','接受此义项（含我的修正）');accept.disabled=!row.gemini;accept.onclick=()=>{const glosses=gloss.value.split('；').map(s=>s.trim()).filter(Boolean);if(!glosses.length||!explanation.value.trim())return alert('请填写简释与解释');decisions.set(row.sense_id,{sense_id:row.sense_id,expectedHash:row.acceptanceHash,decision:'user_accepted',glosses,explanation:explanation.value.trim(),manualCorrection:JSON.stringify(glosses)!==JSON.stringify(row.gemini.glosses)||explanation.value.trim()!==row.gemini.explanation});indicator.textContent='已选择接受；导出后才保存';};
const reject=add(card,'button','拒绝此义项');reject.onclick=()=>{decisions.set(row.sense_id,{sense_id:row.sense_id,expectedHash:row.acceptanceHash,decision:'user_rejected'});indicator.textContent='已选择拒绝；导出后才保存';};
const retry=add(card,'button','加入重新生成清单');retry.onclick=()=>{decisions.set(row.sense_id,{sense_id:row.sense_id,expectedHash:row.acceptanceHash,decision:'regenerate'});indicator.textContent='已加入重新生成清单；不会立即调用 API';};}}
document.getElementById('filter').onchange=render;
document.getElementById('acceptAll').onclick=()=>{if(!confirm('接受全部 auto_pass 项？异常、失败及已有批准项不会被包含。'))return;for(const r of data.rows.filter(r=>r.status==='auto_pass'))if(!decisions.has(r.sense_id))decisions.set(r.sense_id,{sense_id:r.sense_id,expectedHash:r.acceptanceHash,decision:'user_accepted',glosses:r.gemini.glosses,explanation:r.gemini.explanation,manualCorrection:false});render();};
function download(name,value){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.getElementById('export').onclick=()=>{const reviewer=document.getElementById('reviewer').value.trim();if(!reviewer||!decisions.size)return alert('填写审核者并选择验收结果');download('m3-acceptance.json',{schemaVersion:1,datasetVersion:data.datasetVersion,reviewer,reviewedAt:new Date().toISOString(),items:[...decisions.values()]});status.textContent='已导出审核包；请用本地 acceptance 命令导入。没有修改线上数据。';};
document.getElementById('report').onclick=()=>download('m3-full-report.json',data);render();`;
  const html = `<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M3 双引擎集中验收</title><style>body{max-width:1000px;margin:auto;padding:20px;font:16px/1.6 system-ui;background:#fafaf7;color:#243b32}article{padding:20px;border:1px solid #ccd6ce;border-radius:14px;margin:20px 0;background:white}textarea{display:block;box-sizing:border-box;width:100%;min-height:90px;margin:10px 0;font:inherit}button,select,input{font:inherit;padding:12px;margin:5px;max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.english{font-weight:600;font-size:19px}h1{font-size:26px}</style><h1>M3 双引擎集中验收</h1><p>仅本地验收；自动通过不等于用户接受。修改或选择后请导出审核包，关闭页面前先保存。原始 ECDICT 候选仅供本机审查，不发布到 PWA。</p><details><summary>总体统计</summary><pre id="stats"></pre></details><label>筛选 <select id="filter"><option value="all">全部 113 个义项</option><option value="exceptions">仅异常与失败</option></select></label><label>审核者 <input id="reviewer" placeholder="填写姓名或称呼"></label><button id="acceptAll">接受全部自动通过项</button><button id="export">导出我的验收决定</button><button id="report">导出完整报告</button><p id="status" role="status"></p><main id="cards"></main><script>${script}</script></html>`;
  writeFileSync(join(destination, 'acceptance.html'), html);
  const table = data.rows.map(r => `| ${r.word} | ${r.pos} | ${r.sense_id} | ${r.status} | ${r.quality_flags.join(', ')} |`).join('\n');
  writeFileSync(join(destination, 'report.md'), `# M3 双引擎报告\n\n${JSON.stringify(data.statistics, null, 2)}\n\n这是实际任务状态；queued 不代表生成成功，缺失结果不填造。\n\n|词|词性|Sense ID|状态|问题|\n|---|---|---|---|---|\n${table}\n`);
  return data.statistics;
}
