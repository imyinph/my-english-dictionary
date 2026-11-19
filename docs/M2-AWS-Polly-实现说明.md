# M2 AWS Polly 音频接入

更新日期：2026-11-14。本阶段仅实现任务书 M2.0 的音频接入，不实现原始路线图中其他 M2 学习功能。全部 210 个正式音频已实际生成，区域统一为用户确认的 ap-southeast-2（悉尼）。

## 决定与边界

- 用户已在 iPhone 选定 Joanna / Stephen，固定 Amazon Polly、neural、en-US、MP3、24000 Hz，默认 Joanna。本次不用重新选音色。
- 最新任务明确取消本阶段 UK 和其他供应商，取代 M1 的 US/UK 与候选评测要求。M0/M1 历史文档保持历史事实。
- 技术选择：本地 Node 24 / TypeScript 脚本、AWS SDK v3 标准凭据链、静态文件与 JSON 清单；没有在线 TTS 后端或数据库。
- 已验证真实合成、全文件解码和桌面页面真实播放；待验事项为 AWS 实际账单、逐条发音质量及 iPhone Safari/PWA 正式接入。已选定音色不等于全部例句逐条审核。

## 实现

`scripts/pollyPlan.ts` 通过既有 Kaikki adapter 扫描当前可播放的词头、独立短语和例句。实际为 9 个词头、1 个短语、95 条例句，共 105 段内容、双音色 210 个请求。113 个义项不是 113 个音频任务。未增加正式词库，没有生成中文或来源文字。

复用 M1 的 AudioResource、ManifestAudioResolver、可取消的播放器、设置持久化键、原子文件和哈希工具。新增 `pollyBatch.ts` 管任务，`polly.ts` 接 AWS，`pollyManifest.ts` 负责前端严格解析。AWS SDK 仅在开发脚本依赖中，前端没有合成接口。旧候选生成器的付费入口已停用，历史数据/测试仍保留。

内容身份包含 kind、contentId、senseId、pronunciationId。示例句去重同时比较词头、词性、义项解释和标签；独立词元的 ID 也参与上下文。相同文字但不同读音或义项不会只按拼写合并。资源 ID 是包含上下文、音色、引擎、语言、格式、采样率、文本/SSML、规则版本的 SHA-256。只改一个纠音规则只影响该对象两个音色。

## 清单结构

`public/data/audio-manifest.json` 延用 schemaVersion 1，通过可选字段兼容扩展原契约：

| 字段 | 含义 |
| --- | --- |
| id / text / textSha256 | 稳定生成配方哈希、原始文本、文本校验值 |
| target / targets | 主内容及相同发音上下文的别名；包含义项与读音身份 |
| publication | production：用户选定组合的正式资源，区别于历史试听候选 |
| provider / source / model / voice / voiceVersion | Amazon Polly / neural / neural / Joanna 或 Stephen；服务不公开固定修订号，voiceVersion 为 null |
| synthesis | engine、languageCode、sampleRate、textType、requestText、billableCharacters、contextKey |
| recipeVersion | 本地生成规则版本；不能冒充 AWS 底层模型版本 |
| asset | 相对路径、mp3、完整字节大小、文件 SHA-256 |
| generation | planned / ready / failed、时间、尝试次数、脱敏错误分类 |
| review | pending / approved / rejected、审核人/日期/设备/备注 |
| license | Polly 输出条款链接及文本来源、许可与署名；不是把合成文件称为真人录音 |

文件为 `audio/polly/en-US/neural/{joanna|stephen}/{id}.mp3`。生成完成与人工审核独立：已选音色的正式资源可在 ready + pending 时用于验收，rejected 绝不解析；pending 不表示已通过真机验收。没有把旧试听候选自动转为正式资源。

## 播放与迁移

词典优先匹配当前音色 Polly 文件，其次现有合法 US 真人录音，最后显示本次主动使用浏览器 TTS 的按钮。所有浏览器都禁止静默 TTS；词头的旧录音不会套到特定义项读音上。快速点击、改音色/速度、导航、隐藏页面均取消旧任务。`playbackRate` 与 `preservesPitch` 控制速度，不生成多倍速副本。

沿用 `dictionary.audio-settings.v1`，旧 UK 设置迁为 US + Joanna，保留语速；不创建第二份冲突设置。诊断页 `#/audio-lab` 展示两个已选音色的状态、校验信息与来源。

清单按应用 BASE_URL 读取。默认音频也相对该路径；以后将相同目录上传 R2，设置公开的 `VITE_AUDIO_ASSET_BASE=https://音频域名/前缀/` 后重新构建即可，详情页无需改变。迁移前逐文件验证 SHA-256，检查 CORS/Content-Type/Range/HTTPS，保留旧部署所引用的文件。该变量只能放公开资源地址，绝不能放密钥。

`_headers` 使 manifest 每次重新验证，哈希音频长期缓存。没有 service worker 全量预缓存，不承诺完整离线。`release:build` 要求所有现有内容 ready，普通 `build` 可用于开发缺失资源回退，但二者都会检查 ready 文件的路径、大小、SHA-256 和 MP3 帧结构。构建后扫描 AWS 密钥模式及合成 SDK，不上传本地日志/凭据。

## 来源与许可

按 [Polly FAQ](https://aws.amazon.com/polly/faqs/)，生成语音可保存、缓存、重用和回放，不因每次回放重新产生合成费；这不替代输入词典/例句的许可。保留 Wiktionary / Kaikki 文本来源及 CC BY-SA 信息，真人录音的逐文件署名仍见 `THIRD_PARTY_NOTICES.md`。合成资源附文本署名，不声称由 AWS 授予原文权利。

[Neural 音色](https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html)、[SynthesizeSpeech 参数](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html)、[SSML 支持](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html)、[标准凭据链](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)。具体账户许可、服务限制和账单仍以 AWS 为准。
