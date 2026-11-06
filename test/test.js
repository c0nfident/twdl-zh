/* twdl 修复版的行为测试。跑不了真 X 页面，但可以在假 DOM 上验证：
   - 按钮组注入 / 挂载位置
   - 下载站链接（x.com 与 twitter.com 两种域名）
   - 用户名 / 原图地址（4096x4096）
   - 无图推文提示
   - 推文转图片端到端（含 canvas 输出尺寸）
   - 转图是否污染页面 DOM（原版会）
*/
(function () {
  var logEl = document.getElementById('log');
  var lines = [];
  var finished = false;

  function render() {
    logEl.textContent = lines.join('\n');
  }
  function ok(name, cond, extra) {
    lines.push((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined && extra !== '' ? '   [' + extra + ']' : ''));
    render();
  }
  function note(text) {
    lines.push('----  ' + text);
    render();
  }
  function click(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  function waitFor(fn, timeout) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var value = null;
        try { value = fn(); } catch (e) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - t0 > (timeout || 8000)) return resolve(null);
        setTimeout(poll, 100);
      })();
    });
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  function closeOverlay() {
    var buttons = document.querySelectorAll('#imageOverlay button');
    if (buttons && buttons.length > 1) click(buttons[1]);
  }

  (async function () {
    try {
      if (!window.__twdl) {
        ok('修复版脚本已加载并暴露 __twdl', false);
        return;
      }
      ok('修复版脚本已加载', true, 'version=' + window.__twdl.version);

      /* 头像：真实 X 是 div[style*=background-image]，这里把垫片像素塞进去 */
      var avatarPixels = window.__TWDL_TEST_PIXELS.avatar;
      Array.prototype.forEach.call(document.querySelectorAll('[data-avatar]'), function (el) {
        el.style.backgroundImage = 'url("' + avatarPixels + '")';
      });

      var c1 = document.getElementById('cell1');
      var c2 = document.getElementById('cell2');
      var c3 = document.getElementById('cell3');

      /* ---------- 1. 按钮注入 ---------- */
      window.__twdl.twdl();
      var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      var allHaveHouse = Array.prototype.every.call(cells, function (c) { return !!c.querySelector('.house'); });
      ok('3 张卡片都注入了 .house 按钮组', cells.length === 3 && allHaveHouse);

      /* ---------- 2. 下载站链接 ---------- */
      function linkHrefs(cell) {
        var house = cell.querySelector('.house');
        if (!house) return '';
        return Array.prototype.map.call(house.querySelectorAll('a'), function (a) {
          return a.getAttribute('href') || '';
        }).join(' ');
      }

      var links1 = linkHrefs(c1);
      ok('cell1(x.com) 下载链接带推文地址',
        links1.indexOf('#https://x.com/alice/status/1780000000000000000') !== -1,
        links1.slice(0, 90));

      var links2 = linkHrefs(c2);
      ok('cell2(twitter.com) 下载链接也带推文地址（原版此处为空）',
        links2.indexOf('#https://twitter.com/bob/status/1790000000000000000') !== -1,
        links2.slice(0, 90));

      /* ---------- 3. 用户名 ---------- */
      ok('cell1 用户名 = alice', window.__twdl.userName(c1) === 'alice', window.__twdl.userName(c1));
      ok('cell1 昵称 = Alice A', window.__twdl.userName(c1, 'nickName') === 'Alice A', window.__twdl.userName(c1, 'nickName'));
      ok('cell2 用户名 = bob', window.__twdl.userName(c2) === 'bob', window.__twdl.userName(c2));

      /* ---------- 4. 原图地址 ---------- */
      var imgs = window.__twdl.get_imgsURL(c1);
      ok('cell1 原图地址升级为 4096x4096',
        imgs.length === 1 && imgs[0].indexOf('name=4096x4096') !== -1 && imgs[0].indexOf('name=small') === -1,
        imgs.join(','));
      ok('页面上的缩略图 src 没有被改成 4K（原版会）',
        c1.querySelector('img[alt="media"]').getAttribute('src').indexOf('name=small') !== -1);

      /* ---------- 5. 挂载位置 ---------- */
      var videoMounted = c2.querySelector('[data-testid="videoComponent"] .house');
      ok('cell2 纯视频卡的按钮组挂到 videoComponent 内', !!videoMounted);

      /* ---------- 6. 幂等 ---------- */
      window.__twdl.twdl();
      window.__twdl.twdl();
      var houseCount = document.querySelectorAll('.house').length;
      ok('twdl() 可重复调用且不重复注入', houseCount === 3, 'houses=' + houseCount);

      /* ---------- 7. 无图推文 ---------- */
      var photoBtn3 = c3.querySelector('.twdlimgs');
      ok('cell3 有「仅图片」按钮', !!photoBtn3);
      click(photoBtn3);
      var alertBox = document.getElementById('custom-alert');
      ok('无图推文点下载会弹出提示', !!alertBox, alertBox ? alertBox.querySelector('p').textContent.slice(0, 20) : '');
      if (alertBox) click(alertBox.querySelector('button'));
      ok('提示框可关闭', !document.getElementById('custom-alert'));

      /* ---------- 8. 记录转图前的页面状态 ---------- */
      var emojiBefore = c1.querySelectorAll('[dir="auto"][lang] img').length;
      var timeEl = c1.querySelector('time');
      var timeBefore = timeEl.textContent;
      var sepEl = c1.querySelector('[dir="ltr"][aria-hidden="true"]');
      var sepBefore = sepEl ? sepEl.textContent : '';
      note('转图前：emoji img=' + emojiBefore + ' time=' + JSON.stringify(timeBefore) + ' sep=' + JSON.stringify(sepBefore));

      /* ---------- 9. 转图（第一次） ---------- */
      var shareBtn = c1.querySelector('.twdlshare');
      ok('cell1 有「推文生成图片」按钮', !!shareBtn);
      click(shareBtn);
      var overlay = await waitFor(function () { return document.getElementById('imageOverlay'); }, 10000);
      ok('点击后出现图片预览层', !!overlay);

      var outImg = overlay ? overlay.querySelector('img') : null;
      ok('生成结果是 JPEG dataURL', !!outImg && /^data:image\/jpeg/.test(outImg.src),
        outImg ? ('len=' + outImg.src.length) : 'no img');
      ok('生成图片宽度 = 1170', !!outImg && outImg.naturalWidth === 1170,
        outImg ? (outImg.naturalWidth + 'x' + outImg.naturalHeight) : '');

      if (outImg) {
        var resultImg = document.getElementById('resultImg');
        resultImg.src = outImg.src;
        resultImg.style.display = 'block';
        document.getElementById('fakeX').style.display = 'none';
      }

      /* ---------- 10. 关闭后再生成一次，检查页面 DOM 是否被改写 ---------- */
      closeOverlay();
      ok('预览层可以关闭', !document.getElementById('imageOverlay'));

      click(c1.querySelector('.twdlshare'));
      var overlay2 = await waitFor(function () { return document.getElementById('imageOverlay'); }, 10000);
      ok('第二次生成图片成功', !!overlay2);

      var emojiAfter = c1.querySelectorAll('[dir="auto"][lang] img').length;
      var timeAfter = c1.querySelector('time').textContent;
      var sepAfter = sepEl ? sepEl.textContent : '';
      ok('页面上 emoji 没有被替换成文本（原版会）', emojiBefore === emojiAfter && emojiBefore > 0,
        'before=' + emojiBefore + ' after=' + emojiAfter);
      ok('页面时间文本没有被反复追加「·」（原版会累积）', timeBefore === timeAfter,
        JSON.stringify(timeBefore) + ' -> ' + JSON.stringify(timeAfter));
      ok('页面分隔符文本没有被覆盖（原版会）', sepBefore === sepAfter,
        JSON.stringify(sepBefore) + ' -> ' + JSON.stringify(sepAfter));

      closeOverlay();

      /* ---------- 11. 下载站自动填充 ---------- */
      var fakeInput = document.createElement('input');
      var fakeBtn = document.createElement('button');
      var clickedCount = 0;
      fakeBtn.addEventListener('click', function () { clickedCount += 1; });
      var tweetUrlForFill = 'https://x.com/alice/status/1780000000000000000';

      var acted = window.__twdl.fillAndClick(fakeInput, fakeBtn, tweetUrlForFill, 10);
      await sleep(150);
      ok('下载站自动填充：写入 URL 并点击提交',
        acted === true && fakeInput.value === tweetUrlForFill && clickedCount === 1,
        'clicks=' + clickedCount);

      var actedAgain = window.__twdl.fillAndClick(fakeInput, fakeBtn, tweetUrlForFill, 10);
      await sleep(150);
      ok('已填过同一 URL 时不重复提交', actedAgain === false && clickedCount === 1, 'clicks=' + clickedCount);

      /* ---------- 12. hash 解析 ---------- */
      var hashResult = null;
      try {
        history.replaceState(null, '', '#https://x.com/alice/status/1780000000000000000');
        hashResult = window.__twdl.getTwitterUrlFromHash();
      } catch (e) {
        note('INFO file:// 下无法设置 location.hash，hash 解析测试跳过 (' + e.name + ')');
      }
      if (hashResult !== null) {
        ok('从 location.hash 解析出推文链接',
          hashResult === 'https://x.com/alice/status/1780000000000000000', String(hashResult));
      }

      await sleep(200);
      lines.push('');
      lines.push(lines.some(function (l) { return l.indexOf('FAIL') === 0; }) ? '结论：有失败项' : '结论：全部通过');
      render();
      finished = true;
      document.title = 'twdl-harness';
    } catch (e) {
      lines.push('ERROR ' + (e && e.stack ? e.stack : e));
      render();
    }
  })();

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!finished && lines.length === 0) {
        lines.push('ERROR 测试没有跑起来');
        render();
      }
    }, 15000);
  });
})();
