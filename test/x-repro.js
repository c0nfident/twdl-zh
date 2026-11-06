/* 真实场景复现 + 脚本自我诊断验证
 *
 * 复刻用户遇到的场景：
 *  1) 图片推文：正文只有图片，图片在 position:relative + overflow:hidden 的容器里（旧版把块插容器外会被裁掉）
 *  2) 视频推文：X 用 video[poster]/amplify_video_thumb（旧版扫描器只认 img[src*=pbs.twimg.com/media]，完全忽略）
 *  3) 俄语推文 + 引用推文（非拉丁文字）
 *  4) 中文推文（不应翻译）
 * 然后用脚本内置的 __twdl.zh.diagnostics() 做自我诊断，验证：覆盖率统计、孤儿块识别、
 * 缓存补回、错误配置告警、429 退避，以及面板「诊断」按钮存在。
 */
(function () {
  'use strict';

  var logEl = document.getElementById('log');
  var diagEl = document.getElementById('diag');
  var lines = [];
  var failures = 0;
  var t0 = Date.now();
  var mockCalls = [];
  var mock429Once = false;
  var chatInFlight = 0;
  var chatMaxInFlight = 0;
  var concurrency429 = 0;

  function stamp() { return '+' + String(Date.now() - t0).padStart(4, ' ') + 'ms '; }
  function out(line) { lines.push(line); logEl.textContent = lines.join('\n'); }
  function note(line) { out('… ' + line); }
  function pass(name, detail) { out('PASS ' + name + (detail ? '  [' + detail + ']' : '')); }
  function fail(name, detail) { failures += 1; out('FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
  function check(name, cond, detail) { if (cond) pass(name, detail); else fail(name, detail); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(fn, timeout) {
    var end = Date.now() + (timeout || 6000);
    return new Promise(function (resolve) {
      (function poll() {
        var value = null;
        try { value = fn(); } catch (e) { value = null; }
        if (value) { resolve(value); return; }
        if (Date.now() > end) { resolve(null); return; }
        setTimeout(poll, 15);
      })();
    });
  }

  /* ---------- 假 X 页面结构对应的选择器 ---------- */
  var PHOTO_CELL = 'tweetPhotoFr';
  var VIDEO_CELL = 'tweetVideoFr';
  var RU_CELL = 'tweetRu';
  var ZH_CELL = 'tweetZh';

  function cell(id) { return document.getElementById(id); }
  function blockAfter(el) {
    if (!el) return null;
    var next = el.nextElementSibling;
    if (next && next.classList && next.classList.contains('twdl-zh-block')) return next;
    return null;
  }
  function textElOf(cellEl, lang) {
    return cellEl ? cellEl.querySelector('.x-text[lang="' + lang + '"]') : null;
  }

  /* ---------- 模拟 GM 传输层（不联网），并记录请求 ---------- */
  function installMockTransport() {
    var store = {};
    window.GM_getValue = function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
    };
    window.GM_setValue = function (key, value) { store[key] = value; };
    window.GM_deleteValue = function (key) { delete store[key]; };

    function replyText(texts) {
      var arr = texts.map(function (t) { return '【中】' + t; });
      return { choices: [{ message: { content: JSON.stringify(arr) } }] };
    }
    function replyVision() {
      return { choices: [{ message: { content: '【译文】图中文字：SOUS LA COUPOLE DU PARLEMENT' } }] };
    }

    window.GM_xmlhttpRequest = function (opts) {
      var url = String(opts.url || '');
      mockCalls.push({ url: url, body: opts.data || '', method: opts.method || 'GET' });
      setTimeout(function () {
        try {
          if (opts.responseType === 'arraybuffer' || opts.method === 'GET') {
            var bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
            if (opts.onload) opts.onload({ status: 200, responseHeaders: 'content-type: image/png', response: bytes.buffer });
            return;
          }
          if (mock429Once) {
            mock429Once = false;
            if (opts.onload) {
              opts.onload({
                status: 429,
                responseHeaders: 'retry-after: 0\r\n',
                responseText: JSON.stringify({
                  error: {
                    type: 'rate_limit_reached_error',
                    message: 'Your account org-repro<ak-repro> request reached TPM rate limit, current:32000, limit:32000'
                  }
                })
              });
            }
            return;
          }
          /* 真实账户组织并发 = 1：两个请求同时在飞就直接 429（验证全局串行门） */
          chatInFlight += 1;
          if (chatInFlight > chatMaxInFlight) chatMaxInFlight = chatInFlight;
          if (chatInFlight > 1) {
            chatInFlight -= 1;
            concurrency429 += 1;
            if (opts.onload) {
              opts.onload({
                status: 429,
                responseHeaders: 'retry-after: 0\r\n',
                responseText: JSON.stringify({
                  error: {
                    type: 'rate_limit_reached_error',
                    message: 'Your account org-repro<ak-repro> request reached max organization concurrency: 1'
                  }
                })
              });
            }
            return;
          }
          var body = JSON.parse(opts.data || '{}');
          var content = body.messages && body.messages[1] && body.messages[1].content;
          var payload = Array.isArray(content) ? replyVision() : replyText(JSON.parse(content || '[]'));
          chatInFlight -= 1;
          if (opts.onload) opts.onload({ status: 200, responseHeaders: 'content-type: application/json', responseText: JSON.stringify(payload) });
        } catch (e) {
          if (opts.onerror) opts.onerror(e);
        }
      }, 12);
    };
  }

  function chatCalls() {
    return mockCalls.filter(function (c) { return c.url.indexOf('/chat/completions') !== -1; }).length;
  }

  async function run() {
    var zh = window.__twdl && window.__twdl.zh;
    if (!zh) { fail('脚本加载', '__twdl.zh 不存在'); return; }

    installMockTransport();
    zh.boot();
    /* 真实运行时是 700ms 间隔 + 自适应，这里为复现提速；自适应逻辑后面单独验证 */
    zh.tune({ minIntervalMs: 0, retryBaseMs: 5, retryMax: 2, adaptive: false, imgMaxSide: 0, imgMaxPerScan: 24 });
    zh.configure({
      enabled: true, mode: 'content', imgMode: 'auto',
      baseUrl: 'https://api.test/v1', model: 'kimi-k3', apiKey: 'test-key',
      visionBaseUrl: '', visionModel: '', visionApiKey: ''
    });
    zh.scan();

    /* 1) 文本翻译（俄语正主 + 引用推文；中文不翻） */
    var ruCell = cell(RU_CELL);
    var ruTexts = ruCell ? ruCell.querySelectorAll('.x-text[lang="ru"]') : [];
    var ruMainBlock = await waitFor(function () { return ruTexts[0] ? blockAfter(ruTexts[0]) : null; }, 6000);
    var ruQuoteBlock = await waitFor(function () { return ruTexts[1] ? blockAfter(ruTexts[1]) : null; }, 6000);
    check('俄语推文已翻译（西里尔字母不再被跳过）', !!ruMainBlock,
      ruMainBlock ? ruMainBlock.textContent.slice(0, 40) : 'no block');
    check('引用推文文本已翻译', !!ruQuoteBlock, ruQuoteBlock ? ruQuoteBlock.textContent.slice(0, 40) : 'no block');
    var zhCell = cell(ZH_CELL);
    var zhTextEl = zhCell ? zhCell.querySelector('.x-text[lang="zh"]') : null;
    check('中文推文不翻译', !blockAfter(zhTextEl));

    /* 2) 图片推文：译文块必须是媒体容器内的浮层，且真的有尺寸（旧版挂容器外会被裁掉） */
    var photo = cell(PHOTO_CELL) ? cell(PHOTO_CELL).querySelector('[data-testid="tweetPhoto"]') : null;
    var imgBlock = await waitFor(function () {
      return photo ? photo.querySelector('.twdl-zh-imgblock[data-state="ok"]') : null;
    }, 8000);
    var imgRect = imgBlock && imgBlock.getBoundingClientRect ? imgBlock.getBoundingClientRect() : null;
    check('图片推文：译文块已生成并浮在 tweetPhoto 内',
      !!imgBlock && imgBlock.parentElement === photo && imgBlock.getAttribute('data-overlay') === '1',
      imgBlock ? 'parent=' + (imgBlock.parentElement && imgBlock.parentElement.getAttribute('data-testid')) : 'no block');
    check('图片译文浮层真实可见（尺寸 > 0，不被 overflow 裁切）',
      !!imgRect && imgRect.width > 4 && imgRect.height > 4,
      imgRect ? Math.round(imgRect.width) + 'x' + Math.round(imgRect.height) : 'no rect');

    /* 3) 视频推文：旧版完全没有入口，这里应能翻译封面帧 */
    var videoPlayer = cell(VIDEO_CELL) ? cell(VIDEO_CELL).querySelector('[data-testid="videoPlayer"]') : null;
    var videoBlock = await waitFor(function () {
      return videoPlayer ? videoPlayer.querySelector('.twdl-zh-imgblock[data-state="ok"]') : null;
    }, 8000);
    check('视频推文：封面帧文字已翻译（旧版直接忽略 amplify_video_thumb）',
      !!videoBlock, videoBlock ? videoBlock.textContent.slice(0, 40) : 'no block');
    check('视频译文浮层挂在播放器容器内',
      !!videoBlock && videoBlock.parentElement === videoPlayer && videoBlock.getAttribute('data-overlay') === '1',
      videoBlock ? 'parent=' + (videoBlock.parentElement && videoBlock.parentElement.getAttribute('data-testid')) : 'no block');

    /* 3.5) 组织并发 = 1 的真实约束：文字与图片请求必须被串行门排队 */
    check('并发=1 账户：文字+图片混合请求未触发 429（全局串行门）',
      concurrency429 === 0 && chatMaxInFlight === 1,
      'concurrency429=' + concurrency429 + ' maxInFlight=' + chatMaxInFlight);

    /* 4) 自我诊断：结构化报告要能反映真实覆盖率 */
    var report = zh.diagnostics();
    check('诊断报告结构完整（version/config/stats/text/media/problems/recent）',
      !!report && !!report.version && !!report.config && !!report.stats && !!report.text &&
      !!report.media && Array.isArray(report.problems) && Array.isArray(report.recent),
      report ? ('v=' + report.version + ' problems=' + report.problems.length) : 'no report');
    check('诊断统计与页面一致（文本块 ≥2、媒体候选 ≥1、视频封面 ≥1）',
      report.text.translatedBlocks >= 2 && report.media.imageCandidates >= 1 && report.media.videoWithPoster >= 1,
      'text=' + report.text.translatedBlocks + ' img=' + report.media.imageCandidates + ' video=' + report.media.videoWithPoster);
    check('面板存在「诊断」按钮', !!document.getElementById('twdl-zh-diag'));
    var diagText = zh.diagnosticsText(report);
    check('诊断文本包含版本/自检结论/最近事件',
      diagText.indexOf('版本') !== -1 && diagText.indexOf('自检结论') !== -1 && diagText.indexOf('最近事件') !== -1);

    /* 5) 自我诊断能发现"译文块被 X 重渲染删掉"（孤儿块），并靠缓存补回、不重发请求 */
    imgBlock.parentNode.removeChild(imgBlock);
    var orphanReport = zh.diagnostics();
    var orphanProblem = orphanReport.problems.some(function (p) { return p.indexOf('重渲染') !== -1; });
    check('诊断能发现孤儿译文块（被 X 重渲染删除）',
      orphanReport.media.imageOrphans >= 1 && orphanProblem,
      'orphans=' + orphanReport.media.imageOrphans + ' problems=' + orphanReport.problems.join(' | ').slice(0, 80));
    var callsBeforeRemount = chatCalls();
    zh.scanImages();
    var remounted = await waitFor(function () { return photo.querySelector('.twdl-zh-imgblock'); }, 5000);
    var callsAfterRemount = chatCalls();
    check('下次扫描自动补回译文块（走缓存，不重复消耗请求）',
      !!remounted && callsAfterRemount === callsBeforeRemount,
      'remounted=' + !!remounted + ' calls=' + callsBeforeRemount + '->' + callsAfterRemount);

    /* 6) 自我诊断能识别"控制台页面当 API 地址"这类错误配置 */
    var goodBase = zh.state().cfg.baseUrl;
    zh.configure({ baseUrl: 'https://platform.kimi.com/console/account' });
    var badProblems = zh.selfCheck();
    var hasConsoleWarn = badProblems.some(function (p) { return p.indexOf('控制台') !== -1; });
    check('诊断能识别错误配置（控制台页面当 API 地址）', hasConsoleWarn,
      badProblems.join(' | ').slice(0, 100));
    zh.configure({ baseUrl: goodBase });

    /* 7) 429：自动退避重试 + 记录日志（真实使用中自适应会拉大间隔） */
    mock429Once = true;
    var callsBefore429 = chatCalls();
    var retryOk = true;
    try {
      await zh.request({ baseUrl: 'https://api.test/v1', model: 'kimi-k3', apiKey: 'test-key' }, ['retry me']);
    } catch (e) {
      retryOk = false;
      out('… 429 重试后仍失败：' + (e && e.message));
    }
    check('429 限速会自动退避重试并成功', retryOk && chatCalls() === callsBefore429 + 2,
      'calls=' + callsBefore429 + '->' + chatCalls());
    var hasRetryLog = zh.debugLog().some(function (ev) { return ev.kind === 'api.retry'; });
    check('自检日志记录退避重试事件（api.retry）', hasRetryLog);

    /* 8) 自适应降速逻辑：触发一次限速后请求间隔应自动拉大 */
    zh.tune({ adaptive: true });
    zh.noteRateLimit(0);
    check('限速后自适应拉大请求间隔（≥2s）', zh.rate().minInterval >= 2000,
      'interval=' + zh.rate().minInterval + 'ms');
    zh.tune({ adaptive: false, minIntervalMs: 0 });

    /* 9) 面板自检摘要（zhUpdatePill 会显示首条问题/状态） */
    zh.scan();
    await sleep(60);
    var statEl = document.getElementById('twdl-zh-stat');
    check('面板状态区可渲染（含自检/上次请求等信息）',
      !!statEl && statEl.textContent.length > 0 && (statEl.textContent.indexOf('状态：') !== -1),
      statEl ? statEl.textContent.split('\n').slice(0, 2).join(' / ') : 'no stat');

    /* 收尾：输出完整诊断报告 */
    var finalReport = zh.diagnostics();
    diagEl.textContent = zh.diagnosticsText(finalReport);
    out('');
    out(failures === 0 ? '结论: 全部通过' : ('结论: 有 ' + failures + ' 项失败'));
    out('— 复现覆盖：图片推文 / 视频推文封面 / 俄语文本 / 引用推文 / 中文跳过 / 孤儿块自愈 / 错误配置识别 / 429 退避 —');
  }

  var kick = function () {
    note('加载脚本 + 安装假传输层，开始复现…');
    run().catch(function (e) {
      fail('复现流程异常', e && e.message ? e.message : String(e));
      out('结论: 有异常');
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(kick, 50); });
  } else {
    setTimeout(kick, 50);
  }
})();
