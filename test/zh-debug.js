(function () {
  var logEl = document.getElementById('log');
  var lines = [];
  var t0 = Date.now();
  function log(msg) {
    lines.push('+' + String(Date.now() - t0).padStart(4, ' ') + 'ms  ' + msg);
    logEl.textContent = lines.join('\n');
  }

  function html404Response() {
    return Promise.resolve({
      ok: false,
      status: 404,
      text: function () {
        return Promise.resolve('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>404</body></html>');
      }
    });
  }
  function okResponse(content) {
    var payload = { choices: [{ message: { content: content } }] };
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(payload)); } });
  }

  var calls = [];
  window.fetch = function (url, opts) {
    var u = String(url);
    calls.push(u);
    log('fetch ' + u);
    if (u.indexOf('pbs.twimg.com') !== -1) {
      var bytes = new Uint8Array([73, 77, 71, 54]);
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return 'image/png'; } },
        arrayBuffer: function () { return Promise.resolve(bytes.buffer); },
        text: function () { return Promise.resolve(''); }
      });
    }
    if (u === 'https://api.test2/chat/completions') return html404Response();
    return okResponse('【图译】debug translation');
  };

  var interval = setInterval(function () {
    var zh = window.__twdl && window.__twdl.zh;
    var img = document.querySelector('#cellM img');
    var block = document.querySelector('#cellM .twdl-zh-imgblock');
    var state = zh ? zh.state() : null;
    log('state: ' + JSON.stringify({
      imgQueue: state ? state.imgQueue : -1,
      imgFailed: state ? state.stats.imgFailed : -1,
      imgRequests: state ? state.stats.imgRequests : -1,
      lastUrl: state ? state.stats.lastAttemptUrl : '',
      blockState: block ? block.getAttribute('data-state') : 'none',
      imgDone: img ? img.getAttribute('data-twdl-zhimg-done') : '',
      imgFail: img ? img.getAttribute('data-twdl-zhimg-fail') : '',
      imgQueued: img ? img.getAttribute('data-twdl-zhimg-queued') : ''
    }));
    if (block && block.getAttribute('data-state') === 'ok') {
      log('DONE: ' + (block.querySelector('.twdl-zh-imgtext') || {}).textContent);
    }
  }, 250);

  setTimeout(function () {
    var zh = window.__twdl && window.__twdl.zh;
    if (!zh) { log('!! __twdl.zh 不存在'); return; }
    zh.boot();
    zh.configure({ baseUrl: 'https://api.test2', model: 'test-model', apiKey: 'test-key', visionModel: 'test-vision', imgMode: 'auto' });
    log('configured: ' + JSON.stringify(zh.state().cfg));
    zh.scanImages();
    log('scanImages() 已调用');
  }, 300);

  setTimeout(function () { clearInterval(interval); log('--- 4s 观察结束 ---'); }, 4000);
})();
