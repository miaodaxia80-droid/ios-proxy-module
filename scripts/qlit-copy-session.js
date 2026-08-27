/**
 * QLIT 出行登记 · 复制会话面板脚本（generic）
 *
 * 点击面板把当前捕获的 JSESSIONID 复制到剪贴板，供 QLIT App 粘贴导入。
 *
 * 剪贴板说明：不同版本的 Surge 脚本运行时对剪贴板 API 支持不一。
 * 脚本做特性探测：有 $clipboard 直写剪贴板；没有则把完整会话放进通知，
 * 通知可长按「拷贝」复制（iOS 16+），效果等价。
 */

var KEY_SESSION = 'qlit_session';

if (typeof $persistentStore !== 'undefined' && typeof $done !== 'undefined') {
  var session = $persistentStore.read(KEY_SESSION) || '';
  if (!session) {
    $notification.post('出行登记', '未捕获到会话', '请先在微信打开「校园微服务-在校服务平台」完成登录。');
    $done({ title: '出行登记', content: '未捕获会话，请先在微信登录平台' });
  } else {
    var copied = false;
    try {
      if (typeof $clipboard !== 'undefined' && $clipboard && typeof $clipboard.write === 'function') {
        $clipboard.write(session);
        copied = true;
      }
    } catch (e) { /* 继续走通知兜底 */ }

    if (copied) {
      $notification.post('出行登记', '✓ 会话已复制', '打开 QLIT「出行登记」粘贴即可');
      $done({ title: '出行登记', content: '会话已复制到剪贴板' });
    } else {
      $notification.post('出行登记', '请长按本通知并「拷贝」', session);
      $done({ title: '出行登记', content: '会话较长，请长按通知拷贝' });
    }
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KEY_SESSION: KEY_SESSION };
}