/* 代理引擎外可跑的冒烟测试：node tests/smoke.cjs */
const assert = require('assert');
const path = require('path');

const capture = require(path.join(__dirname, '..', 'scripts', 'qlit-capture.js'));
const submit = require(path.join(__dirname, '..', 'scripts', 'qlit-submit.js'));
const keepalive = require(path.join(__dirname, '..', 'scripts', 'qlit-keepalive.js'));
const diagnose = require(path.join(__dirname, '..', 'scripts', 'qlit-diagnose.js'));
// Shadowrocket 版与 Surge 版共享全部纯函数（仅网络回调适配不同）
const srSubmit = require(path.join(__dirname, '..', 'shadowrocket', 'qlit-submit.js'));
const srKeepalive = require(path.join(__dirname, '..', 'shadowrocket', 'qlit-keepalive.js'));

let n = 0;
function t(name, fn) {
  fn();
  n++;
  console.log('  ok -', name);
}

// ---------- capture 基础 ----------
t('extractJsid 从 Cookie 头提取并保留 sticky 后缀', () => {
  assert.strictEqual(capture.extractJsid('JSESSIONID=ABC123.node1; HHMM=1200'), 'ABC123.node1');
});
t('extractJsid 支持数组形式的头', () => {
  assert.strictEqual(capture.extractJsid(['JSESSIONID=XYZ']), 'XYZ');
});
t('extractJsid 空值/无会话安全返回空串', () => {
  assert.strictEqual(capture.extractJsid(''), '');
  assert.strictEqual(capture.extractJsid('FOO=bar'), '');
});
t('hostOf 解析 hostname', () => {
  assert.strictEqual(capture.hostOf('https://pass.qlit.edu.cn/student/x?y=1'), 'pass.qlit.edu.cn');
  assert.strictEqual(capture.hostOf('https://xg.qlit.edu.cn/a/b'), 'xg.qlit.edu.cn');
  assert.strictEqual(capture.hostOf('not a url'), '');
});

const memStore = (init = {}) => {
  const kv = Object.assign({}, init);
  return {
    read: k => (k in kv ? kv[k] : ''),
    write: (v, k) => { kv[k] = v; }
  };
};
const probeSync = (ok) => (jsid, cb) => cb(ok);

// ---------- capture：域名发现与过滤 ----------
t('capture 非校园域请求忽略', () => {
  const store = memStore();
  const r = capture.runCapture({ url: 'https://a.com/x', headers: { Cookie: 'JSESSIONID=S' } }, store, () => {});
  assert.strictEqual(r.skipped, 'host');
});
t('capture 其他校园子域只记录发现不入库', () => {
  const store = memStore({ qlit_hostnote_at: '0' });
  const notes = [];
  const r = capture.runCapture(
    { url: 'https://xg.qlit.edu.cn/wechat/index', headers: { Cookie: 'JSESSIONID=XX' } },
    store,
    (t1, sub) => notes.push([t1, sub]),
    () => true,
    () => { throw new Error('不应探测'); }
  );
  assert.strictEqual(r.discovered, 'xg.qlit.edu.cn');
  assert.strictEqual(store.read('qlit_session'), '');
  assert.strictEqual(store.read('qlit_hosts_seen'), 'xg.qlit.edu.cn');
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0][0], /发现域名/);
  // 同一子域再来一次：不再通知
  const notes2 = [];
  capture.runCapture(
    { url: 'https://xg.qlit.edu.cn/other', headers: {} },
    store, (t1, sub) => notes2.push(sub)
  );
  assert.strictEqual(notes2.length, 0);
});
t('capture pass 域无 Cookie 请求发调试通知', () => {
  const store = memStore({ qlit_debug_at: '0' });
  const notes = [];
  const r = capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/student/mobile/admin.jsp', headers: {} },
    store, (t1, sub, body) => notes.push([t1, sub, body])
  );
  assert.strictEqual(r.skipped, 'no-cookie');
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0][2], /未携带 JSESSIONID/);
});

// ---------- capture：会话验证流 ----------
t('capture 新会话实测通过 → 入库 + qlit:// 直达通知', () => {
  const store = memStore();
  const notes = [];
  const r = capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/student/mobile/admin.jsp', headers: { Cookie: 'JSESSIONID=S1' } },
    store,
    (t1, sub, body, urlOpt) => notes.push([t1, sub, body, urlOpt]),
    () => true,
    probeSync(true)
  );
  assert.strictEqual(r.probing, true);
  assert.strictEqual(store.read('qlit_session'), 'S1');
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0][1], /已捕获校园会话，已复制/);
  assert.strictEqual(notes[0][3].url, 'qlit://import-session?value=S1');
});
t('capture 实测失败 → 拉黑 + 调试通知（限频）', () => {
  const store = memStore({ qlit_debug_at: '0' });
  const notes = [];
  capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/mj_view/x', headers: { Cookie: 'JSESSIONID=MJ1' } },
    store,
    (t1, sub) => notes.push(sub),
    () => true,
    (j, cb) => cb(false, { status: '200', preview: '<html>登录页</html>' })
  );
  assert.strictEqual(store.read('qlit_session'), '');
  assert.strictEqual(store.read('qlit_rejected'), 'MJ1');
  assert.strictEqual(notes.length, 1);
  // 黑名单会话再次出现：直接跳过，不探测不通知
  const r2 = capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/mj_view/y', headers: { Cookie: 'JSESSIONID=MJ1' } },
    store, () => {},
    () => true,
    (j, cb) => { throw new Error('不应再探测'); }
  );
  assert.strictEqual(r2.rejected, true);
});
t('capture 探测通过后清黑名单', () => {
  const store = memStore({ qlit_rejected: 'OLD' });
  capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/student/x', headers: { Cookie: 'JSESSIONID=GOOD' } },
    store, () => {},
    () => true,
    probeSync(true)
  );
  assert.strictEqual(store.read('qlit_session'), 'GOOD');
  assert.strictEqual(store.read('qlit_rejected'), '');
});
t('capture 同值会话不重复探测', () => {
  const store = memStore({ qlit_session: 'S1', qlit_captured_at: String(Date.now()) });
  let probeCalls = 0;
  capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/student/x', headers: { Cookie: 'JSESSIONID=S1' } },
    store, () => {},
    () => true,
    (j, cb) => { probeCalls++; cb(true); }
  );
  assert.strictEqual(probeCalls, 0);
});
t('capture pending 标记防验证重入', () => {
  const store = memStore({ qlit_probe_pending: 'S9' });
  const r = capture.runCapture(
    { url: 'https://pass.qlit.edu.cn/student/x', headers: { Cookie: 'JSESSIONID=S9' } },
    store, () => {}
  );
  assert.strictEqual(r.pending, true);
  assert.strictEqual(store.read('qlit_session'), '');
});

// ---------- submit ----------
t('hhmm 补零', () => {
  assert.strictEqual(capture.hhmm(new Date(2026, 0, 2, 7, 5)), '0705');
});
t('cookieHeader 携带 JSESSIONID 与 HHMM', () => {
  assert.match(submit.cookieHeader('AB'), /^JSESSIONID=AB; HHMM=\d{4}$/);
});
t('jwtOf 匹配 SSO 页内 setItem 授权令牌', () => {
  const html = '<script>localStorage.setItem("Authorization", "eyJhbGci.eyJzdXA.tok");</script>';
  assert.strictEqual(submit.jwtOf(html), 'eyJhbGci.eyJzdXA.tok');
  assert.strictEqual(submit.jwtOf('<html>登录页</html>'), '');
});
t('unwrapMessage：JSON 字符串解析、失败抛错、纯文本透传', () => {
  assert.deepStrictEqual(submit.unwrapMessage({ message: '{"adress":[]}' }), { adress: [] });
  assert.throws(() => submit.unwrapMessage({ success: false, message: '没登录' }), /没登录/);
  assert.strictEqual(submit.unwrapMessage({ message: '成功' }), '成功');
});

const CFG = {
  stu: { STUMC: '张三' },
  adress: [{ ID: '370181', NAME: '历城' }, { CODE: '370112', NAME: '历下' }],
  cxfs: ['步行', '公交'],
  timesetb: '08:00',
  timesete: '18:00'
};
const FORM_OK = { REGION_INDEX: 1, MODE_INDEX: 1, PLACE: ' 家 ', REASON: '回家', PHONE: '13800000000', ALLOW_DUPLICATE: false };

t('buildBody 组装完整提交体（含历史拼写 adress 与 CODE 兜底）', () => {
  const { body, who } = submit.buildBody(CFG, [], FORM_OK, '2026-08-27');
  assert.deepStrictEqual(body, {
    CXRQ: '2026-08-27', LXSJ: '08:00', FXSJ: '18:00',
    MDDQX: '370112', MDD: '家', SY: '回家', FS: '公交', JJDH: '13800000000'
  });
  assert.strictEqual(who, '张三');
});
t('buildBody 缺必填时列出全部缺失项', () => {
  try {
    submit.buildBody(CFG, [], { ...FORM_OK, PHONE: '' }, '2026-08-27');
    assert.fail('应当抛错');
  } catch (e) {
    assert.match(e.message, /FORM\.PHONE/);
  }
});
t('buildBody 同日已有登记且未允许重复时阻断', () => {
  assert.throws(
    () => submit.buildBody(CFG, [{ CXRQ: '2026-08-27' }], FORM_OK, '2026-08-27'),
    /已有 1 条登记/
  );
  submit.buildBody(CFG, [{ CXRQ: '2026-08-27' }],
    { ...FORM_OK, ALLOW_DUPLICATE: true }, '2026-08-27');
});
t('buildBody 下标越界与空配置报错', () => {
  assert.throws(() => submit.buildBody(CFG, [], { ...FORM_OK, REGION_INDEX: 9 }, '2026-08-27'), /REGION_INDEX/);
  assert.throws(() => submit.buildBody({ cxfs: [] }, [], FORM_OK, '2026-08-27'), /配置为空/);
});
t('todayIso 为本地日期 YYYY-MM-DD', () => {
  assert.match(submit.todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- keepalive ----------
t('looksLoggedOut 区分失效与正常', () => {
  assert.strictEqual(keepalive.looksLoggedOut('403', ''), true);
  assert.strictEqual(keepalive.looksLoggedOut('302', ''), true);
  assert.strictEqual(keepalive.looksLoggedOut('200', ''), false);
  assert.strictEqual(keepalive.looksLoggedOut('200', '<html>统一身份认证登录</html>'), true);
  assert.strictEqual(keepalive.looksLoggedOut('200', '<html>欢迎返校</html>'), false);
});

// ---------- diagnose ----------
t('diagnose mask/ageText 文案', () => {
  assert.strictEqual(diagnose.mask(''), '无');
  assert.strictEqual(diagnose.mask('ABCDEFGHIJKLMNOP'), 'ABCDEFGH…');
  assert.strictEqual(diagnose.ageText('0'), '从未');
  assert.match(diagnose.ageText(String(Date.now() - 5 * 60000)), /5 分钟前/);
});

// ---------- Shadowrocket 版一致性 ----------
t('SR 版与 Surge 版纯函数行为一致', () => {
  assert.deepStrictEqual(Object.keys(srSubmit).sort(), Object.keys(submit).sort());
  assert.deepStrictEqual(Object.keys(srKeepalive).sort(), Object.keys(keepalive).sort());
  assert.strictEqual(srSubmit.jwtOf('<script>setItem("Authorization", "eyJx.y.z")</script>'), 'eyJx.y.z');
  assert.match(srSubmit.cookieHeader('SR1'), /^JSESSIONID=SR1; HHMM=\d{4}$/);
  assert.strictEqual(srKeepalive.looksLoggedOut('200', ''), false);
  const body = srSubmit.buildBody(CFG, [], FORM_OK, '2026-08-27').body;
  assert.strictEqual(body.MDDQX, '370112');
  assert.strictEqual(body.FS, '公交');
});

console.log(`\n${n} 个断言组全部通过`);
