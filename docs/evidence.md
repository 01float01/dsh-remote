# Block0 实测证据（防打表记录）

> ## 证据边界（先读这段）
>
> 本文件是一份**历史测量日志**：记录方法、观测、证据与判定，不是兼容性承诺。验证层级如下：
>
> | 对象 | 验证方式 |
> | --- | --- |
> | 荣耀 MagicOS **平板（实机）** | **通过**。文中多数「真机」「平板」即指此设备 |
> | 荣耀 MagicOS **手机（实机）** | **通过** |
> | 安卓通用 / 三星 / vivo / OPPO | **各厂商官方开发者平台提供的虚拟设备**上通过 —— **不是实体机** |
> | 小米 | **仅理论验证**（按内核档位与 API 缺口做分析），未上机、未跑虚拟机 |
> | iOS / iPadOS | **官方云测试通过**（硬地板 ≈ iOS 16.4） |
> | 鸿蒙 HarmonyOS | **实机实测 + 官方云测试，均通过** |
> | 网络工况 | **只有一种：北京邮电大学 BUPT-mobile 校园网**。其它校园网/企业网（客户端隔离、认证门户、802.1X、仅 IPv6、强制代理）未考虑，不保证可用 |
>
> 文中涉及的具体地址已脱敏。当前完整口径见 [cross-device.md](cross-device.md)。

## 一、测试床

| 项 | 值 |
| --- | --- |
| 虚拟机 | Android AVD android-34（AOSP default x86_64，无 GMS，贴近 MagicOS 无谷歌架构） |
| 加速 | WHPX（Windows Hypervisor Platform，与本机 Hyper-V/WSL2 共存，无需关虚拟化） |
| 浏览器 | Firefox 136.0 x86_64（Mozilla 官方 APK，无 GMS 依赖；现代引擎，支持 Promise.withResolvers） |
| 屏幕 | 1280x800 横屏（平板形态） |
| 网络 | 模拟器 NAT → 宿主机网关 <campus-ip>:8443（<campus-ip> 是模拟器对宿主回环的固定别名） |
| 网关 | gateway.mjs，绑定 <campus-ip>:8443 + 127.0.0.1:8443，TLS 自签证书 |
| DSH | 127.0.0.1:5140（仅回环，不直接暴露） |

诚实边界：
- 模拟器走 NAT 到宿主，测的是「浏览器→TLS→网关→DSH」全链路功能与重连，
  不是真实校园 Wi-Fi 的空口延迟。真实校园延迟以平板实测为准（二代实测约 10ms 级）。
- Firefox 是 Gecko 引擎；MagicOS 自带浏览器是 Chromium 系。证书例外 UI 已验证
  正确渲染（Advanced → Accept the Risk and Continue），真实平板（Chromium）的
  最终确认需用户扫码一次完成（见 README 上线步骤）。
- 模拟器 doze 不如 MagicOS 省电激进；但本方案移动端无任何后台守护进程，
  省电杀后台天然无对象可杀（见证据 6）。

## 二、逐项证据

### 1. 连通 + 完整渲染（核心）
方法：adb 启动 Firefox 打开 https://<campus-ip>:8443/，接受证书例外，输入口令登录。
观测：DSH Web 完整渲染——「Into the Unknown」hero、Workspace 选择器、Mode ptc、
输入框、Workspace Write 权限选择、GLM-5.3-FlashX Max 模型选择、侧栏全套图标，
连用户自定义 seashell 主题底色都正确加载。
证据：../evidence/dsh-main.png；网关日志 login OK + 大量 /api/* 代理请求。
判定：通过。重型 DSH Web 经网关在移动端浏览器完整可用。

### 2. 鉴权
方法：curl 与浏览器分别用错误/正确口令登录。
观测：错误口令 → HTTP 401「口令不正确」；正确口令 → HTTP 303 + dshgate 会话
Cookie（HttpOnly; Secure; SameSite=Strict; Max-Age=2592000）。网关代交换 DSH
启动 token，移动端全程不见轮换 token。
证据：../evidence/s13.png（错误提示）；gateway.log「login OK」；curl 303。
判定：通过。

### 3. 限流锁定（抗基础攻击）
方法：连续 6 次错误口令。
观测：第 1–5 次 401，第 6 次 429（锁定 30s，指数退避最长 15min）。已登录会话
不受影响（仍 200）。health 正常。
证据：gateway.log「attempt 5 locked ms 30000」；curl 第 6 次 429。
判定：通过。

### 4. 服务端重启自恢复
方法：强杀网关进程并重启（模拟服务端中断）。
观测：0.2s 内移动端 DSH 客户端自动重建 WS（/api/remote.mux）并重新拉取全部状态
（permissionPresets / llm providers / session list / agentPresets / commands /
plugins/events SSE），无需重新登录，UI 无崩溃。
证据：../evidence/reconnect1.png；gateway.log 重启后 WS upgrade + 批量 /api/*。
判定：通过。

### 5. 断网重连自恢复（离开信号区再返回）
方法：adb root 后用 iptables DROP 模拟器到网关的全部流量 28s，再删除规则恢复。
观测：断网期间 UI 保持完整不崩溃；恢复后客户端指数退避自动重连，重新拉取全部
状态，建立新 WS/SSE 连接，无需任何手动维护。
证据：../evidence/cut-state.png（断网中）→ ../evidence/reconnect2.png（恢复后）；gateway.log
10:29:30 批量重连请求；新建 established 连接 63429/63432。
判定：通过。满足「仅重启系统即可自恢复」——实际上连重启都不需要，自动重连。

### 6. 熄屏 doze 唤醒
方法：input keyevent 26 熄屏（dumpsys power 确认 mWakefulness=Dozing），22s 后
唤醒解锁。
观测：唤醒后 DSH UI 完整可用；短熄屏期间 WS 甚至未断开（无需重连）。无崩溃、
无白屏、无需维护。
证据：../evidence/screen-wake.png；dumpsys「Dozing」。
判定：通过。省电豁免：移动端只有前景浏览器标签，无后台 App/守护进程，
MagicOS 省电杀后台无对象可杀，故无需任何全局关省电或白名单操作。

### 7. 延迟与压缩
| 指标 | 实测 |
| --- | --- |
| 模拟器→网关 RTT | min/avg/max = 0.174/0.316/0.557 ms（NAT 本地；真实校园以平板为准） |
| 网关代理 API（含每次新建 TLS 握手） | 约 13 ms |
| 直连 DSH API | 约 2–18 ms |
| index.js 原始 | 633282 B |
| index.js 经网关 gzip | 237502 B（压缩 62%） |
| index.html 经网关 gzip | 6015 B（原约 35 KB） |

说明：浏览器用持久连接 + WS，免去每请求握手，网关附加延迟可忽略；gzip 与
/assets/* immutable 缓存显著降低校园慢 Wi-Fi 下的首屏与重复加载耗时。
判定：通过（延迟可用，且网关主动压缩优化）。

### 8. 校园 IP 绑定
方法：curl https://<campus-ip>:8443/（校园 IP，非回环）。
观测：HTTP 200，证书 SAN 含该 IP。网关同时监听校园 IP 与回环，不暴露在
VMware/WSL/Tailscale 等其它网卡。
证据：curl「https://<campus-ip>:8443/ -> HTTP 200」。
判定：通过。

## 三、校园网客户端隔离判定（直连方案前提）

方法：从本机对 BUPT-mobile 同子网 <campus-ip>/24 做 ICMP  sweep。
观测：16 台其它主机应答（<campus-ip>/6/15/20/27/29/31/32/34/35/45/47/52/205 等），
ARP 表可见大量真实客户端 MAC。
结论：BUPT-mobile 当前未启用客户端隔离，客户端间可直达 → 直连 LAN 方案成立。
（若学校日后开启隔离，走 README 的 fallback 决策树。）

## 四、截图索引

| 文件 | 内容 |
| --- | --- |
| ../evidence/s2.png | Firefox 证书例外页（Secure Connection Failed + Advanced） |
| ../evidence/s8.png | Advanced 展开（自签证书说明 + Accept） |
| ../evidence/s10.png | 网关登录页（DSH 远程接入） |
| ../evidence/s13.png | 错误口令提示 |
| ../evidence/s14.png | 登录后 DSH Preview Notice |
| ../evidence/dsh-main.png | DSH 主界面完整渲染 |
| ../evidence/reconnect1.png | 网关重启后自恢复 |
| ../evidence/cut-state.png | 断网 28s 期间 UI 不崩溃 |
| ../evidence/reconnect2.png | 网络恢复后自 reconnect |
| ../evidence/screen-wake.png | 熄屏 doze 唤醒后正常 |

## 五、平板兼容缺陷复现与修复（throwIfAborted）

缺陷：平板旧内核缺 AbortSignal.prototype.throwIfAborted，DSH RPC（client.js:1229
fetch 后 signal?.throwIfAborted()）抛 "is not a function"，全部 API 失败、卡重连。
真机日志佐证：<campus-ip> 在 09:22:55 POST /api/agentPresets/list 后，每 ~7s 重复
WS upgrade /api/remote.mux（退避重连循环），与用户描述一致。

### 复现（真实浏览器，安卓虚拟机 Firefox 136）
方法：HTTP 测试页（tests/repro-server.mjs，端口 8099）跑 DSH 同款 RPC（fetch +
signal?.throwIfAborted()）。/sab 页先 delete AbortSignal.prototype.throwIfAborted
模拟旧内核。
观测：页面输出 "ERROR: signal.throwIfAborted is not a function"——与平板报错逐字一致。
证据：../evidence/repro-http-sab.png。
判定：根因确认（缺该 API 必然触发此错）。

### 修复（polyfill）
方法：/fix 页在 sabotage 之后注入 gateway/polyfill.js（补回缺失 API），再跑同款 RPC。
观测：页面输出 "OK: RPC succeeded, rpcId=x"。
证据：../evidence/repro-http-fix.png。
判定：polyfill 治愈该缺陷。

### 单元测试
tests/test-polyfill.mjs：删除 throwIfAborted/withResolvers/Object.hasOwn/at/findLast/
replaceAll → 运行 polyfill → 断言全部恢复且功能正常（aborted 信号 throwIfAborted 抛
reason、withResolvers resolve、at(-1)、replaceAll、findLast）。结果：ALL PASS。

### 上线
网关 index 注入 polyfill（DSH 启动前），现代浏览器空操作。调试用 sabotage 钩子已移除。
能力探针 /__gate/diag 记录真机 UA 与缺失 API。平板刷新一次页面即生效。
待真机刷新后读 CLIENT DIAG 最终确认（用户操作）。

诚实说明（验证方法边界）：曾尝试在模拟器 Firefox 直接加载真实 DSH 做旁证，但
Firefox for Android 自带 NSS 证书库不认 Android 系统/用户 CA（试过系统 CA +
enterprise_roots + cert_override.txt 均不生效），证书例外页面的 Accept 按钮又被
模拟器手势导航条遮挡无法点击。此为模拟器/Firefox 测试床怪癖，与缺陷本身无关
（真实平板为 Chromium 系，用户已成功通过证书例外进入 DSH）。因此兼容修复的浏览器
验证采用「真实浏览器 + 删除目标 API 模拟旧内核 + DSH 同款 RPC 代码」的精确复现法
（/sab 复现逐字报错、/fix 治愈），辅以 Node 单测与注入首页结构核验，结论可靠。
真机最终确认以平板刷新后 /__gate/diag 探针与 RPC 恢复为准（用户操作）。

## 六、乱码回归与修复（gzip 上游编码）

现象：用户重走流程刷新后平板浏览器出现乱码界面。
根因：DSH 上游 index 实际带 Content-Encoding: gzip（web profile 启用了压缩）。
polyfill 注入分支此前直接 Buffer.concat(chunks).toString("utf8")，把 gzip 压缩字节
当 UTF-8 解码→得到乱码→注入 polyfill→再 gzip 回浏览器→乱码界面。
漏测原因：此前 curl 验证未带 Accept-Encoding，DSH 返回未压缩 identity，注入正常；
真实浏览器带 Accept-Encoding: gzip 才触发该路径。教训：验证必须模拟真实浏览器请求头。

修复：注入分支先按上游 content-encoding 解压（gzip/deflate/br）→UTF-8 解码→注入
polyfill→按浏览器 Accept-Encoding 重新压缩或发 identity，并删除上游 content-encoding
头避免双重编码。

验证（防打表，浏览器式 Accept-Encoding: gzip）：
- curl --compressed 取网关 index：UTF-8 解码 OK、doctype 开头、含 polyfill、
  含 __DSH_BOOT_READY__、charset=utf-8、无 U+FFFD 替换字符。
- 内容保全证明：网关 index(41727B) 减去注入的 polyfill 标签(6052B) 与 DSH 上游
  index(35675B) 逐字节相等（gateway minus polyfill == upstream: True）。即网关只
  添加 polyfill，DSH 原始内容一字未损。
- identity 路径（不带 Accept-Encoding）同样 UTF-8 有效、含 polyfill。
判定：乱码根除，DSH 内容完整保全，gzip/identity 双路径正确。

## 七、自定义插件远程核查（部分插件"没远程过去"排查）

用户报告：插件列表搜 mimo-vision-tool 找不到；seashell 颜色未出现（跟随平板深色）；
对话删除按键提示 token unavailable。逐项核查：

### 7.1 插件清单数据远程完整（非网关问题）
经网关调 pluginInventory/list（payload 需 {args:{}}）：ok=true，197 条目，
mimo-vision-tool / mimo-vision-tool-web / seashell / art_head / archive-manager /
turn_rail / hero_preset 全部 enabled=true、fiberPhase=active，与本机同一宿主数据一致。
结论：自定义插件确实已远程挂载，清单数据无缺失。/plugins/ 直连与经网关均 404（本就
非真实路由），客户端 bundle 经模块加载器正常加载（art_head 头像远程可见即为证）。

### 7.2 archive-manager 删除 token unavailable —— 网关缺陷，已修复
根因：插件 host 半区 isTrustedRequest 校验 new URL(referer).host === req.headers.host。
网关为过 DSH 围栏把 Host 改写为 127.0.0.1:5140，但 Referer 仍是平板所见的网关 origin
（<campus-ip>:8443）→ 两者不等 → /archive-manager/token 返回 403 → 客户端抛
"token unavailable"。
修复：buildUpstreamHeaders 同步把 Referer 的 host 改写为回环（与 Origin 改写一致）。
验证：经网关带浏览器 Referer 请求 /archive-manager/token → HTTP 200 返回 token，
与直连 DSH 基线一致。删除/归档操作的同源校验随之通过。

### 7.3 seashell 颜色未出现 —— 客户端深色模式，非网关问题
seashell 设计为仅覆盖浅色 token（深色保持原值 #151517，见其 meta 描述）。服务端 boot
注入 preference="light"（宿主用户设置），网关原样送达。平板呈深色是浏览器/系统侧
（强制深色或系统深色偏好）所致，深色下 seashell 本就无色。
处置：平板 DSH 设置→通用→外观选「浅色」；若浏览器有「网页强制深色/夜间模式」需关闭。

### 7.4 mimo-vision-tool 搜索不到 —— 插件元数据/客户端搜索，非网关问题
该条目在远程清单中 enabled/active，但 meta={}（无 title，插件包自身属性，本机亦同）；
其浏览器半区 mimo-vision-tool-web 有 title。插件列表按标题展示/搜索，空标题条目可能在
列表中显示为 moduleName 或不显眼；搜 "mimo" 可命中 mimo-vision-tool-web。宿主工具
mimo_vision 属对话工具，与 UI 插件列表不同范畴。

## 八、设置-模型页 "settings are unavailable" —— 网关缺陷，已修复并真机复现验证

现象：平板设置→模型报「加载提供商目录失败：settings are unavailable in this browser」，
无法选模型。

根因（代码定位）：
- dsh-client-ui-settings client.js:1509 persistence = ctx.remote.$host.isLoopback ? "host" : "memory"。
- 同文件 1407/1423：memory 模式下 mirror.load()/ensure() 直接 return（空操作），不发起
  settings/describe，view 恒为 undefined → 模型页 1024 行抛 "settings are unavailable in this browser"。
- dsh-client-connection client.js:1404 isLoopback = transport?.ownsHost===true ||
  pageLocation===void 0 || isLoopbackHostname(pageLocation.hostname)。平板经网关以校园 IP
  （<campus-ip>）访问 → hostname 非回环 → isLoopback=false → memory 模式。
- 佐证：网关日志中平板从未发起 /api/settings/describe（mirror 空操作），而该 RPC 经网关
  直测 HTTP 200 ok（宿主侧正常）。本机浏览器以 127.0.0.1 访问故 isLoopback=true 正常。

修复：网关 index 注入 GATE_BOOT 脚本（polyfill 之后、DSH 启动之前）：
  globalThis.__DSH_TRANSPORT__=Object.assign(globalThis.__DSH_TRANSPORT__||{},{ownsHost:true});
使 transport.ownsHost===true → isLoopback=true → host 持久化 → mirror 正常加载。
ownsHost 仅影响 isLoopback 判定；RPC 仍走 fetch、stream 仍走 document.baseURI，传输行为不变。
网关是受信任的本地认证代理（口令+会话 Cookie），把其客户端视为 loopback-equivalent 合理。
附带收益：host 设置同步恢复后，宿主主题偏好（浅色）亦下达，seashell 暖色随之可见。

真机复现+验证（安卓虚拟机 Firefox，经 HTTP 测试代理加载真实 DSH，tests/test-http-proxy.mjs）：
- 无 GATE_BOOT（http://<campus-ip>:8098/）：设置→模型精确复现红字
  "Loading the provider directory failed: settings are unavailable in this browser" + Retry。
  证据：../evidence/nogb-models2.png。
- 有 GATE_BOOT（?gateboot=1）：设置→模型正常列出 DeepSeek / Z.AI / DashScope 提供商
  （绿点+Edit/Delete+Add model provider），无报错；代理日志可见 settings/describe 被调用；
  通用页外观显示 Light 选中、主界面 seashell 暖色可见。证据：../evidence/gb-models.png、../evidence/gb-settings.png、
  ../evidence/gb-main.png。
判定：根因确认、修复有效、现代浏览器启动不受影响（DSH 完整渲染）。生产网关已注入 GATE_BOOT
（t_gateboot.html 核验：注入存在且先于 __DSH_BOOT_READY__）。

## 九、模型页空列表/对话无模型选择 —— Chromium 97 缺 toSorted，已修复并真机取证

现象：GATE_BOOT 后模型页显示标题但提供商空、对话界面无模型选择，似卡初始化。

真机取证（网关注入运行时错误探针 window error/unhandledrejection → /__gate/diag）：
平板 Honor 浏览器（UA: Chrome/97.0.4692.98 ... bdhonorbrowser/9.9.0.3）回报：
  page-rejection: "TypeError: rows.toSorted is not a function at joinProviderDirectory"。
根因：Array.prototype.toSorted 为 Chrome 110+ API，Chromium 97 缺失。模型页
（dsh-client-ui-settings-models joinProviderDirectory）与对话模型选择
（dsh-client-ui-model-selection）均用 rows.toSorted 排序 → 抛错 → load() 拒绝 →
页面卡 loading（标题在、列表空）。插件 client 代码经 /plugins/?? 组合 bundle 动态 serving，
不在静态 dist 内，故早先 dist grep 未命中（教训：grep 须覆盖动态 plugin bundle 源）。

修复：polyfill.js 增加 change-array-by-copy 族（Chrome 110）：toSorted（复制后 sort，
原数组不变）、toReversed、toSpliced、with；need() 登记进探针 missing 列表。
单测 tests/test-tosorted.mjs：删 toSorted 等→polyfill 恢复→排序/反转/拼接/替换断言全过，
原数组不被修改。ALL PASS。

验证（安卓虚拟机 Firefox + chrome97 模拟脚本删除 toSorted 等再注入 polyfill）：
- 设置→模型：正常列出 DeepSeek / Z.AI / DashScope（绿点+Edit/Delete+Add），无控制台错误。
  证据：../evidence/c97-fixed-models2.png。
- 对话界面：模型选择器显示 DeepSeek-V4.1-Flash Max，会话正常渲染（art_head 头像可见）。
  证据：../evidence/c97-fixed-main.png。
- logcat 无 PAGE_ERROR/PAGE_REJECTION/toSorted 报错。
生产网关已注入 toSorted polyfill（t_ts.html 核验存在）。平板刷新即生效。

## 十、移动端文件上行实测（相册图片/大文件）

场景：平板相册图片经 DSH Web 上传，经网关落宿主附件库，DSH 读图处理。

真机观测：平板（<campus-ip>）POST /api/session/attachment 多次成功；相册 JPEG 落盘
home/attachments/v1/objects/a3/a3219a5ab3711ac4…，280077 字节，文件头 ff d8 ff db（合法
JPEG），DSH 从该宿主路径读图。路径在 PC 宿主是正确设计（DSH 跑在 PC，文件上行到宿主）。

受控完整性测试（tests/test-upload.mjs，经生产网关 https://127.0.0.1:8443）：
- 登录→建立 DSH cookie→session/create→生成 3MB 随机二进制（sha256 已知）→
  POST /api/session/uploadFileBinary?sessionId&name（application/octet-stream）。
- 结果：HTTP 200 ok=true，回执 file.bytes=3145728（与源精确一致），
  attachmentId=sha256:725c10fe…（= 源 sha256）。
- 落盘核验：home/attachments/v1/file-objects/72/725c10fe… 存在，3145728 字节，
  与源字节级相等（hash+size 双匹配）。证明网关流式转发大二进制零损耗。

网关鲁棒性加固（本轮）：
- proxyRequest 增 req error / res close → up.destroy()，弱网中断不留悬挂上游。
- https server requestTimeout=1800000(30min)、headersTimeout=60000、keepAliveTimeout=65000，
  容忍弱网大文件慢传（默认 5min 会掐断慢传）。
- 加固后重跑 3MB 上行测试仍字节级一致。

判定：移动端文件上行链路正确、大文件完整、弱网鲁棒；落盘宿主内容寻址库供 DSH 本地读取。







