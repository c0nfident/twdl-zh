# twdl-zh — Twitter/X 网页版下载 + 整页汉化 + 图片文字翻译

基于 [limbopro](https://github.com/limbopro) 的 `Twitter/X(网页版)视频/原始图片/gif一键下载` v0.1.5.19 的修复与增强版 **v1.0.0**。

- 一键下载 X 网页版视频 / 4K 原始图片 / GIF / 推文转图片
- **整页汉化**：用 LLM 把推文正文与界面文案翻成简体中文，支持「内容 / 内容+界面」两档，随时切回原文
- **图片 / 视频封面文字翻译**：视觉模型 OCR + 翻译，译文以浮层显示在媒体内，可一键看原图
- **自检诊断**：面板「诊断」按钮 + `__twdl.zh.diagnostics()`，出问题不用截图即可定位
- **不包含任何 API Key**：Key 由你自己在设置面板填写，仅保存在本机

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）
2. 新建脚本，粘贴 [`twdl-0.2.1-zh.user.js`](twdl-0.2.1-zh.user.js) 全部内容并保存
3. 打开 x.com，右下角出现 `译` 和 `⚙` 两个悬浮按钮

> 文件名沿用 `twdl-0.2.1-zh.user.js` 是为了保持 Tampermonkey 的更新识别（管理器按脚本名/命名空间识别，不按文件名）；**实际版本以脚本头 `@version 1.0.0` 为准**。后续升级会继续保持该文件名。

## 配置（⚙ 面板）

| 字段 | 说明 |
|---|---|
| API 地址 | OpenAI 兼容 base url，例如 `https://api.moonshot.cn/v1`（Kimi）或 `https://api.deepseek.com/v1`（DeepSeek） |
| 模型 | 例如 `kimi-k3` / `deepseek-chat` |
| API Key | 你的 Key（只保存在本机） |
| 视觉模型 | 留空则沿用上面的模型；Kimi K3 原生支持图片，可留空 |
| 视觉 API 地址 / Key | 留空则沿用上面的文字配置 |

> 图片翻译必须使用**支持图片输入**的模型。Kimi 官方文档：base 用 `https://api.moonshot.cn/v1`，模型 `kimi-k3` 原生视觉；脚本按官方要求不传 `temperature`、使用 `reasoning_effort: low`。

## 文档

- [FEATURE-ZH.md](FEATURE-ZH.md) — 完整功能说明、配置、错误对照表
- [SECURITY.md](SECURITY.md) — 安全说明（Key 存储/去向、脱敏、权限面）
- [CHANGELOG.md](CHANGELOG.md) — 更新日志
- [REVIEW.md](REVIEW.md) — 原版 bug 审查记录

## 测试

- `test/zh-test.html` — 汉化功能回归（104 项断言）
- `test/x-repro.html` — 真实场景复现夹具（19 项，含图片/视频/俄语/引用推文、孤儿块自愈、429 限流）
- `test/harness.html` — 下载器回归（27 项）
- `test/real-api-smoke.mjs` — 真实 API 冒烟（可选，用环境变量传 Key）
- 详细说明见 [test/README.md](test/README.md)

## 项目结构

```
twdl-zh/
├── twdl-0.2.1-zh.user.js   # 用户脚本本体（v1.0.0，单文件、无构建步骤）
├── README.md / FEATURE-ZH.md / REVIEW.md
├── SECURITY.md / CHANGELOG.md
├── dist/twdl-1.0.0.zip     # 发布包（脚本 + 文档，未纳入 git）
└── test/                   # 离线回归 + 真实场景复现 + 真实 API 冒烟
    ├── zh-test.html/.js    # 汉化回归 104 项
    ├── harness.html/test.js# 下载器回归 27 项
    ├── x-repro.html/.js    # X 真实 DOM 结构复现 19 项
    ├── zh-debug.html/.js   # 单条媒体最小调试页
    ├── visual.html/.js     # 分享图渲染检查
    └── real-api-smoke.mjs  # 真实 Kimi API 冒烟（4 项，需 Key）
```

脚本是**单文件无依赖**设计（Tampermonkey 环境）：13 个功能分区，从原版下载器 → 传输层（GM/fetch 双通道）→ 翻译队列 → 图片/视频封面 OCR → 自检诊断依次组织，便于 grep 定位。

## 发布说明

- GitHub 上的 `v1.0.0` 是通过 Git Data API 发布的**内容快照**（沙箱网络无法直连 `github.com:443` 做 `git push`）；本地仓库保留完整提交历史
- 网络正常时可执行 `git push -f origin main --tags` 用完整历史覆盖远端（内容一致）

## 安全

脚本**不含任何 API Key / Key 前缀字样**；`__twdl.zh.state()` 与诊断报告中的 Key 均已打码。详见 [SECURITY.md](SECURITY.md)。

## License

MIT。原始版本作者 limbopro；本仓库为修复/汉化分支。
