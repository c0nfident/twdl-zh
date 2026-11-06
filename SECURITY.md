# 安全说明（v1.0.0 审计版）

本脚本（`twdl-0.2.1-zh.user.js`）是可审计的纯前端脚本。v1.0.0 做了一次结构 / 安全审计，结论如下。

## 1. 脚本内不含任何密钥

- **源码中不存在任何 API Key**，也不存在 Key 前缀形式的示例字符（可直接全仓扫描验证）
- 面板里的 Key 输入框只是空占位提示，不预填、不内置
- 仓库历史中同样没有提交过真实 Key

## 2. Key 从哪里来、存在哪里

- 仅来自**用户在设置面板手动输入**
- 存储优先级：Tampermonkey 存储（`GM_setValue`）→ 管理器不可用时退回同源 `localStorage`
  - 注意：`localStorage` 对同源页面脚本可见。**建议在 Tampermonkey 等管理器环境使用**；浏览器插件缺失时的降级存储属于可用性取舍
- 「清空缓存」只清翻译缓存，不会动 Key；卸载脚本/清除管理器数据即删除 Key

## 3. Key 会发往哪里

- **只发往用户自己填写的 API 地址**：`POST {baseUrl}/chat/completions`（OpenAI 兼容）
- 图片下载是 `GET https://pbs.twimg.com/...`，**不带 Key**，只读取图片字节后转 base64 发给视觉模型
- 脚本没有任何统计、上报、遥测、第三方埋点

## 4. 脱敏处理

- `__twdl.zh.state()` 对外返回的配置中 `apiKey` / `visionApiKey` 已打码（页面上下文拿不到明文）
- 面板「诊断」生成的报告、复制到剪贴板的文本，Key 均为打码形式
- 日志（环形日志 240 条）只记录 URL、状态码、事件类型，不记录请求体与 Key

## 5. 注入与 XSS

- 译文、OCR 结果全部用 `textContent` 渲染（不解析 HTML）
- 面板 `innerHTML` 仅使用**静态模板**，不拼接任何外部/页面数据
- 未使用 `eval` / `new Function` / `document.write`
- 无明文 `http://` 端点（下载器站点与 API 均为 https）

## 6. 权限面

- `@grant`：`GM_xmlhttpRequest`、`GM.xmlHttpRequest`、`GM_getValue`、`GM_setValue`、`unsafeWindow`
- `@connect *`：为支持用户自填的任意 OpenAI 兼容服务商；如只用自己的服务商，可把 `@connect *` 收窄为该域名
- `@match` 只包含 X/Twitter 与下载器相关域名

## 7. 使用建议

- 用**限额子账号或专用 Key**，不要用主账号全权限 Key
- 用完可在服务商控制台随时作废/轮换
- 公共电脑上不要勾选记住 Key；离开前清除 Tampermonkey 数据
- 翻译内容会发送给你选择的模型服务商，敏感推文请自行评估

## 8. 报告问题

发现安全问题请直接在仓库提 issue（附复现步骤），不要公开贴出 Key。
