# 中文内容专项 · iPhone 验收清单

设备型号 __________　iOS 版本 __________　验收日期 __________

从 [正式站首页](https://my-english-dictionary.pages.dev/) 开始。先在 Safari 做第 1–6 项，再从主屏幕图标做第 7 项。主屏幕使用正式域名安装的图标；首次安装可在 Safari 的分享菜单里选择「添加到主屏幕」。表中的英文是定位义项和例句的原文。

最终验收：用户已确认 Safari、主屏幕和倍速均通过。下方保留原验收步骤。

## Safari

- [ ] **1．分清创作成果与创作过程。** 打开 [creation](https://my-english-dictionary.pages.dev/#/entry/creation)，找到 *Something created such as an invention or artwork.*。英文和简释「创作品」默认可见，点击「展开中文解释」后看到「指创造出来的具体事物，例如一项发明或一件艺术作品。」再打开「中文来源与审核」，确认简释来自词典，新增解释标为 AI 复核通过。例句译文仍然收起。
- [ ] **2．核对造物主义项。** 打开 [creator](https://my-english-dictionary.pages.dev/#/entry/creator)，找到 *The deity that created the world.*。简释是「造物主」，展开后是「在宗教语境中，指创造世界的神。」上下相邻义项各自显示对应内容。
- [ ] **3．核对 make 的致使义。** 打开 [make](https://my-english-dictionary.pages.dev/#/entry/make)，用 Safari 页内查找 *To cause to be.*。简释是「使；使得」，解释包含「make + 宾语 + 形容词」。再查找 *The camera was of German make.*，展开这条例句看到「这台相机是德国制造的。」确认动词、名词的义项和例句对应正确。
- [ ] **4．检查短语、折叠和返回。** 打开 [make sense](https://my-english-dictionary.pages.dev/#/entry/make-sense)，找到 *Can you make sense of her handwriting?*。目标短语高亮，初始只显示英文；点「查看例句译文」后看到「你看得懂她的字迹吗？」和 AI 复核标识。其他例句仍收起。点短语关键词 sense，再点「← 返回」，应回到 make sense。
- [ ] **5．真机试听。** 在同一短语页选择 Joanna、1×，朗读词头和一条例句；再切换 Stephen、0.75×，朗读同一例句。确认两种音色可以区分、降速生效、整句能播完。播放中点「停止朗读」，确认声音停止。
- [ ] **6．检查长文本排版和译文质量。** 打开 [create](https://my-english-dictionary.pages.dev/#/entry/create)，找到以 *Under the concordate with Belgium* 开头的长句。竖屏展开译文、读到句末、再收起。检查原句与译文是否自然换行，按钮是否可点，页面是否出现横向溢出。遇到翻译不顺或歧义，记下具体原句。

## 主屏幕 PWA

- [ ] **7．从图标独立启动并重开。** 启动后通过首页搜索 creation，重复第 1 项，确认打开的是含新解释的版本。再搜索 make sense，重复第 4 项并播放例句。在 PWA 中选择 Stephen、0.75× 后退出并重开，确认其音色、语速仍是刚选的值。分别记录 Safari 和主屏幕的实际体验。

## 验收结果

- Safari　□ 通过　□ 有问题　□ 未测
- 主屏幕 PWA　□ 通过　□ 有问题　□ 未测
- 中文内容与朗读　□ 接受　□ 需修订

反馈可用一行写清：**第几项 / Safari 或主屏幕 / 词条和英文原句 / 实际看到或听到什么 / 期望结果**。全部通过时直接回复「Safari、主屏幕均通过」即可。

[95 条例句英中对照](例句译文95条验收.md) · [新增解释的逐条审核记录](../content/reviews/explanations-v1.json)

## 已完成的工程核验

- [x] 正式站逐义项比对通过：113/113 条英文义项均显示对应的中文简释和扩展解释，95/95 条英文例句均显示对应译文。
- [x] 正式站首页、中文义项文件、安装清单、JS、CSS 的 SHA-256 均与本次本地构建一致。
- [x] 157 项单元与脚本测试（151 Node、6 Python）、147 项浏览器测试通过。浏览器覆盖桌面 Chromium、移动 Chromium 和模拟 iPhone 的 WebKit。
- [x] 线上 210/210 条 MP3 哈希通过；本地 210/210 条可解码。正式站对单词、短语、例句各试听 Joanna 和 Stephen，6/6 次原生播放均触发结束事件。真机听感留给第 5 项确认。

中文专项首次发布标识 **42511882**，生产分支 main。[本次固定快照](https://42511882.my-english-dictionary.pages.dev/) · [上一版快照（回滚定位）](https://65491a67.my-english-dictionary.pages.dev/)


## 倍速修复后复验

倍速验收版本 **03807f67**。[正式站短语页](https://my-english-dictionary.pages.dev/#/entry/make-sense) · [本次固定快照](https://03807f67.my-english-dictionary.pages.dev/)

- [ ] iPhone Safari 打开 [make sense](https://my-english-dictionary.pages.dev/#/entry/make-sense)，刷新一次。用同一音色朗读 *Can you make sense of her handwriting?*，依次选择 1×、0.5×、0.75× 和 1.25×，每次重新点「朗读例句」。0.5× 的句子应约为正常时长的两倍，0.75× 略慢，1.25× 略快，最后一个词应完整。
- [ ] 从正式站的主屏幕图标重开，选择另一音色，在同一句对比 1× 和 0.5×。若有异常，请注明入口、音色、速度和所听例句。
