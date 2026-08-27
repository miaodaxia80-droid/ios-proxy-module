/**
 * QLIT 出行登记 · 会话捕获脚本
 *
 * 以 http-response 钩子挂在整个 pass.qlit.edu.cn 域上：
 * 只要从微信 WebView 发来的任何请求携带了 student 域 JSESSIONID，
 * 就把它写进 $persistentStore，供提交脚本与保活脚本使用。
 *
 * 挂载方式见同目录上级清单文件（.sgmodule / .stoverride / .plugin）。
 */

var KEY_SESSION = 'qlit_session';
var KEY_AT = 'qlit_captured_at';
var NOTIFY_SILENCE_MS = 5 * 60 * 1000; // 同值会话的重复通知静默窗

function extractJsid(raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) raw = raw.join('; ');
  var m = /JSESSIONID=([^;\s]+)/.exec(String(raw));
  return m ? m[1] : '';
}

function runCapture(request, store, notify) {
  var url = (request && request.url) || '';
  if (!/pass\.qlit\.edu\.cn/.test(url)) return { wrote: false };

  var headers = (request && request.headers) || {};
  var raw = headers.Cookie || headers.cookie || '';
  var jsid = extractJsid(raw);
  if (!jsid) return { wrote: false };

  var old = store.read(KEY_SESSION);
  var now = Date.now();

  if (old !== jsid) {
    store.write(jsid, KEY_SESSION);
    store.write(String(now), KEY_AT);
    notify('出行登记', '✓ 已捕获校园会话', jsid.slice(0, 16) + '…\n在「出行登记」面板即可提交');
    return { wrote: true, changed: true };
  }
  // 会话没变：超过静默窗才刷新时间戳（给保活脚本一个“最后确认存活”参考）
  if (now - Number(store.read(KEY_AT) || 0) > NOTIFY_SILENCE_MS) {
    store.write(String(now), KEY_AT);
  }
  return { wrote: true, changed: false };
}

// 代理引擎环境
if (typeof $request !== 'undefined' && typeof $done !== 'undefined') {
  try {
    runCapture($request, $persistentStore, function (t, sub, body) {
      $notification.post(t, sub, body);
    });
  } catch (e) {
    $notification.post('出行登记', '捕获脚本异常', String(e));
  }
  $done({});
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractJsid: extractJsid, runCapture: runCapture };
}
