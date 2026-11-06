/* 汉化模块（v0.2.0-zh.1）行为测试。
   模拟：OpenAI 兼容接口返回、X 页面文本块、界面文案词典、原文切换。
   注意：这里不联网——window.fetch 被替换成 mock。 */
(function () {
  var logEl = document.getElementById('log');
  var lines = [];
  var fetchCalls = [];
  var chatInFlight = 0, chatMaxInFlight = 0, mockDelayMs = 0;
  var mockMode = 'ok';   // ok | http401 | reject

  function render() { logEl.textContent = lines.join('\n'); }
  function ok(name, cond, extra) {
    lines.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined && extra !== '' ? '   [' + extra + ']' : ''));
    render();
  }
  function note(text) { lines.push('----  ' + text); render(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function waitFor(fn, timeout) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var value = null;
        try { value = fn(); } catch (e) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - t0 > (timeout || 5000)) return resolve(null);
        setTimeout(poll, 15);
      })();
    });
  }
  function click(el) {
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function okImageResponse(content) {
    var payload = { choices: [{ message: { content: content } }] };
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(payload)); } });
  }

  function html404Response() {
    return Promise.resolve({
      ok: false,
      status: 404,
      text: function () {
        return Promise.resolve('<!DOCTYPE html><html lang="zh-CN" dir="ltr"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"></head>' +
          '<body><h1>404</h1></body></html>');
      }
    });
  }

  /* 返回 true 的 URL 一律回 HTML 404（模拟"把网站首页/完整接口填进 API 地址"） */
  var html404Matcher = null;
  function setHtml404Matcher(fn) { html404Matcher = fn; }

  /* 返回 true 的 URL 回「模型不存在」JSON 404（模拟把品牌名 kimi 当模型 ID） */
  var model404Matcher = null;
  function setModel404Matcher(fn) { model404Matcher = fn; }
  function model404Response() {
    return Promise.resolve({
      ok: false,
      status: 404,
      text: function () {
        return Promise.resolve(JSON.stringify({
          error: {
            message: 'Not found the model kimi or Permission denied',
            type: 'resource_not_found_error'
          }
        }));
      }
    });
  }

  /* 429 模拟：fn(url, count) 返回 null 或 {type, message, retryAfter} */
  var rateLimit429Fn = null;
  var rateLimit429Count = 0;
  function setRateLimit429(fn) { rateLimit429Fn = fn; rateLimit429Count = 0; }
  function rateLimit429Response(type, message, retryAfter) {
    return Promise.resolve({
      ok: false,
      status: 429,
      headers: {
        get: function (name) {
          return String(name).toLowerCase() === 'retry-after' ? String(retryAfter || 0) : '';
        }
      },
      text: function () {
        return Promise.resolve(JSON.stringify({ error: { type: type, message: message } }));
      }
    });
  }

  function installFetchMock() {    window.fetch = function (url, opts) {
      var urlStr = String(url);
      fetchCalls.push({ url: urlStr, opts: opts || {} });
      if (mockMode === 'reject') return Promise.reject(new Error('mock 网络中断'));

      /* 图片下载（zhImageToDataUrl 用 fetch 拉 pbs.twimg.com） */
      if (urlStr.indexOf('pbs.twimg.com') !== -1) {
        var tag = /IMG2/.test(urlStr) ? 'IMG2' : (/IMG3/.test(urlStr) ? 'IMG3' : 'IMG1');
        var bytes = new Uint8Array(4);
        for (var i = 0; i < 4; i++) bytes[i] = tag.charCodeAt(i);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: function () { return 'image/png'; } },
          arrayBuffer: function () { return Promise.resolve(bytes.buffer); },
          text: function () { return Promise.resolve(''); }
        });
      }

      if (html404Matcher && html404Matcher(urlStr)) return html404Response();
      if (model404Matcher && model404Matcher(urlStr)) return model404Response();
      if (rateLimit429Fn) {
        var rl = rateLimit429Fn(urlStr, rateLimit429Count);
        if (rl) {
          rateLimit429Count += 1;
          return rateLimit429Response(rl.type, rl.message, rl.retryAfter);
        }
      }

      if (mockMode === 'http401') {
        return Promise.resolve({ ok: false, status: 401, text: function () { return Promise.resolve('Unauthorized'); } });
      }

      var body = {};
      try { body = JSON.parse(opts.body); } catch (e) { body = {}; }
      var contentPart = body.messages && body.messages[1] && body.messages[1].content;

      /* 视觉请求：content 是数组（image_url + text，官方示例图片在前） */
      if (Array.isArray(contentPart)) {
        var imageUrl = '';
        for (var pi = 0; pi < contentPart.length; pi++) {
          if (contentPart[pi] && contentPart[pi].type === 'image_url' && contentPart[pi].image_url) {
            imageUrl = contentPart[pi].image_url.url || '';
            break;
          }
        }
        if (imageUrl.indexOf('SU1HMg==') !== -1) return okImageResponse('NO_TEXT');       // IMG2：纯图片
        if (imageUrl.indexOf('SU1HMw==') !== -1) return okImageResponse('【图译3】第三张图的文字');  // IMG3
        return okImageResponse('【图译】图中文字：STOCK MARKET SUFFERED ONE OF THE WORST DAYS');
      }

      var texts = [];
      try { texts = JSON.parse(contentPart); } catch (e) { texts = []; }
      var translations = texts.map(function (t) { return '【中】' + t; });
      return okImageResponse(JSON.stringify(translations));
    };

    /* 并发追踪：模拟"组织并发=1"的低等级账户，用来验证全局串行门 */
    var baseFetch = window.fetch;
    window.fetch = function (url, opts) {
      var isChat = String(url).indexOf('/chat/completions') !== -1;
      if (!isChat) return baseFetch(url, opts);
      chatInFlight += 1;
      if (chatInFlight > chatMaxInFlight) chatMaxInFlight = chatInFlight;
      return baseFetch(url, opts).then(function (resp) {
        if (mockDelayMs > 0) {
          return new Promise(function (resolve) {
            setTimeout(function () { chatInFlight -= 1; resolve(resp); }, mockDelayMs);
          });
        }
        chatInFlight -= 1;
        return resp;
      }, function (err) { chatInFlight -= 1; throw err; });
    };
  }

  function makeImageCell(id, tag) {
    var cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    cell.id = id;
    var photo = document.createElement('div');
    photo.setAttribute('data-testid', 'tweetPhoto');
    var img = document.createElement('img');
    img.setAttribute('src', 'https://pbs.twimg.com/media/' + tag + '?format=png&name=small');
    img.setAttribute('alt', tag);
    photo.appendChild(img);
    cell.appendChild(photo);
    document.getElementById('fakeX').appendChild(cell);
    return cell;
  }

  /* 视频推文：X 用 video[poster] / amplify_video_thumb 封面，不是 img[src*='pbs.twimg.com/media'] */
  function makeVideoCell(id, tag) {
    var cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    cell.id = id;
    var player = document.createElement('div');
    player.setAttribute('data-testid', 'videoPlayer');
    player.style.width = '640px';
    player.style.height = '360px';
    var video = document.createElement('video');
    video.setAttribute('poster', 'https://pbs.twimg.com/amplify_video_thumb/' + tag + '?format=jpg&name=small');
    player.appendChild(video);
    cell.appendChild(player);
    document.getElementById('fakeX').appendChild(cell);
    return cell;
  }

  function makeCell(id, lang, text) {
    var cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    cell.id = id;
    var body = document.createElement('div');
    body.setAttribute('dir', 'auto');
    body.setAttribute('lang', lang);
    var span = document.createElement('span');
    span.textContent = text;
    body.appendChild(span);
    cell.appendChild(body);
    document.getElementById('fakeX').appendChild(cell);
    return cell;
  }
  function textElOf(cell) { return cell.querySelector('[dir="auto"][lang]'); }
  function blockOf(el) {
    if (!el) return null;
    var next = el.nextElementSibling;
    return (next && next.classList && next.classList.contains('twdl-zh-block')) ? next : null;
  }
  function zhTextOf(block) {
    var t = block && block.querySelector('.twdl-zh-text');
    return t ? t.textContent : '';
  }

  (async function () {
    try {
      var ready = await waitFor(function () { return window.__twdl && window.__twdl.zh; }, 4000);
      ok('userscript 已加载并暴露 __twdl.zh', !!ready, window.__twdl && window.__twdl.version);
      if (!ready) return;

      installFetchMock();
      var zh = window.__twdl.zh;
      zh.boot();
      /* 测试里关闭请求节流/降采样、缩短退避（真实使用时是 700ms / 2s 起） */
      zh.tune({ minIntervalMs: 0, retryBaseMs: 5, retryMax: 3, adaptive: false, imgMaxSide: 0, imgMaxPerScan: 24 });
      ok('悬浮按钮 + 设置面板已创建',
        !!document.getElementById('twdl-zh-toggle') && !!document.getElementById('twdl-zh-panel'));
      ok('默认 API 地址是 DeepSeek 兼容端点', zh.state().cfg.baseUrl.indexOf('api.deepseek.com') !== -1,
        zh.state().cfg.baseUrl);

      /* ---------- 1. 没有 Key 时不发请求 ---------- */
      zh.configure({ apiKey: '', enabled: true, mode: 'content' });
      zh.scan();
      await sleep(15);
      ok('未配置 Key 时不调用接口', fetchCalls.length === 0, 'calls=' + fetchCalls.length);
      ok('未配置 Key 时悬浮按钮是灰色未就绪态',
        document.getElementById('twdl-zh-toggle').classList.contains('twdl-zh-off'));

      /* ---------- 2. 配置 Key 后翻译内容 ---------- */
      zh.configure({ apiKey: 'test-key', baseUrl: 'https://api.test/v1', model: 'test-model', enabled: true, mode: 'content' });
      zh.scan();
      await waitFor(function () { return document.querySelectorAll('.twdl-zh-block').length >= 2 ? true : null; }, 6000);

      var cellA = document.getElementById('cellA');
      var textEls = cellA.querySelectorAll('[dir="auto"][lang]');
      var src1 = textEls[0];
      var src2 = textEls[1];
      var block1 = blockOf(src1);
      var block2 = blockOf(src2);

      ok('英文推文出现译文块（正文 + 引用 2 段）', !!block1 && !!block2,
        'blocks=' + document.querySelectorAll('.twdl-zh-block').length);
      ok('译文内容正确', zhTextOf(block1).indexOf('【中】Hello world') === 0, zhTextOf(block1));
      ok('原文元素被隐藏', src1.style.display === 'none', 'display=' + src1.style.display);
      ok('中文推文不翻译', !document.getElementById('cellB').querySelector('.twdl-zh-block'));
      ok('纯 URL 文本不翻译', !document.getElementById('cellC').querySelector('.twdl-zh-block'));

      var call0 = fetchCalls[0] || {};
      var body0 = {};
      try { body0 = JSON.parse(call0.opts.body); } catch (e) { body0 = {}; }
      var headers0 = call0.opts.headers || {};
      ok('请求打向 <baseUrl>/chat/completions', String(call0.url) === 'https://api.test/v1/chat/completions', call0.url);
      ok('请求带 Bearer Key', /^Bearer test-key$/.test(headers0.Authorization || ''), headers0.Authorization);
      ok('请求体是 OpenAI 兼容格式',
        body0.model === 'test-model' && body0.messages && body0.messages.length === 2, body0.model);
      ok('多条文本合并成 1 次请求', fetchCalls.length === 1, 'calls=' + fetchCalls.length);

      /* ---------- 3. 每条的「原」按钮 ---------- */
      var toggleBtn = block1.querySelector('.twdl-zh-orig');
      ok('译文块自带「原」按钮', !!toggleBtn && toggleBtn.textContent === '原', toggleBtn ? toggleBtn.textContent : '');
      click(toggleBtn);
      ok('点「原」后显示原文、隐藏译文',
        src1.style.display === '' && block1.style.display === 'none',
        'src=' + src1.style.display + ' block=' + block1.style.display);
      ok('点「原」后按钮变成「译」', toggleBtn.textContent === '译', toggleBtn.textContent);
      click(toggleBtn);
      ok('再点一次恢复译文', src1.style.display === 'none' && block1.style.display === '',
        'src=' + src1.style.display);

      /* ---------- 4. 转图用的文本提取跟随显示状态 ---------- */
      ok('textBlocks() 显示译文时返回译文',
        window.__twdl.textBlocks(cellA)[0].indexOf('【中】') === 0, window.__twdl.textBlocks(cellA)[0]);
      click(toggleBtn);
      ok('textBlocks() 切到原文时返回原文',
        window.__twdl.textBlocks(cellA)[0].indexOf('Hello world') === 0, window.__twdl.textBlocks(cellA)[0]);
      click(toggleBtn);

      /* ---------- 5. 动态新增推文批量请求 ---------- */
      var beforeCalls = fetchCalls.length;
      var cellD = makeCell('cellD', 'en', 'Second batch tweet number one.');
      var cellE = makeCell('cellE', 'en', 'Second batch tweet number two.');
      zh.scan();
      var added = await waitFor(function () {
        return blockOf(textElOf(cellD)) && blockOf(textElOf(cellE));
      }, 6000);
      ok('动态新增的推文被翻译', !!added);
      ok('新增两条合并成 1 次请求', fetchCalls.length - beforeCalls === 1, 'delta=' + (fetchCalls.length - beforeCalls));

      /* ---------- 6. 缓存 ---------- */
      var callsBeforeCache = fetchCalls.length;
      zh.scan();
      await sleep(15);
      ok('再次扫描命中缓存，不重复请求', fetchCalls.length === callsBeforeCache, 'calls=' + fetchCalls.length);
      ok('缓存条数 >= 4', zh.state().cacheSize >= 4, 'cache=' + zh.state().cacheSize);

      /* ---------- 7. 全局显示原文开关 ---------- */
      click(document.getElementById('twdl-zh-toggle'));
      ok('全局切换后 body 带 twdl-zh-orig 标记', document.body.classList.contains('twdl-zh-orig'));
      ok('全局切换后原文可见',
        src1.style.display === '' && textElOf(cellD).style.display === '');
      ok('全局切换后译文块隐藏', block1.style.display === 'none');
      ok('全局切换后悬浮按钮显示「原」',
        document.getElementById('twdl-zh-toggle').textContent === '原');
      click(document.getElementById('twdl-zh-toggle'));
      ok('再切一次回到译文',
        !document.body.classList.contains('twdl-zh-orig') &&
        src1.style.display === 'none' &&
        document.getElementById('twdl-zh-toggle').textContent === '译');

      /* ---------- 8. 没有 Key 时不翻译 ---------- */
      zh.configure({ apiKey: '' });
      var callsBeforeNoKey = fetchCalls.length;
      var cellF = makeCell('cellF', 'en', 'This tweet should not be sent to the API.');
      zh.scan();
      await sleep(15);
      ok('无 Key 时新推文不发请求',
        fetchCalls.length === callsBeforeNoKey, 'delta=' + (fetchCalls.length - callsBeforeNoKey));
      ok('无 Key 时新推文不产生译文块', !blockOf(textElOf(cellF)));
      /* 这条不删掉的话，恢复 Key 后自动扫描会把它补译，影响最后的块数断言。
         删掉让总数确定：A(2) + D(1) + E(1) + G(1) = 5。 */
      cellF.remove();

      /* ---------- 9. 接口报错 ---------- */
      zh.configure({ apiKey: 'test-key', baseUrl: 'https://api.test/v1', model: 'test-model' });
      mockMode = 'http401';
      var cellG = makeCell('cellG', 'en', 'This tweet will hit an HTTP 401 error.');
      zh.scan();
      var failed = await waitFor(function () { return zh.state().stats.failed > 0 ? true : null; }, 6000);
      ok('接口 401 时记录失败', !!failed, 'failed=' + zh.state().stats.failed);
      ok('面板状态里显示失败原因',
        (document.getElementById('twdl-zh-stat').textContent || '').indexOf('HTTP 401') !== -1,
        (document.getElementById('twdl-zh-stat').textContent || '').split('\n').pop());
      ok('失败项不产生译文块', !blockOf(textElOf(cellG)));

      var callsBeforeRetryScan = fetchCalls.length;
      zh.scan();
      await sleep(20);
      ok('失败项不会被自动反复重试',
        fetchCalls.length === callsBeforeRetryScan, 'delta=' + (fetchCalls.length - callsBeforeRetryScan));

      /* ---------- 10. 重试失败项 ---------- */
      mockMode = 'ok';
      zh.clearFailed();
      zh.scan();
      var retried = await waitFor(function () { return blockOf(textElOf(cellG)); }, 6000);
      ok('「重试失败项」后翻译成功', !!retried);

      /* ---------- 10.5 图片内文字翻译（v0.2.1） ---------- */
      mockMode = 'ok';
      zh.configure({
        imgMode: 'auto',
        visionModel: 'test-vision',
        visionBaseUrl: 'https://api.test/v1',
        visionApiKey: ''
      });

      var cellH = makeImageCell('cellH', 'IMG1');
      var callsBeforeImg = fetchCalls.length;
      zh.scanImages();
      var imgBlock = await waitFor(function () {
        var b = cellH.querySelector('.twdl-zh-imgblock[data-state="ok"]');
        return b ? b : null;
      }, 8000);
      ok('图片内文字被翻译（出现图片译文块）', !!imgBlock);
      ok('图片译文内容正确',
        !!imgBlock && imgBlock.querySelector('.twdl-zh-imgtext').textContent.indexOf('【图译】') === 0,
        imgBlock && imgBlock.querySelector('.twdl-zh-imgtext').textContent);

      var imgReq = null;
      for (var fi = callsBeforeImg; fi < fetchCalls.length; fi++) {
        var callItem = fetchCalls[fi];
        if (callItem.url.indexOf('/chat/completions') === -1) continue;
        var callBody = {};
        try { callBody = JSON.parse(callItem.opts.body); } catch (e) { callBody = {}; }
        if (callBody.messages && Array.isArray(callBody.messages[1].content)) { imgReq = callItem; break; }
      }
      var imgReqBody = {};
      try { imgReqBody = imgReq ? JSON.parse(imgReq.opts.body) : {}; } catch (e) { imgReqBody = {}; }
      var visionContent = (imgReqBody.messages && Array.isArray(imgReqBody.messages[1].content))
        ? imgReqBody.messages[1].content : [];
      var imagePart = null;
      for (var vpi = 0; vpi < visionContent.length; vpi++) {
        if (visionContent[vpi] && visionContent[vpi].type === 'image_url' && visionContent[vpi].image_url) {
          imagePart = visionContent[vpi];
          break;
        }
      }
      ok('图片请求发往视觉模型 + 使用 image_url 格式',
        !!imgReq && imgReqBody.model === 'test-vision' && !!imagePart && imagePart.type === 'image_url',
        imgReqBody.model);
      ok('视觉消息 content 为对象数组且图片在前、文字在后（按官方示例）',
        visionContent.length >= 2 &&
        visionContent[0] && visionContent[0].type === 'image_url' &&
        visionContent[1] && visionContent[1].type === 'text',
        visionContent.map(function (p) { return p && p.type; }).join(','));
      ok('图片以 base64 data URL 发送（不依赖服务商回源 twimg）',
        !!imagePart && /^data:image\/png;base64,/.test(imagePart.image_url.url),
        imagePart ? imagePart.image_url.url.slice(0, 32) : '');

      var imgTextEl = imgBlock ? imgBlock.querySelector('.twdl-zh-imgtext') : null;
      var imgToggleBtn = imgBlock ? imgBlock.querySelector('.twdl-zh-orig') : null;
      ok('图片译文块自带「原」按钮', !!imgToggleBtn && imgToggleBtn.textContent === '原',
        imgToggleBtn ? imgToggleBtn.textContent : '');
      click(imgToggleBtn);
      ok('点「原」隐藏图片译文',
        getComputedStyle(imgTextEl).display === 'none' && imgToggleBtn.textContent === '译',
        getComputedStyle(imgTextEl).display);
      click(imgToggleBtn);
      ok('再点恢复图片译文', getComputedStyle(imgTextEl).display !== 'none');

      var callsBeforeImgCache = fetchCalls.length;
      zh.scanImages();
      await sleep(20);
      ok('图片译文命中缓存，不重复请求', fetchCalls.length === callsBeforeImgCache,
        'delta=' + (fetchCalls.length - callsBeforeImgCache));

      /* 全局「原文」也要管图片译文块 */
      click(document.getElementById('twdl-zh-toggle'));
      ok('全局切原文时图片译文块也隐藏',
        getComputedStyle(cellH.querySelector('.twdl-zh-imgblock')).display === 'none');
      click(document.getElementById('twdl-zh-toggle'));
      ok('全局切回译文时图片译文块恢复',
        getComputedStyle(cellH.querySelector('.twdl-zh-imgblock')).display !== 'none');

      /* 纯图片（模型回 NO_TEXT）：不产生译文块 */
      var cellI = makeImageCell('cellI', 'IMG2');
      zh.scanImages();
      var noTextDone = await waitFor(function () {
        var im = cellI.querySelector('img');
        return (im && im.getAttribute('data-twdl-zhimg-done') === '1') ? true : null;
      }, 8000);
      ok('纯图片（NO_TEXT）处理完不产生译文块', !!noTextDone && !cellI.querySelector('.twdl-zh-imgblock'),
        'state=' + (cellI.querySelector('img') || {}).getAttribute);
      ok('NO_TEXT 计入统计', zh.state().stats.imgNoText >= 1, 'noText=' + zh.state().stats.imgNoText);

      /* 关闭图片翻译：不再处理新图 */
      zh.configure({ imgMode: 'off' });
      var cellJ = makeImageCell('cellJ', 'IMG5');
      var callsBeforeOff = fetchCalls.length;
      zh.scanImages();
      await sleep(15);
      ok('关闭图片翻译后不再处理新图片',
        fetchCalls.length === callsBeforeOff && !cellJ.querySelector('.twdl-zh-imgblock'),
        'delta=' + (fetchCalls.length - callsBeforeOff));
      zh.configure({ imgMode: 'auto' });
      cellJ.remove();   // 避免自动扫描把它排进队列，干扰下面的失败用例

      /* 视觉接口失败 + 重试 */
      mockMode = 'http401';
      var cellK = makeImageCell('cellK', 'IMG4');
      zh.scanImages();
      var imgFailed = await waitFor(function () { return zh.state().stats.imgFailed > 0 ? true : null; }, 8000);
      ok('视觉接口失败时记失败并显示错误块',
        !!imgFailed && !!cellK.querySelector('.twdl-zh-imgblock[data-state="error"]'),
        (cellK.querySelector('.twdl-zh-imgtext') || {}).textContent);

      var callsBeforeImgRetry = fetchCalls.length;
      zh.scanImages();
      await sleep(15);
      ok('失败的图片不会自动反复重试',
        fetchCalls.length === callsBeforeImgRetry, 'delta=' + (fetchCalls.length - callsBeforeImgRetry));

      mockMode = 'ok';
      zh.clearFailed();
      zh.scanImages();
      var imgRetried = await waitFor(function () {
        return cellK.querySelector('.twdl-zh-imgblock[data-state="ok"]');
      }, 8000);
      ok('「重试失败项」后图片翻译成功', !!imgRetried,
        imgRetried && imgRetried.querySelector('.twdl-zh-imgtext').textContent);

      /* ---------- 10.6 v0.2.1-zh.2：API 地址归一化 / 自动重试 / 错误提示 ---------- */
      mockMode = 'ok';
      setHtml404Matcher(null);

      /* (a) 把「完整接口地址」粘进设置也能用（不会拼成 .../chat/completions/chat/completions） */
      var cellL = makeCell('cellL', 'en', 'Normalization test tweet.');
      zh.configure({
        baseUrl: 'https://api.test/v1/chat/completions/',
        model: 'test-model', apiKey: 'test-key',
        visionModel: 'test-vision', imgMode: 'auto'
      });
      zh.scan();
      var blockL = await waitFor(function () { return blockOf(textElOf(cellL)); }, 6000);
      var lastTextCall = null;
      for (var ti = fetchCalls.length - 1; ti >= 0; ti--) {
        if (fetchCalls[ti].url.indexOf('/chat/completions') !== -1) { lastTextCall = fetchCalls[ti]; break; }
      }
      ok('完整接口地址被归一化（不重复拼 /chat/completions）',
        !!blockL && !!lastTextCall && lastTextCall.url === 'https://api.test/v1/chat/completions',
        lastTextCall && lastTextCall.url);

      /* (b) base 少了 /v1 时：第一次 404 HTML → 自动换 /v1 重试成功 */
      setHtml404Matcher(function (u) { return u === 'https://api.test2/chat/completions'; });
      var cellM = makeImageCell('cellM', 'IMG6');
      var callsBeforeM = fetchCalls.length;
      zh.configure({ baseUrl: 'https://api.test2', visionBaseUrl: '', imgMode: 'auto', visionModel: 'test-vision' });
      zh.scanImages();
      var blockM = await waitFor(function () { return cellM.querySelector('.twdl-zh-imgblock[data-state="ok"]'); }, 8000);
      var triedUrls = fetchCalls.slice(callsBeforeM).map(function (c) { return c.url; });
      ok('地址缺 /v1 时自动换 /v1 重试并成功',
        !!blockM &&
        triedUrls.indexOf('https://api.test2/chat/completions') !== -1 &&
        triedUrls.indexOf('https://api.test2/v1/chat/completions') !== -1,
        triedUrls.join(' | '));

      /* (c) 译文块以浮层挂在媒体容器内（X 媒体容器 overflow:hidden，挂外面会被裁掉） */
      var photoM = cellM.querySelector('[data-testid="tweetPhoto"]');
      var blockMEl = cellM.querySelector('.twdl-zh-imgblock');
      ok('图片译文块浮在 tweetPhoto 内（保证可见、不被裁切）',
        !!blockMEl && blockMEl.parentElement === photoM && blockMEl.getAttribute('data-overlay') === '1',
        blockMEl ? ('parent=' + (blockMEl.parentElement && blockMEl.parentElement.getAttribute('data-testid')) +
          ' overlay=' + blockMEl.getAttribute('data-overlay')) : 'no block');

      /* (d) 全部候选都返回 HTML 404：给可照做的提示，而不是把 HTML 糊到推文上 */
      setHtml404Matcher(function () { return true; });
      var cellN = makeImageCell('cellN', 'IMG7');
      zh.configure({ baseUrl: 'https://api.test3' });
      zh.scanImages();
      var errBlockN = await waitFor(function () { return cellN.querySelector('.twdl-zh-imgblock[data-state="error"]'); }, 8000);
      var errTextN = errBlockN ? errBlockN.querySelector('.twdl-zh-imgtext').textContent : '';
      ok('HTML 404 时给出「接口地址」类提示', /接口地址/.test(errTextN), errTextN.slice(0, 120));
      ok('错误块不再展示原始 HTML',
        errTextN.indexOf('<!DOCTYPE') === -1 && errTextN.indexOf('<html') === -1, errTextN.length + ' 字符');
      ok('错误块长度可控（< 400 字符）', errTextN.length < 400, errTextN.length + ' 字符');
      ok('错误块带「重试」按钮', !!errBlockN && !!errBlockN.querySelector('.twdl-zh-imgretry'));
      ok('状态里记录实际请求地址', (zh.state().stats.lastAttemptUrl || '').indexOf('https://api.test3') === 0,
        zh.state().stats.lastAttemptUrl);

      /* (e) 点「重试」用当前设置重来 */
      setHtml404Matcher(null);
      click(errBlockN.querySelector('.twdl-zh-imgretry'));
      var retriedN = await waitFor(function () { return cellN.querySelector('.twdl-zh-imgblock[data-state="ok"]'); }, 8000);
      ok('点「重试」后图片翻译成功', !!retriedN);
      ok('重试成功后「重试」按钮消失', !!retriedN && !retriedN.querySelector('.twdl-zh-imgretry'));

      /* (f) 文本接口返回网页时也给友好提示（不再出现「不是 JSON：<!DOCTYPE…」） */
      var textHtmlErr = null;
      setHtml404Matcher(function () { return true; });
      try {
        await zh.request({ baseUrl: 'https://api.test4', model: 'test-model', apiKey: 'test-key' }, ['hi']);
      } catch (e) {
        textHtmlErr = e;
      }
      ok('文本接口 HTML 404 也给出友好提示',
        !!textHtmlErr && /接口地址/.test(textHtmlErr.message || ''), textHtmlErr && textHtmlErr.message);
      setHtml404Matcher(null);
      zh.configure({ baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'test-key' });

      /* (g) 非拉丁文字（俄语/阿拉伯语）也要翻译：旧版只认拉丁字母，整页 0 任务 */
      var cellR = makeCell('cellR', 'ru', 'Так получилось, что я пишу нишевые работы.');
      var cellS = makeCell('cellS', 'ar', 'إذا كتبتم لي شكرا سأكون سعيدا جدا.');
      zh.scan();
      var blockR = await waitFor(function () {
        return blockOf(textElOf(cellR)) && blockOf(textElOf(cellS));
      }, 6000);
      ok('俄语（西里尔字母）推文会被翻译',
        !!blockR && zhTextOf(blockOf(textElOf(cellR))).indexOf('【中】') === 0,
        blockR ? zhTextOf(blockOf(textElOf(cellR))) : 'no block');
      ok('阿拉伯语推文会被翻译',
        !!blockR && zhTextOf(blockOf(textElOf(cellS))).indexOf('【中】') === 0,
        blockR ? zhTextOf(blockOf(textElOf(cellS))) : 'no block');
      ok('俄语文本确实发给了接口', fetchCalls.some(function (c) {
        try { return String(c.opts.body || '').indexOf('Так получилось') !== -1; } catch (e) { return false; }
      }));

      /* (h) 地址校验：控制台页面 / 缺 /v1 会被识别 */
      ok('识别「控制台页面」型地址',
        /控制台/.test(zh.apiWarning('https://platform.kimi.com/console/account')),
        zh.apiWarning('https://platform.kimi.com/console/account'));
      ok('正确的 Kimi base url 不报警', zh.apiWarning('https://api.moonshot.cn/v1') === '',
        zh.apiWarning('https://api.moonshot.cn/v1'));
      ok('缺 /v1 会提醒', /\/v1/.test(zh.apiWarning('https://api.deepseek.com')),
        zh.apiWarning('https://api.deepseek.com'));

      /* (i) 模型名错误（品牌名当模型 ID）：Moonshot 回 404 JSON，要提示「模型不存在」而不是「路径不存在」 */
      ok('识别「品牌名当模型 ID」', /品牌名/.test(zh.modelWarning('kimi')), zh.modelWarning('kimi'));
      ok('完整模型 ID 不报警', zh.modelWarning('moonshot-v1-8k-vision-preview') === '' &&
        zh.modelWarning('kimi-latest') === '', zh.modelWarning('kimi-latest'));

      setModel404Matcher(function (u) { return u.indexOf('/chat/completions') !== -1; });
      var cellT = makeImageCell('cellT', 'IMG8');
      var callsBeforeT = fetchCalls.length;
      zh.configure({ baseUrl: 'https://api.moonshot.cn/v1', visionBaseUrl: '', visionModel: 'kimi', imgMode: 'auto', apiKey: 'test-key' });
      zh.scanImages();
      var errBlockT = await waitFor(function () {
        return cellT.querySelector('.twdl-zh-imgblock[data-state="error"]');
      }, 8000);
      var errTextT = errBlockT ? errBlockT.querySelector('.twdl-zh-imgtext').textContent : '';
      ok('模型不存在时提示「模型/无权限」而不是「路径不存在」',
        /模型不存在或无权限/.test(errTextT) && errTextT.indexOf('接口路径不存在') === -1,
        errTextT.slice(0, 120));
      ok('模型错误不会浪费一次 /v1 重试',
        fetchCalls.slice(callsBeforeT).filter(function (c) {
          return c.url.indexOf('/chat/completions') !== -1;
        }).length === 1,
        'apiCalls=' + fetchCalls.slice(callsBeforeT).filter(function (c) {
          return c.url.indexOf('/chat/completions') !== -1;
        }).length);
      setModel404Matcher(null);
      zh.configure({ baseUrl: 'https://api.test/v1', visionModel: 'test-vision', apiKey: 'test-key' });

      /* (j) 按 Kimi K3 官方文档构造请求：kimi-k3 不传 temperature、传 reasoning_effort=low */
      var cellK3 = makeCell('cellK3', 'en', 'Kimi K3 request shape test.');
      zh.configure({ baseUrl: 'https://api.test/v1', model: 'kimi-k3', apiKey: 'test-key' });
      zh.scan();
      await waitFor(function () { return blockOf(textElOf(cellK3)); }, 6000);
      function findCallBody(matcher) {
        for (var ci = fetchCalls.length - 1; ci >= 0; ci--) {
          var cb = {};
          try { cb = JSON.parse(fetchCalls[ci].opts.body || '{}'); } catch (e) { cb = {}; }
          if (matcher(cb)) return cb;
        }
        return null;
      }
      var kimiCall = findCallBody(function (cb) { return cb.model === 'kimi-k3'; });
      ok('Kimi K3 请求带 reasoning_effort=low（官方：K3 始终思考，用顶层参数控制强度）',
        !!kimiCall && kimiCall.reasoning_effort === 'low',
        kimiCall ? ('reasoning_effort=' + kimiCall.reasoning_effort) : 'no call');
      ok('Kimi K3 请求不传 temperature（官方要求不要手动设置）',
        !!kimiCall && typeof kimiCall.temperature === 'undefined',
        kimiCall ? ('temperature=' + kimiCall.temperature) : 'no call');
      var nonKimiCall = findCallBody(function (cb) {
        return cb.model === 'test-model' && Array.isArray(cb.messages);
      });
      ok('非 Kimi 模型仍保留 temperature=0.2 且不带 reasoning_effort',
        !!nonKimiCall && nonKimiCall.temperature === 0.2 && typeof nonKimiCall.reasoning_effort === 'undefined',
        nonKimiCall ? ('temperature=' + nonKimiCall.temperature) : 'no call');
      zh.configure({ model: 'test-model', baseUrl: 'https://api.test/v1', apiKey: 'test-key' });

      /* (j2) 视频封面文字翻译：X 用 video[poster]/amplify_video_thumb，旧版直接忽略了 */
      setHtml404Matcher(null);
      setModel404Matcher(null);
      setRateLimit429(null);
      zh.configure({ baseUrl: 'https://api.test/v1', model: 'test-model', visionModel: 'test-vision', imgMode: 'auto', apiKey: 'test-key' });
      var cellV = makeVideoCell('cellV', 'VID1');
      zh.scanImages();
      var blockV = await waitFor(function () {
        return cellV.querySelector('.twdl-zh-imgblock[data-state="ok"]');
      }, 8000);
      var vpV = cellV.querySelector('[data-testid="videoPlayer"]');
      ok('视频封面的文字会被翻译（旧版只处理 img[src*=pbs.twimg.com/media]）',
        !!blockV, blockV ? blockV.querySelector('.twdl-zh-imgtext').textContent : 'no block');
      ok('视频译文块浮在播放器容器内（不被 overflow 裁掉）',
        !!blockV && blockV.parentElement === vpV && blockV.getAttribute('data-overlay') === '1',
        blockV ? ('parent=' + (blockV.parentElement && blockV.parentElement.getAttribute('data-testid'))) : 'no block');

      /* (j3) X 重渲染删掉译文块 → 从缓存补回，不重复发请求 */
      var remountBlock = cellH.querySelector('.twdl-zh-imgblock');
      ok('重挂载测试准备：原译文块存在', !!remountBlock);
      if (remountBlock) remountBlock.parentNode.removeChild(remountBlock);
      var orphanDiag = zh.diagnostics();
      ok('诊断能发现被 X 删除的孤儿译文块（并给出重渲染提示）',
        orphanDiag.media.imageOrphans >= 1 && orphanDiag.problems.some(function (p) {
          return p.indexOf('重渲染') !== -1;
        }),
        'orphans=' + orphanDiag.media.imageOrphans + ' problems=' + orphanDiag.problems.join(' | ').slice(0, 80));
      var callsBeforeRemount = fetchCalls.filter(function (c) {
        return c.url.indexOf('/chat/completions') !== -1;
      }).length;
      zh.scanImages();
      var remounted = await waitFor(function () { return cellH.querySelector('.twdl-zh-imgblock'); }, 5000);
      var callsAfterRemount = fetchCalls.filter(function (c) {
        return c.url.indexOf('/chat/completions') !== -1;
      }).length;
      ok('译文块被 X 删掉后能自动补回（虚拟列表重渲染场景）', !!remounted);
      ok('补回译文块走缓存、不重复消耗请求', callsAfterRemount === callsBeforeRemount,
        'before=' + callsBeforeRemount + ' after=' + callsAfterRemount);

      /* (j5) 全局串行门：真实账户「组织并发=1」，文字与图片请求不能并行 */
      chatInFlight = 0;
      chatMaxInFlight = 0;
      mockDelayMs = 40;
      var gateCfg = { baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'test-key' };
      await Promise.all([zh.request(gateCfg, ['gate one']), zh.request(gateCfg, ['gate two'])]);
      mockDelayMs = 0;
      ok('并发受限账户：多个请求被全局串行门排队（最大并发 = 1）',
        chatMaxInFlight === 1, 'maxInFlight=' + chatMaxInFlight);

      /* (j4) 内置自检 / 诊断接口 */
      var diag = zh.diagnostics();
      ok('诊断报告结构完整（version/config/stats/text/media/problems/recent）',
        !!diag && !!diag.version && !!diag.config && !!diag.stats && !!diag.text && !!diag.media &&
        Array.isArray(diag.problems) && Array.isArray(diag.recent),
        diag ? ('v=' + diag.version + ' problems=' + diag.problems.length) : 'no report');
      ok('诊断文本包含版本/自检结论/最近事件',
        (function () {
          var text = zh.diagnosticsText(diag);
          return text.indexOf('版本') !== -1 && text.indexOf('自检结论') !== -1 && text.indexOf('最近事件') !== -1;
        })());
      ok('面板存在「诊断」按钮', !!document.getElementById('twdl-zh-diag'));
      ok('自检日志记录了扫描/请求事件',
        zh.debugLog().some(function (ev) {
          return ev.kind === 'scan.text' || ev.kind === 'scan.media' || ev.kind === 'api.request';
        }),
        'events=' + zh.debugLog().length);
      zh.configure({ baseUrl: 'https://platform.kimi.com/console/account' });
      ok('自检能识别「控制台页面当 API 地址」',
        zh.selfCheck().some(function (p) { return p.indexOf('控制台') !== -1; }),
        zh.selfCheck().join(' | ').slice(0, 100));
      zh.configure({ baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'test-key' });

      /* (k) 429 分类与自动退避重试（按 Kimi 官方错误码文档） */
      zh.tune({ minIntervalMs: 0, retryBaseMs: 5, retryMax: 3, adaptive: false, imgMaxSide: 0, imgMaxPerScan: 24 });
      setHtml404Matcher(null);
      setModel404Matcher(null);

      /* k1: rate_limit_reached_error → 自动退避重试一次后成功 */
      setRateLimit429(function (u, n) {
        return n < 2 ? {
          type: 'rate_limit_reached_error',
          message: 'Your account org-test<ak-test> request reached TPM rate limit, current:100, limit:100',
          retryAfter: 0
        } : null;
      });
      var cellRL = makeCell('cellRL', 'en', 'Rate limit retry test.');
      zh.configure({ baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'test-key' });
      var callsBeforeRL = fetchCalls.length;
      zh.scan();
      var blockRL = await waitFor(function () { return blockOf(textElOf(cellRL)); }, 6000);
      var rlCalls = fetchCalls.slice(callsBeforeRL).filter(function (c) {
        return c.url.indexOf('/chat/completions') !== -1;
      });
      ok('429 限速会自动退避重试并成功（官方：按 Retry-After/指数退避）',
        !!blockRL && rlCalls.length === 3, 'apiCalls=' + rlCalls.length);
      ok('统计里记录退避重试次数', (zh.state().stats.retries || 0) >= 1,
        'retries=' + zh.state().stats.retries);
      ok('测试模式下自适应降速已关闭（真实使用默认开启）',
        zh.rate().adaptive === false && zh.rate().minInterval === 0,
        'adaptive=' + zh.rate().adaptive + ' interval=' + zh.rate().minInterval);
      ok('自适应限速状态可观测（面板/调试用）',
        typeof zh.rate().cooldownUntil === 'number',
        'cooldownUntil=' + zh.rate().cooldownUntil);
      setRateLimit429(null);

      /* k2: exceeded_current_quota_error → 不重试，提示充值/余额 */
      setRateLimit429(function () {
        return {
          type: 'exceeded_current_quota_error',
          message: 'Your account org-test<ak-test> is in arrears, please recharge',
          retryAfter: 5
        };
      });
      var cellRL2 = makeImageCell('cellRL2', 'IMG9');
      var callsBeforeRL2 = fetchCalls.length;
      zh.scanImages();
      var errBlockRL2 = await waitFor(function () {
        return cellRL2.querySelector('.twdl-zh-imgblock[data-state="error"]');
      }, 8000);
      var rl2Calls = fetchCalls.slice(callsBeforeRL2).filter(function (c) {
        return c.url.indexOf('/chat/completions') !== -1;
      });
      var rl2Text = errBlockRL2 ? errBlockRL2.querySelector('.twdl-zh-imgtext').textContent : '';
      ok('余额不足类 429 不浪费重试（重试也没用）', rl2Calls.length === 1, 'apiCalls=' + rl2Calls.length);
      ok('余额不足类提示「余额/充值」而不是泛泛的限流',
        /余额/.test(rl2Text) && /充值/.test(rl2Text), rl2Text.slice(0, 120));
      setRateLimit429(null);
      zh.configure({ baseUrl: 'https://api.test/v1', model: 'test-model', visionModel: 'test-vision', apiKey: 'test-key' });

      /* ---------- 11. 界面文案模式 ---------- */
      zh.configure({ mode: 'full', enabled: true, apiKey: 'test-key' });
      zh.applyUi();
      var navHome = document.querySelector('#fakeNav a span');
      var replyBtn = document.getElementById('replyBtn');
      var followingSpan = document.querySelector('#fakeNav > span');
      ok('界面模式：Home → 首页', !!navHome && navHome.textContent === '首页', navHome && navHome.textContent);
      ok('界面模式：按钮文案与 aria-label 一起翻译',
        replyBtn.textContent === '回复' && replyBtn.getAttribute('aria-label') === '回复',
        replyBtn.textContent + ' / ' + replyBtn.getAttribute('aria-label'));
      ok('界面模式：Following → 正在关注', followingSpan.textContent === '正在关注', followingSpan.textContent);

      click(document.getElementById('twdl-zh-toggle'));
      ok('全局切原文时界面文案也还原',
        navHome.textContent === 'Home' && replyBtn.getAttribute('aria-label') === 'Reply',
        navHome.textContent + ' / ' + replyBtn.getAttribute('aria-label'));
      click(document.getElementById('twdl-zh-toggle'));
      await sleep(20);
      ok('切回译文后界面文案重新汉化', navHome.textContent === '首页', navHome.textContent);

      zh.configure({ mode: 'content' });
      zh.applyUi();
      await sleep(15);
      ok('切回「仅内容」后界面文案还原', navHome.textContent === 'Home', navHome.textContent);
      ok('切回「仅内容」后推文译文保留',
        !!blockOf(src1) && src1.style.display === 'none');

      /* ---------- 12. 统计 ---------- */
      var state = zh.state();
      note('最终状态：文本已译 ' + state.stats.applied + ' 段 / 请求 ' + state.stats.requests + ' 次 / 缓存 ' +
        state.cacheSize + ' 条 / 失败 ' + state.stats.failed);
      note('图片：已译 ' + state.stats.imgApplied + ' 张 / 无文字 ' + state.stats.imgNoText +
        ' 张 / 失败 ' + state.stats.imgFailed + ' 张 / 请求 ' + state.stats.imgRequests + ' 次 / 图片块 ' + state.imgBlocks);
      ok('译文块总数符合预期（A 两段 + D + E + G + L + R + S + K3 + RL）',
        document.querySelectorAll('.twdl-zh-block').length === 10,
        'blocks=' + document.querySelectorAll('.twdl-zh-block').length);
      ok('图片统计符合预期（IMG1 + IMG4 成功，IMG2 无文字）',
        state.stats.imgApplied >= 2 && state.stats.imgNoText >= 1 && state.imgBlocks >= 2,
        'applied=' + state.stats.imgApplied + ' noText=' + state.stats.imgNoText + ' blocks=' + state.imgBlocks);

      await sleep(15);
      lines.push('');
      lines.push(lines.some(function (l) { return l.indexOf('FAIL') === 0; }) ? '结论：有失败项' : '结论：全部通过');
      render();
      document.title = 'twdl-zh-test';
    } catch (e) {
      lines.push('ERROR ' + (e && e.stack ? e.stack : e));
      render();
    }
  })();
})();
