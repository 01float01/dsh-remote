# DSH 版本兼容验证 + 独立报告 F1–F5 修复

## 背景
独立对话把项目推到 GitHub（01float01/dsh-remote@c6605a7），并在 WSL2 隔离 VM 全新安装 DSH 0.2.2-rc.5 从头测试，
报告 D:\NEXT_V3K1\Pre\Test_DeepAway\REPORT.md。核心提醒：此前未考虑 DSH 版本兼容。

## 一、报告核实（F1–F5 全部对照源码证实）
| 编号 | 问题 | 根因（源码核实） | 修复 |
|---|---|---|---|
| F1 P1 | 二维码永远不可用 | package.json type:module，vendor/qrcode.js 是 CJS UMD，createRequire 按 ESM 解析→导出空 | gateway/vendor/package.json {type:commonjs} |
| F2 P1 | 自动绑到虚拟网卡 | detectIp 取首个 RFC1918，WSL vEthernet 172.18 排在 WLAN 前 | 跳过 vEthernet/VMnet/VirtualBox/docker/Tailscale/wsl/tap/tun + 169.254 |
| F3 P2 | 追加日志致 token 恒旧 | readToken 取首处 match | matchAll 取末项（最新 token）|
| F4 P3 | 文档与实现不符 | 文档称 coarse 必需，代码 coarse()||(h>w) | 文档改为 coarse 或竖屏几何 |
| F5 P1 | 端口占用仍打印就绪+QR | listen error 仅记日志，printBanner 无条件执行 | EADDRINUSE 立即 exit(1)；banner 移到 listen 成功回调 |

修复后回归测试 tests/test-fixes.mjs：F1/F2/F3/F5 全 PASS；smoke/unit 全 PASS。

## 二、DSH 版本兼容矩阵（隔离实例实测）
每版本独立 npm 安装（隔离 DSH_HOME）+ 独立端口起 DSH web + 网关，两层验证：
- curl 层（10 项）：startup token、网关 health、token 抓取、密码登录 303、index 200、polyfill/GATE_BOOT/responsive 注入、API session/list 转发、QR 生成。
- 浏览器层（8 项，Edge 158 → 网关 → 真实 DSH，390×844 iPhone UA）：DSH 启动、ownsHost、mobile 模式、移动顶栏、设置可用、WS remote.mux、无页面错误、横屏回 default。

| DSH 版本 | curl 层 | 浏览器层 |
|---|---|---|
| 0.1.7-rc.2（旧） | 10/10 | 8/8 |
| 0.2.0-rc.2（基线） | 10/10 | 8/8 |
| 0.2.1-rc.5 | 10/10 | 8/8 |
| 0.2.2-rc.5（latest） | 10/10 | 8/8 |
| 0.2.3-alpha.2（最新 alpha） | 10/10 | 8/8 |

**结论**：网关 + 响应层跨 DSH 0.1.7 → 0.2.3-alpha 全兼容。响应层用运行时 DOM 探测（data 属性/稳定后缀），
不依赖版本特定哈希，故版本漂移下仍生效。ownsHost shim、API 转发、WS、设置可用在各版本一致。

## 三、复现
- 安装：npm install @deepseek-ai/dsh@<ver> --prefix versions/v<ver>（需 LOCALAPPDATA/APPDATA env，koffi 原生依赖）。
- curl 层：node version-compat.mjs <ver> <dshPort> <gatePort>。
- 浏览器层：node version-compat-browser.mjs <ver> <dshPort> <gatePort>（Edge executablePath）。
- 结果：versions/v<ver>/compat-result.json、browser-result.json、browser-portrait.png。

## 四、未尽
- 浏览器层用 Edge/Chromium 设备仿真，非真机 OEM/ArkWeb/Safari（那些在 Block2/Block3 已真机/云真机/WebKit 验证）。
- GitHub 仓库 responsive.js 为较早快照，Block1 后续微调（设置退出/归档/统计两排/语法地板探针）尚未合入，建议同步。
- 网络受限无法 git push，修复在本地仓库 dsh-remote-vcompat/repo，待推送 GitHub。

## 五、真机复测（荣耀手机/平板，第三方浏览器）
- 平板横屏 + 小窗任意比例：百度/QQ 第三方浏览器（现代内核）全部 AC。
- 手机竖屏 QQ：初查「更多」按键点击回主界面 → 根因 rc5 给侧栏打 inert（原生抽屉认为关闭），点击穿透遮罩关抽屉。修复：抽屉打开时剥离 inert（interval+IDL setter 钩子）。复测全通过。
- Chrome 97 原生浏览器：rc5 现代 CSS（锚点定位 125+/color-mix 111+）不认 → 菜单飞角/材质透明。响应层 JS 锚点回退尽力兜底；材质缺口建议现代浏览器或 rc2。
- 结论：rc5 配现代第三方浏览器全功能可用；老原生浏览器配 rc2 稳。

## 六、隔离方法诚实说明
本轮版本矩阵用宿主机隔离 npm 实例（独立 DSH_HOME+端口），非完整 VM。真机验证在用户荣耀设备。
用户指出应采用 WSL2 全隔离（如独立报告）——已知差距，后续可补 WSL2 干净复跑。

## 七、官方原生远程（重要背景）
DSH 0.2.3-alpha 起官方已出原生远程服务（dsh-client-remote-connection：QR 配对/私有链接/owner 审批；dsh-api-remote-access：Peer 方法级权限；web CLI 新增 --tls-cert/--public-url/--trusted-host）。本项目认证/TLS 与之重叠，但老浏览器 polyfill、移动竖屏布局、零依赖一键部署仍为独有补充。稳定版（≤0.2.2）尚无原生远程。

## 八、浏览器首选
无论如何首选现代第三方浏览器（Chrome/Edge/Firefox/夸克/百度/QQ），尤其老安卓/鸿蒙。现代内核绕开旧内核 CSS/JS 缺口（锚点定位 125+/color-mix 111+ 等）。系统浏览器（如荣耀 Chromium 97）跑新版 DSH 会遇菜单飞角/材质透明，polyfill 与响应层尽力兜底但不承诺 100%。
