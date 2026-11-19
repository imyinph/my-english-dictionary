import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function openBackup(page: Page) {
  await page.goto('/#/personal-backup');
  await expect(page.getByRole('button',{name:'准备 JSON 备份'})).toBeEnabled();
}
async function save(page: Page, value:string, queue=false) {
  await page.getByLabel('单词或短语').fill(value);
  await page.getByLabel('保存方式').selectOption(queue?'queue':'favorite');
  await page.getByRole('button',{name:'保存记录'}).click();
  await expect(page.getByLabel('单词或短语')).toHaveValue('');
}
async function file(page:Page, contents:Buffer) {
  await expect(page.getByLabel('选择备份文件')).toBeEnabled();
  await page.getByLabel('选择备份文件').setInputFiles({name:'词汇备份.json',mimeType:'application/json',buffer:contents});
}
test('download, preview, cancel and restore a personal backup in a clean browser', async ({page,browser,baseURL})=>{
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByRole('link',{name:'个人数据与备份'}).click();
  await save(page,'created');
  await save(page,'create',true);
  await save(page,'make sense',true);
  await save(page,'Resilient',true);
  await save(page,'resilient');
  await page.reload();
  await expect(page.getByText('已匹配 2 条 · 待匹配 1 条',{exact:true})).toBeVisible();
  await page.getByText('查看保存内容').click();
  await expect(page.getByText('create · 已收藏 · 待学',{exact:true})).toBeVisible();
  await expect(page.getByText('Resilient · 待匹配 · 匹配后收藏 · 匹配后加入待学')).toBeVisible();
  await page.getByRole('button',{name:'准备 JSON 备份'}).click();
  const pendingDownload=page.waitForEvent('download');
  await page.getByRole('link',{name:'下载 JSON 文件'}).click();
  const download=await pendingDownload;
  const bytes=await readFile((await download.path())!);
  const backup=JSON.parse(bytes.toString());
  expect(backup.entries.map((r:{entryId:string})=>r.entryId).sort()).toEqual(['create','make-sense']);
  const other=await browser.newContext({baseURL});
  try {
    const clean=await other.newPage();
    await openBackup(clean);
    await file(clean,bytes);
    await expect(clean.getByText('新增 3 条 · 更新 0 条 · 移除 0 条')).toBeVisible();
    await clean.getByText('取消恢复',{exact:true}).click();
    await expect(clean.getByText('已匹配 0 条 · 待匹配 0 条',{exact:true})).toBeVisible();
    await file(clean,bytes);
    await clean.getByText('确认整库恢复').click();
    await expect(clean.getByText('备份已恢复。')).toBeVisible();
    await clean.close();
    const reopened=await other.newPage();
    await openBackup(reopened);
    await expect(reopened.getByText('已匹配 2 条 · 待匹配 1 条',{exact:true})).toBeVisible();
    await reopened.getByText('查看保存内容').click();
    await expect(reopened.getByText('make sense · 待学',{exact:true})).toBeVisible();
    await file(reopened,Buffer.from('invalid'));
    await expect(reopened.getByRole('alert')).toContainText('有效的 JSON');
    await file(reopened,Buffer.from(JSON.stringify({...backup,version:999})));
    await expect(reopened.getByRole('alert')).toContainText('不支持此备份版本');
    await expect(reopened.getByText('确认整库恢复')).toHaveCount(0);
    await expect(reopened.getByText('create · 已收藏 · 待学',{exact:true})).toBeVisible();
  } finally {await other.close();}
});

test('replacement checks concurrent edits and applies deletions only after confirmation',async({page,context})=>{
  test.setTimeout(60000);
  const empty=Buffer.from(JSON.stringify({format:'personal-english-dictionary',version:1,exportedAt:new Date().toISOString(),entries:[],pending:[]}));
  await openBackup(page);await save(page,'create');
  await file(page,empty);
  await expect(page.getByText('新增 0 条 · 更新 0 条 · 移除 1 条')).toBeVisible();
  const second=await context.newPage();await openBackup(second);await save(second,'creator');
  await second.close();await page.bringToFront();
  await page.getByText('确认整库恢复').click();
  await expect(page.getByRole('alert')).toContainText('本机数据已变化');
  await file(page,empty);
  await expect(page.getByText('新增 0 条 · 更新 0 条 · 移除 2 条')).toBeVisible();
  await page.getByText('确认整库恢复').click();
  await expect(page.getByText('已匹配 0 条 · 待匹配 0 条',{exact:true})).toBeVisible();
});

test('existing data can still be exported when the shared dictionary cannot load', async ({page})=>{
  await openBackup(page);
  await save(page,'make sense',true);
  await page.route('**/data/kaikki-subset.json',route=>route.abort());
  await page.reload();
  await expect(page.getByText('词典加载失败，可先导出备份。')).toBeVisible();
  await page.getByRole('button',{name:'准备 JSON 备份'}).click();
  await expect(page.getByRole('link',{name:'下载 JSON 文件'})).toBeVisible();
  await expect(page.getByLabel('选择备份文件')).toBeDisabled();
});
