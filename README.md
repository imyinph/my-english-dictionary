# 英语词典 App

一个面向英语学习的中英双语网页版词典。内置 10 个词条，适合查阅义项、例句、发音和词族关系。

[在线体验](https://my-english-dictionary.pages.dev/)

## 功能

- 搜索词头、已收录的词形和短语，查看音标、词性、英文释义、中文简释及来源。
- 内置 113 个义项和 95 条例句，支持展开中文扩展解释和例句译文。AI 辅助内容在页面上标明来源和审核状态。
- 单词和例句支持 Amazon Polly 美式英语发音，可选 Joanna 或 Stephen，语速可设为 0.5×、0.75×、1× 或 1.25×。缺少合成音频时可使用有来源的录音或手动选择浏览器朗读。
- 支持收藏、待学状态和个人词汇 JSON 备份与恢复。个人词汇保存在当前浏览器的 IndexedDB 中；设置保存在当前浏览器中。
- 支持从 Safari 添加到 iPhone 主屏幕。线上版本由 Cloudflare Pages 托管。

## 技术栈

React 19、TypeScript 5.9 和 Vite 8。词典、翻译与预生成音频随项目提供。Python 3 用于构建和数据校验，Playwright 用于浏览器测试。

## 本地运行

安装 Node.js 24（项目版本见 `.node-version`）和 pnpm 11.25.0，然后在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

浏览器打开 [localhost:5173](http://localhost:5173/)。运行现有词典无需配置环境变量、密钥或后端。

## 构建与测试

构建和单元测试需要 PATH 上有 Python 3，命令名为 `python`。

```sh
pnpm test
pnpm build
pnpm preview
```

构建输出位于 `dist/`，预览地址为 [localhost:4173](http://localhost:4173/)。运行浏览器测试时先退出预览，再执行 `pnpm exec playwright install chromium webkit` 和 `pnpm test:e2e`。

应保留 `pnpm-lock.yaml`、`public/data/`、`public/audio/` 和 `content/`。项目使用这些文件来复现安装、构建和内容校验。依赖目录、构建输出、缓存、维护任务状态和本地环境变量由 `.gitignore` 排除。云端音频生成和翻译维护脚本使用独立的本地凭据配置，示例见 `config/` 下的 `*.env.example`。

## 数据与署名

英文词典来自 English Wiktionary，由 Wiktextract / Kaikki 提取。词典文本与相关改编适用 CC BY-SA 4.0。录音、合成音频及相关来源见 [第三方内容说明](THIRD_PARTY_NOTICES.md)。
