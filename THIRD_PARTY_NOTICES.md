# Third-party content notices / 第三方内容说明

## Dictionary text

The dictionary subset in `public/data/kaikki-subset.json` and its adapted dictionary text are distributed under [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

Attribution: English Wiktionary contributors. Structured extraction: Wiktextract / Kaikki.org, Tatu Ylonen and contributors.

Changes: selected ten headwords; projected fields; excluded external quotations and ambiguous example records; mapped fields into the application model; retained original gloss wording. No generated definitions, example sentences or translations were added. Example ordering uses word count, not a validated difficulty scale.

This notice applies to the dictionary content, not as a blanket license for application code or audio files. Do not assume all material on Wiktionary is available under the text license: third-party quotations and media may have different terms.

Sources and contributor histories:

| Headword | Download | Original and history |
| --- | --- | --- |
| create | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/c/cr/create.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/create#English) / [history](https://en.wiktionary.org/w/index.php?title=create&action=history) |
| creative | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/c/cr/creative.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/creative#English) / [history](https://en.wiktionary.org/w/index.php?title=creative&action=history) |
| creation | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/c/cr/creation.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/creation#English) / [history](https://en.wiktionary.org/w/index.php?title=creation&action=history) |
| creator | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/c/cr/creator.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/creator#English) / [history](https://en.wiktionary.org/w/index.php?title=creator&action=history) |
| creatively | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/c/cr/creatively.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/creatively#English) / [history](https://en.wiktionary.org/w/index.php?title=creatively&action=history) |
| creativity | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/c/cr/creativity.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/creativity#English) / [history](https://en.wiktionary.org/w/index.php?title=creativity&action=history) |
| make | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/m/ma/make.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/make#English) / [history](https://en.wiktionary.org/w/index.php?title=make&action=history) |
| destroy | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/d/de/destroy.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/destroy#English) / [history](https://en.wiktionary.org/w/index.php?title=destroy&action=history) |
| make sense | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/m/ma/make%20sense.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/make_sense#English) / [history](https://en.wiktionary.org/w/index.php?title=make_sense&action=history) |
| sense | [Kaikki JSONL](https://kaikki.org/dictionary/English/meaning/s/se/sense.jsonl) | [Wiktionary](https://en.wiktionary.org/wiki/sense#English) / [history](https://en.wiktionary.org/w/index.php?title=sense&action=history) |

Source download time, byte size and SHA-256 are preserved in the dataset `provenance` array. The original downloads are not needed to run the application.

M3.1A (2026-11-14): `public/data/content-v1/identity-registry.json` and `chinese-content.json` reuse the same English context and three existing Chinese translations under the above CC BY-SA 4.0 terms. Changes are structural: frozen identities, source pointers and explicit missing/review states. Each source reference preserves the snapshot and extraction hashes, attribution and license URL. No new dictionary source or generated translation was added. `source_verified` means traceable exact source mapping, not a new human linguistic review.

M3.1 / M3.2 (2026-11-14): `public/data/chinese-senses.json` contains three source glosses explicitly approved by the project user. For creation, the already-present simplified form was selected from the traditional/simplified pair; for make, the existing semicolon-separated text became two glosses. No extended explanation was invented. Original source text and revision history remain intact; the published glosses retain the above attribution and CC BY-SA 4.0 license.

ECDICT is evaluated locally at commit `39cfb9672c0906b63569e0453c2e6abfb9ab182a`. Its repository [LICENSE](https://github.com/skywind3000/ECDICT/blob/39cfb9672c0906b63569e0453c2e6abfb9ab182a/LICENSE) is MIT; its [upstream notes](https://github.com/skywind3000/ECDICT/wiki/%E5%8F%8C%E8%A7%A3%E9%87%8A%E4%B9%89) describe mixed sources without per-record rights evidence. This project has not verified a uniform upstream content license. ECDICT CSV, normalized text and candidate source groups stay in local `artifacts/ecdict/`, outside the PWA distribution. No ECDICT definition or translation is published as an approved gloss. See the [matching report](docs/M3.2-ECDICT匹配质量报告.md) for limits and provenance. This does not change any audio license or claim that all upstream material is MIT.

## Audio

Each recording has its own license. The app streams Wikimedia-hosted MP3/OGG files on demand without editing them; users can adjust playback speed. Source files are not bundled. Attribution and license links are also visible on each entry page. License verification is not proof of network availability or successful audible playback.

| File / source | Creator | Selected license |
| --- | --- | --- |
| [en-us-create.ogg](https://commons.wikimedia.org/wiki/File:En-us-create.ogg) | Dvortygirl | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| [LL-Q1860 (eng)-Vealhurl-creative.wav](https://commons.wikimedia.org/wiki/File:LL-Q1860_(eng)-Vealhurl-creative.wav) | Speaker: Vealhurl / Recorder: Vealhurl | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [LL-Q1860 (eng)-I learned some phrases-creator.wav](https://commons.wikimedia.org/wiki/File:LL-Q1860_(eng)-I_learned_some_phrases-creator.wav) | Speaker: I learned some phrases / Recorder: I learned some phrases | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [en-us-creator.ogg](https://commons.wikimedia.org/wiki/File:En-us-creator.ogg) | LegionMammal978 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [LL-Q1860 (eng)-AnotherFriendlyHuman-creatively.wav](https://commons.wikimedia.org/wiki/File:LL-Q1860_(eng)-AnotherFriendlyHuman-creatively.wav) | Speaker: AnotherFriendlyHuman / Recorder: AnotherFriendlyHuman | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [en-us-creativity.ogg](https://commons.wikimedia.org/wiki/File:En-us-creativity.ogg) | Sylvanmoon | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [en-uk-to make.ogg](https://commons.wikimedia.org/wiki/File:En-uk-to_make.ogg) | Association Shtooka, Judith Franck | [CC BY 3.0 us](https://creativecommons.org/licenses/by/3.0/us/deed.en) |
| [en-us-make.ogg](https://commons.wikimedia.org/wiki/File:En-us-make.ogg) | Dvortygirl | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| [en-us-destroy.ogg](https://commons.wikimedia.org/wiki/File:En-us-destroy.ogg) | Dvortygirl | [Public domain](https://commons.wikimedia.org/wiki/File:En-us-destroy.ogg) |
| [LL-Q1860 (eng)-Vealhurl-destroy.wav](https://commons.wikimedia.org/wiki/File:LL-Q1860_(eng)-Vealhurl-destroy.wav) | Speaker: Vealhurl / Recorder: Vealhurl | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| [en-us-make sense.ogg](https://commons.wikimedia.org/wiki/File:En-us-make_sense.ogg) | Steve Shives | [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| [En-us-sense.ogg](https://commons.wikimedia.org/wiki/File:En-us-sense.ogg) | Dvortygirl | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| [LL-Q1860 (eng)-Back ache-sense.wav](https://commons.wikimedia.org/wiki/File:LL-Q1860_(eng)-Back_ache-sense.wav) | Speaker: Back ache / Recorder: Back ache | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |

The `audioLicenses` dataset records include the source credit, metadata API URL, verification time and metadata SHA-256. `en-us-creation.ogg` is deliberately excluded because the machine-readable author field only supplies an assumed attribution. It is not treated as a verified recording.

`make sense` uses a Commons file attributed to Steve Shives under CC0. Its Commons source credit points to YouTube; this application does not access, scrape or embed YouTube to obtain it.

## Policy references

- [Wiktionary copyright information](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)
- [Wikimedia Terms of Use, content licensing](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content)
- [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- [Wiktextract field documentation](https://github.com/tatuylonen/wiktextract)
- [Kaikki English dictionary](https://kaikki.org/dictionary/English/index.html)

Application dependencies retain their own package licenses. Browser TTS is device/browser speech synthesis, not a recording supplied by Wiktionary.

## M1 音频试听增量（2026-11-11）

现有词典文本及上述真人录音署名保留。本次新增 Azure Neural / Google Chirp 3 HD 试听计划，尚未调用 API 或生成音频；没有把候选音色或测试字节当作已经取得许可的媒体文件发布。

后续真实合成文件的提供商、音色、生成状态、服务条款与输入文本署名逐项记录于 `public/data/audio-audition.json`。Wiktionary 例句保留原文出处及 CC BY-SA 4.0；另有明确标注的项目自编发音诊断，不加入词典。音频提供商条款不替代输入文本许可，文档网站的 CC BY 许可也不适用于供应商音色模型。

详见 [供应商与授权报告](docs/M1-音频供应商评测.md)。本轮没有变更原有 Commons 音频的许可、作者或文件链接。
## M2 合成音频补充（2026-11-13）

新合成资源使用 Amazon Polly Neural，Joanna / Stephen，en-US。生成文件及原文署名在 `public/data/audio-manifest.json` 和诊断页逐项记录；generation 为 planned 的记录没有实际音频。输出保存/缓存/回放说明见 [Amazon Polly FAQ](https://aws.amazon.com/polly/faqs/)。输入文本继续适用上述 Wiktionary / Kaikki 许可与署名，不因合成改变原文权利。AI 合成音频不称为真人录音。上述既有真人录音信息完整保留。

# M3.3 中文样本增补（2026-11-14）

`public/data/chinese-samples.json` 含 12 条由当前 Codex 对话 AI 根据固定 English Wiktionary / Kaikki 英文义项生成的简体中文翻译与解释；不是源站提供的中文。原文及中文改编遵循 CC BY-SA 4.0 并保留 English Wiktionary contributors / Wiktextract / Kaikki.org 署名。逐条来源 URL、快照哈希及源 JSON 指针随数据保留。未使用 ECDICT 中文。样本仅经同一 AI 自检；未宣称独立模型或人工审核。

