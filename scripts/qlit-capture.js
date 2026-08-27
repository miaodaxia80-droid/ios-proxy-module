/**
 * QLIT 出行登记 · 会话捕获脚本
 *
 * 只有 student 域的 JSESSIONID 才能用于 SSO 换 JWT，mj_view 域的不行。
 * 因此本脚本：
 *  1. 只处理 URL 路径含 /student/ 的请求（魔托 admin.jsp / sso 页等），
 *     排除 mj_view 域接口带来的干扰 Cookie；
 *  2. 抓到**新**会话后先用 SSO 接口实测（请求 sso 页看是否返回授权令牌），
 *     验证通过才写入存储并发通知——通知里的会话保证可用；
 *  3. 验证请求到达时用 pending 标记防重入（避免验证请求自身再次触发捕获）。
 *
 * 通知携带 qlit:// URL：点击直达 QLIT App 自动导入。
 * 剪贴板做特性探测，支持则顺带复制一份（兼容未来版本）。
 */

var KEY_SESSION = 'qlit_session';
var KEY_AT = 'qlit_captured_at';
var KEY_PROBE = 'qlit_probe_pending';
var KEY_REJECTED = 'qlit_rejected';
var KEY_DEBUG_AT = 'qlit_debug_at';
var NOTIFY_SILENCE_MS = 5 * 60 * 1000;
var DEBUG_SILENCE_MS = 10 * 60 * 1000; // 调试通知最多 10 分钟一条

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

function hhmm(d) {
  d = d || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + p(d.getMinutes());
}

/**
 * 对新会话做一次 SSO 实测。probe 由引擎侧注入（$httpClient 实现），
 * 回调签名 cb(ok, info)；info 含 { status, preview } 供失败调试用。
 * Node 测试环境传 null 时视为可用。
 */
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

/** 失败调试通知（限频）：让用户能直接把服务端响应发回来定位问题。 */
function notifyDebug(store, notify, info) {
  var now = Date.now();
  if (now - Number(store.read(KEY_DEBUG_AT) || 0) < DEBUG_SILENCE_MS) return;
  store.write(String(now), KEY_DEBUG_AT);
  var status = (info && info.status) || '?';
  var preview = (info && info.preview) || '无响应体';
  notify('⚠️ 出行登记·调试', '会话验证未通过（HTTP ' + status + '）',
    '响应开头：' + preview + '\n请把本通知内容发给开发者');
}

function runCapture(request, store, notify, copyFn, probe) {
  var url = (request && request.url) || '';
  if (!/pass\.qlit\.edu\.cn/.test(url)) return { wrote: false, skipped: 'host' };
  // 说明：不做路径过滤。手机微信已登录态下可能全程没有 /student/ 请求，
  // 域的甄别交给下面的 SSO 实测——mj 域会话实测必然失败并进黑名单。

  var headers = (request && request.headers) || {};
  var raw = headers.Cookie || headers.cookie || '';
  var jsid = extractJsid(raw);
  if (!jsid) return { wrote: false, skipped: 'no-cookie' };

  // 已是当前会话：只刷新时间戳（保活脚本据此判断存活）
  var old = store.read(KEY_SESSION);
  var now = Date.now();
  if (jsid === old) {
    if (now - Number(store.read(KEY_AT) || 0) > NOTIFY_SILENCE_MS) {
      store.write(String(now), KEY_AT);
    }
    return { wrote: true, changed: false, copied: false };
  }
  // 验证请求自身（防重入）与已拉黑的会话都直接跳过
  if (store.read(KEY_PROBE) === jsid) return { wrote: false, pending: true };
  if (store.read(KEY_REJECTED) === jsid) return { wrote: false, rejected: true };

  // 新候选：标记 → SSO 实测 → 通过才入库并通知，失败拉黑
  store.write(jsid, KEY_PROBE);
  verifySession(jsid, probe, function (ok, info) {
    store.write('', KEY_PROBE);
    if (!ok) {
      store.write(jsid, KEY_REJECTED); // 同一坏会话不再重复探测（mj_view 请求高频出现）
      notifyDebug(store, notify, info);
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
  });
  return { wrote: false, probing: true };
}

// 代理引擎环境
if (typeof $request !== 'undefined' && typeof $done !== 'undefined') {
  try {
    runCapture($request, $persistentStore, function (t, sub, body, urlOpt) {
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
      // SSO 实测：响应体出现 setItem("Authorization" 或任意 eyJ JWT 痕迹即为会话可用
      $httpClient.get(SSO_URL, {
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
    });
  } catch (e) {
    $notification.post('出行登记', '捕获脚本异常', String(e));
  }
  $done({});
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractJsid: extractJsid, verifySession: verifySession, runCapture: runCapture, notifyDebug: notifyDebug, hhmm: hhmm };
}