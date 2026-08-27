/**
 * QLIT 出行登记 · 诊断面板脚本（generic）
 *
 * 点击面板把捕获相关的全部内部状态用通知报出来：
 * 当前会话、黑名单、探测中标记、已发现的校园子域名、最近捕获时间。
 * 排查"收不到通知"类问题时，点一下把通知全文发给开发者即可。
 */

var KEYS = {
  session: 'qlit_session',
  at: 'qlit_captured_at',
  probe: 'qlit_probe_pending',
  rejected: 'qlit_rejected',
  hosts: 'qlit_hosts_seen'
};

function mask(v) {
  v = String(v || '');
  if (!v) return '无';
  return v.length <= 16 ? v.slice(0, 8) + '…' : v.slice(0, 12) + '…';
}

function ageText(ms) {
  var n = Number(ms || 0);
  if (!n) return '从未';
  var mins = Math.round((Date.now() - n) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return mins + ' 分钟前';
  return Math.round(mins / 60) + ' 小时前';
}

if (typeof $persistentStore !== 'undefined' && typeof $done !== 'undefined') {
  var lines = [
    '当前会话：' + mask($persistentStore.read(KEYS.session)),
    '最近捕获：' + ageText($persistentStore.read(KEYS.at)),
    '黑名单：' + mask($persistentStore.read(KEYS.rejected)),
    '探测中：' + ($persistentStore.read(KEYS.probe) ? mask($persistentStore.read(KEYS.probe)) : '无'),
    '已见子域：' + (String($persistentStore.read(KEYS.hosts) || '（空，尚未见到任何 qlit.edu.cn 请求）'))
  ];
  $notification.post('出行登记·诊断', '点击展开查看详情', lines.join('\n'));
  $done({ title: '出行登记·诊断', content: '详见通知' });
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mask: mask, ageText: ageText };
}