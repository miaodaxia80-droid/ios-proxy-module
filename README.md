# QLIT 出行登记助手 · 代理 App 模块（iPhone）

把「会话捕获 + 提交 + 保活」放进 Surge / Loon / Stash 的脚本模块，
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
└── scripts/
    ├── qlit-capture.js     抓取：任何带 JSESSIONID 的校园域请求 → 持久存储
    ├── qlit-submit.js      提交：SSO→JWT→配置→提交→通知（顶部 FORM 可编辑）
    └── qlit-keepalive.js   保活：每 20 分钟探活 admin.jsp 续期滑动过期
```

## 安装前提（三个 App 相同）

1. 在代理 App 内**生成根证书**，到 iOS 设置中安装描述文件，再到
   `设置 → 通用 → 关于本机 → 证书信任设置` 给它打开完全信任；
2. 开启 MITM 且解密域名仅包含 `pass.qlit.edu.cn`（清单文件已声明）。

## 安装方式

- **推荐（在线模块）**：先把本分支推送到 GitHub，然后在 App 中以 URL 导入
  对应清单文件（`raw.githubusercontent.com` 地址，脚本已在清单里引用同名仓库路径；
  如果换分支或 fork 了仓库，请替换清单里的脚本 URL 前缀）。
- **离线**：用 AirDrop 把 `scripts/*.js` 与对应清单文件发到手机，
  按各 App 的本地目录规则放置，并把清单里四个 `script-path/script:` 改成本地相对路径。

## 必须修改的默认值

打开 `scripts/qlit-submit.js` 顶部 FORM 区块：

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

- [ ] E3：iOS 微信 WebView 是否遵循 VPN 代理且无证书固定（路线 B 生死项）；
- [ ] Stash 清单键名是否与其 wiki 完全一致（文件内已标注核对点）；
- [ ] Loon generic 面板语法（不可用时按注释改走「脚本页手动运行」）;
- [ ] `admin.jsp` 是否必然出现在登录后的页面资源里（抓取钩子已放宽为全域名兜底）。
