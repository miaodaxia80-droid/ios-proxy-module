/**
 * QLIT 出行登记 · 提交脚本（Shadowrocket 版）
 *
 * 与 Surge 版的差异：
 *  - $httpClient 回调签名是 (error, response, data)，response 里带 status/statusCode；
 *  - Shadowrocket 没有面板，generic 类型脚本在「脚本」列表里点一下即运行；
 *    点击运行 = 最终确认（对应 Android 版的确认弹窗），脚本不会定时自动提交。
 *
 * 顶部 FORM 为默认表单值，首次使用必须修改三项必填。
 */

// ============ 默认表单值：首次使用请修改这三项必填 ============
var FORM = {
  REGION_INDEX: 0,        // 出行区县下标，对应服务端配置列表顺序
  MODE_INDEX: 0,          // 出行方式下标
  PLACE: '',              // 出行地点 MDD（必填），例如「家」
  REASON: '',             // 出行事由 SY（必填），例如「回家探亲」
  PHONE: '',              // 紧急电话 JJDH（必填）
  ALLOW_DUPLICATE: false  // 当天已有登记时，是否仍然继续提交
};
// ============================================================

var BASE = 'https://pass.qlit.edu.cn';
var SSO_URL = BASE + '/student/mobile/sso_mj_baobei/index.jsp';
var CONFIG_URL = BASE + '/mj_view/RemoteAnswer.do?lk=61617271';
var RECORDS_URL = BASE + '/mj_view/RemoteAnswer.do?lk=87621607';
var SUBMIT_URL = BASE + '/mj_view/remoteAnswer.do?lk=46012317';

var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
         'AppleWebKit/537.36 NetType/WIFI ' +
         'MicroMessenger/7.0.20.1781(0x6700143B) MacWechat/3.8.7';
var REFERER = BASE + '/mj_view/web/addBaobei/index.html';

var KEY_SESSION = 'qlit_session';
var KEY_LOCK = 'qlit_submit_lock';
var LOCK_MS = 120 * 1000;

function hhmm(d) {
  d = d || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + p(d.getMinutes());
}
function cookieHeader(jsid) { return 'JSESSIONID=' + jsid + '; HHMM=' + hhmm(); }
function jwtOf(html) {
  var m = /setItem\("Authorization",\s*"(eyJ[^"]+)"/.exec(html || '');
  return m ? m[1] : '';
}

function unwrapMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.success === false) throw new Error(String(data.message || '接口返回失败'));
  var msg = ('message' in data) ? data.message : null;
  if (msg && typeof msg === 'string') {
    try { msg = JSON.parse(msg); } catch (e) { /* 纯文本时原样返回 */ }
  }
  return msg;
}

function buildBody(configMsg, records, form, todayIso) {
  var student = (configMsg && (configMsg.stu || {})) || {};
  var addresses = (configMsg && (configMsg.adress || configMsg.address)) || [];
  var modes = (configMsg && configMsg.cxfs) || [];

  if (!addresses.length || !modes.length) throw new Error('服务端区县/出行方式配置为空');

  var lower = String((configMsg && configMsg.timesetb) || '08:00');
  var upper = String((configMsg && configMsg.timesete) || '18:00');

  if (form.REGION_INDEX >= addresses.length) throw new Error('REGION_INDEX 超出区县数量');
  if (form.MODE_INDEX >= modes.length) throw new Error('MODE_INDEX 超出出行方式数量');

  var address = addresses[form.REGION_INDEX];
  var place = String(form.PLACE || '').trim();
  var reason = String(form.REASON || '').trim();
  var phone = String(form.PHONE || '').trim();
  var missing = [];
  if (!place) missing.push('FORM.PLACE（出行地点）');
  if (!reason) missing.push('FORM.REASON（出行事由）');
  if (!phone) missing.push('FORM.PHONE（紧急电话）');
  if (missing.length) throw new Error('请在提交脚本顶部补全默认表单值：\n' + missing.join('、'));

  var body = {
    CXRQ: todayIso,
    LXSJ: lower,
    FXSJ: upper,
    MDDQX: String(address.ID || address.CODE || ''),
    MDD: place,
    SY: reason,
    FS: modes[form.MODE_INDEX],
    JJDH: phone
  };

  var sameDay = (records || []).filter(function (r) { return String(r && r.CXRQ) === todayIso; });
  if (sameDay.length && !form.ALLOW_DUPLICATE) {
    throw new Error('今天(' + todayIso + ')已有 ' + sameDay.length + ' 条登记。' +
      '如确需重复提交，把 ALLOW_DUPLICATE 改为 true');
  }
  return { body: body, who: student.STUMC || '', from: lower, to: upper };
}

function todayIso(d) {
  d = d || new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// ============ Shadowrocket 执行流 ============

if (typeof $httpClient !== 'undefined' && typeof $persistentStore !== 'undefined') {
  var store = $persistentStore;

  /** Shadowrocket 回调 (error, response, data)——两种取数方式都兜住 */
  function adapt(cb) {
    return function (err, resp, data) {
      var status = '0';
      if (typeof err === 'number') status = String(err);
      else if (typeof err === 'string' && /^\d{3}$/.test(err)) status = err;
      else if (resp && (resp.status || resp.statusCode)) status = String(resp.status || resp.statusCode);
      var body = data;
      if (body == null && resp && 'body' in resp) body = resp.body;
      cb(status, String(body == null ? '' : body));
    };
  }

  function headersFor(jsid, jwt) {
    var h = {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Origin: BASE,
      Referer: REFERER,
      Cookie: cookieHeader(jsid)
    };
    if (jwt) h.Authorization = jwt;
    return h;
  }

  function httpGet(url, headers, cb) {
    $httpClient.get(url, { headers: headers }, adapt(cb));
  }
  function httpPost(url, obj, headers, cb) {
    var h = Object.assign({}, headers, { 'Content-Type': 'application/json' });
    $httpClient.post(url, { headers: h, body: JSON.stringify(obj) }, adapt(cb));
  }

  function notify(sub, body) { $notification.post('出行登记', sub, body); }
  function finish() { $done({}); }

  runSubmit();

  function runSubmit() {
    var jsid = store.read(KEY_SESSION);
    if (!jsid) {
      notify('未捕获到会话', '请先在微信打开「齐鲁理工微服务-在校生服务平台」，\n看到捕获通知后再回来运行一次本脚本。');
      finish();
      return;
    }

    // 并发锁：短时间内重复点运行直接忽略
    var now = Date.now();
    var lockAt = Number(store.read(KEY_LOCK) || 0);
    if (now - lockAt < LOCK_MS) { finish(); return; }
    store.write(String(now), KEY_LOCK);

    httpGet(SSO_URL, headersFor(jsid), function (st1, html) {
      var jwt = jwtOf(html);
      if (!jwt) {
        store.write('', KEY_LOCK);
        notify('✗ 会话已过期', 'SSO 未返回授权令牌。\n请在微信里重新打开一次在校生服务平台，再回来提交。');
        finish();
        return;
      }

      httpGet(CONFIG_URL, headersFor(jsid, jwt), function (_st2, cfgText) {
        var cfgMsg;
        try { cfgMsg = unwrapMessage(JSON.parse(cfgText)); } catch (e) {
          store.write('', KEY_LOCK);
          notify('✗ 配置解析失败', String(e).slice(0, 200));
          finish();
          return;
        }

        httpGet(RECORDS_URL, headersFor(jsid, jwt), function (_st3, recText) {
          var records = [];
          try {
            var recMsg = unwrapMessage(JSON.parse(recText));
            if (Array.isArray(recMsg)) records = recMsg;
          } catch (e) { /* 记录读取失败不阻断 */ }

          var built;
          try { built = buildBody(cfgMsg, records, FORM, todayIso()); } catch (e) {
            store.write('', KEY_LOCK);
            notify('✗ 无法提交', String(e).slice(0, 200));
            finish();
            return;
          }

          httpPost(SUBMIT_URL, built.body, headersFor(jsid, jwt), function (_st4, subText) {
            store.write('', KEY_LOCK);
            var ok = false, detail = '';
            try {
              var res = JSON.parse(subText);
              ok = res && res.success === true;
              detail = String(res && res.message || '').slice(0, 150);
            } catch (e) {
              detail = ('非 JSON 响应: ' + String(subText)).slice(0, 150);
            }
            if (ok) {
              notify('✓ 提交成功' + (built.who ? '：' + built.who : ''),
                built.body.CXRQ + ' ' + built.body.LXSJ + '-' + built.body.FXSJ + '\n' +
                built.body.MDD + ' · ' + built.body.FS);
            } else {
              notify('✗ 提交失败', detail || '未知原因');
            }
            finish();
          });
        });
      });
    });
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    hhmm: hhmm,
    cookieHeader: cookieHeader,
    jwtOf: jwtOf,
    unwrapMessage: unwrapMessage,
    buildBody: buildBody,
    todayIso: todayIso
  };
}