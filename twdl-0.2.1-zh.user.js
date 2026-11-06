// ==UserScript==
// @name         Twitter/X(网页版)视频/原始图片/gif一键下载.[limbopro]
// @name:zh-cn   Twitter/X(网页版)视频/原始图片/gif一键下载.[limbopro]
// @name:zh-tw   Twitter/X(網頁版)影片/原始圖片/gif一鍵下載.[limbopro]
// @name:en     Twitter/X(web version) videos/4K photos/gif download.[limbopro]
// @name:ja     Twitter/X (Web 版) のビデオ/写真/GIF をワンクリックでダウンロード。[limbopro]
// @name:ko     Twitter/X(웹버전) 동영상/사진/gif 원클릭 다운로드.[limbopro]
// @name:ru     Twitter/X (веб-версия) — загрузка видео/изображений/гифок в один клик.[limbopro]
// @namespace    https://limbopro.com/
// @version      1.0.0
// @description  [修 bug + 汉化 v1.0.0] 基于 limbopro v0.1.5.19：修复 8 个硬 bug；整页汉化（LLM，内容/界面两档，可切回原文）；推文图片与视频封面文字 OCR 翻译；内置自检/诊断。纯脚本，不包含任何 API Key。
// @description:zh-cn  [修 bug + 汉化版] 一键下载 4K/原始图片 / 推文转图片 / 整页汉化（LLM）/ 图片和视频封面文字 OCR 翻译（保留原文切换）。基于原版 0.1.5.19。
// @author       limbopro (original) / fix fork
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://twittervideodownloader.com/*
// @match        https://twittervid.com/*
// @match        https://tweeload.com/*
// @match        https://twittervideomp4.com/*
// @match        https://snapvid.net/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitter.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/*
 * 说明：本文件是 limbopro 原版 v0.1.5.19 的修 bug + 汉化版本。
 * - 已删除 @downloadURL / @updateURL：避免 Tampermonkey 自动更新时用原版覆盖这个修复版。
 * - 与原版的主要差异见同目录 REVIEW.md；代码里所有改动处都标了 [FIX] 或 [FIX-PERF]。
 * - 汉化功能（v0.2.0-zh.1 新增）说明见同目录 FEATURE-ZH.md。
 *   【重要】v0.1.5.20 是 @grant none；v0.2.0 起为了跨域调用 LLM 接口改成了 GM_xmlhttpRequest 授权。
 *   如果某个管理器不支持 GM_xmlhttpRequest，会退化为 fetch（可能被 CORS 拦截，界面里会显示错误原因）。
 */

(function () {
    'use strict';

    var VERSION = '1.0.0';
    var PAGE_WINDOW = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    /* -----------------------------------------------------------------
     * 1. 常量 / 正则
     * [FIX] 原版把 twURL_regex 用 var 声明了三次，且带 /g 全局标志：
     *       - /g 的 RegExp 在 .test() 之后 lastIndex 会前进，同一个正则
     *         第二次调用就会从中间开始匹配（原版 regex_name.test(...) 因此
     *         每次点击交替失效）。
     *       - 现在的常量全部不带 /g，可以安全反复 test()。
     * [FIX] 原版正则只认 https://x.com/…；twitter.com 域下抓不到推文链接。
     * ----------------------------------------------------------------- */
    var TW_STATUS_URL_RE = /^https?:\/\/(?:x|twitter)\.com\/.*?\/status\/\d{10,}(?:\/.*)?$/i;
    var TW_STATUS_URL_SEARCH_RE = /https?:\/\/(?:x|twitter)\.com\/.*?\/status\/\d{10,}/i;
    var TW_HOST_STRIP_RE = /^https?:\/\/(?:x|twitter)\.com\//i;
    var STATUS_SUFFIX_RE = /\/status\/\d{10,}.*$/i;
    var STATUS_ID_RE = /\/status\/(\d{10,})/;
    var NAME_PARAM_RE = /([?&])name=[^&]*/i;

    var LARGE_NAME = '$1name=4096x4096';
    var LARGE_IMG_NAME = '$1name=large';

    var MQ_MOBILE = /android|iphone|ipod|ipad|mobile|webos|blackberry|iemobile|opera mini/i;

    /* -----------------------------------------------------------------
     * 2. 多语言文案（原版是 6 份手写 switch，这里收成一张表）
     * ----------------------------------------------------------------- */
    var I18N = {
        'zh-cn': {
            vidEtc: '⏬ 视频等',
            photoOnly: '⏬ 仅图片',
            shareShape: '✍️ 推文生成图片 🎨',
            noImage: '该推文内容不存在图片!',
            mobileTip: '手机端用户：当浏览器提示保存/下载图片时，请尽可能快的点击确认按钮!（在本次会话中，本信息只会出现两次，累计会出现五次，以便你可以很好的了解如何操作下载图片）',
            help: '❓ Need Help?',
            hide: '隐藏',
            close: '关闭',
            download: '下载',
            confirm: '确认',
            qrTip1: '保存至相册->长按二维码识别',
            qrTip2: '跳转查看',
            replyQuote: '✍️ Reply Quote from ',
            retweetQuote: '✍️ Retweet Quote from "',
            noContent: '发现一条推文，\n分享给你！',
            noLink: '未找到推文链接'
        },
        'zh-tw': {
            vidEtc: '⏬ 影片等',
            photoOnly: '⏬ 僅圖片',
            shareShape: '✍️ 推文生成圖片 🎨',
            noImage: '該推文內容不存在圖片!',
            mobileTip: '手機端用戶：當瀏覽器提示儲存/下載圖片時，請盡可能快的點擊確認按鈕!（在本次會話中，本資訊只會出現兩次，累計會出現五次，以便你可以很好的了解如何操作下載圖片）',
            help: '❓ Need Help?',
            hide: '隱藏',
            close: '關閉',
            download: '下載',
            confirm: '確認',
            qrTip1: '儲存至相冊->長按二維碼識別',
            qrTip2: '跳轉查看',
            replyQuote: '✍️ Reply Quote from ',
            retweetQuote: '✍️ Retweet Quote from "',
            noContent: '發現一條推文，\n分享給你！',
            noLink: '未找到推文連結'
        },
        en: {
            vidEtc: '⏬ Vid etc.',
            photoOnly: '⏬ Photo.',
            shareShape: '✍️ Tweet to Image 🎨',
            noImage: 'There is no image in this tweet!',
            mobileTip: 'Mobile users: When the browser prompts you to save/download the image, please click the confirmation button as quickly as possible! (In this session, this message will only appear twice, and it will appear five times in total, so that you can learn how to download images)',
            help: '❓ Need Help?',
            hide: 'Hide',
            close: 'Close',
            download: 'Download',
            confirm: 'OK',
            qrTip1: 'Save to album, then long-press the QR code',
            qrTip2: 'to open the tweet',
            replyQuote: '✍️ Reply Quote from ',
            retweetQuote: '✍️ Retweet Quote from "',
            noContent: 'Found a tweet,\nshare it with you!',
            noLink: 'Tweet link not found'
        }
    };

    function twdlLang() {
        var lang = '';
        try {
            lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
        } catch (e) { /* ignore */ }
        if (lang.indexOf('zh') === 0) {
            return (/hant|tw|hk/.test(lang)) ? 'zh-tw' : 'zh-cn';
        }
        return 'en';
    }

    function t(key) {
        var table = I18N[twdlLang()] || I18N.en;
        return table[key] || I18N.en[key] || key;
    }

    /* -----------------------------------------------------------------
     * 3. 样式
     * [FIX] 原版 CSS 里 `display:none !important;},` 多了一个逗号，
     *       浏览器会把它当成非法选择器丢掉后面那条隐藏广告的规则。
     * [FIX] PC/移动两套 CSS 只差 .twdl 的 padding，改成 media query。
     * ----------------------------------------------------------------- */
    var TWDL_CSS = [
        '.twdlimgs{cursor:pointer}',
        '#custom-alert p{color:#000;font-size:inherit}',
        '.twdlContainerDown>a{padding:4px 0}',
        '.twdlContainerDown{display:grid;gap:1px}',
        '.twdlhidden{cursor:pointer;background:#adb5bd}',
        '.twdlhidden:hover{background-color:#6c757d;transition:.7s}',
        '.twdlshare{background:#8a63d2}',
        '.twdlshare:hover{background:#692adf;transition:.7s}',
        'div.contentBox,ins.adsbygoogle[data-ad-slot],ins.adsbygoogle[data-ad-client],',
        'span[id^="ezoic-pub-ad-placeholder-"],.ez-sidebar-wall,',
        'span[data-ez-ph-id],.ez-sidebar-wall-ad{display:none!important}',
        '.download_pics:hover{font-weight:bolder;background:#0015ff;transition:.7s}',
        '.atx{display:none}',
        '.house{background-color:inherit;gap:1px;opacity:.5;font-size:xx-small;',
        'z-index:114154!important;max-width:235px;display:flex;flex-direction:row;',
        'flex-wrap:wrap;margin-top:5px}',
        '.house:hover{opacity:1}',
        '.houseab{position:absolute;top:5%}',
        '.help{background:#6c757d;top:80px!important}',
        '.twdl{border:0;text-align:center;width:75px;align-content:center;',
        'z-index:114154!important;line-height:normal;font-size:inherit;',
        'text-decoration:none;position:sticky;top:5px;padding:4px 8px;color:#fff}',
        '.twittervideodownloader{background:#28a745}',
        '.twittervideodownloader:hover{background-color:#5dd17a;transition:.7s}',
        '.twittervid{background:linear-gradient(to bottom,#66BB6A 0%,#43A047 100%);',
        'box-shadow:inset 0 2px 2px #388E3C}',
        '.twee{background:#28a745}',
        '.twee:hover{background-color:#5dd17a;transition:.7s}',
        '.download_pics{font-weight:bolder;background-color:#339dff}',
        '.greasyfork{cursor:help;right:295px;',
        'background:linear-gradient(rgb(62 53 53) 0%,rgb(31 29 29) 100%);',
        'box-shadow:rgb(0 0 0) 0 2px 2px inset}',
        '@media (max-width:640px){.twdl{padding:6px 12px}}'
    ].join('\n');

    function injectStyle() {
        if (document.getElementById('twdlcss')) return;
        var style = document.createElement('style');
        style.id = 'twdlcss';
        style.textContent = TWDL_CSS;
        /* [FIX] 原版插到 head 的父节点（即 <html>）里，属于非法位置；直接进 head。 */
        (document.head || document.documentElement).appendChild(style);
    }

    /* -----------------------------------------------------------------
     * 4. 小工具
     * ----------------------------------------------------------------- */
    function isMobileUA() {
        return MQ_MOBILE.test(navigator.userAgent || '');
    }

    function safeStorageGet(storage, key) {
        try {
            return storage ? storage.getItem(key) : null;
        } catch (e) {
            return null;
        }
    }

    function safeStorageSet(storage, key, value) {
        try {
            if (storage) storage.setItem(key, value);
        } catch (e) { /* 隐私模式 / 配额满，忽略 */ }
    }

    /* [FIX] 原版：a.download = nickName + '-' + ts || userName + '-' + ts || 'photo' + '-'
     *       第一段永远是真值，|| 后面两条永远走不到；nickName 为空时文件名变成 "-20261106…"。
     *       另外 formatTimetoNumber() 被调用了 3 次，可能产生三个不同时间戳。 */
    function formatTimetoNumber() {
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return String(now.getFullYear()) +
            pad(now.getMonth() + 1) + pad(now.getDate()) +
            pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    }

    function sanitizeFileName(name) {
        return String(name == null ? '' : name)
            .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
            .replace(/^[.\s]+/, '')
            .trim()
            .slice(0, 120);
    }

    function buildBaseName(nickName, handle) {
        var name = sanitizeFileName(nickName) || sanitizeFileName(handle) || 'x-media';
        return name + '-' + formatTimetoNumber();
    }

    function showCustomAlert(message) {
        if (document.getElementById('custom-alert')) return;

        var alertBox = document.createElement('div');
        alertBox.id = 'custom-alert';
        alertBox.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
            'background:#fff;padding:20px;box-shadow:0 4px 8px rgba(0,0,0,.2);z-index:2147483000;' +
            'text-align:center;max-width:80vw;border-radius:8px;';

        var messageText = document.createElement('p');
        messageText.textContent = message;
        alertBox.appendChild(messageText);

        var closeButton = document.createElement('button');
        closeButton.textContent = t('confirm');
        closeButton.style.cssText = 'margin-top:10px;padding:10px 20px;border:none;' +
            'background:#007BFF;color:#fff;border-radius:4px;cursor:pointer;';
        closeButton.onclick = function () {
            if (alertBox.parentNode) alertBox.parentNode.removeChild(alertBox);
        };
        alertBox.appendChild(closeButton);

        document.body.appendChild(alertBox);
    }

    function mobilePrompt() {
        if (!isMobileUA()) return;
        var sessionCount = parseInt(safeStorageGet(window.sessionStorage, 'clickcount'), 10) || 0;
        var localCount = parseInt(safeStorageGet(window.localStorage, 'clickcount'), 10) || 0;
        sessionCount += 1;
        localCount += 1;
        safeStorageSet(window.sessionStorage, 'clickcount', String(sessionCount));
        safeStorageSet(window.localStorage, 'clickcount', String(localCount));
        if (sessionCount < 3 && localCount < 5) showCustomAlert(t('mobileTip'));
    }

    /* -----------------------------------------------------------------
     * 5. 推文链接 / 用户名
     * [FIX] 原版 twdl_Kurl 是全局变量，twdl_url() 匹配不到时会把上一条推文的
     *       链接返回给下一个按钮（广告位、没有 status 链接的卡片会挂错链接）。
     * ----------------------------------------------------------------- */
    function twdl_url(articleEl) {
        var found = '';
        if (!articleEl) return found;
        var links = articleEl.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
            /* 用 .href 而不是 getAttribute('href')：X 页面里的锚点大多是
               相对路径（href="/alice"），getAttribute 拿到的不是绝对地址。 */
            var href = links[i].href || '';
            if (TW_STATUS_URL_SEARCH_RE.test(href)) {
                /* 与原版一致：取最后一个匹配（通常是最贴近推文正文的那条） */
                var matched = href.match(TW_STATUS_URL_SEARCH_RE);
                if (matched && matched[0]) found = matched[0];
            }
        }
        return found;
    }

    /* [FIX] 原版 userName(article) 在 twitter.com 域下匹配不到链接，
     *       而且 replaceAll(/g 正则) 的写法依赖全局标志；现在统一走 .replace。
     * [FIX] 原版 userName(article,'nickName') 直接取 querySelectorAll('a')[1]，
     *       只有 1 个 <a> 的卡片会抛 TypeError，整轮 twdl() 中断。 */
    function userName(articleEl, mode) {
        if (!articleEl) return '';
        if (mode === 'nickName') {
            var nick = '';
            var nameBox = articleEl.querySelector('[data-testid="User-Name"]');
            var nameAnchor = nameBox ? nameBox.querySelector('a[href]') : null;
            if (nameAnchor) nick = (nameAnchor.textContent || '').trim();
            if (!nick) {
                var anchors = articleEl.querySelectorAll('a[href]');
                for (var i = 0; i < anchors.length; i++) {
                    var txt = (anchors[i].textContent || '').trim();
                    if (txt && txt.charAt(0) !== '@' && !/^https?:/i.test(txt)) { nick = txt; break; }
                }
            }
            return nick.replace(/\./g, '');
        }

        var url = twdl_url(articleEl);
        var handle = '';
        if (url) {
            handle = url.replace(TW_HOST_STRIP_RE, '').replace(STATUS_SUFFIX_RE, '');
        }
        /* i/web 这类非用户名路径，回退到显示名 */
        if (!handle || handle === 'i' || handle === 'web' || handle.indexOf('/') !== -1) {
            handle = userName(articleEl, 'nickName').replace(/\s+/g, '');
        }
        return handle || 'unknown';
    }

    /* -----------------------------------------------------------------
     * 6. 原图列表
     * [FIX] 原版为了收集图片地址，往每张卡片里塞隐藏的 <a class="twdl_用户名">，
     *       再用 a[class=...] 反查；用户名带特殊字符 / 卡片重渲染时就会丢图。
     *       而且原版会顺手把页面上缩略图的 src 改成 name=4096x4096（4K），
     *       等于每次滚动都强制整页重新拉大图。现在只在点击时计算原图地址。
     * ----------------------------------------------------------------- */
    function toLargeName(src, replacement) {
        return String(src || '').replace(NAME_PARAM_RE, replacement);
    }

    function get_imgsURL(articleEl) {
        var urls = [];
        if (!articleEl) return urls;
        var imgs = articleEl.querySelectorAll("img[src*='name=']");
        for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].currentSrc || imgs[i].src || imgs[i].getAttribute('src') || '';
            if (!src) continue;
            var large = toLargeName(src, LARGE_NAME);
            if (urls.indexOf(large) === -1) urls.push(large);
        }
        return urls;
    }

    /* -----------------------------------------------------------------
     * 7. 下载（图片）
     * [FIX] 原版 canvas 被跨域图片污染时 toDataURL 抛 SecurityError，
     *       并且没有 onerror 分支，结果是点了没反应、控制台一条报错都没有。
     *       现在失败就退回直链下载。
     * ----------------------------------------------------------------- */
    function triggerDownload(href, fileName, asLink) {
        var a = document.createElement('a');
        a.href = href;
        a.download = fileName;
        if (asLink) {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
        }
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 0);
    }

    function downloadOneImage(url, fileName) {
        var image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = function () {
            try {
                var canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                canvas.getContext('2d').drawImage(image, 0, 0);
                triggerDownload(canvas.toDataURL('image/jpeg', 1.0), fileName);
            } catch (e) {
                console.warn('[twdl] canvas 被跨域污染，改为直链下载：', url, e && e.message);
                triggerDownload(url, fileName, true);
            }
        };
        image.onerror = function () {
            console.warn('[twdl] 图片加载失败，改为直链下载：', url);
            triggerDownload(url, fileName, true);
        };
        image.src = url;
    }

    function dlpicsfromURL(imgsrcURL, handle, nickName) {
        if (!imgsrcURL || imgsrcURL.length === 0) {
            showCustomAlert(t('noImage'));
            return;
        }
        mobilePrompt();

        var base = buildBaseName(nickName, handle);
        var mobile = isMobileUA();
        /* 移动端/Safari 需要给浏览器留出保存确认的时间，Chrome 桌面可以快一些 */
        var step = mobile ? 1500 : (/chrome|crios|edg\//i.test(navigator.userAgent) ? 400 : 1500);

        imgsrcURL.forEach(function (url, index) {
            var fileName = base + (imgsrcURL.length > 1 ? '-' + (index + 1) : '') + '.jpg';
            setTimeout(function () { downloadOneImage(url, fileName); }, index * step);
        });
    }

    /* -----------------------------------------------------------------
     * 8. 只读文本提取
     * [FIX] 原版 twEmojiToText() 直接改页面 DOM：把推文里的 emoji <img>
     *       换成文本节点，点一次“生成图片”，页面上这条推文的 emoji 就没了。
     * [FIX] 原版 getQuote() 会写 `[dir=ltr]` 的 textContent、给 time 加 “ · ”，
     *       每点一次就累积一层，页面被改得越来越乱。
     *       现在所有提取都在 cloneNode(true) 出来的副本上做。
     * ----------------------------------------------------------------- */
    function cloneWithEmojiText(articleEl) {
        if (!articleEl) return null;
        var clone = articleEl.cloneNode(true);
        var emojiImgs = clone.querySelectorAll('[dir="auto"][lang] img');
        for (var i = 0; i < emojiImgs.length; i++) {
            var img = emojiImgs[i];
            var alt = img.getAttribute('alt');
            if (alt && img.parentNode) {
                img.parentNode.replaceChild(document.createTextNode(alt), img);
            }
        }
        return clone;
    }

    /* 读取推文文本块。
       v0.2.0 起支持"所见即所得"：如果这个文本块当前显示的是译文（原文被汉化模块
       隐藏），这里返回译文，这样「推文转图片」和下载按钮的文案与页面一致。
       克隆体里同样有效——判断依据是 DOM 属性/内联样式，不是 JS 对象引用。 */
    function textBlocks(articleEl) {
        var out = [];
        if (!articleEl) return out;
        var blocks = articleEl.querySelectorAll('[dir="auto"][lang]');
        for (var i = 0; i < blocks.length; i++) {
            var el = blocks[i];
            var textEl = el;
            var next = el.nextElementSibling;
            var showingZh = el.style && el.style.display === 'none';
            if (showingZh && next && next.classList && next.classList.contains('twdl-zh-block')) {
                var zhText = next.querySelector('.twdl-zh-text');
                if (zhText && (zhText.textContent || '').trim()) textEl = zhText;
            }
            var txt = (textEl.textContent || '').trim();
            if (txt) out.push(txt);
        }
        return out;
    }

    /* 原版这里是一堆 [0]/[1]/[2] 的索引猜测，本质是「第一条文本块 = 正文」。
       转图只需要正文，引用/翻译块单独处理，因此改成按顺序取。 */
    function getTweetContent(articleEl, mode) {
        var texts = textBlocks(articleEl);
        if (!texts.length) return mode === 'reply' ? '' : t('noContent');
        return texts[0];
    }

    function getQuote(articleEl) {
        var texts = textBlocks(articleEl);
        if (texts.length < 2) return '';
        return texts.slice(1).join(' ');
    }

    function extractReplyInfo(cell) {
        if (!/\/status\/\d{10,}/.test(window.location.href)) return '';
        var primary = document.querySelector('main[role="main"] [data-testid="primaryColumn"]');
        if (!primary) return '';
        var cells = primary.querySelectorAll('[data-testid="cellInnerDiv"]');
        if (cells.length < 2) return '';
        var parent = cells[0];
        if (parent === cell || parent.contains(cell) || cell.contains(parent)) return '';
        var parentContent = getTweetContent(cloneWithEmojiText(parent), 'content');
        if (!parentContent) return '';
        return t('replyQuote') + userName(parent, 'nickName') + '@' + userName(parent) + ':\n' + parentContent;
    }

    /* -----------------------------------------------------------------
     * 9. 推文转图片
     * ----------------------------------------------------------------- */
    function fontOf(size) {
        return size + 'px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
    }

    function pathRoundRect(ctx, x, y, w, h, r) {
        var radius = Math.min(r, w / 2, h / 2);
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, radius);
            return;
        }
        /* [FIX] ctx.roundRect 是 Chrome 99+ / Firefox 112+ 的 API。
           旧内核里调用会抛 TypeError，drawCoverImage 一挂整个转图流程就静默失败。 */
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }

    function wrapText(ctx, text, maxWidth, fontSize) {
        ctx.font = fontOf(fontSize);
        var chars = Array.from(String(text == null ? '' : text));
        var lines = [];
        var current = '';
        chars.forEach(function (ch) {
            var testLine = current + ch;
            if (ctx.measureText(testLine).width > maxWidth && current !== '') {
                lines.push(current);
                current = ch;
            } else {
                current = testLine;
            }
        });
        if (current) lines.push(current.trim());
        return lines;
    }

    function loadImage(url) {
        return new Promise(function (resolve) {
            if (!url) { resolve(null); return; }
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () { resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = url;
        });
    }

    function drawCoverImage(ctx, img, x, y, w, h) {
        if (!img || !w || !h) return;
        var targetRatio = w / h;
        var sx, sy, sw, sh;
        if (img.width / img.height > targetRatio) {
            sh = img.height;
            sw = img.height * targetRatio;
            sx = (img.width - sw) / 2;
            sy = 0;
        } else {
            sw = img.width;
            sh = img.width / targetRatio;
            sx = 0;
            sy = (img.height - sh) / 2;
        }
        ctx.save();
        pathRoundRect(ctx, x, y, w, h, 20);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        ctx.restore();
    }

    async function drawQRCode(url, canvas, ctx, y) {
        if (typeof QRCode === 'undefined' || !url) return y;
        var qrSize = 200;
        var qrCanvas = document.createElement('canvas');
        qrCanvas.width = qrSize;
        qrCanvas.height = qrSize;
        try {
            await new Promise(function (resolve, reject) {
                QRCode.toCanvas(qrCanvas, url, { width: qrSize, margin: 1 }, function (err) {
                    if (err) reject(err); else resolve();
                });
            });
        } catch (e) {
            console.warn('[twdl] 二维码生成失败', e);
            return y;
        }
        /* [FIX] 原版没等 toCanvas 的回调就继续执行，紧接着 canvas.toDataURL()，
           结果二维码永远画不进最终图片里。改成 await 之后再绘制。 */
        ctx.drawImage(qrCanvas, (canvas.width - qrSize) / 2, y);
        var fontSize = 14;
        ctx.font = fontOf(fontSize);
        ctx.fillStyle = '#fff';
        var line1 = t('qrTip1');
        var line2 = t('qrTip2');
        ctx.fillText(line1, (canvas.width - ctx.measureText(line1).width) / 2, y + qrSize + 20);
        ctx.fillText(line2, (canvas.width - ctx.measureText(line2).width) / 2, y + qrSize + 20 + fontSize + 5);
        return y + qrSize + 20 + fontSize + 5 + 20;
    }

    function tw2Canvas_fc(opts) {
        opts = opts || {};
        if (document.getElementById('imageOverlay')) return Promise.resolve();

        var FONT_SCALE = 1.8;
        var content = opts.content || t('noContent');
        var username = opts.username || '';
        var tweetTime = opts.time || '';
        var tweetUrl = opts.url || '';
        var likes = opts.likes || '';
        var imgsCount = opts.imgsCount || 0;
        var videosCount = opts.videosCount || 0;
        var retweetQuote = opts.retweetQuote || '';
        var replyInfo = opts.replyInfo || '';
        var imgsEl = opts.imgsEl || [];
        var avatarUrl = opts.avatarUrl || '';

        var canvas = document.createElement('canvas');
        canvas.id = 'tweetCanvas';
        canvas.width = 1170;
        var ctx = canvas.getContext('2d');

        var padding = { left: 32 * FONT_SCALE, right: 32 * FONT_SCALE, top: 125 * FONT_SCALE };
        var lineSpacing = 7;
        var gap = 16;
        var contentWidth = canvas.width - padding.left - padding.right;
        var textWidth = contentWidth - 80;

        var AVATAR_SIZE = 120;
        var QR_SIZE = 200;
        var hasQr = (typeof QRCode !== 'undefined') && !!tweetUrl;
        /* [FIX] 原版把底部留白写成 magic number（125*1.3 或 150*2.4），
           而头像(30+120+20)+二维码(200+~40) 实际要 300~400px，
           没装 qrcode 库时头像会被画到画布外裁掉。这里按实际要画的东西算留白。 */
        var footerHeight = (avatarUrl ? 30 + AVATAR_SIZE + 20 : 0) +
            (hasQr ? QR_SIZE + 60 : 0) + 40;

        /* 正文 */
        var segments = String(content).split(/\n+/).map(function (s) {
            return s.trim();
        }).filter(function (s) { return s !== ''; });

        var textsMain = segments.map(function (segment) {
            return { content: segment, fontSize: 40 * FONT_SCALE };
        });
        if (!textsMain.length) {
            textsMain.push({ content: t('noContent'), fontSize: 40 * FONT_SCALE });
        }
        if (retweetQuote) {
            textsMain.push({ content: t('retweetQuote') + retweetQuote + '"', fontSize: 22 * FONT_SCALE });
        }
        if (replyInfo) {
            String(replyInfo).split(/\n+/).map(function (s) {
                return s.trim();
            }).filter(function (s) { return s !== ''; }).forEach(function (segment) {
                textsMain.push({ content: segment, fontSize: 22 * FONT_SCALE });
            });
        }

        /* 页脚统计 */
        var textsSec = [
            { content: ' ', fontSize: 15 * FONT_SCALE },
            { content: '————————————————', fontSize: 15 * FONT_SCALE },
            { content: '图片 ' + imgsCount + ' 张、 视频 ' + videosCount + ' 个; ', fontSize: 15 * FONT_SCALE },
            { content: (likes || '-') + ';', fontSize: 15 * FONT_SCALE },
            { content: ' ', fontSize: 15 * FONT_SCALE },
            { content: username, fontSize: 25 * FONT_SCALE },
            { content: tweetUrl, fontSize: 15 * FONT_SCALE },
            { content: tweetTime, fontSize: 15 * FONT_SCALE }
        ];

        /* 预加载推文内图片 */
        var loadedImgs = [];
        var imgNodes = Array.prototype.slice.call(imgsEl || []);
        var totalImgsHeight = 0;

        /* 高度计算与绘制必须用同一套行高逻辑，否则文字会戳出画布底部。
           原版 calculateTextHeight() 里 textsSec 加的是 fontSize*0.5，
           绘制循环里加的却是 lineSpacing，两者对不上。 */
        function measure(items, addSpacingBetween) {
            var total = 0;
            items.forEach(function (item, index) {
                var lines = wrapText(ctx, item.content, textWidth, item.fontSize);
                total += lines.length * (item.fontSize + lineSpacing);
                if (addSpacingBetween && index < items.length - 1) {
                    total += item.fontSize * 0.5;
                } else if (!addSpacingBetween) {
                    total += lineSpacing;
                }
            });
            return total;
        }

        function calculateCanvasHeight() {
            return Math.ceil(padding.top + footerHeight + totalImgsHeight + 50 +
                measure(textsMain, true) + measure(textsSec, false));
        }

        return (async function () {
            for (var k = 0; k < imgNodes.length; k++) {
                var node = imgNodes[k];
                var rawSrc = node.currentSrc || node.src || '';
                if (!rawSrc) continue;
                var loaded = await loadImage(toLargeName(rawSrc, LARGE_IMG_NAME));
                if (loaded) loadedImgs.push(loaded);
            }

            var imgCount = loadedImgs.length;
            if (imgCount === 1) {
                totalImgsHeight = Math.min(loadedImgs[0].height / loadedImgs[0].width * contentWidth, 400 * 2);
            } else if (imgCount === 2) {
                totalImgsHeight = 200 * 2;
            } else if (imgCount === 3) {
                totalImgsHeight = (200 * 2) + gap + (120 * 2);
            } else if (imgCount >= 4) {
                totalImgsHeight = (150 * 2) * 2 + gap;
            }

            canvas.height = calculateCanvasHeight();

            /* 背景：红蓝渐变 + 胶片颗粒 */
            var dpr = window.devicePixelRatio || 2;
            var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, 'red');
            gradient.addColorStop(1, 'blue');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.03;
            for (var g = 0; g < 800; g++) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height,
                    Math.random() * 1.5 * dpr, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            var currentY = padding.top;

            /* 正文 */
            textsMain.forEach(function (item, index) {
                var lines = wrapText(ctx, item.content, textWidth, item.fontSize);
                ctx.font = fontOf(item.fontSize);
                ctx.fillStyle = '#fff';
                lines.forEach(function (line) {
                    ctx.fillText(line, padding.left, currentY);
                    currentY += item.fontSize + lineSpacing;
                });
                if (index < textsMain.length - 1) currentY += item.fontSize * 0.5;
            });

            /* 图片网格 */
            if (imgCount === 1) {
                drawCoverImage(ctx, loadedImgs[0], padding.left, currentY, contentWidth, totalImgsHeight);
                currentY += totalImgsHeight + gap;
            } else if (imgCount === 2) {
                var w2 = (contentWidth - gap) / 2;
                drawCoverImage(ctx, loadedImgs[0], padding.left, currentY, w2, totalImgsHeight);
                drawCoverImage(ctx, loadedImgs[1], padding.left + w2 + gap, currentY, w2, totalImgsHeight);
                currentY += totalImgsHeight + gap;
            } else if (imgCount === 3) {
                var topH = 200 * 2;
                var bottomH = 120 * 2;
                var w3 = (contentWidth - gap) / 2;
                drawCoverImage(ctx, loadedImgs[0], padding.left, currentY, contentWidth, topH);
                currentY += topH + gap;
                drawCoverImage(ctx, loadedImgs[1], padding.left, currentY, w3, bottomH);
                drawCoverImage(ctx, loadedImgs[2], padding.left + w3 + gap, currentY, w3, bottomH);
                currentY += bottomH + gap;
            } else if (imgCount >= 4) {
                var w4 = (contentWidth - gap) / 2;
                var h4 = 150 * 2;
                drawCoverImage(ctx, loadedImgs[0], padding.left, currentY, w4, h4);
                drawCoverImage(ctx, loadedImgs[1], padding.left + w4 + gap, currentY, w4, h4);
                currentY += h4 + gap;
                drawCoverImage(ctx, loadedImgs[2], padding.left, currentY, w4, h4);
                drawCoverImage(ctx, loadedImgs[3], padding.left + w4 + gap, currentY, w4, h4);
                currentY += h4 + gap;
            }

            /* 页脚统计 */
            textsSec.forEach(function (item) {
                var lines = wrapText(ctx, item.content, textWidth, item.fontSize);
                ctx.font = fontOf(item.fontSize);
                ctx.fillStyle = '#fff';
                lines.forEach(function (line) {
                    ctx.fillText(line, padding.left, currentY);
                    currentY += item.fontSize + lineSpacing;
                });
                currentY += lineSpacing;
            });

            /* 头像 */
            if (avatarUrl) {
                currentY += 30;
                var avatarImg = await loadImage(avatarUrl);
                if (avatarImg) {
                    var ax = (canvas.width - AVATAR_SIZE) / 2;
                    var centerX = ax + AVATAR_SIZE / 2;
                    var centerY = currentY + AVATAR_SIZE / 2;
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, AVATAR_SIZE / 2, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(avatarImg, ax, currentY, AVATAR_SIZE, AVATAR_SIZE);
                    ctx.restore();
                    ctx.strokeStyle = 'rgba(255,255,255,.8)';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, AVATAR_SIZE / 2, 0, Math.PI * 2);
                    ctx.stroke();
                    currentY += AVATAR_SIZE + 20;
                }
            }

            /* 二维码 */
            currentY = await drawQRCode(tweetUrl, canvas, ctx, currentY);

            var imageData;
            try {
                imageData = canvas.toDataURL('image/jpeg', 1.0);
            } catch (e) {
                console.error('[twdl] 画布导出失败（多半是跨域图片污染）', e);
                return;
            }

            showImageOverlay(imageData, username);
        })();
    }

    function showImageOverlay(imageData, nameForFile) {
        if (document.getElementById('imageOverlay')) return;
        var mobile = isMobileUA();

        var overlay = document.createElement('div');
        overlay.id = 'imageOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'background:rgba(0,0,0,.8);display:flex;justify-content:center;align-items:center;' +
            'z-index:2147483000;pointer-events:auto;';

        function closeOverlay() {
            document.removeEventListener('keydown', onKeyDown, true);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') closeOverlay();
        }

        if (!mobile) {
            overlay.addEventListener('click', function (event) {
                if (event.target === overlay) closeOverlay();
            });
        }
        document.addEventListener('keydown', onKeyDown, true);

        var img = document.createElement('img');
        img.src = imageData;
        img.style.cssText = 'max-width:90%;max-height:90%;border-radius:0;';

        var closeButton = document.createElement('button');
        closeButton.textContent = t('close');
        closeButton.style.cssText = 'position:absolute;top:20px;right:20px;padding:10px 20px;' +
            'font-size:16px;color:#fff;background:#e0245e;border:none;border-radius:5px;cursor:pointer;';
        closeButton.onclick = closeOverlay;

        var downloadButton = document.createElement('button');
        downloadButton.textContent = t('download');
        downloadButton.style.cssText = 'position:absolute;top:20px;right:110px;padding:10px 20px;' +
            'font-size:16px;color:#fff;background:green;border:none;border-radius:5px;cursor:pointer;';
        downloadButton.onclick = function () {
            /* [FIX] 原版 a.download = twUsername（含 @、可能含空格/':'），
               也没有扩展名，部分浏览器会存成无后缀文件。 */
            var base = sanitizeFileName(String(nameForFile || '').replace(/@/g, '-')) || 'tweet';
            triggerDownload(imageData, base + '-' + formatTimetoNumber() + '.jpg');
        };

        overlay.appendChild(downloadButton);
        overlay.appendChild(closeButton);
        overlay.appendChild(img);
        document.body.appendChild(overlay);
    }

    function openAsImage(cell) {
        var timeEl = cell.querySelector('time');
        var tweetTime = '';
        if (timeEl) tweetTime = timeEl.getAttribute('datetime') || (timeEl.textContent || '').trim();

        /* 所有文本提取都在副本上做，不碰页面本身 */
        var clone = cloneWithEmojiText(cell);
        var content = getTweetContent(clone, 'content');
        var retweetQuote = getQuote(clone);

        var replyInfo = '';
        try {
            replyInfo = extractReplyInfo(cell);
        } catch (e) {
            console.warn('[twdl] 回复引用提取失败', e);
        }

        var groupEl = cell.querySelector('div[aria-label][role="group"]');
        var likes = groupEl ? (groupEl.getAttribute('aria-label') || '') : '';
        var imgsEl = cell.querySelectorAll("img[src*='name=']");
        var videosCount = cell.querySelectorAll('[data-testid="videoPlayer"]').length;

        var avatarUrl = '';
        var avatarEl = cell.querySelector('div[data-testid="Tweet-User-Avatar"] div[style*="background-image"]');
        if (avatarEl) {
            var matched = /url\(["']?(.*?)["']?\)/i.exec(avatarEl.style.backgroundImage || '');
            if (matched) avatarUrl = matched[1];
        }

        tw2Canvas_fc({
            content: content,
            username: userName(cell, 'nickName') + '@' + userName(cell),
            time: tweetTime,
            url: twdl_url(cell),
            likes: likes,
            imgsCount: imgsEl.length,
            videosCount: videosCount,
            retweetQuote: retweetQuote,
            replyInfo: replyInfo,
            imgsEl: imgsEl,
            avatarUrl: avatarUrl
        }).catch(function (e) {
            console.error('[twdl] 转图失败', e);
        });
    }

    /* -----------------------------------------------------------------
     * 10. 按钮组
     * ----------------------------------------------------------------- */
    function snapvid_url() {
        return /^zh/.test(twdlLang())
            ? 'https://snapvid.net/zh-cn1/twitter-downloader'
            : 'https://snapvid.net/en2/twitter-downloader';
    }

    function tweeload_url() {
        return /^zh/.test(twdlLang()) ? 'https://tweeload.com/zh-cn' : 'https://tweeload.com/en';
    }

    function makeDownloaderLink(articleEl, baseUrl, className, label) {
        var a = document.createElement('a');
        var tweetUrl = twdl_url(articleEl);
        a.href = tweetUrl ? baseUrl + '#' + tweetUrl : baseUrl;
        a.className = className;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.zIndex = '114154';
        a.textContent = label;
        if (!tweetUrl) a.title = t('noLink');
        return a;
    }

    function makeButton(className, label, onClick) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    /* [FIX] 原版挂载按钮组的分支会直接 .appendChild() 到可能为 null 的节点上
       （例如 [data-testid='videoComponent'] 不存在时），一抛异常整轮 twdl() 就断了。
       现在按优先级找第一个可用容器，全都找不到就挂到卡片本身。 */
    function mountHouse(cell, house) {
        var langEl = cell.querySelector('[dir="auto"][lang]');
        var videoPlayer = cell.querySelector('[data-testid="videoPlayer"]');
        var targets = [];

        if (langEl && langEl.parentElement) targets.push(langEl.parentElement);

        if (videoPlayer) {
            var videoComponent = cell.querySelector('[data-testid="videoComponent"]');
            if (videoComponent) targets.push(videoComponent);
            if (videoPlayer.parentElement && videoPlayer.parentElement.parentElement) {
                targets.push(videoPlayer.parentElement.parentElement);
            }
            if (videoPlayer.parentElement) targets.push(videoPlayer.parentElement);
        }

        if (!videoPlayer && !langEl) {
            var labelled = cell.querySelector('div[aria-labelledby]');
            if (labelled && labelled.parentNode) {
                house.classList.add('houseab');
                labelled.parentNode.insertBefore(house, labelled.nextElementSibling);
                return;
            }
        }

        targets.push(cell);
        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            if (target && typeof target.appendChild === 'function') {
                target.appendChild(house);
                return;
            }
        }
    }

    function buildHouse(cell) {
        if (cell.querySelector('.house')) return;

        var house = document.createElement('div');
        house.className = 'house';

        var imgsdownloader = makeButton('twdl download_pics twdlimgs', t('photoOnly'), function () {
            dlpicsfromURL(get_imgsURL(cell), userName(cell), userName(cell, 'nickName'));
        });

        var snapvid = makeDownloaderLink(cell, snapvid_url(), 'twdl download_pics', t('vidEtc'));
        var twee = makeDownloaderLink(cell, tweeload_url(), 'twdl download_pics', t('vidEtc'));
        var help = makeDownloaderLink(cell,
            'https://greasyfork.org/zh-CN/scripts/478651', 'twdl twdlhidden', t('help'));

        var shareBtn = makeButton('twdl twdlshare', t('shareShape'), function () {
            openAsImage(cell);
        });

        var hideBtn = makeButton('twdl twdlhidden', t('hide'), function () {
            house.style.display = 'none';
        });

        var downBox = document.createElement('div');
        downBox.className = 'twdlContainerDown';
        [imgsdownloader, snapvid, twee].forEach(function (el) { downBox.appendChild(el); });

        var helpBox = document.createElement('div');
        helpBox.className = 'twdlContainerDown';
        [help, hideBtn].forEach(function (el) { helpBox.appendChild(el); });

        house.appendChild(downBox);
        house.appendChild(shareBtn);
        house.appendChild(helpBox);

        mountHouse(cell, house);
    }

    function twdl() {
        var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            if (!cell || cell.querySelector('.house')) continue;

            var hasVideo = !!cell.querySelector('[data-testid="videoPlayer"]');
            var hasText = !!cell.querySelector('[dir="auto"][lang]');
            var hasImg = cell.querySelectorAll("img[src*='name=']").length > 0;
            if (!hasVideo && !hasText && !hasImg) continue;

            /* [FIX] 原版没有 try/catch：任何一张卡片结构和猜测对不上，
               整个循环就被打断，后面的卡片永远拿不到按钮。现在单卡片隔离。 */
            try {
                buildHouse(cell);
            } catch (e) {
                console.warn('[twdl] 跳过异常卡片', e && e.message);
            }
        }
    }

    /* -----------------------------------------------------------------
     * 11. 调度
     * [FIX-PERF] 原版用 setInterval(1500ms)+setTimeout(2500ms) 一直轮询滚动条，
     *            每次滚动都全量重跑 twdl()，同时在 load 和 popstate 上再跑一遍。
     *            X 是 SPA，pushState 导航根本不触发 popstate。
     *            改成 MutationObserver + 导航钩子 + 防抖。
     * ----------------------------------------------------------------- */
    var twdlTimer = null;

    function scheduleTwdl(delay) {
        clearTimeout(twdlTimer);
        twdlTimer = setTimeout(function () {
            try {
                twdl();
            } catch (e) {
                console.warn('[twdl] twdl() 异常', e);
            }
        }, typeof delay === 'number' ? delay : 500);
    }

    function hookNavigation() {
        window.addEventListener('popstate', function () { scheduleTwdl(600); });
        ['pushState', 'replaceState'].forEach(function (name) {
            var original = history[name];
            if (typeof original !== 'function') return;
            try {
                history[name] = function () {
                    var result = original.apply(this, arguments);
                    scheduleTwdl(600);
                    return result;
                };
            } catch (e) {
                console.warn('[twdl] 无法拦截 history.' + name, e);
            }
        });
    }

    function startObserver() {
        if (typeof MutationObserver === 'undefined' || !document.body) return;
        var observer = new MutationObserver(function () {
            scheduleTwdl(500);
            scheduleZh(600);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /* -----------------------------------------------------------------
     * 12. 下载站页面：把 hash 里的推文链接填进去并点提交
     * ----------------------------------------------------------------- */
    var autofillDone = false;

    function getTwitterUrlFromHash() {
        var target = (window.location.hash || '').replace(/^#/, '');
        if (!target) return null;
        try {
            target = decodeURIComponent(target);
        } catch (e) { /* hash 不是合法编码，保持原样 */ }
        return TW_STATUS_URL_RE.test(target) ? target : null;
    }

    function fillAndClick(input, button, url, delay) {
        if (!input || !button) return false;
        if (input.value === url) return false;
        input.value = url;
        setTimeout(function () {
            /* [FIX] 原版这里拿 input.value 和 window.location.href 比较，
               永远不相等；而 twittervideodownloader 分支把 '#tweetURL' 写成了
               '#tweetUrl'，querySelector 返回 null 后 .value 直接抛 TypeError，
               所以那个下载站一次都没自动提交成功过。 */
            if (!input.value || !TW_STATUS_URL_RE.test(input.value)) return;
            button.click();
        }, typeof delay === 'number' ? delay : 500);
        return true;
    }

    function inDownloaderPage() {
        var url = getTwitterUrlFromHash();
        if (!url) {
            console.warn('[twdl] hash 中没有合法的推文链接');
            return false;
        }
        var href = window.location.href;

        if (/snapvid\.net/i.test(href)) {
            return fillAndClick(document.querySelector('#s_input'),
                document.querySelector('.btn-red'), url, 500);
        }
        if (/twittervid\.com/i.test(href)) {
            return fillAndClick(document.querySelector('#tweetUrl'),
                document.querySelector('#loadVideos'), url, 500);
        }
        if (/twittervideodownloader\.com/i.test(href)) {
            return fillAndClick(document.querySelector('#tweetURL'),
                document.querySelector('#submitBtn'), url, 500);
        }
        if (/twittervideomp4\.com/i.test(href)) {
            return fillAndClick(document.querySelector('#txt-url'),
                document.querySelector('button#btn-submit'), url, 800);
        }
        if (/tweeload\.com/i.test(href)) {
            var matched = url.match(STATUS_ID_RE);
            if (!matched) return false;
            window.location.href = tweeload_url() + '/i/status/' + matched[1];
            return true;
        }
        return false;
    }

    function onDownloaderPage() {
        return /twittervid\.com|twittervideodownloader\.com|tweeload\.com|snapvid\.net|twittervideomp4\.com/i
            .test(window.location.href);
    }

    /* 下载站通常把输入框/按钮异步渲染出来，重试若干次（≈10s）等它出现 */
    function tryAutofill(retries) {
        if (autofillDone || !onDownloaderPage()) return;
        var acted = false;
        try {
            acted = inDownloaderPage();
        } catch (e) {
            console.warn('[twdl] 自动填充异常', e);
        }
        if (acted) {
            autofillDone = true;
            return;
        }
        if (retries > 0) {
            setTimeout(function () { tryAutofill(retries - 1); }, 800);
        }
    }

    /* =================================================================
     * 13. 视图汉化（LLM 翻译）  v0.2.0-zh.1 新增
     *
     * 设计要点：
     * - 不替换 X 自己的文本节点：译文放在原文元素「后面」的独立块里，原文只加
     *   display:none。这样 React 重渲染时最多丢我们的样式，不会破坏推文数据；
     *   反过来，原版那种 replaceChild 会真的把 emoji 从页面上抹掉。
     * - 每条译文自带「原 / 译」按钮；右下角悬浮按钮做全局切换（全局切换会清掉
     *   单条覆盖，保证状态可预期）。
     * - 翻译走 OpenAI 兼容的 /chat/completions。Tampermonkey 里用
     *   GM_xmlhttpRequest（绕 CORS），没有 GM 时退化为 fetch。
     * - 结果按文本 hash 缓存到 GM 存储 / localStorage（默认上限 600 条）。
     * - 界面文案用内置词典（X 的 UI 词汇量有限，走 LLM 又贵又慢）。
     * ================================================================= */
    var ZH_LS_PREFIX = 'twdl.zh.';
    var ZH_MAX_CACHE = 600;
    var ZH_BATCH_ITEMS = 12;
    var ZH_BATCH_CHARS = 1800;
    var ZH_UI_LIST_MAX = 800;
    var ZH_MAX_TEXT = 2000;
    /* 每次扫描最多新增多少个翻译任务。长列表一次性排队会瞬间烧掉几十次请求，
       这里做成本上限；剩下的等滚动/下一次扫描再补。 */
    var ZH_QUEUE_MAX = 24;
    /* 图片内文字翻译（v0.2.1）：视觉接口按张计费，限制每轮扫描最多处理几张，
       太小的图（头像/图标/表情）直接跳过，视频封面也跳过。 */
    var ZH_IMG_MAX_PER_SCAN = 3;
    var ZH_IMG_MIN_SIDE = 240;
    var ZH_IMG_MIN_HEIGHT = 120;
    var ZH_NO_TEXT = 'NO_TEXT';
    var ZH_IMG_SKIP_RE = /(profile_images|emoji|amplify_video|tweet_video_thumb|ext_tw_video_thumb|semantic_core_img|default_profile)/i;

    /* X 界面常用英文 → 简体中文。只在「内容 + 界面」模式下生效。
       键一律小写比较；值为空则跳过。 */
    var ZH_UI_DICT = {
        'home': '首页',
        'explore': '探索',
        'notifications': '通知',
        'messages': '消息',
        'bookmarks': '书签',
        'jobs': '工作机会',
        'communities': '社区',
        'profile': '个人资料',
        'more': '更多',
        'post': '发帖',
        'posts': '帖子',
        'reply': '回复',
        'replies': '回复',
        'repost': '转帖',
        'like': '喜欢',
        'likes': '喜欢',
        'bookmark': '收藏',
        'share': '分享',
        'view': '查看',
        'views': '查看次数',
        'quote': '引用',
        'copy link': '复制链接',
        'show more': '显示更多',
        'show less': '收起',
        'see more': '查看更多',
        'follow': '关注',
        'unfollow': '取消关注',
        'following': '正在关注',
        'followers': '关注者',
        'for you': '为你推荐',
        'trends': '趋势',
        'trending': '趋势',
        "what's happening": '正在发生',
        'search': '搜索',
        'settings and privacy': '设置和隐私',
        'log out': '退出登录',
        'see new posts': '查看新帖子',
        'who to follow': '推荐关注',
        'translate post': '翻译帖子',
        'show translation': '显示翻译',
        'show original': '显示原文',
        'translate': '翻译',
        'back': '返回',
        'close': '关闭',
        'cancel': '取消',
        'save': '保存',
        'delete': '删除',
        'edit': '编辑',
        'send': '发送',
        'next': '下一步',
        'previous': '上一步',
        'done': '完成',
        'retry': '重试',
        'try again': '重试',
        'promoted': '推广',
        'verified': '已认证',
        'media': '媒体',
        'subscribe': '订阅',
        'subscribed': '已订阅',
        'sign up': '注册',
        'log in': '登录',
        'create account': '创建账号',
        'add a comment': '添加评论',
        'post your reply': '发布回复',
        'people': '用户',
        'lists': '列表',
        'topics': '话题',
        'mute': '静音',
        'unmute': '取消静音',
        'block': '屏蔽',
        'unblock': '取消屏蔽',
        'report': '举报',
        'pinned': '置顶',
        'edited': '已编辑',
        'not interested in this post': '对此帖子不感兴趣',
        'highlights': '亮点',
        'articles': '文章',
        'signed up': '已注册',
        'grok': 'Grok',
        'premium': 'Premium'
    };

    /* 安全声明：本脚本不包含任何 API Key / 密钥字符串。
       所有 Key 由用户在设置面板输入，仅保存在本机（Tampermonkey 存储 / localStorage），
       只会发送到用户自己填写的 API 地址；__twdl.zh.state() 对外返回的配置已脱敏。 */
    var ZH_DEFAULTS = {
        enabled: true,
        auto: true,
        mode: 'content',          // content | full
        showOriginal: false,
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: '',
        /* 图片内文字翻译（v0.2.1 新增）：off | button | auto */
        imgMode: 'auto',
        /* 视觉模型配置；留空则沿用上面的 baseUrl / model / apiKey */
        visionBaseUrl: '',
        visionModel: '',
        visionApiKey: ''
    };

    var ZH_CSS = [
        '#twdl-zh-root{position:fixed;right:16px;bottom:96px;z-index:2147483000;',
        'display:flex;gap:6px;align-items:center;font:12px/1.4 system-ui,sans-serif}',
        '#twdl-zh-root button{border:0;border-radius:999px;cursor:pointer;',
        'box-shadow:0 2px 10px rgba(0,0,0,.28);padding:9px 13px;font-weight:700;',
        'background:#1d9bf0;color:#fff;font-size:13px}',
        '#twdl-zh-root #twdl-zh-gear{background:#536471;padding:9px 11px}',
        '#twdl-zh-root button.twdl-zh-off{background:#8b98a5}',
        '#twdl-zh-panel{position:fixed;right:16px;bottom:148px;z-index:2147483001;',
        'width:330px;max-height:72vh;overflow:auto;background:#fff;color:#0f1419;',
        'border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:14px;',
        'font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;text-align:left}',
        '#twdl-zh-panel h3{margin:0 0 10px;font-size:14px}',
        '.twdl-zh-row{display:flex;flex-direction:column;gap:4px;margin:8px 0}',
        '.twdl-zh-row>label{color:#536471;font-size:12px}',
        '.twdl-zh-row input[type=text],.twdl-zh-row input[type=password],',
        '.twdl-zh-row select{border:1px solid #cfd9de;border-radius:8px;',
        'padding:6px 8px;font-size:13px;outline:none;background:#fff;color:#0f1419}',
        '.twdl-zh-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}',
        '.twdl-zh-actions button{border:0;border-radius:8px;padding:7px 10px;',
        'cursor:pointer;background:#1d9bf0;color:#fff;font-size:12px}',
        '.twdl-zh-actions button#twdl-zh-clearn,.twdl-zh-actions button#twdl-zh-retry,.twdl-zh-actions button#twdl-zh-diag{background:#536471}',
        '.twdl-zh-tip{color:#536471;font-size:11px;margin-top:8px;line-height:1.45}',
        '.twdl-zh-stat{margin-top:8px;font-size:11px;color:#0f1419;',
        'white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto}',
        '.twdl-zh-block{display:block;margin:0}',
        '.twdl-zh-text{font:inherit;color:inherit;white-space:pre-wrap;word-break:break-word}',
        '.twdl-zh-orig{display:inline-block;margin:4px 0 0;padding:1px 8px;',
        'border:1px solid #cfd9de;border-radius:999px;background:transparent;',
        'color:#536471;font-size:11px;line-height:1.5;cursor:pointer}',
        '.twdl-zh-orig:hover{background:#eff3f4;color:#0f1419}',
        /* ---- 图片内文字翻译（v0.2.1） ---- */
        '.twdl-zh-imgblock{display:block;margin:6px 0 0;padding:8px 10px;',
        'border:1px solid rgba(29,155,240,.45);border-radius:12px;',
        'background:rgba(29,155,240,.08);font:14px/1.55 inherit;',
        'white-space:pre-wrap;word-break:break-word;color:inherit;text-align:left;',
        'max-height:340px;overflow:auto}',
        '.twdl-zh-imgblock .twdl-zh-imgtext{font:inherit;color:inherit}',
        '.twdl-zh-imgblock[data-show-orig="1"] .twdl-zh-imgtext{display:none}',
        '.twdl-zh-imgblock[data-state="pending"]{color:#536471;font-style:italic;border-style:dashed}',
        '.twdl-zh-imgblock[data-state="error"]{border-color:rgba(224,36,94,.55);',
        'background:rgba(224,36,94,.08)}',
        'body.twdl-zh-orig .twdl-zh-imgblock{display:none!important}',
        '.twdl-zh-imgbtn{display:inline-block;margin:4px 0 0;padding:2px 10px;',
        'border:1px dashed #1d9bf0;border-radius:999px;background:transparent;',
        'color:#1d9bf0;font-size:12px;line-height:1.6;cursor:pointer}',
        '.twdl-zh-imgbtn:hover{background:rgba(29,155,240,.12)}',
        /* 媒体内浮层：X 的媒体容器是绝对定位/overflow:hidden，插在容器外面的块会被裁掉，
           所以译文直接浮在图片/视频封面底部，保证一定可见 */
        '.twdl-zh-imgblock[data-overlay="1"]{position:absolute;left:8px;right:8px;bottom:8px;z-index:6;',
        'max-height:58%;overflow:auto;background:rgba(0,0,0,.82);color:#fff;',
        'border:1px solid rgba(255,255,255,.28);border-radius:10px;padding:8px 10px;margin:0;',
        'font-size:14px;line-height:1.5;text-shadow:0 1px 2px rgba(0,0,0,.6)}',
        '.twdl-zh-imgblock[data-overlay="1"] .twdl-zh-imgtext{color:#fff}',
        '.twdl-zh-imgblock[data-overlay="1"] .twdl-zh-orig{background:rgba(255,255,255,.2);color:#fff}',
        '.twdl-zh-imgbtn[data-overlay="1"]{position:absolute;right:8px;top:8px;z-index:6;margin:0;',
        'background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.5);color:#fff}',
        '.twdl-zh-imgretry{display:inline-block;margin:6px 0 0;padding:2px 10px;',
        'border:1px solid #e0245e;border-radius:999px;background:transparent;',
        'color:#e0245e;font-size:12px;line-height:1.6;cursor:pointer}',
        '.twdl-zh-imgretry:hover{background:rgba(224,36,94,.12)}'
    ].join('');

    var ZH_SYSTEM_PROMPT = [
        '你是专业的社交媒体翻译引擎，目标语言：简体中文。',
        '规则：',
        '1) 忠实还原语气与语义，不添加解释、不省略信息；',
        '2) 保留 @用户名、#话题、URL、emoji、数字、代码原样；',
        '3) 输入是一个 JSON 字符串数组，输出必须是一个 JSON 数组，长度和顺序与输入完全一致，元素为对应译文；',
        '4) 只输出 JSON 数组本身，不要 markdown 代码块，不要任何额外文字。'
    ].join('\n');

    var ZH_IMG_PROMPT = [
        '你是图片文字识别与翻译引擎，目标语言：简体中文。',
        '任务：识别图片中所有可读文字（截图里的帖子正文、标题、表格、图表标注等都算），翻译成简体中文。',
        '规则：',
        '1) 按阅读顺序输出纯文本，保留原有段落换行，不要加任何解释；',
        '2) 不要臆造图片里没有的内容；数字、URL、@用户名、emoji 原样保留；',
        '3) 如果图片中没有可读文字（纯照片/表情包/图标），只输出：' + ZH_NO_TEXT
    ].join('\n');

    var zhCfg = null;
    var zhCache = null;
    var zhQueue = [];
    var zhInFlight = false;
    var zhTimer = null;
    var zhUiRecords = [];
    var zhUiLastRun = 0;
    var zhStats = {
        applied: 0, failed: 0, requests: 0, lastError: '', lastRequestAt: 0,
        imgApplied: 0, imgFailed: 0, imgRequests: 0, imgNoText: 0,
        lastAttemptUrl: '', retries: 0
    };
    var zhImgQueue = [];
    var zhImgInFlight = false;

    /* ---------- 13.1 存储 ---------- */
    function zhStoreGet(key, fallback) {
        try {
            if (typeof GM_getValue === 'function') {
                var value = GM_getValue(key);
                return (value === undefined || value === null) ? fallback : value;
            }
        } catch (e) { /* 忽略，走 localStorage */ }
        try {
            var raw = window.localStorage.getItem(ZH_LS_PREFIX + key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function zhStoreSet(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
                return;
            }
        } catch (e) { /* 忽略，走 localStorage */ }
        try {
            window.localStorage.setItem(ZH_LS_PREFIX + key, JSON.stringify(value));
        } catch (e) { /* 隐私模式/配额满，忽略 */ }
    }

    function zhLoadCfg() {
        var saved = zhStoreGet('cfg', null);
        var cfg = {};
        Object.keys(ZH_DEFAULTS).forEach(function (key) { cfg[key] = ZH_DEFAULTS[key]; });
        if (saved && typeof saved === 'object') {
            Object.keys(ZH_DEFAULTS).forEach(function (key) {
                if (saved[key] !== undefined && saved[key] !== null) cfg[key] = saved[key];
            });
        }
        return cfg;
    }

    function zhSaveCfg() {
        if (zhCfg) zhStoreSet('cfg', zhCfg);
    }

    function zhLoadCache() {
        var cache = zhStoreGet('cache', null);
        return (cache && typeof cache === 'object') ? cache : {};
    }

    function zhSaveCache() {
        if (zhCache) zhStoreSet('cache', zhCache);
    }

    function zhHash(text) {
        var hash = 2166136261;
        for (var i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36) + '_' + text.length;
    }

    function zhCacheGet(text) {
        if (!zhCache) return '';
        var hit = zhCache[zhHash(text)];
        return (typeof hit === 'string') ? hit : '';
    }

    function zhCacheSet(text, zh) {
        if (!zhCache) zhCache = {};
        /* 已经以同一个 hash 缓存了原文，meta 里存一份原文方便清理/排查，
           但那是双倍存储，这里只存译文，靠 hash 命中。 */
        zhCache[zhHash(text)] = zh;
        var keys = Object.keys(zhCache);
        if (keys.length > ZH_MAX_CACHE) {
            for (var i = 0; i < keys.length - ZH_MAX_CACHE; i++) delete zhCache[keys[i]];
        }
        zhSaveCache();
    }

    /* ---------- 13.2 文案 / 状态 ---------- */
    function zhUpdatePill() {
        var toggle = document.getElementById('twdl-zh-toggle');
        if (toggle) {
            var hasKey = !!(zhCfg && zhCfg.apiKey);
            toggle.textContent = (zhCfg && zhCfg.showOriginal) ? '原' : '译';
            toggle.classList.toggle('twdl-zh-off', !zhCfg || !zhCfg.enabled || !hasKey);
            var tip = '汉化：';
            if (!zhCfg) tip += '未初始化';
            else if (!zhCfg.enabled) tip += '已关闭（点击设置）';
            else if (!hasKey) tip += '未配置 API Key（点击设置）';
            else tip += '已开启';
            tip += '\n点击切换：显示原文 / 显示译文';
            toggle.title = tip;
        }
        var stat = document.getElementById('twdl-zh-stat');
        if (stat) {
            var cacheSize = zhCache ? Object.keys(zhCache).length : 0;
            var lines = [];
            lines.push('状态：' + (!zhCfg ? '-' :
                (!zhCfg.enabled ? '已关闭' : (zhCfg.apiKey ? '运行中' : '待配置 Key'))) +
                '｜范围：' + ((zhCfg && zhCfg.mode === 'full') ? '内容 + 界面' : '仅内容'));
            lines.push('已译 ' + zhStats.applied + ' 段｜失败 ' + zhStats.failed +
                ' 段｜请求 ' + zhStats.requests + ' 次｜缓存 ' + cacheSize + ' 条');
            if (zhCfg && (zhCfg.imgMode || 'auto') !== 'off') {
                lines.push('图片/视频封面：已译 ' + zhStats.imgApplied + ' 张｜无文字 ' + zhStats.imgNoText +
                    ' 张｜失败 ' + zhStats.imgFailed + ' 张｜请求 ' + zhStats.imgRequests + ' 次');
            }
            if (zhQueue.length) lines.push('队列中：' + zhQueue.length + ' 段');
            if (zhImgQueue.length) lines.push('图片队列：' + zhImgQueue.length + ' 张');
            if (zhInFlight || zhImgInFlight) lines.push('请求进行中…');
            if (zhStats.retries) lines.push('限流/故障退避重试：' + zhStats.retries + ' 次');
            if (zhRate.minInterval > ZH_BASE_INTERVAL) lines.push('自适应降速：请求间隔 ' + zhRate.minInterval + 'ms');
            if (zhCfg) {
                var textWarn = zhApiAddressWarning(zhCfg.baseUrl);
                if (textWarn) lines.push('⚠ 文字接口：' + textWarn);
                var textModelWarn = zhModelWarning(zhCfg.model);
                if (textModelWarn) lines.push('⚠ 文字模型：' + textModelWarn);
                if (zhCfg.visionBaseUrl) {
                    var visionWarn = zhApiAddressWarning(zhCfg.visionBaseUrl);
                    if (visionWarn) lines.push('⚠ 视觉接口：' + visionWarn);
                }
                var visionModelWarn = zhModelWarning(zhCfg.visionModel);
                if (visionModelWarn) lines.push('⚠ 视觉模型：' + visionModelWarn);
            }
            var selfCheck = zhSelfCheckCached();
            if (selfCheck.length && selfCheck[0] !== '未发现明显问题') {
                lines.push('自检：' + selfCheck[0] + (selfCheck.length > 1 ? '（共 ' + selfCheck.length + ' 项，点「诊断」看详情）' : ''));
            }
            if (zhStats.lastAttemptUrl) lines.push('上次请求：' + zhStats.lastAttemptUrl);
            if (zhStats.lastError) lines.push('最近错误：' + zhStats.lastError);
            stat.textContent = lines.join('\n');
        }
    }

    /* ---------- 13.3 传输（GM_xmlhttpRequest / fetch） ---------- */

    /* API 基地址归一化：去掉尾部斜杠、误粘贴进来的 /chat/completions，并补协议。
       很多人会把「完整接口地址」或「网站首页」粘进设置，这里统一纠正。 */
    function zhNormalizeBaseUrl(raw) {
        var url = String(raw == null ? '' : raw).trim();
        if (!url) return '';
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
        url = url.replace(/\/+$/, '');
        url = url.replace(/\/chat\/completions$/i, '');
        url = url.replace(/\/+$/, '');
        return url;
    }

    /* 一眼识别「这不是 API 地址」的常见错误（控制台/登录页、缺 /v1）。
       返回可读提示；没问题返回空串。用于面板状态与保存后提醒。 */
    function zhApiAddressWarning(raw) {
        var url = String(raw == null ? '' : raw).trim().toLowerCase();
        if (!url) return '';
        if (/(^|[/.])(console|platform|dashboard|account|login|signin|signup)([/.]|$)/.test(url)) {
            return '这个地址是服务商的控制台/登录页，不是 API 地址。Kimi 填 https://api.moonshot.cn/v1 ，DeepSeek 填 https://api.deepseek.com/v1 ，其它家填「OpenAI 兼容 base url」。';
        }
        if (!/\/v\d+$/.test(url.replace(/\/+$/, ''))) {
            return '地址没有以 /v1 结尾。多数 OpenAI 兼容服务需要 /v1；脚本会自动再试一次，建议直接补上。';
        }
        return '';
    }

    /* 模型名体检：把「品牌名当模型 ID」这类常见错误提前指出来（如 kimi / deepseek / gpt） */
    function zhModelWarning(model) {
        var m = String(model == null ? '' : model).trim().toLowerCase();
        if (!m) return '';
        if (/^(kimi|moonshot|deepseek|gpt|chatgpt|claude|gemini|qwen|glm|doubao|ernie|mistral)$/.test(m)) {
            return '"' + model + '" 看起来是品牌名，不是模型 ID。请填控制台模型列表里的完整 ID（Kimi 多模态填 kimi-k3（原生支持图片；「视觉模型」留空即沿用文字模型）。';
        }
        return '';
    }

    /* 候选接口地址：正常情况 1 个；base 里没写 /vN 时再补一个 /v1 候选，
       遇到 404/HTML 时自动换一个再试（能救「少了 /v1」这类最常见配置错误）。 */
    function zhChatUrlCandidates(base) {
        var normalized = zhNormalizeBaseUrl(base);
        if (!normalized) return [];
        var list = [normalized + '/chat/completions'];
        if (!/\/v\d+$/i.test(normalized)) list.push(normalized + '/v1/chat/completions');
        var unique = [];
        list.forEach(function (url) {
            if (unique.indexOf(url) === -1) unique.push(url);
        });
        return unique;
    }

    function zhTextPreview(text, limit) {
        var s = String(text == null ? '' : text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (s.length > limit) s = s.slice(0, limit) + '…';
        return s;
    }

    function zhLooksLikeHtml(text) {
        var s = String(text == null ? '' : text).trim();
        return /^<!doctype/i.test(s) || /^<html/i.test(s) || /<html[\s>]/i.test(s.slice(0, 400));
    }

    /* 从服务商 JSON 错误体里认出「模型不存在/无权限」这类错误（各家措辞不同，多语言都兜） */
    function zhIsModelError(body) {
        var s = String(body || '');
        if (s.indexOf('"error"') === -1) return false;
        return /model|模型|resource_not_found|not found|no such|permission|权限|无权/i.test(s);
    }

    /* ---------- 13.2.5 限速 / 退避重试（按 Kimi 官方错误码文档）---------- */

    /* Kimi 按「累计充值金额」分账户等级限速（并发/RPM/TPM/TPD）；这里统一做节流与退避：
       - 两次请求之间至少隔 ZH_MIN_INTERVAL，避免一批翻译/图片瞬间打满 RPM；
       - 429（engine_overloaded / rate_limit_reached）与 500/503/504 自动退避重试；
       - exceeded_current_quota（余额不足/欠费）不重试（重试也没用）；
       - 官方明确：因 429 中断的请求不会扣费。 */
    var ZH_BASE_INTERVAL = 700;      /* 正常情况下的请求间隔 */
    var ZH_MIN_INTERVAL = 700;       /* 当前生效的请求间隔（被 429 触发后自适应变大） */
    var ZH_RETRY_MAX = 3;            /* 429/5xx 自动退避重试次数 */
    var ZH_RETRY_BASE = 2000;        /* 指数退避基数 ms（无 Retry-After 时） */
    var ZH_IMG_MAX_SIDE = 1600;      /* 图片长边上限：Kimi 视觉按 token 计费，太大容易撞 TPM */
    var ZH_IMG_QUALITY = 0.9;
    var zhAdaptive = true;           /* 自适应降速开关（测试里可关掉） */
    var zhLastCallAt = 0;
    var zhRate = { minInterval: ZH_BASE_INTERVAL, cooldownUntil: 0, okStreak: 0 };

    function zhSleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, ms)); });
    }

    /* 撞到 429 后自动降速：间隔至少翻倍 / 按 Retry-After，并记一段冷却时间 */
    function zhNoteRateLimit(retryAfterMs) {
        if (!zhAdaptive) return;
        var next = Math.max(2000, retryAfterMs || 0, zhRate.minInterval * 2);
        zhRate.minInterval = Math.min(20000, next);
        zhRate.cooldownUntil = Date.now() + (retryAfterMs || zhRate.minInterval);
        zhRate.okStreak = 0;
        zhStats.rateInterval = zhRate.minInterval;
        zhLog('rate.limit', { interval: zhRate.minInterval, retryAfterMs: retryAfterMs || 0 });
    }

    /* 连续成功若干次后逐步恢复速度 */
    function zhNoteSuccess() {
        if (!zhAdaptive) return;
        zhRate.okStreak += 1;
        if (zhRate.okStreak >= 5) {
            zhRate.okStreak = 0;
            zhRate.minInterval = Math.max(ZH_BASE_INTERVAL, Math.round(zhRate.minInterval * 0.7));
            zhStats.rateInterval = zhRate.minInterval;
        }
    }

    function zhPace() {
        var now = Date.now();
        var wait = Math.max((zhLastCallAt + zhRate.minInterval) - now, zhRate.cooldownUntil - now);
        if (wait > 0) return zhSleep(wait);
        return Promise.resolve();
    }

    /* 图片降分辨率：长边超过 maxSide 就用 canvas 缩一下再发，
       既省视觉 token（TPM）也降低 body 大小；任何失败都退回原图 */
    function zhDownscaleDataUrl(dataUrl, maxSide) {
        return new Promise(function (resolve) {
            if (!maxSide || typeof Image !== 'function' || typeof document === 'undefined') {
                resolve(dataUrl);
                return;
            }
            var done = false;
            var finish = function (out) { if (done) return; done = true; resolve(out || dataUrl); };
            try {
                var img = new Image();
                img.onload = function () {
                    try {
                        var w = img.naturalWidth || img.width;
                        var h = img.naturalHeight || img.height;
                        var side = Math.max(w, h);
                        if (!side || side <= maxSide) { finish(dataUrl); return; }
                        var scale = maxSide / side;
                        var canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(w * scale));
                        canvas.height = Math.max(1, Math.round(h * scale));
                        var ctx = canvas.getContext('2d');
                        if (!ctx) { finish(dataUrl); return; }
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        finish(canvas.toDataURL('image/jpeg', ZH_IMG_QUALITY));
                    } catch (e) { finish(dataUrl); }
                };
                img.onerror = function () { finish(dataUrl); };
                setTimeout(function () { finish(dataUrl); }, 1200);
                img.src = dataUrl;
            } catch (e) { finish(dataUrl); }
        });
    }

    function zhParseApiErrorBody(body) {
        var out = { type: '', message: '', quota: false, overloaded: false, rateLimited: false };
        try {
            var data = JSON.parse(String(body || ''));
            if (data && data.error) {
                out.type = String(data.error.type || '');
                out.message = String(data.error.message || '');
            }
        } catch (e) { /* 非 JSON，忽略 */ }
        var s = (out.type + ' ' + out.message).toLowerCase();
        out.overloaded = /engine_overloaded/.test(s);
        out.rateLimited = /rate_limit_reached|rate limit reached|reached rpm|reached tpm/.test(s);
        out.quota = /exceeded_current_quota|insufficient|arrears|余额不足|欠费/.test(s) && !out.overloaded;
        return out;
    }

    function zhHeaderValue(headers, name) {
        if (!headers) return '';
        try {
            if (typeof headers.get === 'function') return String(headers.get(name) || '');
        } catch (e) { /* ignore */ }
        var match = new RegExp('(?:^|[\\r\\n])' + name + ':\\s*([^\\r\\n]+)', 'i').exec(String(headers));
        return match ? match[1].trim() : '';
    }

    function zhRetryAfterMs(headers) {
        var raw = zhHeaderValue(headers, 'retry-after');
        var sec = parseFloat(raw);
        if (!isNaN(sec) && sec >= 0) return Math.min(sec * 1000, 60000);
        return 0;
    }

    /* 把 HTTP 错误翻译成"照着改就能好"的提示；不再把整段 HTML 塞进推文。 */
    function zhHttpError(status, bodyText, url, headers) {
        var body = String(bodyText || '');
        var html = zhLooksLikeHtml(body);
        var apiErr = html ? null : zhParseApiErrorBody(body);
        var modelErr = !html && (status === 400 || status === 404 || status === 422) && zhIsModelError(body);
        var retryAfterMs = zhRetryAfterMs(headers);
        var typeTag = (apiErr && apiErr.type) ? ('type=' + apiErr.type + '，') : '';
        var hint;
        if (html) {
            hint = '接口地址返回了网页而不是 API（HTTP ' + status + '）。请检查「API 地址」是否粘成了完整接口 / 网站首页 / 代理页面，应只填 base url（例：https://api.deepseek.com/v1）。';
        } else if (modelErr) {
            hint = '模型不存在或无权限（HTTP ' + status + '）：检查「模型 / 视觉模型」是否填了服务商的真实模型 ID（不是品牌名；Kimi 视觉模型填 kimi-k3 或 kimi-k3.1-pro，以控制台模型列表为准），并确认该 Key 有该模型权限。';
        } else if (status === 401 || status === 403) {
            hint = 'API Key 被拒绝（HTTP ' + status + '）：Key 错误、过期或无权限（注意 platform.kimi.com 与 platform.kimi.ai 的 Key 不通用）。';
        } else if (status === 404) {
            hint = '接口路径不存在（HTTP 404）：检查 base url 是否少了 /v1，或服务商不支持该路径。';
        } else if (status === 400) {
            hint = '请求被拒绝（HTTP 400）：模型名可能不对，或该模型不支持图片输入（图片翻译必须填支持视觉的模型）。';
        } else if (status === 413) {
            hint = '图片太大被拒（HTTP 413）：换小图或改用支持大图的模型。';
        } else if (status === 429) {
            if (apiErr && apiErr.quota) {
                hint = '账户余额不足 / 欠费（HTTP 429，' + typeTag + 'exceeded_current_quota_error）：到控制台充值或调用 GET https://api.moonshot.cn/v1/users/me/balance 查余额；代金券不计入累计充值、也不能用于全部模型。';
            } else if (apiErr && apiErr.overloaded) {
                hint = '服务节点过载（HTTP 429，' + typeTag + 'engine_overloaded_error）：按 Retry-After 退避重试（脚本已自动重试）；这是服务端容量问题，充值/升级等级不能消除。';
            } else if (apiErr && apiErr.rateLimited) {
                hint = '触发组织级限速（HTTP 429，' + typeTag + 'rate_limit_reached_error）：并发/RPM/TPM/TPD 被限，脚本已自动退避重试；仍频繁就降低频率或充值提升账户等级。';
            } else {
                hint = '触发限流（HTTP 429' + (apiErr && apiErr.type ? '，' + typeTag.replace(/，$/, '') : '') + '）：脚本已自动退避重试；仍失败请降低频率或充值提升账户等级。';
            }
        } else if (status >= 500) {
            hint = '服务商暂时故障（HTTP ' + status + '）：官方建议稍后重试；脚本已自动退避重试，长请求也可考虑流式输出。';
        } else {
            hint = '请求失败（HTTP ' + status + '）。';
        }
        var preview = zhTextPreview(body, 100);
        var err = new Error(hint + (preview && !html ? ' 返回：' + preview : ''));
        err.status = status;
        err.isHtml = html;
        err.isModelError = modelErr;
        err.retryAfterMs = retryAfterMs;
        err.apiErrorType = apiErr ? apiErr.type : '';
        err.isQuota = !!(apiErr && apiErr.quota);
        /* 可自动重试：429 里除「余额不足」以外的原因（过载/限速/未知），以及 500/503/504 */
        if (!html && !modelErr) {
            if (status === 429) err.retryable = !(apiErr && apiErr.quota);
            else err.retryable = (status === 500 || status === 503 || status === 504);
        }
        err.url = url || '';
        err.detail = preview;
        return err;
    }

    function zhPostJson(url, headers, body, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var timeout = timeoutMs || 45000;
            var legacy = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest : null;
            var modern = null;
            try {
                if (!legacy && typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') {
                    modern = GM.xmlHttpRequest;
                }
            } catch (e) { /* ignore */ }

            if (legacy) {
                legacy({
                    method: 'POST',
                    url: url,
                    headers: headers,
                    data: body,
                    timeout: timeout,
                    onload: function (resp) {
                        if (resp.status >= 200 && resp.status < 300) resolve(resp.responseText || '');
                        else reject(zhHttpError(resp.status, resp.responseText, url, resp.responseHeaders));
                    },
                    onerror: function () { reject(new Error('网络请求失败（检查 API 地址 / 代理 / 系统时间）')); },
                    ontimeout: function () { reject(new Error('请求超时')); },
                    onabort: function () { reject(new Error('请求被中断')); }
                });
                return;
            }

            if (modern) {
                var maybe = modern({ method: 'POST', url: url, headers: headers, data: body, timeout: timeout });
                if (maybe && typeof maybe.then === 'function') {
                    maybe.then(function (resp) {
                        if (resp.status >= 200 && resp.status < 300) resolve(resp.responseText || '');
                        else reject(zhHttpError(resp.status, resp.responseText, url, resp.responseHeaders));
                    }).catch(function () { reject(new Error('网络请求失败（GM.xmlHttpRequest）')); });
                    return;
                }
            }

            if (typeof fetch !== 'function') {
                reject(new Error('当前环境既没有 GM_xmlhttpRequest 也没有 fetch'));
                return;
            }
            var controller = (typeof AbortController === 'function') ? new AbortController() : null;
            var timer = null;
            if (controller) {
                timer = setTimeout(function () { controller.abort(); }, timeout);
            }
            fetch(url, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: controller ? controller.signal : undefined
            }).then(function (resp) {
                if (timer) clearTimeout(timer);
                return resp.text().then(function (text) {
                    if (!resp.ok) throw zhHttpError(resp.status, text, url, resp.headers);
                    return text;
                });
            }).then(resolve).catch(function (err) {
                if (timer) clearTimeout(timer);
                if (err && err.name === 'AbortError') {
                    var timeoutErr = new Error('请求超时（fetch）');
                    timeoutErr.code = 'timeout';
                    reject(timeoutErr);
                } else {
                    /* 保留原始错误对象：zhCallChat 要靠 err.status / err.isHtml 决定是否换候选重试 */
                    reject((err && err.message) ? err : new Error(String(err)));
                }
            });
        });
    }

    /* ---------- 13.4 解析 ---------- */
    function zhParseArray(content) {
        if (!content) return null;
        var text = String(content).trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/i, '');
        var start = text.indexOf('[');
        var end = text.lastIndexOf(']');
        if (start !== -1 && end > start) {
            try {
                var arr = JSON.parse(text.slice(start, end + 1));
                if (Array.isArray(arr)) return arr;
            } catch (e) { /* 继续尝试逐行兜底 */ }
        }
        var lines = text.split(/\r?\n/).map(function (line) {
            return line.replace(/^\s*\d+[.、)]\s*/, '')
                .replace(/^["'“]/, '')
                .replace(/["'”]$/, '')
                .trim();
        }).filter(function (line) { return line !== ''; });
        return lines.length ? lines : null;
    }

    /* 统一解析 OpenAI 兼容的 chat 响应 */
    function zhParseChatResponse(respText) {
        var data = null;
        try {
            data = JSON.parse(respText);
        } catch (e) {
            if (zhLooksLikeHtml(respText)) {
                var htmlErr = zhHttpError(200, respText, '');
                htmlErr.message = '接口返回了网页而不是 JSON：' + htmlErr.message;
                throw htmlErr;
            }
            throw new Error('接口返回不是 JSON：' + zhTextPreview(respText, 90));
        }
        if (data && data.error) {
            throw new Error('接口错误：' + zhTextPreview(data.error.message || JSON.stringify(data.error), 120));
        }
        var content = data && data.choices && data.choices[0] &&
            data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('接口返回缺少 choices[0].message.content（模型可能不支持该接口格式）');
        return String(content);
    }

    /* 依次尝试候选接口地址；地址类错误（404/返回网页）换候选重试，
       429（过载/限速）与 5xx 按官方建议退避重试同一地址；
       401/400/quota（余额不足）等不重试，避免浪费请求和额度。 */
    /* 全局串行门：文字翻译与图片/视频封面共用同一条请求链。
       真实测试发现低等级 Kimi 账户「组织并发」可能 = 1，文字与图片同时发请求会直接 429，
       所以所有 chat 请求必须严格串行。 */
    var zhRequestChain = Promise.resolve();
    function zhWithGate(run) {
        var result = zhRequestChain.then(run, run);
        zhRequestChain = result.then(function () { return null; }, function () { return null; });
        zhLog('gate.wait', {});
        return result;
    }

    function zhCallChat(cfg, body, timeoutMs) {
        var candidates = zhChatUrlCandidates((cfg && cfg.baseUrl) || ZH_DEFAULTS.baseUrl);
        if (!candidates.length) return Promise.reject(new Error('API 地址为空，请在设置里填写 base url'));
        var headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + ((cfg && cfg.apiKey) || '')
        };
        var attempt = function (index, lastErr, retries) {
            if (index >= candidates.length) {
                var finalErr = lastErr || new Error('请求失败');
                finalErr.message = finalErr.message + '（已尝试：' + candidates.join('、') + '）';
                throw finalErr;
            }
            var url = candidates[index];
            return zhWithGate(function () {
                return zhPace().then(function () {
                    zhLastCallAt = Date.now();
                    zhStats.requests += 1;
                    zhStats.lastRequestAt = Date.now();
                    zhStats.lastAttemptUrl = url;
                    zhLog('api.request', { url: url, retry: retries });
                    zhUpdatePill();
                    return zhPostJson(url, headers, body, timeoutMs || 45000);
                });
            }).then(function (respText) {
                /* 有些网关会用 200 返回一张 HTML 页面（登录页/首页/错误页），也当地址问题重试 */
                if (zhLooksLikeHtml(respText) && index + 1 < candidates.length) {
                    return attempt(index + 1, zhHttpError(200, respText, url), retries);
                }
                zhLog('api.ok', { url: url });
                zhNoteSuccess();
                return respText;
            }).catch(function (err) {
                if (!err) throw err;
                /* 1) 429 过载/限速、500/503/504：同一地址指数退避重试（优先用 Retry-After） */
                if (err.retryable && retries < ZH_RETRY_MAX) {
                    if (err.status === 429) zhNoteRateLimit(err.retryAfterMs);
                    var waitMs = err.retryAfterMs > 0
                        ? err.retryAfterMs
                        : Math.max(ZH_RETRY_BASE * Math.pow(2, retries), err.status === 429 ? zhRate.minInterval : 0);
                    zhLog('api.retry', { status: err.status || 0, type: err.apiErrorType || '', waitMs: waitMs, retries: retries + 1 });
                    zhStats.retries = (zhStats.retries || 0) + 1;
                    zhUpdatePill();
                    return zhSleep(waitMs).then(function () { return attempt(index, err, retries + 1); });
                }
                /* 2) 地址类错误：换下一个候选地址 */
                var retryableAddressError = err.isHtml || (err.status === 404 && !err.isModelError && !err.isQuota);
                zhLog('api.error', { status: err.status || 0, type: err.apiErrorType || '', msg: String(err.message || '').slice(0, 160) });
                if (retryableAddressError && index + 1 < candidates.length) return attempt(index + 1, err, retries);
                throw err;
            });
        };
        return attempt(0, null, 0);
    }

    /* Kimi K3 系列判定。官方文档（kimi-k3-quickstart / use-kimi-vision-model）要求：
       - temperature / top_p / n 各模型取值约束不同，不要手动设置；
       - K3 始终开启思考，用顶层 reasoning_effort（low/high/max）控制强度；
       - 视觉模型与文字模型相同（kimi-k3 原生支持图片），视觉消息 content 用对象数组。 */
    function zhIsKimiK3(model) {
        return /^kimi-k3/i.test(String(model || ''));
    }

    function zhBuildChatPayload(model, messages) {
        var payload = { model: model, messages: messages };
        if (zhIsKimiK3(model)) payload.reasoning_effort = 'low';   /* 翻译用 low：更快更省 */
        else payload.temperature = 0.2;                            /* 其它 OpenAI 兼容服务保持低温 */
        return payload;
    }

    function zhRequest(cfg, texts) {
        var model = (cfg && cfg.model) || ZH_DEFAULTS.model;
        var body = JSON.stringify(zhBuildChatPayload(model, [
            { role: 'system', content: ZH_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(texts) }
        ]));
        zhLog('text.batch', { count: texts.length, chars: texts.join('').length });
        return zhCallChat(cfg, body, 45000).then(function (respText) {
            var content = zhParseChatResponse(respText);
            var arr = zhParseArray(content);
            if (!arr) throw new Error('无法解析翻译结果');
            return texts.map(function (_, index) {
                var value = arr[index];
                return (typeof value === 'string' && value.trim()) ? value.trim() : '';
            });
        });
    }

    /* ---------- 13.5 译文块渲染 ---------- */
    function zhWrapperOf(el) {
        if (!el) return null;
        var next = el.nextElementSibling;
        if (next && next.classList && next.classList.contains('twdl-zh-block')) return next;
        return null;
    }

    function zhBlockShowOriginal(wrapper) {
        var override = wrapper.getAttribute('data-show-orig');
        if (override === '1') return true;
        if (override === '0') return false;
        return !!(zhCfg && zhCfg.showOriginal);
    }

    function zhRefreshBlock(wrapper) {
        if (!wrapper || !wrapper.parentNode) return;
        var showOrig = zhBlockShowOriginal(wrapper);
        var src = wrapper.previousElementSibling;
        var isSrc = src && src.getAttribute && src.getAttribute('data-twdl-zh') === '1';
        wrapper.style.display = showOrig ? 'none' : '';
        if (isSrc) src.style.display = showOrig ? '' : 'none';
        var btn = wrapper.querySelector('.twdl-zh-orig');
        if (btn) {
            btn.textContent = showOrig ? '译' : '原';
            btn.title = showOrig ? '显示译文' : '显示原文';
        }
    }

    function zhApplyTranslation(el, srcText, zhText, fromCache) {
        if (!el || !el.parentNode) return;
        var wrapper = zhWrapperOf(el);
        if (wrapper) {
            var existing = wrapper.querySelector('.twdl-zh-text');
            if (existing) existing.textContent = zhText;
            wrapper.setAttribute('data-twdl-src', srcText);
            wrapper.setAttribute('data-twdl-cache', fromCache ? '1' : '0');
            zhRefreshBlock(wrapper);
            return;
        }

        wrapper = document.createElement('div');
        wrapper.className = 'twdl-zh-block';
        wrapper.setAttribute('data-twdl-src', srcText);
        wrapper.setAttribute('data-twdl-cache', fromCache ? '1' : '0');

        var textEl = document.createElement('div');
        textEl.className = 'twdl-zh-text';
        textEl.textContent = zhText;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'twdl-zh-orig';
        btn.textContent = '原';
        btn.title = '显示原文';
        btn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            var current = zhBlockShowOriginal(wrapper);
            wrapper.setAttribute('data-show-orig', current ? '0' : '1');
            zhRefreshBlock(wrapper);
        });

        wrapper.appendChild(textEl);
        wrapper.appendChild(btn);
        el.parentNode.insertBefore(wrapper, el.nextSibling);
        el.setAttribute('data-twdl-zh', '1');
        zhRefreshBlock(wrapper);

        zhStats.applied += 1;
        zhUpdatePill();
    }

    function zhRemoveTranslation(el) {
        var wrapper = zhWrapperOf(el);
        if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        if (el) {
            el.removeAttribute('data-twdl-zh');
            el.style.display = '';
        }
    }

    function zhSetShowOriginal(show) {
        if (!zhCfg) zhCfg = zhLoadCfg();
        zhCfg.showOriginal = !!show;
        zhSaveCfg();
        if (document.body) document.body.classList.toggle('twdl-zh-orig', zhCfg.showOriginal);
        var blocks = document.querySelectorAll('.twdl-zh-block');
        for (var i = 0; i < blocks.length; i++) {
            /* 全局切换清掉单条覆盖：否则用户会看到"我切了原文，但某几条还是译文" */
            blocks[i].removeAttribute('data-show-orig');
            zhRefreshBlock(blocks[i]);
        }
        /* 图片译文块：全局隐藏靠 CSS，但单条「原/译」覆盖也一并清掉更可预期 */
        var imgBlocks = document.querySelectorAll('.twdl-zh-imgblock');
        for (var k = 0; k < imgBlocks.length; k++) {
            imgBlocks[k].removeAttribute('data-show-orig');
            var imgToggle = imgBlocks[k].querySelector('.twdl-zh-orig');
            if (imgToggle) imgToggle.textContent = '原';
        }
        zhApplyUiState(true);
        zhUpdatePill();
    }

    /* ---------- 13.6 界面文案词典 ---------- */
    function zhUiApply() {
        if (!zhCfg || !zhCfg.enabled || zhCfg.mode !== 'full') return;
        if (!document.body) return;
        var now = Date.now();
        if (now - zhUiLastRun < 800) return;
        zhUiLastRun = now;

        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            var value = node.nodeValue;
            if (!value) continue;
            var parent = node.parentNode;
            if (!parent || parent.nodeType !== 1) continue;
            var tag = parent.nodeName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT' ||
                tag === 'CODE' || tag === 'PRE' || tag === 'OPTION') continue;
            if (parent.closest && parent.closest('#twdl-zh-root, #twdl-zh-panel, [dir="auto"][lang], [contenteditable="true"]')) continue;
            var trimmed = value.trim();
            if (!trimmed || trimmed.length > 40) continue;
            var zh = ZH_UI_DICT[trimmed.toLowerCase()];
            if (!zh || zh === trimmed) continue;
            if (zhUiRecords.length >= ZH_UI_LIST_MAX) break;
            zhUiRecords.push({ node: node, orig: value, zh: value.replace(trimmed, zh) });
            node.nodeValue = value.replace(trimmed, zh);
        }

        var attrs = ['aria-label', 'title', 'placeholder'];
        var els = document.querySelectorAll('[aria-label], [title], [placeholder]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.closest && el.closest('#twdl-zh-root, #twdl-zh-panel')) continue;
            for (var a = 0; a < attrs.length; a++) {
                var name = attrs[a];
                if (!el.hasAttribute(name)) continue;
                var attrValue = (el.getAttribute(name) || '').trim();
                var attrZh = ZH_UI_DICT[attrValue.toLowerCase()];
                if (!attrZh || attrZh === attrValue) continue;
                if (zhUiRecords.length >= ZH_UI_LIST_MAX) break;
                zhUiRecords.push({ el: el, attr: name, orig: el.getAttribute(name), zh: attrZh });
                el.setAttribute(name, attrZh);
            }
        }
        zhUpdatePill();
    }

    function zhUiRestore() {
        for (var i = 0; i < zhUiRecords.length; i++) {
            var rec = zhUiRecords[i];
            try {
                if (rec.node) {
                    /* 只还原"还是我们写进去的那份译文"的节点；React 已经重渲染过的跳过，
                       免得把旧原文写回一个已经换成别的推文的节点。 */
                    if (rec.node.parentNode && rec.node.nodeValue === rec.zh) rec.node.nodeValue = rec.orig;
                } else if (rec.el && rec.attr && rec.el.getAttribute(rec.attr) === rec.zh) {
                    rec.el.setAttribute(rec.attr, rec.orig);
                }
            } catch (e) { /* ignore */ }
        }
        zhUiRecords = [];
    }

    /* force=true 时绕过节流（模式切换/用户操作后要立刻生效）；
       MutationObserver 触发的周期刷新传 false，避免在长页面上每次全量遍历 DOM。 */
    function zhApplyUiState(force) {
        if (!zhCfg) return;
        if (zhCfg.enabled && zhCfg.mode === 'full' && !zhCfg.showOriginal) {
            if (force) zhUiLastRun = 0;
            zhUiApply();
        } else {
            zhUiRestore();
        }
    }

    /* ---------- 13.7 扫描 / 队列 ---------- */

    /* 任何语言的字母都算（西里尔/阿拉伯/希腊/希伯来/泰文/天城文…）。
       旧版只认拉丁+假名+谚文，导致俄语等推文被整页跳过（0 任务 0 请求）。 */
    function zhHasLetters(text) {
        try {
            if (/\p{L}/u.test(text)) return true;
        } catch (e) { /* 旧引擎不支持 Unicode property escapes，退回手工区间 */ }
        return /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\uAC00-\uD7AF]/.test(text);
    }

    function zhShouldTranslate(el, text) {
        if (!text || !el) return false;
        if (el.getAttribute('data-twdl-zh-fail') === '1') return false;
        if (el.getAttribute('data-twdl-zh') === '1') return false;
        if (el.closest && el.closest('[contenteditable="true"]')) return false;
        var lang = (el.getAttribute('lang') || '').toLowerCase();
        if (lang.indexOf('zh') === 0) return false;
        if (text.length < 2 || text.length > ZH_MAX_TEXT) return false;
        if (/^(?:https?:\/\/\S+|@\w+|#\w+)$/i.test(text)) return false;
        /* 至少要有一个字母（任意语言），纯数字/符号/emoji 不翻 */
        if (!zhHasLetters(text)) return false;
        /* 已经是中文为主的不翻（中英混排的推文保留原样） */
        var cjk = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g);
        if (cjk && cjk.length / text.length > 0.15) return false;
        return true;
    }

    function zhScan() {
        if (!zhCfg) zhCfg = zhLoadCfg();
        if (!zhCache) zhCache = zhLoadCache();
        if (!zhCfg.enabled) { zhUpdatePill(); return; }

        var hasKey = !!zhCfg.apiKey;
        var nodes = document.querySelectorAll('[dir="auto"][lang]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!el.parentNode) continue;
            if (el.closest && el.closest('#twdl-zh-root, #twdl-zh-panel')) continue;

            var text = (el.textContent || '').trim();
            var wrapper = zhWrapperOf(el);
            if (wrapper) {
                if (wrapper.getAttribute('data-twdl-src') === text) {
                    zhRefreshBlock(wrapper);   // React 偶尔会把我们设的内联 display 冲掉，重新压一遍状态
                    continue;
                }
                zhRemoveTranslation(el);       // 虚拟列表复用节点：文本变了，旧译文作废
            }

            if (!zhShouldTranslate(el, text)) continue;
            if (!hasKey) continue;             // 没有 Key 就别排队（循环里也不要反复刷状态）
            if (zhQueue.length >= ZH_QUEUE_MAX) break;   // 成本上限：剩下的等下一轮

            var queued = false;
            for (var q = 0; q < zhQueue.length; q++) {
                if (zhQueue[q].el === el) { queued = true; break; }
            }
            if (queued) continue;
            zhQueue.push({ el: el, text: text });
        }
        zhLog('scan.text', {
            raw: nodes.length,
            queued: zhQueue.length,
            translated: document.querySelectorAll('.twdl-zh-block').length,
            hasKey: hasKey
        });
        zhProcessQueue();
        if (!hasKey) zhUpdatePill();
        /* 图片是独立通道：文本块处理完再扫图片（内部有每轮上限和去重标记） */
        try {
            zhScanImages();
        } catch (e) {
            console.warn('[twdl zh] 图片扫描失败', e);
        }
    }

    function zhQueueBatch() {
        var batch = [];
        var chars = 0;
        while (zhQueue.length && batch.length < ZH_BATCH_ITEMS) {
            var item = zhQueue[0];
            if (batch.length && chars + item.text.length > ZH_BATCH_CHARS) break;
            batch.push(item);
            chars += item.text.length;
            zhQueue.shift();
        }
        return batch;
    }

    function zhMarkFailed(item) {
        zhStats.failed += 1;
        if (item && item.el && item.el.setAttribute) item.el.setAttribute('data-twdl-zh-fail', '1');
    }

    function zhProcessQueue() {
        if (zhInFlight) return;
        if (!zhCfg || !zhCfg.enabled) { zhUpdatePill(); return; }
        if (!zhCache) zhCache = zhLoadCache();

        var batch = zhQueueBatch();
        if (!batch.length) { zhUpdatePill(); return; }

        var need = [];
        batch.forEach(function (item) {
            var cached = zhCacheGet(item.text);
            if (cached) zhApplyTranslation(item.el, item.text, cached, true);
            else need.push(item);
        });

        if (!need.length) {
            setTimeout(zhProcessQueue, 30);
            return;
        }
        if (!zhCfg.apiKey) {
            zhStats.lastError = '未配置 API Key';
            zhUpdatePill();
            return;
        }

        zhInFlight = true;
        zhUpdatePill();
        zhRequest(zhCfg, need.map(function (item) { return item.text; })).then(function (list) {
            var okCount = 0;
            need.forEach(function (item, index) {
                var zh = list[index];
                if (!zh) { zhMarkFailed(item); return; }
                if (item.el && item.el.isConnected === false) return;
                zhCacheSet(item.text, zh);
                zhApplyTranslation(item.el, item.text, zh, false);
                okCount += 1;
            });
            if (okCount) zhStats.lastError = '';
        }).catch(function (err) {
            zhStats.lastError = (err && err.message) ? err.message : String(err);
            need.forEach(zhMarkFailed);
        }).then(function () {
            zhInFlight = false;
            zhUpdatePill();
            if (zhQueue.length) setTimeout(zhProcessQueue, 150);
        });
    }

    function zhClearFailed() {
        zhStats.failed = 0;
        zhStats.imgFailed = 0;
        var els = document.querySelectorAll('[data-twdl-zh-fail]');
        for (var i = 0; i < els.length; i++) els[i].removeAttribute('data-twdl-zh-fail');

        /* 图片：清掉失败标记/占位，并把错误提示块删掉，让下一轮扫描重新建块 */
        var imgFails = document.querySelectorAll('[data-twdl-zhimg-fail]');
        for (var j = 0; j < imgFails.length; j++) {
            imgFails[j].removeAttribute('data-twdl-zhimg-fail');
            imgFails[j].removeAttribute('data-twdl-zhimg-queued');
        }
        var errorBlocks = document.querySelectorAll('.twdl-zh-imgblock[data-state="error"]');
        for (var k = 0; k < errorBlocks.length; k++) {
            if (errorBlocks[k].parentNode) errorBlocks[k].parentNode.removeChild(errorBlocks[k]);
        }
        zhUpdatePill();
    }

    function scheduleZh(delay) {
        clearTimeout(zhTimer);
        zhTimer = setTimeout(function () {
            try {
                zhScan();
            } catch (e) {
                console.warn('[twdl zh] 扫描失败', e);
            }
            if (zhCfg && zhCfg.enabled && zhCfg.mode === 'full') {
                try {
                    zhApplyUiState(false);
                } catch (e) {
                    console.warn('[twdl zh] 界面翻译失败', e);
                }
            }
        }, typeof delay === 'number' ? delay : 600);
    }

    /* ---------- 13.8 设置面板 ---------- */
    function zhInjectStyle() {
        if (document.getElementById('twdl-zh-style')) return;
        var style = document.createElement('style');
        style.id = 'twdl-zh-style';
        style.textContent = ZH_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function zhSetEnabled(value) {
        if (!zhCfg) zhCfg = zhLoadCfg();
        zhCfg.enabled = !!value;
        zhSaveCfg();
        if (zhCfg.enabled) {
            zhApplyUiState(true);
            zhScan();
        } else {
            zhUiRestore();
        }
        zhUpdatePill();
    }

    function zhOpenPanel() {
        var panel = document.getElementById('twdl-zh-panel');
        if (!panel) return;
        if (!zhCfg) zhCfg = zhLoadCfg();
        var byId = function (id) { return panel.querySelector('#' + id); };
        var enabled = byId('twdl-zh-enabled');
        if (enabled) enabled.checked = !!zhCfg.enabled;
        var mode = byId('twdl-zh-mode');
        if (mode) mode.value = zhCfg.mode === 'full' ? 'full' : 'content';
        var pairs = [
            ['twdl-zh-baseurl', zhCfg.baseUrl || ''],
            ['twdl-zh-model', zhCfg.model || ''],
            ['twdl-zh-apikey', zhCfg.apiKey || ''],
            ['twdl-zh-vbaseurl', zhCfg.visionBaseUrl || ''],
            ['twdl-zh-vmodel', zhCfg.visionModel || ''],
            ['twdl-zh-vapikey', zhCfg.visionApiKey || '']
        ];
        pairs.forEach(function (pair) {
            var input = byId(pair[0]);
            if (input) input.value = pair[1];
        });
        var imgMode = byId('twdl-zh-imgmode');
        if (imgMode) imgMode.value = zhCfg.imgMode || 'auto';
        panel.hidden = false;
        zhUpdatePill();
    }

    function zhTogglePanel() {
        var panel = document.getElementById('twdl-zh-panel');
        if (!panel) return;
        if (panel.hidden) zhOpenPanel();
        else panel.hidden = true;
    }

    function zhReadPanel() {
        var panel = document.getElementById('twdl-zh-panel');
        if (!panel) return null;
        var byId = function (id) { return panel.querySelector('#' + id); };
        var valueOf = function (id) {
            var input = byId(id);
            return input ? String(input.value || '').trim() : '';
        };
        var enabled = byId('twdl-zh-enabled');
        var mode = byId('twdl-zh-mode');
        var imgMode = byId('twdl-zh-imgmode');
        var imgModeValue = (imgMode && imgMode.value) ? imgMode.value : 'auto';
        if (imgModeValue !== 'button' && imgModeValue !== 'off') imgModeValue = 'auto';
        return {
            enabled: enabled ? !!enabled.checked : true,
            mode: (mode && mode.value === 'full') ? 'full' : 'content',
            baseUrl: zhNormalizeBaseUrl(valueOf('twdl-zh-baseurl')) || ZH_DEFAULTS.baseUrl,
            model: valueOf('twdl-zh-model') || ZH_DEFAULTS.model,
            apiKey: valueOf('twdl-zh-apikey'),
            imgMode: imgModeValue,
            visionBaseUrl: zhNormalizeBaseUrl(valueOf('twdl-zh-vbaseurl')),
            visionModel: valueOf('twdl-zh-vmodel'),
            visionApiKey: valueOf('twdl-zh-vapikey'),
            showOriginal: zhCfg ? !!zhCfg.showOriginal : false
        };
    }

    function zhSaveFromPanel() {
        var next = zhReadPanel();
        if (!next) return;
        zhCfg = next;
        zhSaveCfg();
        /* 把纠正后的地址回写到面板，让人一眼看到实际会用的 base url */
        var panel = document.getElementById('twdl-zh-panel');
        if (panel) {
            var baseInput = panel.querySelector('#twdl-zh-baseurl');
            if (baseInput) baseInput.value = zhCfg.baseUrl || '';
            var vBaseInput = panel.querySelector('#twdl-zh-vbaseurl');
            if (vBaseInput) vBaseInput.value = zhCfg.visionBaseUrl || '';
        }
        zhClearFailed();
        zhApplyUiState(true);
        zhScan();
        zhUpdatePill();
    }

    function zhTestFromPanel() {
        var next = zhReadPanel();
        var stat = document.getElementById('twdl-zh-stat');
        if (!next || !next.apiKey) {
            if (stat) stat.textContent = '未填写 API Key';
            return;
        }
        var candidates = zhChatUrlCandidates(next.baseUrl);
        var warnings = [zhApiAddressWarning(next.baseUrl), zhModelWarning(next.model)].filter(function (w) { return !!w; });
        if (stat) {
            stat.textContent = '测试中…\n将尝试：' + candidates.join('\n') +
                (warnings.length ? '\n⚠ ' + warnings.join('\n⚠ ') : '');
        }
        zhRequest(next, ['Hello, this is a connection test.']).then(function (list) {
            if (stat) {
                stat.textContent = '✓ 连接成功：' + (list[0] || '(空)') +
                    (zhStats.lastAttemptUrl ? '\n实际请求：' + zhStats.lastAttemptUrl : '');
            }
        }).catch(function (err) {
            if (stat) {
                stat.textContent = '✗ 连接失败：' + ((err && err.message) ? err.message : String(err)) +
                    (zhStats.lastAttemptUrl ? '\n最后一次请求：' + zhStats.lastAttemptUrl : '');
            }
        });
    }

    function zhBuildUi() {
        if (document.getElementById('twdl-zh-root') || !document.body) return;
        zhInjectStyle();

        var root = document.createElement('div');
        root.id = 'twdl-zh-root';

        var toggle = document.createElement('button');
        toggle.id = 'twdl-zh-toggle';
        toggle.type = 'button';
        toggle.textContent = '译';
        toggle.addEventListener('click', function () {
            if (!zhCfg || !zhCfg.apiKey) {
                zhOpenPanel();
                return;
            }
            zhSetShowOriginal(!zhCfg.showOriginal);
        });

        var gear = document.createElement('button');
        gear.id = 'twdl-zh-gear';
        gear.type = 'button';
        gear.title = '汉化设置';
        gear.textContent = '⚙';
        gear.addEventListener('click', function () { zhTogglePanel(); });

        root.appendChild(toggle);
        root.appendChild(gear);
        document.body.appendChild(root);

        var panel = document.createElement('div');
        panel.id = 'twdl-zh-panel';
        panel.hidden = true;
        panel.innerHTML = [
            '<h3>汉化设置</h3>',
            '<div class="twdl-zh-row"><label><input type="checkbox" id="twdl-zh-enabled"> 启用汉化</label></div>',
            '<div class="twdl-zh-row"><label>范围</label>',
            '<select id="twdl-zh-mode"><option value="content">仅内容（推文 / 简介 / 引用）</option>',
            '<option value="full">内容 + X 界面文案</option></select></div>',
            '<div class="twdl-zh-row"><label>API 地址（OpenAI 兼容）</label>',
            '<input type="text" id="twdl-zh-baseurl" placeholder="https://api.moonshot.cn/v1（Kimi）或 https://api.deepseek.com/v1"></div>',
            '<div class="twdl-zh-row"><label>模型</label>',
            '<input type="text" id="twdl-zh-model" placeholder="kimi-k3（Kimi K3）或 deepseek-chat"></div>',
            '<div class="twdl-zh-row"><label>API Key</label>',
            '<input type="password" id="twdl-zh-apikey" placeholder="输入你的 API Key"></div>',
            '<h3 style="margin-top:14px">图片内文字</h3>',
            '<div class="twdl-zh-row"><label>模式（推文里的截图/图片文字）</label>',
            '<select id="twdl-zh-imgmode">',
            '<option value="auto">自动翻译（有视觉模型时）</option>',
            '<option value="button">仅显示「翻译图片文字」按钮</option>',
            '<option value="off">关闭</option></select></div>',
            '<div class="twdl-zh-row"><label>视觉模型（留空 = 沿用上面的模型；需支持图片）</label>',
            '<input type="text" id="twdl-zh-vmodel" placeholder="kimi-k3（原生支持图片，可留空沿用）/ gpt-4o-mini / qwen-vl-max"></div>',
            '<div class="twdl-zh-row"><label>视觉 API 地址（留空沿用）</label>',
            '<input type="text" id="twdl-zh-vbaseurl" placeholder="https://api.moonshot.cn/v1 或 https://api.deepseek.com/v1"></div>',
            '<div class="twdl-zh-row"><label>视觉 API Key（留空沿用）</label>',
            '<input type="password" id="twdl-zh-vapikey" placeholder="输入你的 API Key"></div>',
            '<div class="twdl-zh-actions">',
            '<button type="button" id="twdl-zh-save">保存并翻译</button>',
            '<button type="button" id="twdl-zh-test">测试连接</button>',
            '<button type="button" id="twdl-zh-retry">重试失败项</button>',
            '<button type="button" id="twdl-zh-clearn">清空缓存</button>',
            '<button type="button" id="twdl-zh-diag">诊断</button>',
            '</div>',
            '<div class="twdl-zh-tip">Key 只保存在本机（Tampermonkey 存储 / localStorage），只会发送到你填写的 API 地址。' +
            '浏览器里持有 Key 有泄露风险，建议用限额子账号或专用 Key。' +
            '图片/视频封面翻译按张计费：每轮最多自动处理 3 张，纯图片/表情会被跳过，结果有缓存。点「诊断」可导出自我诊断报告。</div>',
            '<div class="twdl-zh-stat" id="twdl-zh-stat"></div>'
        ].join('');
        document.body.appendChild(panel);

        var save = panel.querySelector('#twdl-zh-save');
        if (save) save.addEventListener('click', zhSaveFromPanel);
        var testBtn = panel.querySelector('#twdl-zh-test');
        if (testBtn) testBtn.addEventListener('click', zhTestFromPanel);
        var retry = panel.querySelector('#twdl-zh-retry');
        if (retry) retry.addEventListener('click', function () {
            zhClearFailed();
            zhScan();
        });
        var clear = panel.querySelector('#twdl-zh-clearn');
        if (clear) clear.addEventListener('click', function () {
            zhCache = {};
            zhSaveCache();
            zhUpdatePill();
        });
        var diag = panel.querySelector('#twdl-zh-diag');
        if (diag) diag.addEventListener('click', function () {
            zhShowDiagnostics();
        });
        var enabledBox = panel.querySelector('#twdl-zh-enabled');
        if (enabledBox) enabledBox.addEventListener('change', function () {
            zhSetEnabled(this.checked);
        });
    }

    function zhBoot() {
        if (zhCfg) return;
        zhCfg = zhLoadCfg();
        zhCache = zhLoadCache();
        zhBuildUi();
        if (document.body) document.body.classList.toggle('twdl-zh-orig', !!zhCfg.showOriginal);
        zhUpdatePill();
        scheduleZh(1200);
        setTimeout(function () {
            if (zhCfg && zhCfg.enabled && zhCfg.mode === 'full' && !zhCfg.showOriginal) {
                zhApplyUiState(true);
            }
        }, 1800);
    }

    /* =================================================================
     * 13.9 图片内文字翻译（v0.2.1 新增）
     *
     * 场景：推文正文其实是"一张截图"（例如 Truth Social 截图），DOM 里没有可翻译
     * 的文本块，文本 LLM 无从下手。这里用视觉模型做 OCR + 翻译。
     *
     * 做法：
     * - 扫 img[src*='pbs.twimg.com/media']，跳过头像/表情/视频封面/小图；
     * - 把图片下载成 base64（GM_xmlhttpRequest / fetch，pbs.twimg.com 有 CORS 头），
     *   以 OpenAI 兼容的 image_url 格式发给视觉模型（比直接给 URL 稳：服务商
     *   不一定能访问 twimg）；
     * - 结果渲染成图片下方的块，带「原/译」按钮；全局「原文」开关也会一起隐藏；
     * - 按图片 URL 缓存；NO_TEXT（纯图片）不渲染任何东西；失败标记后不自动重试。
     * ================================================================= */
    function zhVisionCfg() {
        if (!zhCfg) return null;
        var cfg = {
            baseUrl: (zhCfg.visionBaseUrl || zhCfg.baseUrl || ZH_DEFAULTS.baseUrl),
            model: (zhCfg.visionModel || zhCfg.model || ''),
            apiKey: (zhCfg.visionApiKey || zhCfg.apiKey || '')
        };
        if (!cfg.apiKey) return null;
        return cfg;
    }

    /* 图片 URL 归一化：去掉 name= 尺寸参数，作为缓存 / 去重 key */
    function zhImgKey(src) {
        return String(src || '').replace(/^https?:\/\//, '').replace(NAME_PARAM_RE, '');
    }


    /* 挂载点：视频播放器 / 图片容器（tweetPhoto）。X 媒体容器是绝对定位 + overflow:hidden，
       把译文插到容器外面会被裁掉（表现就是"翻译了但看不见"），所以统一插到容器**内部**做浮层。 */
    function zhImgBlockHost(el) {
        if (!el) return null;
        var node = el;
        if (node.tagName === 'VIDEO') node = node.parentElement || node;
        if (node.closest) {
            var player = node.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]');
            if (player) return player;
            var photo = node.closest('[data-testid="tweetPhoto"]');
            if (photo && photo.parentNode) return photo;
        }
        return node.parentElement || node;
    }

    function zhFindImgBlock(el) {
        var host = zhImgBlockHost(el);
        if (!host || !host.children) return null;
        for (var i = 0; i < host.children.length; i++) {
            var child = host.children[i];
            if (child.classList && child.classList.contains('twdl-zh-imgblock')) return child;
        }
        return null;
    }

    function zhInsertAfterHost(el, block) {
        var host = zhImgBlockHost(el) || el;
        if (host.tagName === 'VIDEO') host = host.parentElement || host;
        try {
            var view = host.ownerDocument && host.ownerDocument.defaultView;
            var position = view && view.getComputedStyle ? view.getComputedStyle(host).position : '';
            if (!position || position === 'static') host.style.position = 'relative';
        } catch (e) { /* ignore */ }
        if (!block.hasAttribute('data-overlay')) block.setAttribute('data-overlay', '1');
        try {
            host.appendChild(block);
            return true;
        } catch (e2) {
            return false;
        }
    }

    /* 视频封面图：X 用 amplify_video_thumb / ext_tw_video_thumb，取 video.poster 或播放器里的 img */
    function zhVideoPoster(el) {
        if (!el) return '';
        var video = (el.tagName === 'VIDEO') ? el : el.querySelector('video');
        if (video) {
            var poster = video.getAttribute('poster');
            if (poster && /^https?:/i.test(poster)) return poster;
        }
        if (!el.querySelectorAll) return '';
        var imgs = el.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].getAttribute('src') || '';
            if (/pbs\.twimg\.com\//.test(src)) return src;
        }
        return '';
    }

    /* 已翻译过但译文块被 X 重新渲染删掉了（虚拟列表/局部刷新）→ 用缓存静默补回，不重发请求 */
    function zhImgRemountIfMissing(el, key) {
        if (!el || !key) return false;
        if (zhFindImgBlock(el)) return false;
        var hit = zhCacheGet('img:' + key);
        if (!hit || hit === ZH_NO_TEXT) return false;
        zhLog('remount', { key: key });
        var block = zhImgBlockCreate('ok', hit, true);
        block.setAttribute('data-twdl-zhimg-for', key);
        return zhInsertAfterHost(el, block);
    }

    function zhMakeOrigToggle(block) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'twdl-zh-orig';
        btn.textContent = '原';
        btn.title = '隐藏译文 / 显示译文';
        btn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            var hide = block.getAttribute('data-show-orig') !== '1';
            block.setAttribute('data-show-orig', hide ? '1' : '0');
            btn.textContent = hide ? '译' : '原';
        });
        return btn;
    }

    function zhImgBlockCreate(state, text, withToggle) {
        var block = document.createElement('div');
        block.className = 'twdl-zh-imgblock';
        block.setAttribute('data-state', state || 'ok');
        var textEl = document.createElement('div');
        textEl.className = 'twdl-zh-imgtext';
        textEl.textContent = text || '';
        block.appendChild(textEl);
        if (withToggle) block.appendChild(zhMakeOrigToggle(block));
        return block;
    }

    function zhImgBlockFill(block, text) {
        block.setAttribute('data-state', 'ok');
        block.removeAttribute('data-show-orig');
        var textEl = block.querySelector('.twdl-zh-imgtext');
        if (!textEl) {
            textEl = document.createElement('div');
            textEl.className = 'twdl-zh-imgtext';
            block.appendChild(textEl);
        }
        textEl.textContent = text;
        var btn = block.querySelector('.twdl-zh-orig');
        if (!btn) {
            btn = zhMakeOrigToggle(block);
            block.appendChild(btn);
        }
        btn.textContent = '原';
        var retry = block.querySelector('.twdl-zh-imgretry');
        if (retry && retry.parentNode) retry.parentNode.removeChild(retry);
    }

    function zhImgInsertButton(img, key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'twdl-zh-imgbtn';
        btn.textContent = '翻译图片文字';
        btn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            btn.disabled = true;
            btn.textContent = '翻译中…';
            zhImgRequestOne(img, key, function () {
                btn.disabled = false;
                btn.textContent = '重新翻译图片';
            });
        });
        zhInsertAfterHost(img, btn);
    }

    function zhArrayBufferToBase64(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        var chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    function zhImageMime(url, contentType) {
        if (contentType && /^image\//i.test(contentType)) return contentType.split(';')[0].trim();
        var match = /[?&]format=([a-z0-9]+)/i.exec(url || '');
        if (match) {
            var ext = match[1].toLowerCase();
            if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
            if (ext === 'png') return 'image/png';
            if (ext === 'webp') return 'image/webp';
            if (ext === 'gif') return 'image/gif';
            if (ext === 'bmp') return 'image/bmp';
            if (ext === 'heic') return 'image/heic';
            if (ext === 'heif') return 'image/heif';
        }
        return 'image/jpeg';
    }

    function zhImageToDataUrl(url) {
        return new Promise(function (resolve, reject) {
            var finish = function (buffer, contentType) {
                try {
                    resolve('data:' + zhImageMime(url, contentType) + ';base64,' + zhArrayBufferToBase64(buffer));
                } catch (e) {
                    reject(new Error('图片转 base64 失败：' + e.message));
                }
            };

            var legacy = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest : null;
            var modern = null;
            try {
                if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') modern = GM.xmlHttpRequest;
            } catch (e) { /* ignore */ }

            if (legacy) {
                legacy({
                    method: 'GET', url: url, responseType: 'arraybuffer', timeout: 45000,
                    onload: function (resp) {
                        if (resp.status >= 200 && resp.status < 300) {
                            var contentType = '';
                            try {
                                var m = /content-type:\s*([^\r\n;]+)/i.exec(resp.responseHeaders || '');
                                if (m) contentType = m[1];
                            } catch (e) { /* ignore */ }
                            finish(resp.response, contentType);
                        } else {
                            reject(new Error('下载图片失败 HTTP ' + resp.status));
                        }
                    },
                    onerror: function () { reject(new Error('下载图片失败（网络）')); },
                    ontimeout: function () { reject(new Error('下载图片超时')); }
                });
                return;
            }

            if (modern) {
                var maybe = modern({ method: 'GET', url: url, responseType: 'arraybuffer', timeout: 45000 });
                if (maybe && typeof maybe.then === 'function') {
                    maybe.then(function (resp) {
                        if (resp.status >= 200 && resp.status < 300) finish(resp.response, '');
                        else reject(new Error('下载图片失败 HTTP ' + resp.status));
                    }).catch(function () { reject(new Error('下载图片失败（GM.xmlHttpRequest）')); });
                    return;
                }
            }

            if (typeof fetch !== 'function') {
                reject(new Error('当前环境无法下载图片'));
                return;
            }
            fetch(url).then(function (resp) {
                if (!resp.ok) throw new Error('下载图片失败 HTTP ' + resp.status);
                var contentType = '';
                try { contentType = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || ''; } catch (e) { /* ignore */ }
                return resp.arrayBuffer().then(function (buffer) { finish(buffer, contentType); });
            }).catch(function (err) {
                reject(new Error((err && err.message) ? err.message : String(err)));
            });
        });
    }

    function zhImgTranslate(img, key, srcOverride) {
        var cfg = zhVisionCfg();
        if (!cfg || !cfg.model) {
            return Promise.reject(new Error('未配置视觉模型（Kimi 填 kimi-k3 并把「视觉模型」留空即可；其它家填 gpt-4o-mini / qwen-vl-max / glm-4v 等）'));
        }

        var cacheKey = 'img:' + key;
        var hit = zhCacheGet(cacheKey);
        if (hit) return Promise.resolve(hit === ZH_NO_TEXT ? '' : hit);

        var src = srcOverride || img.currentSrc || img.src || '';
        if (!src) return Promise.reject(new Error('取不到图片地址'));
        var largeUrl = toLargeName(src, LARGE_IMG_NAME);

        return zhImageToDataUrl(largeUrl).then(function (dataUrl) {
            return zhDownscaleDataUrl(dataUrl, ZH_IMG_MAX_SIDE);
        }).then(function (dataUrl) {
            /* Kimi 文档：请求 body 上限 100M，图片分辨率建议 ≤4K；这里给 20MB 的保守上限 */
            if (dataUrl.length > 20 * 1024 * 1024) {
                throw new Error('图片太大（base64 超过 20MB）：换小图，或调低图片分辨率');
            }
            var body = JSON.stringify(zhBuildChatPayload(cfg.model, [
                { role: 'system', content: ZH_IMG_PROMPT },
                {
                    role: 'user',
                    /* 官方视觉文档示例：content 必须是对象数组，顺序为图片在前、文字在后 */
                    content: [
                        { type: 'image_url', image_url: { url: dataUrl } },
                        { type: 'text', text: '请识别图片中的文字并翻译成简体中文。' }
                    ]
                }
            ]));
            zhStats.imgRequests += 1;
            zhUpdatePill();
            return zhCallChat(cfg, body, 90000);
        }).then(function (respText) {
            var text = zhParseChatResponse(respText).trim();
            if (text.replace(/[。.\s"'`]/g, '') === ZH_NO_TEXT) {
                zhCacheSet(cacheKey, ZH_NO_TEXT);
                return '';
            }
            zhCacheSet(cacheKey, text);
            return text;
        });
    }

    function zhImgRequestOne(img, key, onDone, srcOverride) {
        var block = zhFindImgBlock(img);
        if (block) {
            block.setAttribute('data-state', 'pending');
            block.removeAttribute('data-show-orig');
            var existing = block.querySelector('.twdl-zh-imgtext');
            if (existing) existing.textContent = '图片文字翻译中…';
            var oldRetry = block.querySelector('.twdl-zh-imgretry');
            if (oldRetry && oldRetry.parentNode) oldRetry.parentNode.removeChild(oldRetry);
        } else {
            block = zhImgBlockCreate('pending', '图片文字翻译中…', false);
            block.setAttribute('data-twdl-zhimg-for', key);
            zhInsertAfterHost(img, block);
        }

        zhLog('img.start', { key: key, tag: (img && img.tagName) || '' });
        zhImgTranslate(img, key, srcOverride).then(function (text) {
            if (!text) {
                zhLog('img.notext', { key: key });
                zhStats.imgNoText += 1;
                img.setAttribute('data-twdl-zhimg-done', '1');
                if (block && block.parentNode) block.parentNode.removeChild(block);
                zhUpdatePill();
                if (onDone) onDone();
                return;
            }
            zhLog('img.ok', { key: key, len: text.length });
            img.setAttribute('data-twdl-zhimg-done', '1');
            img.removeAttribute('data-twdl-zhimg-fail');
            zhStats.imgApplied += 1;
            zhImgBlockFill(block, text);
            zhUpdatePill();
            if (onDone) onDone();
        }).catch(function (err) {
            var message = (err && err.message) ? err.message : String(err);
            zhLog('img.error', { key: key, message: String(message).slice(0, 160) });
            zhStats.imgFailed += 1;
            zhStats.lastError = '图片翻译失败：' + message;
            img.setAttribute('data-twdl-zhimg-fail', '1');
            if (block) {
                block.setAttribute('data-state', 'error');
                var textEl = block.querySelector('.twdl-zh-imgtext');
                if (textEl) {
                    textEl.textContent = '图片文字翻译失败：' + message;
                    if (err && err.detail) textEl.title = err.detail;
                }
                /* 错误块里给一个「重试」，不用整页刷新 */
                if (!block.querySelector('.twdl-zh-imgretry')) {
                    var retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'twdl-zh-imgretry';
                    retry.textContent = '重试';
                    retry.title = '用当前设置重新翻译这张图';
                    retry.addEventListener('click', function (event) {
                        event.preventDefault();
                        event.stopPropagation();
                        retry.disabled = true;
                        zhStats.imgFailed = Math.max(0, zhStats.imgFailed - 1);
                        img.removeAttribute('data-twdl-zhimg-fail');
                        zhImgRequestOne(img, key, function () {
                            if (retry.parentNode) retry.parentNode.removeChild(retry);
                        });
                    });
                    block.appendChild(retry);
                }
            }
            zhUpdatePill();
            if (onDone) onDone();
        });
    }

    function zhScanImages() {
        if (!zhCfg) zhCfg = zhLoadCfg();
        if (!zhCfg.enabled) return;
        var imgMode = zhCfg.imgMode || 'auto';
        if (imgMode === 'off') return;

        var imgs = document.querySelectorAll("img[src*='pbs.twimg.com/media']");
        var queuedThisScan = 0;
        var imgSeen = [];
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if (!img.parentNode) continue;
            if (img.closest && img.closest('#twdl-zh-root, #twdl-zh-panel')) continue;
            var src = img.getAttribute('src') || '';
            if (ZH_IMG_SKIP_RE.test(src)) continue;
            var key = zhImgKey(img.currentSrc || src);
            imgSeen.push(key);
            if (img.getAttribute('data-twdl-zhimg-done') === '1') {
                zhImgRemountIfMissing(img, key);   // X 重渲染把译文块删了 → 用缓存补回
                continue;
            }
            if (img.getAttribute('data-twdl-zhimg-fail') === '1') continue;
            if (img.getAttribute('data-twdl-zhimg-queued') === '1') continue;
            if (img.getAttribute('data-twdl-zhimg-skip') === '1') continue;
            if (img.naturalWidth && (img.naturalWidth < ZH_IMG_MIN_SIDE || img.naturalHeight < ZH_IMG_MIN_HEIGHT)) {
                img.setAttribute('data-twdl-zhimg-skip', '1');
                continue;
            }

            if (imgMode === 'button') {
                img.setAttribute('data-twdl-zhimg-queued', '1');
                zhImgInsertButton(img, key);
                continue;
            }

            if (!zhVisionCfg()) continue;   // 没有 Key 就不自动发请求
            if (zhImgQueue.length >= ZH_IMG_MAX_PER_SCAN) break;
            img.setAttribute('data-twdl-zhimg-queued', '1');
            zhImgQueue.push({ img: img, key: key });
            queuedThisScan += 1;
            if (queuedThisScan >= ZH_IMG_MAX_PER_SCAN) break;
        }

        /* v0.2.1-zh.8：视频封面（X 用 amplify_video_thumb 封面图，不在 img[src*='pbs.twimg.com/media'] 里） */
        var rawVideos = document.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"] video, video[poster]');
        var videoHosts = [];
        for (var vi = 0; vi < rawVideos.length; vi++) {
            var raw = rawVideos[vi];
            var hostEl = raw;
            if (raw.tagName === 'VIDEO' && raw.closest) {
                hostEl = raw.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]') || raw.parentElement;
            }
            if (!hostEl || !hostEl.getAttribute) continue;
            if (videoHosts.indexOf(hostEl) !== -1) continue;
            videoHosts.push(hostEl);
        }
        for (var hi = 0; hi < videoHosts.length; hi++) {
            var vp = videoHosts[hi];
            if (vp.closest && vp.closest('#twdl-zh-root, #twdl-zh-panel')) continue;
            var poster = zhVideoPoster(vp);
            if (!poster) continue;
            var vkey = zhImgKey(poster);
            if (imgSeen.indexOf(vkey) !== -1) continue;
            if (vp.getAttribute('data-twdl-zhimg-done') === '1') {
                if (imgMode !== 'off') zhImgRemountIfMissing(vp, vkey);
                continue;
            }
            if (vp.getAttribute('data-twdl-zhimg-fail') === '1') continue;
            if (vp.getAttribute('data-twdl-zhimg-queued') === '1') continue;
            if (vp.getAttribute('data-twdl-zhimg-skip') === '1') continue;
            var rect = vp.getBoundingClientRect ? vp.getBoundingClientRect() : null;
            if (rect && (rect.width < ZH_IMG_MIN_SIDE || rect.height < ZH_IMG_MIN_HEIGHT)) {
                vp.setAttribute('data-twdl-zhimg-skip', '1');
                continue;
            }
            if (imgMode === 'button') {
                vp.setAttribute('data-twdl-zhimg-queued', '1');
                zhImgInsertButton(vp, vkey);
                continue;
            }
            if (!zhVisionCfg()) continue;
            if (zhImgQueue.length >= ZH_IMG_MAX_PER_SCAN || queuedThisScan >= ZH_IMG_MAX_PER_SCAN) break;
            vp.setAttribute('data-twdl-zhimg-queued', '1');
            zhImgQueue.push({ img: vp, key: vkey, src: poster });
            queuedThisScan += 1;
        }
        zhLog('scan.media', { images: imgs.length, videos: videoHosts.length, queue: zhImgQueue.length });
        zhImgProcessQueue();
    }

    function zhImgProcessQueue() {
        if (zhImgInFlight) return;
        if (!zhCfg || !zhCfg.enabled || (zhCfg.imgMode || 'auto') === 'off') return;
        var item = zhImgQueue.shift();
        if (!item) { zhUpdatePill(); return; }
        if (!item.img || !item.img.parentNode) {
            setTimeout(zhImgProcessQueue, 10);
            return;
        }
        zhImgInFlight = true;
        zhUpdatePill();
        zhImgRequestOne(item.img, item.key, function () {
            zhImgInFlight = false;
            zhUpdatePill();
            if (zhImgQueue.length) setTimeout(zhImgProcessQueue, 300);
        }, item.src);
    }

    /* =================================================================
     * 13.10 自检 / 自我诊断（v0.2.1-zh.9）
     *
     * 目的：页面"没翻译 / 没报错 / 看不见"时，不用截图就能定位。
     * - 环形日志记录扫描、请求、退避、跳过、重挂载等关键事件；
     * - diagnostics() 输出结构化报告：配置（Key 打码）、统计、限速、DOM 覆盖率、
     *   孤儿译文块（被 X 重渲染删掉）、被裁切的块、缓存与最近日志；
     * - selfCheck() 把常见故障翻译成可执行的结论；
     * - 面板「诊断」= 报告写进状态区并复制到剪贴板。
     * ================================================================= */
    var ZH_DEBUG_MAX = 240;
    var zhDebugLog = [];
    var zhSelfCheckAt = 0;
    var zhSelfCheckCache = [];

    function zhLog(kind, detail) {
        try {
            zhDebugLog.push({
                t: Date.now(),
                kind: String(kind),
                detail: detail === undefined ? null : detail
            });
            if (zhDebugLog.length > ZH_DEBUG_MAX) zhDebugLog.shift();
        } catch (e) { /* 日志永不抛出 */ }
    }

    function zhMaskKey(key) {
        var s = String(key || '');
        if (!s) return '(空)';
        if (s.length <= 8) return s.charAt(0) + '***';
        return s.slice(0, 4) + '***' + s.slice(-4);
    }

    function zhCountMatches(selector) {
        try { return document.querySelectorAll(selector).length; } catch (e) { return 0; }
    }

    function zhBlockVisible(block) {
        try {
            if (!block || !block.getBoundingClientRect) return false;
            var rect = block.getBoundingClientRect();
            return rect.width > 4 && rect.height > 4;
        } catch (e) { return false; }
    }

    function zhMediaStats() {
        var out = {
            imageCandidates: 0, imageEligible: 0, imageSkippedRegex: 0, imageSkippedSmall: 0,
            imageDone: 0, imageFailed: 0, imageOrphans: 0,
            imageBlocks: 0, imageBlocksVisible: 0, imageBlocksClipped: 0,
            videoPlayers: 0, videoWithPoster: 0, videoDone: 0, videoOrphans: 0,
            videoBlocks: 0
        };
        try {
            var imgs = document.querySelectorAll("img[src*='pbs.twimg.com/media']");
            for (var i = 0; i < imgs.length; i++) {
                var img = imgs[i];
                if (!img.parentNode) continue;
                if (img.closest && img.closest('#twdl-zh-root, #twdl-zh-panel')) continue;
                out.imageCandidates += 1;
                var src = img.getAttribute('src') || '';
                if (ZH_IMG_SKIP_RE.test(src)) { out.imageSkippedRegex += 1; continue; }
                if (img.getAttribute('data-twdl-zhimg-skip') === '1') { out.imageSkippedSmall += 1; continue; }
                if (img.getAttribute('data-twdl-zhimg-fail') === '1') { out.imageFailed += 1; continue; }
                if (img.getAttribute('data-twdl-zhimg-done') === '1') {
                    out.imageDone += 1;
                    if (!zhFindImgBlock(img)) out.imageOrphans += 1;
                    continue;
                }
                out.imageEligible += 1;
            }
            var rawVideos = document.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"] video, video[poster]');
            var seen = [];
            for (var vi = 0; vi < rawVideos.length; vi++) {
                var raw = rawVideos[vi];
                var host = raw;
                if (raw.tagName === 'VIDEO' && raw.closest) {
                    host = raw.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]') || raw.parentElement;
                }
                if (!host || seen.indexOf(host) !== -1) continue;
                seen.push(host);
                out.videoPlayers += 1;
                if (!zhVideoPoster(host)) continue;
                out.videoWithPoster += 1;
                if (host.getAttribute('data-twdl-zhimg-done') === '1') {
                    out.videoDone += 1;
                    if (!zhFindImgBlock(host)) out.videoOrphans += 1;
                }
            }
            var blocks = document.querySelectorAll('.twdl-zh-imgblock');
            for (var b = 0; b < blocks.length; b++) {
                var blk = blocks[b];
                if (blk.closest && blk.closest('#twdl-zh-panel')) continue;
                out.imageBlocks += 1;
                if (blk.getAttribute('data-state') !== 'ok') continue;
                if (zhBlockVisible(blk)) out.imageBlocksVisible += 1;
                else out.imageBlocksClipped += 1;
                if (blk.closest && blk.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]')) {
                    out.videoBlocks += 1;
                }
            }
        } catch (e) {
            out.error = String(e && e.message ? e.message : e);
        }
        return out;
    }

    function zhTextStats() {
        var out = { candidatesRaw: 0, candidatesEligible: 0, translatedBlocks: 0, failed: 0, failedBlocks: 0 };
        try {
            var nodes = document.querySelectorAll('[dir="auto"][lang]');
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (!el.parentNode) continue;
                if (el.closest && el.closest('#twdl-zh-root, #twdl-zh-panel')) continue;
                out.candidatesRaw += 1;
                var text = (el.textContent || '').trim();
                if (zhShouldTranslate(el, text)) out.candidatesEligible += 1;
                if (el.getAttribute && el.getAttribute('data-twdl-zh-fail') === '1') out.failed += 1;
            }
            out.translatedBlocks = zhCountMatches('.twdl-zh-block');
            out.failedBlocks = zhCountMatches('.twdl-zh-block[data-state="error"]');
        } catch (e) { /* ignore */ }
        return out;
    }

    function zhSelfCheck() {
        var problems = [];
        if (!zhCfg) return ['配置未加载'];
        var text = zhTextStats();
        var media = zhMediaStats();
        var vision = zhVisionCfg();
        if (!zhCfg.apiKey) problems.push('未配置 API Key，不会发任何请求');
        var urlWarn = zhApiAddressWarning(zhCfg.baseUrl);
        if (urlWarn) problems.push('文字接口地址可疑：' + urlWarn);
        if (zhCfg.visionBaseUrl) {
            var vWarn = zhApiAddressWarning(zhCfg.visionBaseUrl);
            if (vWarn) problems.push('视觉接口地址可疑：' + vWarn);
        }
        var modelWarn = zhModelWarning(zhCfg.model);
        if (modelWarn) problems.push('文字模型可疑：' + modelWarn);
        var vModelWarn = zhModelWarning(zhCfg.visionModel);
        if (vModelWarn) problems.push('视觉模型可疑：' + vModelWarn);
        if (zhRate.minInterval > ZH_BASE_INTERVAL) {
            problems.push('限流自适应中：请求间隔已提高到 ' + zhRate.minInterval + 'ms（会自动恢复）');
        }
        if (zhCfg.apiKey && text.candidatesEligible > 0 && text.translatedBlocks === 0) {
            problems.push('有 ' + text.candidatesEligible + ' 段可翻译文本但还没有译文块：检查 Key/模型/网络，或点「测试连接」');
        }
        if (text.failed > 0) problems.push(text.failed + ' 段文本翻译失败：点「重试失败项」');
        if (zhStats.imgFailed > 0) problems.push(zhStats.imgFailed + ' 张图片/视频封面翻译失败：点「重试失败项」');
        if (media.imageOrphans + media.videoOrphans > 0) {
            problems.push((media.imageOrphans + media.videoOrphans) + ' 个媒体译文块被 X 重渲染删掉，下次扫描会用缓存补回');
        }
        if (media.imageBlocksClipped > 0) problems.push(media.imageBlocksClipped + ' 个媒体译文块尺寸为 0（可能被容器裁切）');
        if (zhCfg.apiKey && media.videoWithPoster > 0 && media.videoDone === 0 && media.videoOrphans === 0 && !vision) {
            problems.push('检测到 ' + media.videoWithPoster + ' 个视频封面但未翻译：确认「视觉模型」支持图片');
        }
        if (!problems.length) problems.push('未发现明显问题');
        return problems;
    }

    function zhSelfCheckCached() {
        var now = Date.now();
        if (now - zhSelfCheckAt < 800) return zhSelfCheckCache;
        zhSelfCheckAt = now;
        zhSelfCheckCache = zhSelfCheck();
        return zhSelfCheckCache;
    }

    function zhDiagnostics() {
        var effectiveVision = zhVisionCfg();
        return {
            version: VERSION,
            time: new Date().toISOString(),
            host: (typeof location !== 'undefined' && location.hostname) || '',
            config: {
                enabled: !!(zhCfg && zhCfg.enabled),
                mode: zhCfg ? zhCfg.mode : '',
                imgMode: zhCfg ? (zhCfg.imgMode || 'auto') : '',
                baseUrl: zhCfg ? zhCfg.baseUrl : '',
                model: zhCfg ? zhCfg.model : '',
                apiKey: zhMaskKey(zhCfg && zhCfg.apiKey),
                visionBaseUrl: zhCfg ? (zhCfg.visionBaseUrl || '(沿用)') : '',
                visionModel: zhCfg ? (zhCfg.visionModel || '(沿用文字模型)') : '',
                visionApiKey: zhMaskKey(zhCfg && (zhCfg.visionApiKey || zhCfg.apiKey)),
                effectiveVisionModel: effectiveVision ? effectiveVision.model : '(未配置)'
            },
            stats: {
                textApplied: zhStats.applied, textFailed: zhStats.failed, requests: zhStats.requests,
                retries: zhStats.retries || 0, imgApplied: zhStats.imgApplied, imgFailed: zhStats.imgFailed,
                imgRequests: zhStats.imgRequests, imgNoText: zhStats.imgNoText,
                lastAttemptUrl: zhStats.lastAttemptUrl || '', lastError: zhStats.lastError || ''
            },
            rate: {
                adaptive: zhAdaptive,
                interval: zhRate.minInterval,
                cooldown: Math.max(0, zhRate.cooldownUntil - Date.now())
            },
            queues: { text: zhQueue.length, image: zhImgQueue.length, textInFlight: zhInFlight, imageInFlight: zhImgInFlight },
            text: zhTextStats(),
            media: zhMediaStats(),
            ui: { records: zhUiRecords.length },
            cache: { total: zhCache ? Object.keys(zhCache).length : 0 },
            problems: zhSelfCheck(),
            recent: zhDebugLog.slice(-30)
        };
    }

    function zhDiagnosticsText(report) {
        var r = report || zhDiagnostics();
        var lines = [];
        lines.push('[twdl 汉化诊断] 版本 ' + r.version + ' · ' + r.time);
        lines.push('页面：' + r.host + ' · 配置 ' + (r.config.enabled ? '已开启' : '已关闭') +
            ' · 范围 ' + r.config.mode + ' · 图片 ' + r.config.imgMode);
        lines.push('文字：' + r.config.baseUrl + ' ｜ 模型 ' + r.config.model + ' ｜ Key ' + r.config.apiKey);
        lines.push('视觉：' + r.config.effectiveVisionModel + ' ｜ 地址 ' + (r.config.visionBaseUrl || '(沿用)') +
            ' ｜ Key ' + r.config.visionApiKey);
        lines.push('统计：文本 已译 ' + r.stats.textApplied + ' / 失败 ' + r.stats.textFailed +
            ' · 请求 ' + r.stats.requests + ' 次（退避重试 ' + r.stats.retries + ' 次）');
        lines.push('媒体：图片/视频封面 已译 ' + r.stats.imgApplied + ' / 失败 ' + r.stats.imgFailed +
            ' / 无文字 ' + r.stats.imgNoText + ' · 请求 ' + r.stats.imgRequests + ' 次');
        lines.push('限速：自适应 ' + (r.rate.adaptive ? '开' : '关') + ' · 间隔 ' + r.rate.interval + 'ms' +
            (r.rate.cooldown ? ' · 冷却剩余 ' + r.rate.cooldown + 'ms' : ''));
        lines.push('文本 DOM：候选 ' + r.text.candidatesRaw + '（可翻 ' + r.text.candidatesEligible + '）' +
            ' · 译文块 ' + r.text.translatedBlocks + ' · 失败标记 ' + r.text.failed);
        lines.push('媒体 DOM：图片候选 ' + r.media.imageCandidates + '（可译 ' + r.media.imageEligible +
            '，跳过正则 ' + r.media.imageSkippedRegex + '，小图 ' + r.media.imageSkippedSmall + '）');
        lines.push('          已渲染块 ' + r.media.imageBlocks + '（可见 ' + r.media.imageBlocksVisible +
            '，疑似裁切 ' + r.media.imageBlocksClipped + '）· 孤儿块 ' + (r.media.imageOrphans + r.media.videoOrphans));
        lines.push('视频：播放器 ' + r.media.videoPlayers + ' · 有封面 ' + r.media.videoWithPoster +
            ' · 已译块 ' + r.media.videoBlocks + ' · 孤儿 ' + r.media.videoOrphans);
        lines.push('缓存 ' + r.cache.total + ' 条 · 界面译文记录 ' + r.ui.records + ' 条 · 队列 文本 ' +
            r.queues.text + '/图片 ' + r.queues.image);
        if (r.stats.lastAttemptUrl) lines.push('上次请求：' + r.stats.lastAttemptUrl);
        if (r.problems && r.problems.length) {
            lines.push('自检结论：');
            for (var p = 0; p < r.problems.length; p++) lines.push(' - ' + r.problems[p]);
        }
        lines.push('最近事件：');
        for (var i = Math.max(0, r.recent.length - 12); i < r.recent.length; i++) {
            var ev = r.recent[i];
            var time = '';
            try { time = new Date(ev.t).toTimeString().slice(0, 8); } catch (e) { time = ''; }
            lines.push(' · ' + time + ' ' + ev.kind +
                (ev.detail ? ' ' + JSON.stringify(ev.detail).slice(0, 160) : ''));
        }
        return lines.join('\n');
    }

    function zhShowDiagnostics() {
        var stat = document.getElementById('twdl-zh-stat');
        var report = zhDiagnostics();
        var text = zhDiagnosticsText(report);
        if (stat) stat.textContent = text;
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
            } else if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text);
            }
        } catch (e) { /* 剪贴板失败不影响展示 */ }
        zhLog('diagnostics', { problems: report.problems });
        return report;
    }

    /* 调试 / 测试入口（test/zh-test.html 会直接调用这些） */
    var zhApi = {
        boot: zhBoot,
        scan: zhScan,
        flush: zhProcessQueue,
        configure: function (partial) {
            if (!zhCfg) zhCfg = zhLoadCfg();
            if (!zhCache) zhCache = zhLoadCache();
            if (partial && typeof partial === 'object') {
                Object.keys(partial).forEach(function (key) { zhCfg[key] = partial[key]; });
                zhSaveCfg();
            }
            zhUpdatePill();
            return zhCfg;
        },
        state: function () {
            var safeCfg = null;
            if (zhCfg) {
                safeCfg = {};
                Object.keys(zhCfg).forEach(function (key) {
                    safeCfg[key] = (key === 'apiKey' || key === 'visionApiKey') ? zhMaskKey(zhCfg[key]) : zhCfg[key];
                });
            }
            return {
                cfg: safeCfg,
                stats: zhStats,
                queue: zhQueue.length,
                imgQueue: zhImgQueue.length,
                cacheSize: zhCache ? Object.keys(zhCache).length : 0,
                blocks: document.querySelectorAll('.twdl-zh-block').length,
                imgBlocks: document.querySelectorAll('.twdl-zh-imgblock').length,
                uiRecords: zhUiRecords.length
            };
        },
        setShowOriginal: zhSetShowOriginal,
        clearCache: function () { zhCache = {}; zhSaveCache(); zhUpdatePill(); },
        clearFailed: zhClearFailed,
        request: zhRequest,
        applyUi: function () { zhApplyUiState(true); },
        scanImages: zhScanImages,
        translateImage: zhImgTranslate,
        apiWarning: zhApiAddressWarning,
        modelWarning: zhModelWarning,
        hasLetters: zhHasLetters,
        /* 仅供测试/调试调参：请求间隔、退避基数、重试次数 */
        tune: function (opts) {
            if (!opts) return;
            if (typeof opts.minIntervalMs === 'number') { ZH_MIN_INTERVAL = opts.minIntervalMs; zhRate.minInterval = opts.minIntervalMs; }
            if (typeof opts.retryBaseMs === 'number') ZH_RETRY_BASE = opts.retryBaseMs;
            if (typeof opts.retryMax === 'number') ZH_RETRY_MAX = opts.retryMax;
            if (typeof opts.adaptive === 'boolean') zhAdaptive = opts.adaptive;
            if (typeof opts.imgMaxSide === 'number') ZH_IMG_MAX_SIDE = opts.imgMaxSide;
            if (typeof opts.imgMaxPerScan === 'number') ZH_IMG_MAX_PER_SCAN = opts.imgMaxPerScan;
        },
        rate: function () {
            return { minInterval: zhRate.minInterval, cooldownUntil: zhRate.cooldownUntil, adaptive: zhAdaptive };
        },
        diagnostics: zhDiagnostics,
        diagnosticsText: zhDiagnosticsText,
        selfCheck: zhSelfCheck,
        showDiagnostics: zhShowDiagnostics,
        debugLog: function () { return zhDebugLog.slice(); },
        noteRateLimit: zhNoteRateLimit,
        dict: ZH_UI_DICT
    };

    /* -----------------------------------------------------------------
     * 14. 启动
     * ----------------------------------------------------------------- */
    function boot() {
        injectStyle();

        if (onDownloaderPage()) {
            tryAutofill(12);
            return;
        }

        if (!/(^|\.)(x|twitter)\.com$/i.test(window.location.hostname)) return;

        scheduleTwdl(0);
        startObserver();
        hookNavigation();
        zhBoot();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    window.addEventListener('load', function () { scheduleTwdl(300); });

    /* 调试入口：控制台里 __twdl.twdl_url(cell) / __twdl.zh.state() 等可直接用。
       因为 v0.2.0 起脚本带 @grant 授权、可能跑在管理器沙箱里，所以同时写到
       unsafeWindow（页面控制台可见）和 window。 */
    try {
        var twdlDebug = {
            version: VERSION,
            twdl: twdl,
            scheduleTwdl: scheduleTwdl,
            twdl_url: twdl_url,
            userName: userName,
            get_imgsURL: get_imgsURL,
            getTwitterUrlFromHash: getTwitterUrlFromHash,
            fillAndClick: fillAndClick,
            inDownloaderPage: inDownloaderPage,
            snapvid_url: snapvid_url,
            tweeload_url: tweeload_url,
            textBlocks: textBlocks,
            zh: zhApi
        };
        window.__twdl = twdlDebug;
        if (PAGE_WINDOW && PAGE_WINDOW !== window) PAGE_WINDOW.__twdl = twdlDebug;
    } catch (e) { /* ignore */ }
})();
