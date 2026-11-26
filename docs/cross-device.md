# Verification: exactly what was run, and where

This page exists so that nothing in the README is more confident than the testing behind it.
The tiers below are different kinds of evidence; treat them as such.

## Scope

- **Devices**: phones and tablets. The gateway is designed for a mobile browser; a desktop
  browser works too, but that is not what it was built or measured for.
- **Network**: **BUPT-mobile** (Beijing University of Posts and Telecommunications campus
  Wi-Fi). It assumes the phone and the PC can reach each other on the same LAN — true there,
  not guaranteed anywhere else. Client isolation, captive portals, 802.1X/EAP, IPv6-only
  addressing and forced proxies were never exercised, and the gateway has no code for them.

## How each platform was verified

| Tier | Target | How | Result |
| --- | --- | --- | --- |
| **Real hardware** | 荣耀 Honor **tablet** (MagicOS) | Physical device, full flow over the campus Wi-Fi | **Passed** |
| **Real hardware** | 荣耀 Honor **phone** (MagicOS) | Physical device, full flow over the campus Wi-Fi | **Passed** |
| **Real hardware + cloud** | **HarmonyOS** | A physical HarmonyOS device, and the official cloud device farm | **Passed both** |
| **Official cloud device farm** | **iOS / iPadOS** | Apple's platform reached through the official cloud device farm — no physical device was used | **Passed** |
| **Vendor virtual device** | Generic Android, Samsung, vivo, OPPO | The VMs hosted by each vendor's official developer platform — virtual devices, *not* handsets | **Passed** |
| **Analysis only** | Xiaomi (MIUI / HyperOS) | Theoretical: kernel tier and missing-API analysis against its shipped browser | **Not executed** |
| **Automated** | This repository's gateway | `npm run test:unit`, `npm run test:smoke`; CI on ubuntu-latest + windows-latest | **Passed** |

"Vendor virtual device" is deliberately not called "real device": those are the emulators and
cloud virtual devices each OEM offers to developers. They exercise the vendor's browser
engine, which is the part that matters for the polyfill, but they do not exercise a handset's
battery manager, its certificate-exception UI on real hardware, or its UA quirks.

## Minimum versions

The app needs APIs that `gateway/polyfill.js` cannot invent, so there is a floor:

| Platform | Hard floor |
| --- | --- |
| iOS / iPadOS | **≈ iOS 16.4** |
| Android (Chromium-based) | **≈ Chromium 94** |

Below those, the page does not work — not "works badly", does not work. On an older handset,
install a current **third-party browser** (Chrome, Edge, Firefox) and open the gateway there
instead of using the vendor's system browser, which on old devices is often a much older
engine than the OS version suggests.

## What was NOT verified

- **Anything below the floors**, and the behaviour of vendor browsers older than Chromium 94
  in general.
- **Xiaomi hardware and Xiaomi's emulator** — analysis only. The reasoning is that its
  shipped browser sits inside the kernel tiers the polyfill already covers, but that is an
  inference, not a run.
- **A second network** — everything above happened on BUPT-mobile. Nothing here promises the
  gateway starts working on another campus or corporate network without changes.
- **Multi-device, multi-user, long-duration use** — one device at a time, short sessions.
- **Cloud device farms are not handsets.** For iOS/iPadOS and the vendor Android runs, the
  platform was reached through an officially hosted virtual device. That validates the
  browser engine and the page; it does not validate a specific phone's radio, battery manager
  or certificate-exception UI on real hardware.

## Why the browser polyfill exists anyway

The old-kernel gap is not hypothetical — it was reproduced, on an emulated device and in Node:
DSH's RPC calls `signal?.throwIfAborted()` after `fetch`, so a single missing method breaks
*every* API call and the UI sits at "reconnecting" forever. `gateway/polyfill.js` fills only
the gaps and becomes a no-op on a modern engine.

That is a defensive measure against *observed* breakage on an old engine. It is **not**
evidence that every vendor browser above the floor is covered, and this page does not claim
they are.

## Turning "analysis" into "verified"

The gateway already collects what a report needs, so adding a device to this table is cheap:

1. Load the page through the gateway once.
2. Read `gateway/state/gateway.log` and find the `CLIENT DIAG` line — it carries the real
   `navigator.userAgent` and the list of APIs the polyfill had to supply (`missing=[...]`).
3. The same log has page `error` / `unhandledrejection` events forwarded by the injected probe.

Posting that line with the device model and browser version is enough to add a row above.
