/**
 * QLIT 出行登记 · 会话捕获脚本
 *
 * 以 http-response 钩子挂在整个校园域上：任何携带 student 域 JSESSIONID 的
 * 请求都会把会话写入 $persistentStore；**抓到新会话时自动尝试复制到剪贴板**，
 * 复制成功后主 App 「出行登记」里直接粘贴即可导入。
 *
 * 剪贴板说明：Surge 不同版本对剪贴板 API 支持不一，脚本做特性探测；
 * 若当前版本不可用，通知会改为显示完整会话，长按通知「拷贝」。
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

/**
 * 尝试把文本写入剪贴板。copyFn 由引擎侧注入（特性探测后的具体实现），
 * 返回是否成功；Node 测试环境不可用时传 null。
 */
function writeClipboard(text, copyFn) {
  try {
    if (typeof copyFn === 'function') return copyFn(text);
  } catch (e) { /* 忽略，走通知兜底 */ }
  return false;
}

function runCapture(request, store, notify, copyFn) {
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
    var copied = writeClipboard(jsid, copyFn);
    // 优先走通知 URL 直达：点击通知即把会话投递给 QLIT App 自动导入
    notify('出行登记', '✓ 已捕获校园会话' + (copied ? '，已复制' : ''),
      '点此打开 QLIT 自动导入',
      { url: 'qlit://import-session?value=' + encodeURIComponent(jsid) });
    return { wrote: true, changed: true, copied: copied };
  }
  // 会话没变：超过静默窗才刷新时间戳（给保活脚本一个“最后确认存活”参考）
  if (now - Number(store.read(KEY_AT) || 0) > NOTIFY_SILENCE_MS) {
    store.write(String(now), KEY_AT);
  }
  return { wrote: true, changed: false, copied: false };
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
      // 特性探测：有 $clipboard.write 就直写剪贴板（部分版本支持）
      if (typeof $clipboard !== 'undefined' && $clipboard && typeof $clipboard.write === 'function') {
        $clipboard.write(text);
        return true;
      }
      return false;
    });
  } catch (e) {
    $notification.post('出行登记', '捕获脚本异常', String(e));
  }
  $done({});
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractJsid: extractJsid, writeClipboard: writeClipboard, runCapture: runCapture };
}