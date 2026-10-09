/**
 * api.js — بديل google.script.run عبر fetch
 * يحاكي نفس الواجهة (withSuccessHandler / withFailureHandler / اسم الدالة)
 * فيبقى منطق التطبيق (app.js) كما هو تماماً، والدوال في الخادم كما هي.
 * الرمز (Token) يُحفظ بعد الدخول ويُرسل مع كل طلب؛ الخادم يستنتج اسم
 * المندوب منه ولا يثق بما يرسله المتصفح.
 */
(function () {
  var TOKEN_KEY = 'zc_token';
  var SESSION_KEY = 'zc_rep_session';
  var TIMEOUT_MS = 30000;

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }

  // جلسة قديمة بلا Token (قبل الترحيل) ← نعيد المندوب لشاشة الدخول
  try {
    if (localStorage.getItem(SESSION_KEY) && !getToken()) localStorage.removeItem(SESSION_KEY);
  } catch (e) {}

  var authLost = false;
  function handleAuthLost() {
    if (authLost) return;
    authLost = true;
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    location.reload();
  }

  function call(fn, args, ok, fail) {
    var url = (window.APP_CONFIG || {}).API_URL || '';
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      if (fail) fail(new Error('API_URL غير مضبوط في config.js'));
      return;
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    fetch(url, {
      method: 'POST',
      // text/plain يتجنّب طلب preflight (غير مدعوم في Apps Script)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args, token: getToken() }),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (res && res.ok) {
          if (fn === 'login' && res.data && res.data.success && res.data.token) {
            setToken(res.data.token);
            delete res.data.token;
          }
          if (ok) ok(res.data);
        } else {
          if (res && res.error === 'auth') handleAuthLost();
          if (fail) fail(new Error((res && res.error) || 'server_error'));
        }
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (fail) fail(err);
      });
  }

  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (prop === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () { call(String(prop), Array.prototype.slice.call(arguments), ok, fail); };
      }
    });
  }

  window.google = { script: { run: runner(null, null) } };
})();
