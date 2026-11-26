# Android compatibility: what is actually verified

This page exists to keep the project honest. The short version: **the only mobile target
that was exercised is an Android emulator, on one campus network.** Everything else is
unverified.

## Scope

- **Network**: built and measured on **BUPT-mobile** (Beijing University of Posts and
  Telecommunications campus Wi-Fi). It assumes the phone and the PC can reach each other
  on the same LAN — true there, not guaranteed anywhere else. Client isolation, captive
  portals, 802.1X/EAP, IPv6-only addressing and forced proxies were never exercised, and
  the gateway has no code for them.
- **Devices**: an Android emulator (AVD) stood in for a tablet. **No physical handset or
  tablet was used** for any conclusion in this repository.
- **Platforms not covered at all**: **iOS / iPadOS (Safari)** and **HarmonyOS**.

## What was actually run

| Target | Engine | What it establishes |
| --- | --- | --- |
| Android emulator: AVD `android-34`, AOSP x86_64, no GMS | Firefox 136 | Page loads through the gateway, certificate exception, password login, index injection |
| Same AVD, Chromium-class browser | Chromium 113 | Chromium rendering path with the polyfill injected |
| AVD + a local test proxy against a real DSH (`tests/test-http-proxy.mjs`) | Firefox / Chromium | The HTTP path, origin rewrite and compression against a live upstream |
| Chromium-97 API surface, simulated in Node | Chromium 97 | The missing-API failure is real, and `gateway/polyfill.js` repairs it |
| Desktop browsers on Windows (Chrome / Edge / Firefox) | modern | Gateway + DSH usable; the polyfill is a no-op |
| CI: `ubuntu-latest` and `windows-latest` | Node 20 | The gateway boots with real TLS, the login gate works, all injections are present |

The automated parts are reproducible without any device: `npm run test:unit` and
`npm run test:smoke`. The emulator runs are documented in [evidence.md](evidence.md).

## What was NOT verified

- **iOS / iPadOS Safari.** No test at all. Relevant differences that could bite: self-signed
  certificate exceptions, `visualViewport` / `dvh` behaviour, and Safari's tracking
  prevention on cookies. The responsive layer avoids `dvh` and `:has()` precisely because
  they are the risky ones, but "avoids" is not "verified".
- **HarmonyOS / ArkWeb.** No test at all. Its engine diverges from Chromium even where the
  UA string suggests otherwise.
- **Any physical Android device** — Samsung, vivo, OPPO, Xiaomi, Honor, or otherwise. Vendor
  browsers differ in ways that matter here: where the certificate exception lives, how
  aggressively the battery manager kills background pages, whether dark mode is forced, and
  UA quirks. None of that was exercised on hardware.
- **A Xiaomi emulator / VM.** Only the AOSP `android-34` image was used.
- **Multi-device, multi-user or long-duration use.** One phone at a time, short sessions.

## Why the browser polyfill exists anyway

The Chromium 97 gap is not hypothetical — it was reproduced, in the emulator and in Node:
DSH's RPC calls `signal?.throwIfAborted()` after `fetch`, so a single missing method breaks
*every* API call and the UI sits at "reconnecting" forever. `gateway/polyfill.js` fills only
the gaps and becomes a no-op on a modern engine.

That is a defensive measure against *observed* breakage on an old engine. It is **not**
evidence that vendor browsers are covered, and this page does not claim they are.

## Turning "untested" into "tested"

If you run this on a device, the gateway already collects what a bug report needs:

1. Load the page through the gateway once.
2. Read `gateway/state/gateway.log` and look for the `CLIENT DIAG` line — it carries the
   real `navigator.userAgent` and the list of APIs the polyfill had to supply
   (`missing=[...]`).
3. If something misbehaves, the same log has page `error` / `unhandledrejection` events
   forwarded by the injected probe.

Posting that line with the device model and browser version is the shortest path to adding
a row to the verified table above.
