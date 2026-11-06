# 汉化功能说明（v1.0.0）

在 [twdl-0.2.1-zh.user.js](twdl-0.2.1-zh.user.js) 上新增：**把 X 页面上的文字（含推文图片里的文字）用 LLM 翻成简体中文，并可随时切回原文**。

- 基线版本：`0.1.5.20-fix.1`（8 个硬 bug 已修，见 [REVIEW.md](REVIEW.md)）
- 开发分支：`feature/zh-localization`（`main` 停留在修复版基线）
- 开发前快照：`D:\1Work\.dsh-snapshots\20261106-154619-pre-zh-localization`（2448 个文件哈希校验通过）
- 版本演进：`0.2.0-zh.1` 文字汉化 → `0.2.1-zh.1` 增加图片内文字翻译 → `0.2.1-zh.2` 修 API 地址归一化 / 自动补 `/v1` 重试 / 友好错误提示 / 译文块不再遮挡图片 → `0.2.1-zh.3` 支持俄语/阿拉伯语等任意语言文本 + 「控制台页面」型地址校验 → `0.2.1-zh.4` 识别「模型不存在/无权限」错误 + 品牌名当模型 ID 的告警 → `0.2.1-zh.5` 按 Kimi K3 官方文档适配（`kimi-k3`、不传 `temperature`、`reasoning_effort`、视觉消息图片在前） → `0.2.1-zh.6` 按官方错误码/限速文档适配（429 分三类 + 自动退避重试 + 请求节流） → `0.2.1-zh.7` 自适应降速 + 图片降分辨率 + 合并批次，进一步减少请求量与 TPM 消耗 → `0.2.1-zh.8` 支持视频封面文字翻译 + 译文块改媒体内浮层（修复被裁切看不见）+ 被 X 重渲染删掉后从缓存补回 → `0.2.1-zh.9` 内置自检/自我诊断（环形日志、DOM 覆盖率、孤儿块检测、面板「诊断」按钮）+ 真实场景复现夹具 → `0.2.1-zh.10` 真实 API 联调后修复：全局请求串行门（低等级账户组织并发=1，文字+图片并行会 429） → **`1.0.0` 结构/安全审计**：脚本内不含任何 Key 字样、`__twdl.zh.state()` 配置脱敏、删除死代码、描述精简

---

## 1. 怎么用

### 1.1 第一次配置（必须做一次）

1. 装好后刷新 X 页面，右下角会出现两个悬浮按钮：**`译`** 和 **`⚙`**。
2. 点 `⚙` 打开设置面板，上半部分是文字翻译：

   | 字段 | 填什么 | 默认值 |
   |---|---|---|
   | API 地址 | 任何 **OpenAI 兼容** 的 base url（不带 `/chat/completions`） | `https://api.deepseek.com/v1` |
   | 模型 | 例如 `deepseek-chat` / `deepseek-reasoner` / `gpt-4o-mini` | `deepseek-chat` |
   | API Key | 你的 key | 空 |

3. 点 **「测试连接」**，面板底部会显示 `✓ 连接成功，返回：…` 或具体错误原因。
4. 点 **「保存并翻译」** → 当前时间线的推文开始逐批翻译，右下角 `译` 变蓝。

> 没有 Key 的时候脚本**不会发任何请求**，悬浮按钮是灰色，点它只会打开设置面板。

### 1.2 日常操作

| 操作 | 效果 |
|---|---|
| 点每条译文下面的 **`原`** | 这条推文切回原文；按钮变 `译`，再点切回译文 |
| 点图片译文块下面的 **`原`** | 隐藏/显示该图片的 OCR 译文（图片本身一直在） |
| 点右下角 **`译`** | 全局切换：所有推文译文、图片译文、界面文案一起显示原文/译文 |
| 点 **`⚙`** | 设置面板：开关、范围、连接测试、重试失败项、清空缓存、图片翻译配置 |

全局切换会**清掉单条覆盖**（避免出现"我切了全局原文，但有几条还是译文"的迷惑状态）。

### 1.3 两档文字范围

- **仅内容**（默认）：推文正文、引用推文、个人简介等所有 `[dir=auto][lang]` 的用户生成内容走 LLM 翻译。
- **内容 + X 界面文案**：额外用内置词典汉化 X 自己的 UI（`Home`→首页、`Reply`→回复、`Following`→正在关注…约 100 个高频词，文本和 `aria-label`/`title`/`placeholder` 一起处理）。词典在 `ZH_UI_DICT`，可自行增删。

### 1.4 图片内文字翻译（v0.2.1 新增）

推文正文如果其实是**一张截图**（例如 Truth Social 截图、图表、长图），DOM 里没有可翻译的文本块，文本 LLM 无从下手 —— 这个模式用**视觉模型**做 OCR + 翻译。

设置面板下半部分「图片内文字」：

| 字段 | 说明 |
|---|---|
| 模式 | `自动翻译`（默认，有 Key 就翻）/ `仅显示「翻译图片文字」按钮`（手动点，最省费用）/ `关闭` |
| 视觉模型 | **必须填支持图片输入的模型**，如 `gpt-4o-mini` / `qwen-vl-max` / `glm-4v` / `gemini-2.0-flash`。留空会沿用上面的文本模型（纯文本模型会报"不支持图片"错误） |
| 视觉 API 地址 / Key | 留空沿用上面的配置；也可以单独指向另一家服务商 |

行为要点：

- 脚本把图片下载成 **base64** 再发给视觉模型，不依赖服务商能不能访问 `pbs.twimg.com`；
- 译文渲染在图片下方，带 `原` 按钮；全局 `译` 切换时图片译文一起隐藏；
- 模型判断"图里没有文字"时回 `NO_TEXT`，脚本什么都不渲染（不产生噪音）；
- 按图片 URL 缓存，同一张图只请求一次；
- 每轮扫描最多自动处理 **6 张**（`ZH_IMG_MAX_PER_SCAN`），过小的图（<240px 或高 <120px）和视频封面直接跳过；
- 请求失败会显示红色错误块，给出可照做的原因（如「接口地址返回了网页」），块内直接有「重试」按钮；404/返回网页这类地址错误会自动换候选地址（`/v1`）再试一次。

---

## 2. 行为细节

### 2.1 哪些会翻译、哪些跳过

会翻译：
- 推文正文 / 引用推文 / 长文首段 / 个人简介 / 通知里的用户内容（凡是带 `dir="auto"` + `lang` 且语言非中文的块）；
- **任意语言**：英 / 俄 / 日 / 阿拉伯 / 泰文……都翻；旧版只认拉丁字母，俄语等会被整页跳过（0 任务 0 请求）。
- **推文图片里的文字**（`pbs.twimg.com/media` 的图片，走视觉模型）。

跳过：
- 已经是中文的（`lang` 以 `zh` 开头）；
- 中文字符占比 > 15% 的中英混排（按原文保留，避免半中半英的怪句子）；
- 纯 URL / 纯 @提及 / 纯 #话题 / 纯数字、符号、emoji；
- 空文本、单字符、超过 **2000 字**的超长文本（超长推文目前整条跳过，不切段）；
- 输入框、`contenteditable` 编辑区（不会翻译你正在写的内容）；
- 脚本自己的 UI（悬浮按钮、设置面板）；
- 头像、emoji 图片、视频封面、尺寸过小的图片。

### 2.2 为什么用"兄弟节点"而不是替换文本

译文放在原文元素**后面**的独立块 `<div class="twdl-zh-block">` 里，原文只加 `display:none`。
这样：

- React 重渲染时最多把我们设的 `display` 冲掉（扫描时会重新压回去），**不会破坏 X 自己的文本节点**；
- 每条译文的 `原/译` 状态是 DOM 上的 `data-show-orig` 属性，刷新/重渲染后可恢复；
- 虚拟列表复用节点时，如果同一个 DOM 节点的文字变了，会**检测到 hash 不一致并丢弃旧译文**重新翻译；
- 「推文转图片」「下载」读到的文本跟随当前显示状态（页面显示中文，导出的图片/文件名也是中文语境），由 `textBlocks()` 统一处理。

视频推文也支持：X 的视频播放器用 `video[poster]` / `amplify_video_thumb` 当封面（不在 `img[src*='pbs.twimg.com/media']` 里），v0.2.1-zh.8 起会把**封面这一帧**的文字也翻出来；视频后续帧里的动态文字不会被翻译（Kimi 视频理解需要先上传文件拿 `ms://` 引用，脚本不做这一步）。

图片译文用的是同一套思路：`<div class="twdl-zh-imgblock">` 插在 `[data-testid="tweetPhoto"]` 之后（即图片卡片下方），图片本身不动；早期版本插在 `<img>` 后面会盖住图片，已修复。

### 2.3 成本控制

- 批量：一次请求最多 **8 段文本 / 1200 字符**（`ZH_BATCH_ITEMS` / `ZH_BATCH_CHARS`），按顺序串行请求。
- 每轮扫描最多新增 **24 个**文字任务（`ZH_QUEUE_MAX`）、**6 张**图片任务（`ZH_IMG_MAX_PER_SCAN`），长列表边滚边翻，不会一进页面就烧掉几十次调用。
- 缓存：按文本 hash / 图片 URL 缓存，默认上限 **600 条**（`ZH_MAX_CACHE`），命中缓存**不再请求**。
- 失败项会被标记，**不会自动反复重试**（避免接口炸了还在烧钱）；点面板「重试失败项」手动重来。
- 图片按张计费：想省钱就把图片模式设成「仅显示按钮」或「关闭」。

### 2.4 错误处理

面板底部实时显示：状态、文字已译/失败/请求次数、图片已译/无文字/失败/请求次数、缓存条数、队列长度、最近错误。常见错误直接显示原因：

- `HTTP 401 Unauthorized` → Key 填错或没权限
- `HTTP 402/429` → 余额不足 / 限流
- `请求超时` → 代理或网络问题
- `接口返回缺少 choices[0].message.content` → base url 填错（填成了完整接口地址？）或模型名不对
- 图片翻译报 `不支持图片` / `invalid image` → 视觉模型那一栏没填，或填的模型不支持图片输入

---

### 2.6 API 地址怎么填 / 常见报错对照

- **只填 base url**：如 https://api.deepseek.com/v1、https://xxx.com/v1。贴成完整接口（.../chat/completions）会被自动纠正；贴成网站首页 / 代理页 / 少了 /v1 会触发下面的错误。粘贴服务商**控制台/登录页**（如 https://platform.kimi.com/console/account）不是 API 地址，脚本会在面板里直接给 ⚠ 警告；Kimi/Moonshot 的 base 是 https://api.moonshot.cn/v1，视觉模型要填具体模型名（如 moonshot-v1-8k-vision-preview，以控制台模型列表为准），kimi 只是品牌名。
- **自动纠正 + 自动重试**：保存时会去掉尾部 / 和误贴的 /chat/completions；请求遇到「404 / 返回网页」时会自动换 /v1 候选地址再试一次（面板状态里的「上次请求」会显示实际打到的 URL）。
- 错误对照：

| 现象 | 原因 / 怎么改 |
|---|---|
| 接口地址返回了网页而不是 API（HTTP 404） | 地址填错（网站首页 / 完整接口 / 代理页面）。改成 base url，缺 /v1 时补上 |
| 模型不存在或无权限（HTTP 404/400） | 模型名填错（如把品牌名 `kimi` 当模型 ID）。填控制台模型列表里的完整 ID：Kimi 填 `kimi-k3` 或 `kimi-k3.1-pro`（原生支持图片） |
| API Key 被拒绝（HTTP 401/403） | Key 错、过期、或该 Key 没权限 |
| 请求被拒绝（HTTP 400） | 模型名不对；或该模型不支持图片输入（图片翻译要用视觉模型） |
| 图片太大（base64 超过 6MB） | 换小图，或换支持大图的模型 |
| HTTP 429（看 error.type） | ① `engine_overloaded_error` 节点过载 → 退避重试（充值/升级不能消除）；② `rate_limit_reached_error` 组织级并发/RPM/TPM/TPD 超限 → 降频或充值提级；③ `exceeded_current_quota_error` 余额不足/欠费 → 充值（`GET https://api.moonshot.cn/v1/users/me/balance` 查余额）；因 429 中断的请求不扣费 |
| 面板出现「上次请求：…」 | 这是脚本实际请求的完整 URL，拿它和服务商文档对照最快 |

---

### 2.7 Kimi K3 配置要点（按官方文档）

> 依据：[Kimi K3 快速开始](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)、[配置 Kimi 视觉模型](https://platform.kimi.com/docs/guide/use-kimi-vision-model)。

| 项 | 填什么 |
|---|---|
| API 地址 | `https://api.moonshot.cn/v1` |
| 模型（文字） | `kimi-k3`（或 `kimi-k3.1-pro`） |
| 视觉模型 | **留空**（沿用文字模型；`kimi-k3` 原生支持视觉） |
| API Key | 控制台创建的 Key（[console/api-keys](https://platform.kimi.com/console/api-keys)） |

脚本已按官方要求处理的细节：

- **不手动传 `temperature` / `top_p` / `n`**（各模型取值约束不同，官方建议不要设置）；K3 系列自动使用顶层 `reasoning_effort: "low"`（翻译场景更快更省），并始终按"思考模型"处理；
- 视觉消息 `content` 是对象数组，**图片在前、文字在后**，图片只用 **base64 data URL**（官方明确不支持公网图片 URL）；
- 图片解码支持 jpeg / png / gif / webp / bmp / heic / heif（SVG 不支持，会被跳过）；
- 请求体上限按官方 100M 限制放宽到 20MB base64 保护阈值；分辨率用 X 的 `name=large`（约 2048px，符合官方 ≤4K 建议）；
- 视觉模型与文字模型相同时无需重复配 Key。
- **限速与重试（官方错误码/限速文档）**：Kimi 按累计充值分账户等级限制并发/RPM/TPM/TPD；脚本默认每两次请求至少间隔 700ms，遇到 429（`engine_overloaded_error` / `rate_limit_reached_error`）或 500/503/504 会自动退避重试（优先按 `Retry-After`，最多 3 次）；`exceeded_current_quota_error`（余额不足/欠费）不重试，直接提示充值；官方说明因 429 中断的请求不扣费。
- **降低请求量/TPM（v0.2.1-zh.7）**：文字批次合并到 12 条 / 1800 字符；图片每轮自动只处理 3 张；图片先缩到长边 ≤1600px 再 base64（视觉按动态 token 计费，分辨率越高越吃 TPM）；撞到 429 后自动降速（请求间隔翻倍、最长 20s，并进入冷却），连续成功 5 次后逐步恢复；面板会显示「自适应降速：请求间隔 Nms」与退避重试次数。
### 2.8 译文块的显示位置与自恢复

- **媒体内浮层**：X 的图片/视频容器是绝对定位 + `overflow:hidden`，把译文块插在容器外面会被裁掉（表现为"面板显示已译 N 张，但页面看不到译文"）。v0.2.1-zh.8 起译文块固定浮在媒体底部（半透明黑底、白字、可滚动），右上角有「原」按钮可隐藏；全局切原文时一起隐藏。
- **自恢复**：X 会因虚拟列表/局部刷新重新渲染 DOM，把注入的译文块删掉。脚本在下次扫描时发现"标记已翻译但译文块不见了"，会直接从本地缓存补回，**不重复发请求、不重复计费**。
- 视频封面与图片共用同一套浮层、缓存与「原」按钮。

---

### 2.9 自我诊断（v0.2.1-zh.9）

页面"没翻译 / 没报错 / 看不见"时，不用截图，先点面板里的**「诊断」**按钮：报告会写进状态区并复制到剪贴板，发出来即可定位。

- **报告内容**：版本、接口/模型（Key 打码）、文本与媒体统计、限速自适应状态、DOM 覆盖率（候选/跳过原因/已译块/可见块/孤儿块）、缓存、**自检结论**、最近 12 条事件
- **环形日志**：最多 240 条，记录扫描（`scan.text`/`scan.media`）、请求（`api.request`/`api.ok`/`api.error`/`api.retry`）、图片（`img.start`/`img.ok`/`img.error`）、重挂载（`remount`）、限速（`rate.limit`）
- **自检结论**会直接把问题翻译成可执行结论，例如：
  - `N 个媒体译文块被 X 重渲染删掉，下次扫描会用缓存补回`
  - `有 N 段可翻译文本但还没有译文块：检查 Key/模型/网络`
  - `文字/视觉接口地址可疑：…`、`限速自适应中：请求间隔已提高到 Nms`
- **控制台/脚本调用**（Tampermonkey 菜单 → 控制台）：
  ```js
  __twdl.zh.diagnostics()        // 结构化报告对象
  __twdl.zh.diagnosticsText()    // 可直接复制的文本报告
  __twdl.zh.selfCheck()          // 只返回问题清单
  __twdl.zh.debugLog()           // 原始事件日志
  ```
- **真实场景复现夹具**：[`test/x-repro.html`](test/x-repro.html) 用与 X 相同的 DOM 结构（`cellInnerDiv`/`tweetPhoto`/`videoPlayer`/`overflow:hidden`）复现 4 类推文（图片海报、视频封面、俄语、引用推文），挂假传输层跑完整流程，并用诊断接口验证孤儿块识别、缓存补回、错误配置告警与 429 退避。

---

### 2.10 真实环境测试记录（v0.2.1-zh.10）

用本机 Edge/Tampermonkey 里实际保存的配置直连 Kimi 做了联调（Key 只在测试进程内存里使用、不落盘不回显）：

| 项目 | 真实结果 |
|---|---|
| `GET /users/me/balance` | 200 · `available_balance=13.68`（全部为代金券，`cash_balance=0`） |
| `GET /models` | 200 · 5 个模型，含 `kimi-k3`、`kimi-k3.1-pro`、`kimi-k2.7-code` 等 |
| 文字翻译（kimi-k3 + `reasoning_effort=low`，不传 temperature） | 200 · 约 2–5s · 英/俄 → 中文输出正确 |
| 视觉 OCR（`image_url` 在前 + base64） | 200 · 约 38–81s · 输出正确（思考型模型较慢） |
| 并发 6 个请求探测 | **组织并发 = 1**：1 个 200、5 个 429 `rate_limit_reached_error`，带 `retry-after: 1` |

由此发现并修复了一个真实 bug：**文字翻译队列与图片翻译队列原本是并行的**，在「组织并发 = 1」的账户上会互相撞限速 → v0.2.1-zh.10 加入**全局请求串行门**（`zhWithGate`），所有 chat 请求（文字+视觉）严格排队，只保留一个在飞。

账户提示：Kimi 按**累计充值**分等级，**代金券不计入累计充值**；该账户现金充值 0 → 等级最低（并发 1、RPM/TPM 很小），所以图片翻译容易 429、且视觉请求很慢。充值 ≥10 元可提升等级。

真实 API 冒烟脚本（可选，不入 CI）：

```powershell
$env:KIMI_BASE = 'https://api.moonshot.cn/v1'
$env:KIMI_MODEL = 'kimi-k3'
$env:KIMI_KEY  = '你的Key'
node test/real-api-smoke.mjs
```

---

## 3. 安全与隐私

> 完整安全说明见 [SECURITY.md](SECURITY.md)，更新记录见 [CHANGELOG.md](CHANGELOG.md)。
>
> v1.0.0 审计结论：**脚本源码中不包含任何 API Key 字样**（仓库内可直接扫描验证）。Key 只在运行时由用户在设置面板输入、保存在本机，且只会发送到用户自己填写的 API 地址；`__twdl.zh.state()` 与「诊断」报告中的 Key 均已脱敏。
- Key 只保存在本机：Tampermonkey 的 `GM_setValue`（没有 GM 时退回 `localStorage`）。
- 请求只发往你填写的 `baseUrl`；脚本里加了 `@connect *` 以支持任意 OpenAI 兼容端点，**这意味着脚本有权向任意域发请求**——如果你在意，把 `@connect *` 改成只留你用的域名（如 `@connect api.deepseek.com`）。
- **浏览器端持有 API Key 有泄露风险**（扩展/页面脚本理论上可读）。建议：用限额子账号、单独签发一把专用 Key、只在可信浏览器配置里用。
- 文字和图片内容都会发送给 LLM 服务商——涉及隐私的推文自己权衡是否开启。

---

## 4. 测试

两个自包含测试台（不需要联网，`fetch` / 图片下载 / 视觉接口全部 mock）：

| 测试 | 断言数 | 覆盖 |
|---|---|---|
| [`test/zh-test.html`](test/zh-test.html) | **104** | 文字：无 Key 不发请求、译文块渲染、中文/纯 URL 跳过、批量合并、缓存命中、单条「原」按钮、全局切换、401 失败标记、失败不自动重试、重试恢复、界面词典（文本 + aria-label）、模式切换还原、`textBlocks()` 跟随显示状态；图片：检测与翻译、视觉模型请求格式（image_url + base64）、图片「原」按钮、全局隐藏、NO_TEXT 不渲染、缓存命中、关闭模式、401 失败与重试 |
| [`test/harness.html`](test/harness.html) | **27** | 原有下载/转图/自动填充功能回归（必须在加了汉化模块后仍然全过） |

结果：`104/104 PASS` + `27/27 PASS`；真实场景复现夹具 `test/x-repro.html` **19/19 PASS**；真实 Kimi API 冒烟 `test/real-api-smoke.mjs` **4/4 PASS**（v1.0.0 只做安全/元数据修改，逻辑与 zh.10 等价；受环境限制本轮未重跑浏览器回归，已用 node --check + 引用扫描确认）。截图：[test/zh-result.png](test/zh-result.png)、[test/harness-result.png](test/harness-result.png)。

跑法：用 Chrome 打开对应 html，看页面顶部日志；或命令行：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --screenshot=zh.png --window-size=1200,1200 "file:///D:/1Work/tools/userscripts/test/zh-test.html"
```

**没验证到的**（需要真实登录环境）：
1. 真实 X 的 DOM 结构（React 虚拟列表、`[dir=auto][lang]` 的实际形态）下译文块/图片译文块挂载位置是否自然；
2. Tampermonkey 沙箱里 SPA 导航钩子（`history.pushState` 拦截）是否仍然生效——不生效也不影响翻译，`MutationObserver` 会兜底，只是按钮/译文刷新慢一拍；
3. 各家 OpenAI 兼容端点的 CORS / 返回格式差异（脚本按 OpenAI 标准解析，异常会在面板里显示）；
4. 真实视觉模型对截图类图片的 OCR 准确率（长截图、密排表格可能漏行，提示词里已要求按阅读顺序输出）。

---

## 5. 升级 / 回滚

### 5.1 安装

1. 先禁用/删除旧版（`v0.1.5.20-fix.1`），避免两套按钮叠加。
2. 安装 [twdl-0.2.1-zh.user.js](twdl-0.2.1-zh.user.js)。
3. **注意**：v0.2.0 起为了跨域调用 LLM 接口，授权从 `@grant none` 改成了 `GM_xmlhttpRequest` 等；管理器会提示脚本权限变更，需要允许。
4. 想要图片翻译，还要在设置里单独填一个**支持图片**的视觉模型。

### 5.2 git 分支

```powershell
cd D:\1Work\tools\userscripts
git log --oneline --all        # 看提交
git switch main                # 回到"只有修 bug"的版本
git switch feature/zh-localization
git merge feature/zh-localization   # 满意后并回 main
```

### 5.3 环境快照回滚

```powershell
powershell -ExecutionPolicy Bypass -File D:\1Work\.dsh\restore.ps1 -DryRun -Snapshot "20261106-154619-pre-zh-localization"
powershell -ExecutionPolicy Bypass -File D:\1Work\.dsh\restore.ps1 -Snapshot "20261106-154619-pre-zh-localization"
```

（回滚必须完全退出 DSH，在外部终端执行，详见 `快照回滚说明.md`。）

---

## 6. 可调参数速查

| 常量 / 配置 | 默认 | 作用 |
|---|---|---|
| `ZH_DEFAULTS.baseUrl` / `model` | `api.deepseek.com/v1` / `deepseek-chat` | 文字翻译默认后端 |
| `ZH_DEFAULTS.visionModel` | 空（沿用文字模型） | 图片 OCR 用的视觉模型 |
| `ZH_DEFAULTS.imgMode` | `auto` | 图片翻译模式：`auto` / `button` / `off` |
| `ZH_BATCH_ITEMS` / `ZH_BATCH_CHARS` | 8 / 1200 | 单次文字请求批量上限 |
| `ZH_QUEUE_MAX` | 24 | 每轮扫描新增文字任务上限 |
| `ZH_IMG_MAX_PER_SCAN` | 6 | 每轮扫描新增图片任务上限 |
| `ZH_IMG_MIN_SIDE` / `ZH_IMG_MIN_HEIGHT` | 240 / 120 | 小于这个尺寸的图片跳过 |
| `ZH_MAX_CACHE` | 600 | 缓存条数上限（文字+图片共用） |
| `ZH_MAX_TEXT` | 2000 | 超过这个长度的文本跳过 |
| `ZH_UI_DICT` | 约 100 条 | 界面词典，可自行扩充 |
| `ZH_SYSTEM_PROMPT` / `ZH_IMG_PROMPT` | — | 文字/图片翻译提示词，可自行调整语气和术语 |
