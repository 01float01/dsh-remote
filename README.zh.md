# dsh-remote

用手机或平板的浏览器，通过同一 Wi-Fi 访问电脑上的 **DSH** Web 界面。
不需要装 App、不需要 VPN、不需要 Termux、不需要内网穿透 —— 一个网址、一次证书例外、一个口令。

[English](README.md) | 中文

> **先说边界。** 这套网关是为**唯一一种部署**写的：**北京邮电大学校园网 BUPT-mobile** 上的一台
> **手机或平板**浏览器。**其它校园网 / 企业网没有考虑过** —— Wi-Fi 客户端隔离、认证门户（captive
> portal）、802.1X/EAP、仅 IPv6、强制代理，这些情况代码里都没有处理，也**不保证换个网络能直接
> 跑起来**。
>
> **实际验过什么**（完整口径见 [docs/cross-device.md](docs/cross-device.md)）：**荣耀 MagicOS
> 平板与手机，实机通过**；**鸿蒙 HarmonyOS —— 实机实测 + 官方云测试，均通过**；
> **iOS / iPadOS —— 官方云测试通过**；安卓通用 / **三星 / vivo / OPPO 在各自厂商官方开发者平台
> 提供的虚拟设备上通过** —— 是虚拟设备，不是实体机；**小米仅做理论验证**，没有上机、也没有跑虚拟机。
>
> **硬地板**：**iOS ≈ 16.4**，**Chromium/Android ≈ 94** —— 低于这个版本页面跑不起来，因为 App 需要
> 的 API 超出 polyfill 能补的范围。**老旧系统请装一个现代第三方浏览器**（Chrome / Edge / Firefox）
> 再访问，不要用系统自带浏览器。
>
> **测试只证明它测的那部分。** `npm test` 证明网关能启动、能鉴权、能代理、三处注入都在；
> 它**不**证明你的手机、你的浏览器、你的网络能跑通。

```
手机/平板浏览器  ──https://<局域网IP>:8443──▶  网关（Node，零依赖）  ──http://127.0.0.1:5140──▶  DSH Web
```

## 解决什么问题

DSH 的 Web 服务只监听 `127.0.0.1:5140`。这是对的默认值：它不对局域网开放，启动 token 也不出机器。
代价是平板用不上，而每种绕法都有成本：

| 绕法 | 代价 |
| --- | --- |
| 把 DSH 端口直接暴露 | 没有 TLS、没有鉴权、没有 Origin 改写 |
| SSH 登录主机 + 端口转发 | 手机上要终端，后台进程会被厂商省电策略杀掉 |
| Tailscale / VPN | 每台设备装客户端、要账号，链路常常绕境外 |
| 拷文件来回倒 | 不是同一个界面 |

本项目在中间放一层小而可审计的代理：说 TLS、要口令，DSH 仍然只在回环。

## 你得到什么

- **`gateway/`** —— 单文件、零依赖的 Node HTTPS 反向代理（约 570 行）：TLS 终结、口令门、
  会话 Cookie、限流与锁定、gzip 与静态资源缓存、流式请求体、WebSocket 升级、自签证书生成、
  崩溃自动重启的启动器。
- **注入到 DSH 页面里**（**从不修改 DSH 本体**）：
  - `gateway/polyfill.js` —— 补齐部分 OEM 浏览器缺失的现代 JS API，让 DSH 的 RPC 不再卡在
    "重新连接中"。
  - `ownsHost` 垫片 —— 让 DSH 把远程页面当作受信宿主，设置页与模型页正常可用，而不是报
    "settings are unavailable in this browser"。
  - `ui/responsive.css` + `ui/responsive.js` —— 竖屏布局层，把桌面三栏自动变成可用的单列手机
    UI，转回横屏自动还原。
- **文档** —— 安全模型、实测记录、移动端覆盖范围的诚实交代、局域网之外的接入方案。

## 快速开始

前置：Node.js ≥ 20、`PATH` 上有 `openssl`（或设 `DSH_GATE_OPENSSL`）、本机已装并运行 DSH、
手机与电脑同一 Wi-Fi。

```bash
git clone https://github.com/01float01/dsh-remote.git
cd dsh-remote
```

**1. 告诉网关 DSH 的 token 写在哪。** DSH 每次启动都会轮换 token，网关从启动器的 stdout 日志里
读它。二选一：

```powershell
$env:DSH_GATE_TOKEN_LOG = "C:\path\to\dsh-launch-stdout.log"
```

或写进 `gateway/state/config.json`（首次运行自动生成）的 `tokenLog` 字段。不配也能跑，只是没有
自动登录交接 —— 日志和 `/__gate/health` 会告诉你 token 缺失。

**2. 启动网关。**

- Windows：双击 `gateway/run-gateway.vbs`（可见控制台 + 看门狗）。
- 任意系统：`npm start` 或 `node gateway/gateway.mjs`。

控制台会显示访问地址、生成的接入口令、以及可扫的二维码。

**3. 手机端**：打开 `https://<局域网IP>:8443/`，首次提示证书不受信任 →「高级」→「继续前往」
（自签证书，链路仍加密）→ 输入口令。会话 Cookie 30 天有效，之后打开即用。

运行期文件都在 `gateway/state/`（已 gitignore）：口令、证书、会话密钥、日志、二维码文本。

## 配置

两层：环境变量（临时、每次启动）与 `gateway/state/config.json`（持久，每次启动写回；环境变量优先）。

| 环境变量 | `config.json` 键 | 默认 | 含义 |
| --- | --- | --- | --- |
| `DSH_GATE_IP` | `bindIp` | 自动探测 | 绑定地址。自动探测优先选 RFC 1918 私网地址。 |
| `DSH_GATE_PORT` | `listenPort` | `8443` | TLS 监听端口。 |
| `DSH_GATE_DSH_PORT` | `dshPort` | `5140` | DSH 的回环端口。 |
| — | `dshHost` | `127.0.0.1` | DSH 主机。 |
| `DSH_GATE_TOKEN_LOG` | `tokenLog` | 空 | 抓取 `?token=…` 的启动器日志。 |
| `DSH_GATE_OPENSSL` | `openssl` | 自动 | 生成自签证书用的 `openssl` 路径。 |
| `DSH_GATE_STATE_DIR` | — | `gateway/state` | 运行期状态目录（测试用）。 |
| `DSH_GATE_RESPONSIVE` | — | `1` | 设为 `0` 关闭响应布局层注入。 |
| `DSH_RESPONSIVE_DIR` | — | 本仓库 `ui/` | 换一份响应布局层构建。 |
| — | `cookieMaxAgeDays` | `30` | 会话 Cookie 有效期。 |

端点：`/__gate/health`（状态，含是否抓到 token）、`/__gate/diag`（能力探针接收端）、
`/__gate/login`、`/__gate/logout`。

网关每 15 秒复核本机地址；地址变了会自动重新绑定、重新签发证书、打印新的二维码。
扫新码即可，口令不变。

## 安全模型

**做到了什么**

- 传输层 TLS（EC prime256v1 自签，10 年，SAN 含局域网地址、回环与安卓模拟器别名）。
- 口令门：`scrypt` 哈希 + 计时安全比较；会话 Cookie 为 HMAC 签名、`HttpOnly`、`Secure`、
  `SameSite=Strict`；登录 POST 校验 `Sec-Fetch-Site` / `Origin`，防 CSRF。
- 抗爆破：同一来源连错 5 次起锁定（指数退避，最长 15 分钟），另有全局令牌桶限流。
- 只绑定局域网地址 + 回环，不监听所有网卡。
- 上游请求的 `Host` / `Origin` / `Referer` 一并改写回环，DSH 自带的 DNS-rebinding 围栏与
  同源校验（包括插件里的校验）在远程侧照常成立。
- DSH 的启动 token 不会到达手机：交换由网关代做。
- 登录成功/失败、锁定、WebSocket 升级、非静态代理请求都落到 `gateway/state/gateway.log`。

**没有做到什么 —— 暴露到公网前请先读这段**

- **证书是自签的。** 链路加密，但手机没有获得可验证的身份。能同时劫持你的流量、又持有你手机
  信任的证书的攻击者可以冒充网关。家用/校园 Wi-Fi 上实际风险不高，但不是零。
- **口令是共享秘密。** 只有一个口令，没有账号体系、没有按用户审计。口令会打印到控制台，并以
  明文留在 `gateway/state/password.txt` 以便查看 —— 在意的话把两处都删掉，自己设定。
- **能连到端口且知道口令的人 = 完全受信。** 这是设计使然：网关是你机器的受信延伸，这也是它让
  页面在 DSH 眼里"像回环"的原因。
- **未做安全审计。** 一个文件，自己读。零依赖把面缩小了，但"小"不等于"已验证"。
- 明确不做：多账号、按用户权限、权威 CA 证书（需要域名时的取舍见
  [docs/tunnel.md](docs/tunnel.md)）。

## 兼容性 —— 验过什么、没验什么

下面几档是**不同性质**的证据，不要当成一个笼统的"支持"。

| | 状态 |
| --- | --- |
| 网络工况 | **只有一种**：北邮 BUPT-mobile 校园网。客户端隔离、认证门户、802.1X/EAP、仅 IPv6、强制代理，均未处理、未测试。 |
| 荣耀 MagicOS 平板 | **实机通过**，在校园 Wi-Fi 上跑通全链路。 |
| 荣耀 MagicOS 手机 | **实机通过**。 |
| 安卓通用 / 三星 / vivo / OPPO | **在各厂商官方开发者平台提供的虚拟设备上通过。** 是虚拟设备而非实体机：验的是厂商浏览器内核，验不到射频与电池管理。 |
| 小米（MIUI / HyperOS） | **仅理论验证。** 依据其浏览器内核档位与 polyfill 的 API 覆盖面做的推断，未上机、未跑虚拟机。 |
| iOS / iPadOS | **官方云测试通过。** 硬地板 **≈ iOS 16.4**，更低版本未覆盖。 |
| 鸿蒙 HarmonyOS | **实机实测 + 官方云测试，均通过。** |
| 浏览器版本地板 | **Chromium / Android ≈ 94** 是硬限制。更低的版本，App 自身需要的 API 已超出 polyfill 能补的范围 —— **老旧设备请装现代第三方浏览器**（Chrome / Edge / Firefox），不要用系统自带浏览器。 |
| 宿主系统 | 在 Windows 上开发；`.vbs` / `.ps1` 是 Windows 专用便利封装。网关本体是纯 Node，CI 在 Linux 与 Windows 上都跑过，但**没有人在 Linux / macOS 上把它当日常工具用过**。 |

真正被本仓库验证过的是 `npm run test:unit` 与 `npm run test:smoke`：不需要设备、也不需要装 DSH。
所有与设备相关的结论都来自 [docs/evidence.md](docs/evidence.md) 记录的实测，按证据层级汇总在
[docs/cross-device.md](docs/cross-device.md)。

## 测试

```bash
npm run check        # 仓库自检 + 两条浏览器 polyfill 单测
npm run test:unit    # 只跑 polyfill 单测
npm run test:smoke   # 端到端：真实 TLS + 桩上游 + 完整登录/首页流程
npm test             # 全部
```

`test:smoke` 会以真实 TLS 启动网关，对着一个模拟 DSH token 交换的桩上游，断言口令门、token 抓取、
以及三处注入（polyfill、`ownsHost`、响应布局层）都在服务出的页面里。它需要 `openssl`，
**不需要**安装 DSH，也就是 CI 在 Linux 与 Windows 上跑的那道门。

另外两个是需要**真实 DSH** 的集成探针：

| 脚本 | 作用 |
| --- | --- |
| `tests/test-http-proxy.mjs` | HTTP 路径、Origin 改写、压缩，对着真 DSH |
| `tests/test-upload.mjs` | 经网关上行 3 MB 二进制，校验内容寻址落盘对象 |

## 目录

```
gateway/          网关本体：gateway.mjs、polyfill.js、Windows 启动器、vendor/qrcode.js
ui/               注入式响应布局层（CSS + JS）
tests/            单测、冒烟测试、需真实 DSH 的集成探针
docs/             实测记录、移动端布局说明、跨 OEM 矩阵、穿透方案
evidence/         docs/evidence.md 引用的截图
scripts/check.mjs 仓库自检（密钥、真实地址、目录完整性、语法）
```

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 页面提示 DSH 未运行 | DSH 没起或 `dshPort` 不对；启动 DSH，页面会自己重试 |
| 旧手机卡在"重新连接中" | 缺现代 JS API —— 确认 polyfill 已注入（更新网关后刷新一次页面） |
| "settings are unavailable in this browser" | `ownsHost` 注入没生效；看页面源码与 `DSH_GATE_RESPONSIVE` |
| 又出现证书警告 | 局域网地址变了，签发了新证书；再接受一次即可 |
| 二维码指的还是旧地址 | 重新绑定时会重印；没有就重启网关 |
| 能登录但仍是桌面布局 | 竖屏规则要求手机级视口**且** `pointer: coarse`，见 [docs/mobile-layout.md](docs/mobile-layout.md) |

## 非目标

- 不是通用反向代理：只假设一个上游、且在回环。
- 不是 DSH 的分支：磁盘上从不修改 DSH，一切都在 HTTP 层注入。
- 不是远程桌面，也不是文件同步工具。

## 许可

MIT，见 [LICENSE](LICENSE)。随附二维码生成库见 [THIRD-PARTY.md](THIRD-PARTY.md)。
