/**
 * QLIT 出行登记 · 会话捕获脚本（v3 诊断版）
 *
 *  1. 监听整个 qlit.edu.cn（不限 pass. 子域）——手机端可能使用其他子域名；
 *  2. 首次发现新子域名时发限频通知，让我们知道流量到底流向哪；
 *  3. pass.qlit.edu.cn 的请求若不带 JSESSIONID（未登录/已过期）也发调试通知；
 *  4. 捕获到新 JSESSIONID → SSO 实测 → 通过才入库并通知（qlit:// 直达 QLIT 导入），
 *     失败进黑名单不重复探测；pending 标记防验证请求自身重入；
 *  5. 所有调试通知限频。
 */

var KEY_SESSION = 'qlit_session';
var KEY_AT = 'qlit_captured_at';
var KEY_PROBE = 'qlit_probe_pending';
var KEY_REJECTED = 'qlit_rejected';
var KEY_DEBUG_AT = 'qlit_debug_at';
var KEY_HOSTS = 'qlit_hosts_seen';
var KEY_HOSTNOTE_AT = 'qlit_hostnote_at';
var NOTIFY_SILENCE_MS = 5 * 60 * 1000;
var DEBUG_SILENCE_MS = 5 * 60 * 1000;
var HOSTNOTE_SILENCE_MS = 60 * 1000;

var SSO_URL = 'https://pass.qlit.edu.cn/student/mobile/sso_mj_baobei/index.jsp';
var PROBE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
               'AppleWebKit/537.36 NetType/WIFI ' +
               'MicroMessenger/7.0.20.1781(0x6700143B) MacWechat/3.8.7';

function extractJsid(raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) raw = raw.join('; ');
  var m = /JSESSIONID=([^;\s]+)/.exec(String(raw));
  return m ? m[1] : '';
}

/** 从 URL 取 hostname。 */
function hostOf(url) {
  var m = /^https?:\/\/([^\/?:]+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

function hhmm(d) {
  d = d || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + p(d.getMinutes());
}

/** SSO 实测；probe 由引擎注入，回调 cb(ok, info)。测试环境传 null 视为通过。 */
function verifySession(jsid, probe, cb) {
  try {
    if (typeof probe === 'function') {
      probe(jsid, cb);
    } else {
      cb(true);
    }
  } catch (e) {
    cb(false, { status: '0', preview: String(e).slice(0, 120) });
  }
}

/** 调试通知（限频）。 */
function notifyDebug(store, notify, info) {
  var now = Date.now();
  if (now - Number(store.read(KEY_DEBUG_AT) || 0) < DEBUG_SILENCE_MS) return;
  store.write(String(now), KEY_DEBUG_AT);
  var status = (info && info.status) || '?';
  var preview = (info && info.preview) || '无响应体';
  notify('⚠️ 出行登记·调试', '（' + status + '）',
    preview.slice(0, 150) + '\n请把本通知内容发给开发者');
}

/** 新子域名发现通知（限频 60s，只记 host，上限 20 个）。 */
function noteNewHost(store, notify, host) {
  var seen = String(store.read(KEY_HOSTS) || '');
  var list = seen ? seen.split(',') : [];
  if (list.indexOf(host) >= 0) return;
  if (list.length >= 20) return;
  list.push(host);
  store.write(list.join(','), KEY_HOSTS);
  var now = Date.now();
  if (now - Number(store.read(KEY_HOSTNOTE_AT) || 0) < HOSTNOTE_SILENCE_MS) return;
  store.write(String(now), KEY_HOSTNOTE_AT);
  notify('⚠️ 出行登记·发现域名', host,
    '检测到校园子域名的请求。若持续收不到捕获通知，请把本条发给开发者');
}

function runCapture(request, store, notify, copyFn, probe, onComplete) {
  var url = (request && request.url) || '';
  var host = hostOf(url);
  if (!/qlit\.edu\.cn$/.test(host)) return { wrote: false, skipped: 'host' };

  // 非 pass. 子域：只记录发现，不参与会话捕获
  if (host !== 'pass.qlit.edu.cn') {
    noteNewHost(store, notify, host);
    return { wrote: false, discovered: host };
  }

  var headers = (request && request.headers) || {};
  var raw = headers.Cookie || headers.cookie || '';
  var jsid = extractJsid(raw);
  if (!jsid) {
    // pass 域请求但不带会话：平台未登录或 Cookie 被清，附上路径便于定位
    var path = url.replace(/^https?:\/\/pass\.qlit\.edu\.cn/, '') || '/';
    notifyDebug(store, notify, { status: '无Cookie', preview: 'pass.qlit.edu.cn' + path.slice(0, 80) + ' 未携带 JSESSIONID（微信侧未登录）' });
    return { wrote: false, skipped: 'no-cookie' };
  }

  var old = store.read(KEY_SESSION);
  var now = Date.now();
  if (jsid === old) {
    if (now - Number(store.read(KEY_AT) || 0) > NOTIFY_SILENCE_MS) {
      store.write(String(now), KEY_AT);
    }
    return { wrote: true, changed: false, copied: false };
  }
  if (store.read(KEY_PROBE) === jsid) return { wrote: false, pending: true };
  if (store.read(KEY_REJECTED) === jsid) return { wrote: false, rejected: true };

  store.write(jsid, KEY_PROBE);
  verifySession(jsid, probe, function (ok, info) {
    store.write('', KEY_PROBE);
    if (!ok) {
      store.write(jsid, KEY_REJECTED);
      notifyDebug(store, notify, info);
      if (typeof onComplete === 'function') onComplete();
      return;
    }
    store.write('', KEY_REJECTED);
    store.write(jsid, KEY_SESSION);
    store.write(String(Date.now()), KEY_AT);
    var copied = false;
    try {
      if (typeof copyFn === 'function') copied = copyFn(jsid);
    } catch (e) { /* 忽略 */ }
    notify('出行登记', '✓ 已捕获校园会话' + (copied ? '，已复制' : ''),
      '点此打开 QLIT 自动导入',
      { url: 'qlit://import-session?value=' + encodeURIComponent(jsid) });
    if (typeof onComplete === 'function') onComplete();
  });
  return { wrote: false, probing: true };
}

function runSurgeCapture() {
  var didFinish = false;
  function finish() {
    if (didFinish) return;
    didFinish = true;
    $done({});
  }
  try {
    var result = runCapture($request, $persistentStore, function (t, sub, body, urlOpt) {
      if (urlOpt && urlOpt.url) {
        $notification.post(t, sub, body, urlOpt);
      } else {
        $notification.post(t, sub, body);
      }
    }, function (text) {
      if (typeof $clipboard !== 'undefined' && $clipboard && typeof $clipboard.write === 'function') {
        $clipboard.write(text);
        return true;
      }
      return false;
    }, function (jsid, cb) {
      $httpClient.get({
        url: SSO_URL,
        headers: {
          'User-Agent': PROBE_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Cookie: 'JSESSIONID=' + jsid + '; HHMM=' + hhmm()
        },
        timeout: 15
      }, function (err, resp, data) {
        var text = String(data || '');
        var status = resp && (resp.status || resp.statusCode) ? String(resp.status || resp.statusCode) : String(err || '0');
        var ok = /setItem\("Authorization"|eyJ[A-Za-z0-9_-]{12,}\./.test(text);
        cb(ok, { status: status, preview: text.replace(/\s+/g, ' ').slice(0, 150) });
      });
    }, finish);
    if (!result.probing) finish();
  } catch (e) {
    $notification.post('出行登记', '捕获脚本异常', String(e));
    finish();
  }
}

function runQuantumultXCapture() {
  var didFinish = false;
  function finish() {
    if (didFinish) return;
    didFinish = true;
    $done({});
  }
  var store = {
    read: function (key) { return $prefs.valueForKey(key) || ''; },
    write: function (value, key) { return $prefs.setValueForKey(String(value), key); }
  };
  function notify(title, subtitle, body, urlOpt) {
    if (urlOpt && urlOpt.url) {
      $notify(title, subtitle, body, { 'open-url': urlOpt.url });
    } else {
      $notify(title, subtitle, body);
    }
  }
  try {
    var result = runCapture($request, store, notify, null, function (jsid, cb) {
      $task.fetch({
        url: SSO_URL,
        method: 'GET',
        headers: {
          'User-Agent': PROBE_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Cookie: 'JSESSIONID=' + jsid + '; HHMM=' + hhmm()
        }
      }).then(function (resp) {
        var text = String((resp && resp.body) || '');
        var status = resp && (resp.statusCode || resp.status) ? String(resp.statusCode || resp.status) : '0';
        var ok = /setItem\("Authorization"|eyJ[A-Za-z0-9_-]{12,}\./.test(text);
        cb(ok, { status: status, preview: text.replace(/\s+/g, ' ').slice(0, 150) });
      }).catch(function (error) {
        cb(false, { status: '0', preview: String(error).slice(0, 150) });
      });
    }, finish);
    if (!result.probing) finish();
  } catch (e) {
    $notify('出行登记', '捕获脚本异常', String(e));
    finish();
  }
}

// 代理引擎环境
if (typeof $request !== 'undefined' && typeof $done !== 'undefined') {
  if (typeof $task !== 'undefined' && typeof $prefs !== 'undefined') {
    runQuantumultXCapture();
  } else {
    runSurgeCapture();
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractJsid: extractJsid, hostOf: hostOf, hhmm: hhmm,
    verifySession: verifySession, notifyDebug: notifyDebug,
    noteNewHost: noteNewHost, runCapture: runCapture
  };
}
