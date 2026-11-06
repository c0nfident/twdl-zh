(function () {
  var avatar = window.__TWDL_TEST_PIXELS.avatar;
  Array.prototype.forEach.call(document.querySelectorAll('[data-avatar]'), function (el) {
    el.style.backgroundImage = 'url("' + avatar + '")';
    el.style.borderRadius = '50%';
  });
  function run() {
    if (window.__twdl) window.__twdl.twdl();
  }
  run();
  window.addEventListener('load', function () { setTimeout(run, 200); });
})();
