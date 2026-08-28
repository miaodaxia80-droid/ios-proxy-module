/**
 * QLIT 出行登记 · 会话保活脚本（Shadowrocket 版，cron 定时）
 *
 * 每 20 分钟访问一次 admin.jsp 续 Tomcat 滑动过期。
 * 静默成功；判定失效时每小时最多提醒一次。
 */

var ADMIN_URL = 'https://pass.qlit.edu.cn/student/mobile/admin.jsp';
var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
         'AppleWebKit/537.36 NetType/WIFI ' +
         'MicroMessenger/7.0.20.1781(0x6700143B) MacWechat/3.8.7';

var KEY_SESSION = 'qlit_session';
var KEY_AT = 'qlit_captured_at';
var KEY_FAIL_AT = 'qlit_keepalive_fail_at';
var FAIL_NOTIFY_SILENCE_MS = 60 * 60 * 1000;

function hhmm(d) {
  d = d || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + p(d.getMinutes());
}

function looksLoggedOut(status, body) {
  if (/^(40[13]|30\d)/.test(status)) return true;
  var text = String(body || '');
  return /验证码|统一身份认证|账号密码|passport\/login/i.test(text) &&
         !/index\.jsp/.test(text);
}

if (typeof $httpClient !== 'undefined' && typeof $persistentStore !== 'undefined') {
  var jsid = $persistentStore.read(KEY_SESSION);
  if (!jsid) {
    if (typeof $done === 'function') $done();
  } else {
    $httpClient.get({
      url: ADMIN_URL,
      headers: {
        'User-Agent': UA,
        Cookie: 'JSESSIONID=' + jsid + '; HHMM=' + hhmm()
      },
      timeout: 15
    }, function (err, resp, data) {
      var status = '0';
      if (typeof err === 'number') status = String(err);
      else if (typeof err === 'string' && /^\d{3}$/.test(err)) status = err;
      else if (resp && (resp.status || resp.statusCode)) status = String(resp.status || resp.statusCode);
      var body = data;
      if (body == null && resp && 'body' in resp) body = resp.body;

      if (/^2\d\d$/.test(status) && !looksLoggedOut(status, body)) {
        $persistentStore.write(String(Date.now()), KEY_AT); // 续期成功
      } else if (Date.now() - Number($persistentStore.read(KEY_FAIL_AT) || 0) > FAIL_NOTIFY_SILENCE_MS) {
        $persistentStore.write(String(Date.now()), KEY_FAIL_AT);
        $notification.post('出行登记', '⚠️ 校园会话疑似失效',
          '保活请求未通过（HTTP ' + status + '）。\n在微信里重开一次在校生平台即可恢复。');
      }
      if (typeof $done === 'function') $done();
    });
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hhmm: hhmm, looksLoggedOut: looksLoggedOut };
}
