# 审查报告：Twitter/X 下载器 userscript（limbopro v0.1.5.19）

审查对象：对话中贴出的完整脚本 `@version 0.1.5.19`（1200 余行，8 个 `@match`）。
产出：[twdl-0.2.1-zh.user.js](twdl-0.2.1-zh.user.js)（v1.0.0：修复版 + 文字汉化 + 图片/视频封面文字翻译 + 自检诊断；安全审计（源码不含 Key、state 脱敏、删死代码），共 3477 行，`node --check` 通过）。
本文档只讲**修 bug** 部分；这些修复在 git 的 `main` 分支（`0.1.5.20-fix.1`）和 `feature/zh-localization` 分支（`0.2.1-zh.1`）上都有。
回归测试：假 DOM 端到端 **27 项断言全过**（`test/` 目录）；汉化功能的 104 项断言见 [FEATURE-ZH.md](FEATURE-ZH.md)。

---

## 0. 一句话结论

原版能跑，但有 **8 个"该功能其实一直没生效/会破坏页面"级别的 bug**，其中 4 个是硬失效：

| # | 症状 | 原版实际表现 |
|---|---|---|
| H1 | twittervideodownloader 自动提交 | 每次都抛 `TypeError`，**一次都没提交成功** |
| H2 | 点"推文生成图片" | **永久改写页面 DOM**（emoji 消失、时间文字累积 `·`） |
| H3 | 转图 | 旧内核直接静默失败；跨域污染时也静默失败 |
| H4 | 二维码 / 头像 | 二维码**永远画不进图**；无 qrcode 库时头像**被裁到画布外** |
| H5 | twitter.com 域 | 推文链接正则只认 `x.com`，**整站功能失效** |
| H6 | 回复引用段 | `/g` 正则状态串味，**只在奇数次点击时出现** |
| H7 | 图片下载文件名 | 丢用户名，变成 `-20261106123456.jpg` |
| H8 | 单卡片异常 | 打断整轮注入，**后面的推文永远没有按钮** |

---

## 1. 高危 bug（功能失效 / 破坏页面）

### H1. `#tweetUrl` 拼写错误 → 下载站自动提交从未成功

原版 `inDownloaderPage()`：

```js
if (document.querySelector('#tweetURL') !== null && document.querySelector('#submitBtn') !== null) {
    document.querySelector('#tweetURL').value = ...
    if (... == 'https://twittervideodownloader.com/') {
    } else if (document.querySelector('#tweetUrl').value.match(twURL_regex)) {   // ← 少了大写 R
```

`#tweetUrl` 不存在 → `querySelector` 返回 `null` → 读 `.value` 抛 `TypeError`，`#submitBtn.click()` 永远不会执行。
（页面上 URL 已经填进去了，所以肉眼看像"没反应"。）

**修复**：`fillAndClick()` 统一处理（修复版 L1093），选择器改正为 `#tweetURL`（L1124），并在点击前用 `TW_STATUS_URL_RE` 复核输入值。

### H2. 转图会永久改写页面 DOM

```js
function twEmojiToText(article) {          // 直接改真实 DOM
    ... node.parentNode.replaceChild(textNode, node)   // emoji <img> 被换成文本节点
}
function getQuote(article, x) {
    ...querySelector('[dir="ltr"][aria-hidden="true"]').textContent = " · "        // 覆盖
    ...querySelector('time').textContent = " " + time.textContent + " · "          // 累加
    ...querySelector('span[dir="ltr"]').textContent = " · " + ... + " · "          // 累加
}
```

点一次"✍️ 推文生成图片"：推文里的 emoji 永久消失；点两次：时间变成 `" ·  2小时 ·  · "` 越积越多。这是对用户时间线的真实破坏。

**修复**：所有文本/引用提取改在 `cloneNode(true)` 副本上做（`cloneWithEmojiText()` 修复版 L415），页面 DOM 只读。测试里专门验证了连续两次转图后 emoji 数量、`time.textContent`、分隔符文本都不变。

### H3. 转图在部分浏览器直接失败，且失败无声

- `context.roundRect(...)`：Chrome 99+ / Firefox 112+ 才有。旧内核抛 `TypeError` → `drawCoverImage` 中断 → `tw2Canvas_fc` 的 Promise 被拒 → 预览层永远不出现，控制台只有一条未处理拒绝。
- 图片走 `crossOrigin="anonymous"`，一旦 CDN 没给 CORS 头（或被扩展改写），`canvas.toDataURL()` 抛 `SecurityError`；原版**没有 `try/catch`，也没有 `img.onerror`**，结果就是"点了没反应"。

**修复**：`pathRoundRect()` 用 `arcTo` 兜底（修复版 L474）；`downloadOneImage()` 加 `onerror` + `try/catch`，`toDataURL` 失败退化为直链下载（L367）。

### H4. 二维码永远画不进图 / 头像被裁掉

```js
QRCode.toCanvas(qrCanvas, url, { width: qrSize, margin: 1 }, (error) => {
    context.drawImage(qrCanvas, qrX, currentY);      // 异步回调里才画
});
// ↓ 原版紧接着同步执行：
const imageData = canvas.toDataURL("image/jpeg", 1.0);   // 二维码还没画
```

另外底部留白是魔法数字：`125 * 1.3 = 162.5px`（无 qrcode 库时），而头像块实际要 `30 + 120 + 20 = 170px`，所以头像底部被裁、二维码在装了库的情况下又新增 `200 + 两行字`。

**修复**：`drawQRCode()` 改成 `await`（修复版 L543）；画布高度按"实际要画的东西"算底部留白（`footerHeight`，L~592），高度计算与绘制共用同一套行高逻辑（`measure()`，L651）。

### H5. twitter.com 域整个功能失效

```js
var twURL_regex = new RegExp(/\b^https:\/\/x\.com\/.*?\/status\/\d{10,100}\b/gi)
```

脚本 `@match` 了 `https://twitter.com/*`，但所有链接匹配都只认 `x.com`。在 twitter.com 域下：按钮 `href` 为空、`userName()` 取不到用户名、下载站 hash 也校验失败。

**修复**：常量统一为同时接受两个域名（修复版 L47），并且取链接改用 `a.href`（解析后的绝对地址）而不是 `getAttribute('href')`——X 页面里的锚点大多是 `href="/alice"` 这样的相对路径。

### H6. `/g` 正则状态串味 → 回复引用只在奇数次出现

```js
var regex_name = new RegExp(/\/status\/\d{10,100}.*/gi)
...
if (regex_name.test(window.location.href) && ...) {   // 带 /g 的 test() 会推进 lastIndex
```

第一次点击 `lastIndex > 0`，第二次 `test()` 从中间开始匹配 → 失败 → 走 `else` 分支 `twContent_reply = ''`。所以"回复引用"时有时无。

**修复**：所有常量正则不带 `/g`（L47-L50），可以安全重复 `test()`；`getTwitterUrlFromHash()` 里也不需要再手动 `lastIndex = 0`。

### H7. 图片下载文件名丢用户名

```js
a.download = nickName + "-" + formatTimetoNumber() || userName + "-" + formatTimetoNumber() || "photo" + "-" + formatTimetoNumber();
```

- `+` 优先级高于 `||`，且第一段永远是非空字符串 → 后面两个回退**永远不生效**；
- 调用点传进来的 `nickName` 是显示名，可能为空 → 文件名变成 `-20261106123456`；
- `formatTimetoNumber()` 被调用 3 次，可能得到 3 个不同时间戳。

**修复**：`buildBaseName()` 只取一次时间戳 + `sanitizeFileName()` 去掉 `\ / : * ? " < > |`（L226），多图加 `-1/-2` 序号和 `.jpg` 后缀。

### H8. 一张卡片异常会打断整轮注入

```js
for (let i = 0; i < article.length; i++) {
    if (... ) {
        ...
        article[i].querySelector("[data-testid='videoComponent']").appendChild(house);   // 可能是 null
        article[i].querySelectorAll("div[aria-labelledby]")[0].parentNode.insertBefore(...) // 可能是 null
```

`twdl()` 内部**没有任何 `try/catch`**。只要有一张卡片的结构和索引猜测对不上，整个 `for` 循环就中断——时序上更靠后的推文**永远拿不到按钮**，而滚动轮询又会反复重跑、反复断在同一处。

**修复**：逐卡片 `try/catch`（修复版 L1015 起），挂载改成候选容器列表 + 最终 `appendChild(cell)` 兜底（`mountHouse()`，L942）。

---

## 2. 中危：行为错误 / 稳定性

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| M1 | `twdl_url()` | `twdl_Kurl` 是全局变量且从不清零：匹配不到推文链接的卡片会**沿用上一条推文的 URL**，按钮挂错链接 | 改为函数内局部变量（修复版 L272） |
| M2 | `userName(article,'nickName')` | 直接取 `querySelectorAll('a')[1].textContent`，锚点不足 2 个时抛 `TypeError` | 优先 `[data-testid="User-Name"] a[href]`，再回退扫描 + 空值保护（L293） |
| M3 | `getTweetContent` / `getQuote` | 用 `[dir=auto][lang]` 的 `[0][1][2]` 索引猜正文/引用/翻译，块数量一变就取错（把翻译当引用、把引用当正文） | 正文取第一段，其余段落作为引用；无法确定的 `Reply Quote` 简化为"详情页里第一条卡片 → 当前卡片"（`extractReplyInfo()` L454） |
| M4 | `twdl()` 图片分支 | 把页面上缩略图的 `src` 改成 `name=4096x4096`，等于让浏览器**重新下载整页 4K 大图**；每次滚动重跑 `twdl()` 还会反复触发 | 只在点击瞬间计算原图地址（`get_imgsURL()` L333），不碰页面 |
| M5 | 全局 CSS | `...{display:none !important;},` 多一个逗号 → 后面那条隐藏 ezoic 广告位的规则选择器非法，被整条丢弃 | 去掉逗号（L141 起） |
| M6 | `calculateTextHeight()` vs 绘制循环 | 高度计算里 `textsSec` 加 `fontSize*0.5`，绘制时加 `lineSpacing`，两者不一致 → 长推文文字可能戳出画布底部 | 计算与绘制共用 `measure()`（L651） |
| M7 | `setInterval(1500)` + `setTimeout(2500)` 轮询滚动条 | 持续占用 CPU；X 是 SPA，`history.pushState` 导航**不触发 `popstate`**，切推文后按钮不刷新 | `MutationObserver` + 防抖 + 劫持 `pushState/replaceState` + `popstate`（L1050 起） |
| M8 | 转图点击处理 | `querySelector('div[aria-label][role="group"]').getAttribute(...)` 无空值保护，无互动栏的推文一点就报错、什么都不发生 | 空值保护，缺失时显示 `-`（L~858） |

---

## 3. 维护性 / 清理（不影响行为）

- `var twURL_regex` 用 `var` 声明了 **3 次**，作用域语义混乱 → 收敛成一组常量。
- 6 份 `switch(language)` 手写文案 → 收敛成一张 `I18N` 表（L62）。
- 死代码：`twittervideomp4` 的 `<a>` 建了但**没插进按钮组**；`loader_`（twittervideodownloader）同理；`getTweetImageSource()` 从未调用；`tempArr_reply` 从未使用。
- `twdl_div()` 里 `a.zIndex = '114154'` 是无效赋值（DOM 元素没有这个属性），应为 `a.style.zIndex`。
- 元数据 `@orginalURL` 拼写错误，且不是标准键。
- **`@downloadURL` / `@updateURL` 指向官方版**：Tampermonkey 自动更新时会把修复版**覆盖回原版**。修复版已删除这两个键（见 §5）。
- `tw2Canvas_fc()` 13 个位置参数（一处调用）→ 改为一个 `opts` 对象，附带可读性。
- 样式节点插在 `head` 的父节点（即 `<html>`）下，属非法位置 → 改 `document.head.appendChild`。
- `@match https://twittervideomp4.com/zh-tw/*` 与 `/*` 重复 → 合并。

---

## 4. 修复版验证方式（可复跑）

`test/` 目录是自包含的假 X DOM 测试台（不需要联网、不需要登录）：

- `test/harness.html`：3 张假卡片（文字+图、纯视频、纯文字无图），`x.com` 与 `twitter.com` 两种链接；对 `new Image()` 做了垫片，把 `pbs.twimg.com` 映射成本地 canvas 生成的像素，从而能真跑通 canvas 绘制路径。
- `test/test.js`：27 项断言。
- `test/visual.html` / `test/visual.js`：按钮组外观检查（CSS 优先级回归）。

用 headless Chrome 跑 `harness.html`，结果：**PASS 27 / FAIL 0**，覆盖：

```
按钮注入(3 卡片) / x.com 链接 / twitter.com 链接 / 用户名 / 昵称 / 4096x4096 原图地址
缩略图不被改成 4K / 视频卡片挂载位置 / twdl() 幂等 / 无图推文提示
转图出现预览层 / 输出 JPEG dataURL / 画布宽度 1170 / 预览层可关闭
第二次转图后 emoji 未丢失 / 时间文本未累积 / 分隔符未被覆盖
下载站自动填充（写入 + 提交）/ 同 URL 不重复提交 / location.hash 解析
```

生成成图：`test/harness-result.png`（1170×1822）；按钮组外观：`test/visual-result.png`。

**没验证到的部分**（需要真实登录环境，建议你实测）：
1. 真实 X 时间线（React 虚拟列表、DOM 结构变化）下按钮注入是否仍挂在正确位置；
2. 下载站（snapvid / twittervid / twittervideodownloader / twittervideomp4 / tweeload）**真实页面**的选择器是否还和脚本一致——原版的选择器来自 2024 年，站点改版就会失配（这部分我只能修好逻辑，没法替你验证线上 DOM）；
3. 移动端 Safari 的多图保存确认弹窗节奏（`step = 1500ms`，可在 `dlpicsfromURL()` 里调）。

---

## 5. 安装与注意事项

1. **先禁用/删除原版**再装 `twdl-0.2.1-zh.user.js`，避免两套按钮组叠加（两版都会插 `.house`，但版本不同不会互相检测）。
2. 修复版删掉了 `@downloadURL/@updateURL`，**不会被自动更新覆盖**；官方出新版后要手动对比合并。
3. 二维码功能仍需自己启用：把头部注释里的
   `//// @required https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js`
   改成 `// @required ...`（原版注释掉了，所以默认永远没有二维码，且底部会留一块空白）。
4. 与原版**行为差异**（有意为之，不是 bug）：
   - 转图文本提取从"索引猜测"改成"第一段正文 + 其余段落作引用"，个别推文的引用文案可能与原版不同；
   - 按钮组保持原版可见的 6 个（仅图片 / snapvid / tweeload / 转图 / help / 隐藏），没有把死代码里那两个下载器加回来；
   - 去掉了滚动轮询，改 `MutationObserver`（结果等价，CPU 更低）；
   - 页面缩略图不再被改成 4K（少流量，原图只在点击时按 `4096x4096` 取）。
5. `name=4096x4096` 对少数格式（部分 gif/avif）可能返回 404，修复版已有 `onerror` 退化为直链下载。

---

## 6. 文件清单

| 文件 | 说明 |
|---|---|
| `twdl-0.2.1-zh.user.js` | 修复版 userscript（装这个） |
| `test/harness.html` + `test/test.js` | 假 DOM 端到端测试（27 断言） |
| `test/visual.html` + `test/visual.js` | 按钮组外观检查 |
| `test/harness-result.png` | 测试时真实生成的推文图（1170×1822） |
| `test/visual-result.png` | 按钮组外观截图 |
| `REVIEW.md` | 本报告 |

> 备注：本目录原先在 `D:\1Work\twdl\`，写作过程中被外部整理进程移动到 `D:\1Work\tools\userscripts\`，内容未变（修复版 SHA256 `DC51AE34…E71D`）。
