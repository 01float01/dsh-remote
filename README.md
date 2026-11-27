# dsh-remote

> ## ✅ DSH version compatibility re-tested
>
> Re-tested across **DSH 0.1.7-rc.2 → 0.2.3-alpha.2** (isolated instances, curl + real-browser
> layers, plus real Honor hardware): all pass. Five deployment bugs found by an independent
> isolated audit (QR, NIC selection, token rotation, port-conflict, doc) are fixed.
> See [docs/version-compatibility.md](docs/version-compatibility.md).
>
> **Always prefer a current third-party browser** (Chrome / Edge / Firefox / Quark / Baidu / QQ)
> over the OEM system browser — especially on older Android or HarmonyOS handsets. Modern
> third-party engines sidestep the old-kernel CSS/JS gaps entirely.
>
> **Note:** the latest DSH (**0.2.3-alpha**) has begun shipping its own native remote service
> (QR pairing, peer access control, TLS / reverse-proxy support). This project overlaps on
> auth/TLS but still adds what the official build does not: **old-browser polyfills, a mobile
> portrait layout, and zero-dependency one-click setup**. On stable DSH (≤0.2.2) the native
> service is not yet present.
>
> 中文说明见 [README.zh.md](README.zh.md)。

Use your **DSH** web UI from a phone or tablet browser on the same Wi-Fi.
No app, no VPN, no Termux, no tunnel — just a URL, a one-off certificate exception and a
password.

English | [中文](README.zh.md)

> **Scope, up front.** This gateway was built for exactly one deployment: a **phone or tablet**
> browser on **BUPT-mobile**, the campus Wi-Fi of Beijing University of Posts and
> Telecommunications.
> No other campus or corporate network was evaluated — Wi-Fi client isolation, captive
> portals, 802.1X/EAP, IPv6-only addressing and forced proxies are unhandled — and there is
> **no guarantee it starts working on your network** without changes.
>
> **What was actually verified** (the full accounting is in
> [docs/cross-device.md](docs/cross-device.md)): Honor MagicOS **tablet and phone, on real
> hardware — passed**; **HarmonyOS — real hardware *and* the official cloud device farm —
> passed**; **iOS / iPadOS — the official cloud device farm — passed**; generic Android,
> **Samsung, vivo and OPPO — through the virtual devices of each vendor's official developer
> platform — passed**, though those are virtual devices, not handsets; **Xiaomi — analysis
> only**, never executed on hardware or emulator.
>
> **Hard floors.** **iOS ≈ 16.4**, and **Chromium/Android ≈ 94** — below those the page does
> not work, because the app needs APIs the polyfill cannot supply. On an older handset,
> install a current third-party browser (Chrome, Edge, Firefox) rather than using the system
> browser.
>
> **The test suite says what it measures.** `npm test` proves that the gateway boots,
> authenticates, proxies and injects its three scripts. It does not prove that your phone,
> your browser or your network works.

```
phone / tablet browser  ──https://<lan-ip>:8443──▶  gateway (Node, zero deps)  ──http://127.0.0.1:5140──▶  DSH Web
```

## The problem

DSH binds its web server to `127.0.0.1:5140`. That is the right default — it is not
reachable from your network, and its launch token never leaves the machine. It also means
your tablet cannot use it, and every workaround has a cost:

| Workaround | Cost |
| --- | --- |
| Expose DSH's port directly | No TLS, no authentication, no origin rewrite |
| SSH into the host + port forward | Needs a terminal on the phone, and a background app the vendor's battery manager will kill |
| Tailscale / VPN | A VPN client per device, an account, and often a relay abroad |
| Copy files back and forth | Not the same UI |

This project puts a small, auditable proxy in between that speaks TLS, asks for a password,
and keeps DSH on loopback.

## What you get

- **`gateway/`** — a single-file, dependency-free Node HTTPS reverse proxy (~570 lines):
  TLS termination, password gate, session cookies, rate limiting and lockout, gzip and
  static-asset caching, streaming request bodies, WebSocket upgrades, self-signed
  certificate generation, and a watchdog launcher.
- **Injection into DSH's page** (DSH itself is never patched):
  - `gateway/polyfill.js` — restores modern JS APIs that some OEM browsers lack, so DSH's
    RPC layer works instead of sitting at "reconnecting".
  - `ownsHost` shim — makes DSH treat the remote page as a trusted host, so the settings
    and model pages work instead of reporting "settings are unavailable in this browser".
  - `ui/responsive.css` + `ui/responsive.js` — a portrait layout that turns the desktop
    three-column UI into a usable single-column phone UI, automatically, and back.
- **Docs** — the security model, a measured test log, an honest account of mobile coverage,
  and how to reach the gateway from outside the LAN.

## Quick start

Prerequisites: Node.js ≥ 20, `openssl` on `PATH` (or set `DSH_GATE_OPENSSL`), DSH installed
and running on the same machine, and the phone on the same Wi-Fi.

```bash
git clone https://github.com/01float01/dsh-remote.git
cd dsh-remote
```

1. **Tell the gateway where DSH writes its token.** DSH rotates its launch token on every
   start; the gateway reads it from your launcher's stdout log. Either set it once…

   ```powershell
   $env:DSH_GATE_TOKEN_LOG = "C:\path\to\dsh-launch-stdout.log"
   ```

   …or put it in `gateway/state/config.json` (created on first run) as `tokenLog`.
   Without it, everything works except the automatic login hand-off: the log and
   `/__gate/health` will tell you the token is missing.

2. **Start the gateway.**

   - Windows: double-click `gateway/run-gateway.vbs` (visible console, watchdog).
   - Any OS: `npm start` or `node gateway/gateway.mjs`.

   It prints the access URL, a generated password and a scannable QR code.

3. **On the phone**: open `https://<lan-ip>:8443/`, accept the self-signed certificate
   ("Advanced → Proceed"), enter the password. The session cookie lasts 30 days.

The gateway writes everything it needs to `gateway/state/`, which is git-ignored:
generated password, certificate, session secret, logs, and the QR code as text.

## Configuration

Two layers: environment variables (convenient, per-run) and `gateway/state/config.json`
(persistent, written on every start; env wins).

| Environment variable | `config.json` key | Default | Meaning |
| --- | --- | --- | --- |
| `DSH_GATE_IP` | `bindIp` | auto-detect | Address to bind. Auto-detection prefers an RFC 1918 address. |
| `DSH_GATE_PORT` | `listenPort` | `8443` | Port for the TLS listener. |
| `DSH_GATE_DSH_PORT` | `dshPort` | `5140` | DSH's loopback port. |
| — | `dshHost` | `127.0.0.1` | DSH's host. |
| `DSH_GATE_TOKEN_LOG` | `tokenLog` | empty | Launcher stdout log to scrape `?token=…` from. |
| `DSH_GATE_OPENSSL` | `openssl` | auto | Path to `openssl` used for the self-signed certificate. |
| `DSH_GATE_STATE_DIR` | — | `gateway/state` | Where runtime state lives (used by the tests). |
| `DSH_GATE_RESPONSIVE` | — | `1` | `0` disables the responsive layer injection. |
| `DSH_RESPONSIVE_DIR` | — | `ui/` in this repo | Alternative responsive layer build. |
| — | `cookieMaxAgeDays` | `30` | Session cookie lifetime. |

Endpoints: `/__gate/health` (status, plus whether a token was found), `/__gate/diag`
(capability probe target), `/__gate/login`, `/__gate/logout`.

The gateway re-checks the machine's address every 15 seconds; if it changed it rebinds,
regenerates the certificate and prints a fresh QR code. Scan it once more and the password
stays the same.

## Security model

What is actually enforced, and what is not.

**Enforced**

- TLS on the wire (EC prime256v1, self-signed, 10-year, SAN covering the LAN address,
  loopback and the Android emulator alias).
- A password gate: `scrypt` hash, timing-safe comparison, session cookie that is HMAC-signed,
  `HttpOnly`, `Secure` and `SameSite=Strict`. Login POSTs are checked against
  `Sec-Fetch-Site` / `Origin`.
- Lockout after five failed attempts per client address (escalating, capped at 15 minutes),
  plus a global token bucket.
- The listener binds only the LAN address and loopback — not every interface.
- Upstream requests are rewritten to loopback `Host` / `Origin` / `Referer`, so DSH's own
  DNS-rebinding fences and same-origin checks (including plugins that enforce them) behave
  as they do locally.
- DSH's launch token never reaches the phone: the gateway performs the exchange itself.
- Login successes and failures, lockouts, WebSocket upgrades and non-static proxied requests
  are logged to `gateway/state/gateway.log`.

**Not enforced — read this before exposing it**

- **The certificate is self-signed.** Traffic is encrypted, but the phone learns no verified
  identity. Anyone able to intercept your traffic *and* hold a device certificate trusted by
  your phone could impersonate the gateway. On a home or campus Wi-Fi the practical risk is
  low; it is not zero.
- **A password is a shared secret.** There is one password, no user accounts, no audit per
  user. It is printed to the console and kept in plaintext in `gateway/state/password.txt`
  for your convenience — delete both if you prefer to set your own.
- **Anyone who can reach the port and knows the password is fully trusted.** That is the
  design: the gateway is a deliberate trusted extension of your machine, which is why it
  also makes the page look like loopback to DSH.
- **Not audited.** It is one file; read it. It has no dependencies, which keeps the surface
  small, but "small" is not "verified".
- Out of scope by design: multi-user accounts, per-user permissions, TLS with a real
  certificate authority (see [docs/tunnel.md](docs/tunnel.md) for when a domain is worth it).

## Compatibility — what was and was not verified

The tiers below are different kinds of evidence and should not be read as one number.

| | Status |
| --- | --- |
| Network | **One environment only**: BUPT-mobile campus Wi-Fi. Client isolation, captive portals, 802.1X/EAP, IPv6-only and forced proxies are unhandled and untested. |
| 荣耀 Honor tablet (MagicOS) | **Real hardware — passed**, full chain over the campus Wi-Fi. |
| 荣耀 Honor phone (MagicOS) | **Real hardware — passed**. |
| Samsung / vivo / OPPO / generic Android | **Passed on the virtual devices hosted by each vendor's official developer platform.** These are virtual devices, not handsets: the vendor browser engine is exercised, the radio and battery manager are not. |
| Xiaomi (MIUI / HyperOS) | **Analysis only.** Reasoning from its browser's kernel tier and the polyfill's API coverage — never run, on hardware or emulator. |
| iOS / iPadOS | **Passed on the official cloud device farm.** Hard floor **≈ iOS 16.4**; earlier versions are not covered. |
| HarmonyOS | **Passed on real hardware and on the official cloud device farm.** |
| Browser floor | **Chromium/Android ≈ 94** is the hard limit. Below it the app's own API needs exceed what the polyfill can restore — use a current third-party browser (Chrome, Edge, Firefox) instead of the system browser on an old device. |
| Host OS | Developed on Windows; the `.vbs` / `.ps1` launchers are Windows-only conveniences. The gateway itself is plain Node and CI runs it on Linux and Windows, but nobody has run it as a daily driver on Linux or macOS. |

`npm run test:unit` and `npm run test:smoke` are the parts that are genuinely verified here:
they need no device and no DSH. Everything device-specific rests on the runs recorded in
[docs/evidence.md](docs/evidence.md), summarised by tier in
[docs/cross-device.md](docs/cross-device.md).

## Testing

```bash
npm run check        # repository hygiene + the two browser-polyfill unit tests
npm run test:unit    # polyfill unit tests only
npm run test:smoke   # end-to-end: real TLS, stub upstream, full login/index flow
npm test             # all of it
```

`test:smoke` boots the real gateway against a stub upstream that mimics DSH's token
exchange, then asserts the login gate, the token scrape, and that all three injections
(polyfill, `ownsHost`, responsive layer) are present in the served page. It needs `openssl`
and no DSH installation. It is the same gate CI runs on Linux and Windows.

The remaining tests are integration probes that need a **live** DSH behind the gateway:

| Script | What it does |
| --- | --- |
| `tests/test-http-proxy.mjs` | HTTP path, origin rewrite and compression against a real DSH |
| `tests/test-upload.mjs` | 3 MB binary upload through the gateway, verifying the content-addressed object |

## Repository layout

```
gateway/          the gateway: gateway.mjs, polyfill.js, Windows launchers, vendor/qrcode.js
ui/               injected responsive layout layer (CSS + JS)
tests/            unit tests, smoke test, live-DSH integration probes
docs/             evidence log, mobile layout notes, cross-OEM matrix, tunnel options
evidence/         screenshots referenced by docs/evidence.md
scripts/check.mjs repository self-check (secrets, addresses, layout, syntax)
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Page says DSH is not running | DSH is not up, or `dshPort` is wrong; start DSH, the page retries itself |
| Stuck at "reconnecting" on an old phone | Missing modern JS APIs — make sure the polyfill is injected (reload the page once after updating the gateway) |
| "settings are unavailable in this browser" | The `ownsHost` injection did not run; check `DSH_GATE_RESPONSIVE` / page source |
| Certificate warning again | The LAN address changed, so a new certificate was generated; accept it once |
| QR code points at an old address | It is reprinted on rebind; if not, restart the gateway |
| Login works but the UI is the desktop layout | Portrait rules need a phone-sized viewport *and* a coarse pointer (see [docs/mobile-layout.md](docs/mobile-layout.md)) |

## Non-goals

- Not a general-purpose reverse proxy: it assumes exactly one upstream, on loopback.
- Not a DSH fork: DSH is never modified on disk; everything is injected at the HTTP layer.
- Not a remote-desktop or file-sync tool.

## License

MIT — see [LICENSE](LICENSE). Vendored QR code library: [THIRD-PARTY.md](THIRD-PARTY.md).
