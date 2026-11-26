# Verification: exactly what was run, and where

This page exists so that nothing in the README is more confident than the testing behind it.
The tiers below are strictly different kinds of evidence; treat them as such.

## Verification tiers

| Tier | Target | How it was verified | Result |
| --- | --- | --- | --- |
| **Real hardware** | 荣耀 Honor **tablet** (MagicOS) | Physical device, full flow over the campus Wi-Fi | **Passed** |
| **Real hardware** | 荣耀 Honor **phone** (MagicOS) | Physical device, full flow over the campus Wi-Fi | **Passed** |
| **Vendor virtual device** | Generic Android, Samsung, vivo, OPPO | The **VMs hosted by each vendor's official developer platform** — virtual devices, *not* physical handsets | **Passed** |
| **Analysis only** | Xiaomi (MIUI / HyperOS) | Theoretical: kernel tier and missing-API analysis against its shipped browser | **Not executed** |
| **Not considered** | iOS / iPadOS (Safari), HarmonyOS (ArkWeb) | — | **No testing, no claim** |
| **Automated** | This repository's gateway | `npm run test:unit`, `npm run test:smoke`; CI on ubuntu-latest + windows-latest | **Passed** |

"Vendor virtual device" is deliberately not called "real device": those are the emulators and
cloud virtual devices each OEM offers to developers. They exercise the vendor's browser
engine, which is the part that matters for the polyfill, but they do not exercise a
handset's battery manager, its certificate-exception UI on real hardware, or its UA quirks.

## What "passed" meant

For the Honor hardware runs, the full chain: accept the self-signed certificate exception →
password login → workspace selection → WebSocket session → create session → model catalogue
loads → send a prompt and receive a streamed reply. The run is recorded in
[evidence.md](evidence.md), including the gateway-side log lines.

For the vendor virtual devices, the same chain minus what a virtual device cannot show
(battery/doze behaviour, real Wi-Fi radio timing).

## Not verified

- **iOS / iPadOS Safari** — not considered. Self-signed certificate acceptance, cookie
  handling and viewport units all differ; the layout layer avoids `dvh` and `:has()` partly
  for that reason, but avoiding a risk is not verifying it.
- **HarmonyOS / ArkWeb** — not considered. Its engine diverges from Chromium even where the
  UA string suggests otherwise.
- **Xiaomi hardware and Xiaomi's emulator** — analysis only. The reasoning is that its
  shipped browser sits inside the kernel tiers the polyfill already covers, but that is an
  inference, not a run.
- **A second network** — everything above happened on **BUPT-mobile** (Beijing University of
  Posts and Telecommunications campus Wi-Fi). Client isolation, captive portals, 802.1X/EAP,
  IPv6-only addressing and forced proxies are unhandled and untested. Nothing here promises
  the gateway starts working on another campus or corporate network without changes.
- **Multi-device, multi-user, long-duration use.**

## Turning "analysis" into "verified"

The gateway already collects what a report needs, so adding a device to this table is cheap:

1. Load the page through the gateway once.
2. Read `gateway/state/gateway.log` and find the `CLIENT DIAG` line — it carries the real
   `navigator.userAgent` and the list of APIs the polyfill had to supply (`missing=[...]`).
3. The same log has page `error` / `unhandledrejection` events forwarded by the injected probe.

Posting that line with the device model and browser version is enough to add a row above.
