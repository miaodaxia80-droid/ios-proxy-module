# QLIT 出行登记助手 · 代理 App 模块（iPhone）

把「会话捕获 + 提交 + 保活」放进 Surge / Loon / Stash / **Shadowrocket** 的脚本模块，
iPhone 端体验对标 Android 版：

```text
微信打开「齐鲁理工微服务-在校生服务平台」并登录
  → 几秒后收到通知「已捕获校园会话」
  → 面板/磁贴点「出行登记」提交
  → 收到成功或失败通知
```

会话在登录后几秒内即被使用，因此不受 JSESSIONID 短时效影响；
保活脚本再把滑动过期续成长期会话（见下文）。

## 文件结构

```text
ios-proxy-module/
├── qlit-travel.sgmodule    Surge 模块
├── qlit-travel.plugin      Loon 插件
├── qlit-travel.stoverride  Stash 覆写
├── shadowrocket/
│   ├── qlit-travel.conf    Shadowrocket 配置片段（并入主配置用）
│   ├── qlit-submit.js      提交脚本 SR 版（generic 手动运行）
│   └── qlit-keepalive.js   保活脚本 SR 版（cron）
└── scripts/
    ├── qlit-capture.js     抓取：任何带 JSESSIONID 的校园域请求 → 持久存储（三端共用）
    ├── qlit-submit.js      提交：SSO→JWT→配置→提交→通知（Surge 系，顶部 FORM 可编辑）
    └── qlit-keepalive.js   保活：每 20 分钟探活 admin.jsp 续期滑动过期（Surge 系）
```

## 安装前提（三个 App 相同）

1. 在代理 App 内**生成根证书**，到 iOS 设置中安装描述文件，再到
   `设置 → 通用 → 关于本机 → 证书信任设置` 给它打开完全信任；
2. 开启 MITM 且解密域名仅包含 `pass.qlit.edu.cn`（清单文件已声明）。

## Surge / Loon / Stash 安装方式

- **推荐（在线模块）**：先把本分支推送到 GitHub，然后在 App 中以 URL 导入
  对应清单文件（`raw.githubusercontent.com` 地址，脚本已在清单里引用同名仓库路径；
  如果换分支或 fork 了仓库，请替换清单里的脚本 URL 前缀）。
- **离线**：用 AirDrop 把 `scripts/*.js` 与对应清单文件发到手机，
  按各 App 的本地目录规则放置，并把清单里四个 `script-path/script:` 改成本地相对路径。

## Shadowrocket 安装方式（手动添加，无需导入配置文件）

Shadowrocket 没有模块/面板概念，但脚本引擎与 Surge 同族，三步在 UI 里完成：

**① 证书与解密**

1. 打开 Shadowrocket → 底部「设置」→「证书」→「生成并安装证书」（无证书时先点生成）；
2. 按系统提示允许下载描述文件 → 「设置 → 通用 → VPN与设备管理」安装；
3. 「设置 → 通用 → 关于本机 → 证书信任设置」→ 打开该证书的「完全信任」；
4. 回 Shadowrocket → 「设置 → 点按顶部证书行（如 MisakaCA）确认描述文件已安装」；
5. 「设置 → HTTPS 解密」→ 打开「解密 HTTPS」开关，并在「Hostname」列表里添加
   `pass.qlit.edu.cn`（其它域名不要加）。

**② 添加三条脚本**（设置 → 脚本 → 右上角 ＋）

| 名称 | 类型 | URL 模式 / 表达式 | 脚本 | requires body |
|---|---|---|---|---|
| QLIT Captor | http-response | `^https?:\/\/pass\.qlit\.edu\.cn\/` | `ios-proxy-module/scripts/qlit-capture.js` | 关 |
| QLIT KeepAlive | cron | 定期执行填 `*/20 * * * *` | `ios-proxy-module/shadowrocket/qlit-keepalive.js` | - |
| QLIT Submit | generic | （无） | `ios-proxy-module/shadowrocket/qlit-submit.js` | - |

脚本路径填远程 raw 地址（仓库推送后）或本地路径。本地路径推荐：
把三个 js 放入 iCloud 或「我的 iPhone/Shadowrocket」目录，路径写相对文件名即可；
不要放到微信/备忘录等沙盒目录，Shadowrocket 读不到。

**③ 启动**

顶部开关打开小火箭（VPN 生效），保持「配置」里路由为正常状态即可；
SSL 解密作用于流经小火箭的全部 HTTPS 会话，与代理/直连模式无关。

之后回到下方「使用流程」：微信登录平台 → 等捕获通知 → 「设置 → 脚本」里
**点一下 QLIT Submit 的那一行**即执行提交 → 收结果通知（每次提交都必须手动点这一下，
这就是你的确认动作）。

## 必须修改的默认值

打开 `scripts/qlit-submit.js`（Surge/Loon/Stash）或
`shadowrocket/qlit-submit.js`（Shadowrocket）顶部 FORM 区块：

| 字段 | 含义 | 默认 |
|---|---|---|
| `PLACE` | 出行地点（必填） | 空——不改会在提交通知时报缺失 |
| `REASON` | 出行事由（必填） | 空 |
| `PHONE` | 紧急电话（必填） | 空 |
| `REGION_INDEX` | 服务端区县列表下标 | 0 |
| `MODE_INDEX` | 出行方式列表下标 | 0 |
| `ALLOW_DUPLICATE` | 当天已有登记时是否仍提交 | false |

区县和方式的完整列表来自服务端配置接口，无需手填 ID；
不确定顺序就先用小工具看一次 `lk=61617271` 的返回。

## 使用流程

1. 微信完成平台登录 → 等「已捕获校园会话」通知；
2. 点面板「出行登记」→ 三五秒后收到结果通知；
3. 会话失效时的提示是「会话过期，请去微信刷新登录态」，重新登录一次即可闭环。

## 保活与过期边界

`qlit-keepalive.js` 每 20 分钟访问一次 `admin.jsp` 续 Tomcat 滑动过期，
失败时每小时最多提醒一次。但它**不能对抗**三类硬性失效：
后端 sticky 节点切换、服务端重启、他处重新登录顶号——这些都会走
提交流程的过期兜底提示，属预期行为而非 Bug。

## 安全注意

- `JSESSIONID` 等价于你的登录态：不截图、不发群、不入 Git；
- 提交是真实写库操作；点击面板即视为最终确认，脚本不做定时自动提交；
- 仅限本人账号使用。

## 待真机验证项

- [ ] E3：iOS 微信 WebView 是否遵循 VPN 代理且无证书固定（路线 B 生死项，Shadowrocket 同样适用）；
- [ ] Shadowrocket：`$httpClient` 回调取数（`adapt` 已兼容 error/response 两种形态）与
      generic 脚本点击运行的行为；
- [ ] Stash 清单键名是否与其 wiki 完全一致（文件内已标注核对点）；
- [ ] Loon generic 面板语法（不可用时按注释改走「脚本页手动运行」）;
- [ ] `admin.jsp` 是否必然出现在登录后的页面资源里（抓取钩子已放宽为全域名兜底）。
