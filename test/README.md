# 测试说明

所有测试都是**离线运行**的：打开 HTML 页面即可，脚本每次通过 `window.fetch` 的假实现返回结果，不会真的调用 API、也不消耗 token（`real-api-smoke.mjs` 除外，它需要真实 Key）。

| 文件 | 作用 | 断言数 |
|---|---|---|
| `zh-test.html` + `zh-test.js` | 汉化模块回归：文本翻译、图片/视频封面、浮层、重试、429、串行门、自检诊断等 | 104 |
| `harness.html` + `test.js` | 下载器回归：图片/视频下载、分享图生成、自动填充、hash 解析 | 27 |
| `x-repro.html` + `x-repro.js` | 真实场景复现夹具：用与 X 相同的 DOM 结构（tweetPhoto/videoPlayer/overflow:hidden）+ 假传输层，验证图片/视频/俄语/引用推文、孤儿块自愈、并发=1 | 19 |
| `zh-debug.html` + `zh-debug.js` | 最小调试页：单条媒体 + 逐帧状态打印，用于排查翻译流程卡住的问题 | - |
| `visual.html` + `visual.js` | 分享图渲染的可视化检查页 | - |
| `real-api-smoke.mjs` | **真实 API 冒烟**（可选）：余额 / 模型列表 / 文字翻译 / 视觉 OCR | 4 |

## 运行方式

**浏览器测试**（推荐 Chrome/Edge）：直接双击对应的 `.html`，页面顶部会逐行输出 `PASS/FAIL`，最后一行是「结论: 全部通过 / 有 N 项失败」。

**真实 API 冒烟**（PowerShell，Key 只放环境变量、不要写进文件）：

```powershell
$env:KIMI_BASE  = 'https://api.moonshot.cn/v1'
$env:KIMI_MODEL = 'kimi-k3'
$env:KIMI_KEY   = '你的Key'
node test/real-api-smoke.mjs
```

> 注：v1.0.0 的改动属于安全/元数据级，逻辑与 `0.2.1-zh.10` 等价；`test/*.png` 是 zh.10 时期的回归截图。
