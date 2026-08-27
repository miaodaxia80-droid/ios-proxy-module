/**
 * QLIT 出行登记 · 会话保活脚本（cron 定时）
 *
 * 原理：服务端大概率是 Tomcat 滑动过期（最后访问后 N 分钟销毁），
 * 每 20 分钟访问一次 admin.jsp 即可续期同一个 JSESSIONID。
 *
 * 静默成功；只在判定失效时发通知（每小时最多提醒一次），避免打扰。
 * 注意保活不能对抗：后端节点切换、服务端重启、他处重新登录顶号——
 * 这些场景交给提交流程的“会话过期”兜底提示。
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

/** 判定响应是否像登录页（即会话已无效） */
function looksLoggedOut(status, body) {
  if (/^(40[13]|30\d)/.test(status)) return true;
  var text = String(body || '');
  return /验证码|统一身份认证|账号密码|passport\/login/i.test(text) &&
         !/index\.jsp/.test(text);
}

if (typeof $httpClient !== 'undefined' && typeof $persistentStore !== 'undefined') {
  var jsid = $persistentStore.read(KEY_SESSION);
  if (!jsid) {
    // 从未捕获过会话：保活无事可做，静默退出
    if (typeof $done === 'function') $done();
  } else {
    $httpClient.get({
      url: ADMIN_URL,
      headers: {
        'User-Agent': UA,
        Cookie: 'JSESSIONID=' + jsid + '; HHMM=' + hhmm()
      },
      timeout: 15
    }, function (status, _resp, data) {
      var st = String(status);
      if (/^2\d\d$/.test(st) && !looksLoggedOut(st, data)) {
        $persistentStore.write(String(Date.now()), KEY_AT); // 续期成功
      } else if (Date.now() - Number($persistentStore.read(KEY_FAIL_AT) || 0) > FAIL_NOTIFY_SILENCE_MS) {
        $persistentStore.write(String(Date.now()), KEY_FAIL_AT);
        $notification.post('出行登记', '⚠️ 校园会话疑似失效',
          '保活请求未通过（HTTP ' + st + '）。\n在微信里重开一次在校生平台即可恢复。');
      }
      if (typeof $done === 'function') $done();
    });
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hhmm: hhmm, looksLoggedOut: looksLoggedOut };
}
