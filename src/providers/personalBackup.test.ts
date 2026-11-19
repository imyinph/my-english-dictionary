import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData, saveWord, backupOf, parseBackup, changes} from '../domain/personalData.ts';

test('round trip includes suspended learning state and rejects invalid or duplicate identities',()=>{
  const saved=saveWord(saveWord(emptyData(),'create','create','queue'),'Resilient',undefined,'queue');
  saved.entries[0].learning='known'; saved.entries[0].resumeLearning='queued';
  const ids=new Set(['create']);
  const decoded=parseBackup(backupOf(saved),ids);
  assert.deepEqual(decoded,saved);
  assert.deepEqual(saveWord(decoded,'create','create','queue'),saved);
  assert.deepEqual(changes(saved,decoded),{added:0,updated:0,removed:0});
  for(const mutate of [
    (b: typeof saved)=>{b.entries[0].entryId='missing';},
    (b: typeof saved)=>{b.entries.push({...b.entries[0]});},
    (b: typeof saved)=>{b.pending.push({...b.pending[0],spelling:' resilient '});},
    (b: typeof saved)=>{b.entries[0].resumeLearning=null;},
    (b: typeof saved)=>{b.pending[0].updatedAt='broken';}
  ]){
    const backup=backupOf(structuredClone(saved)); mutate(backup);
    assert.throws(()=>parseBackup(backup,ids));
  }
});
