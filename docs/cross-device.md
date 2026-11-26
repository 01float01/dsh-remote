# Android cross-OEM compatibility

The premise of this project is that a phone needs **only a browser**. That premise is
worth testing on real OEM browsers, because Android vendors ship very different Chromium
versions behind the same "browser" icon — and the DSH web client is modern JavaScript.

## What was tested

| Device / environment | Browser engine | Result |
| --- | --- | --- |
| Android emulator, vendor browser class | Chromium 97 | Works *with* the polyfill; broken without it |
| Android emulator, Chrome | Chromium 113 | Works |
| OPPO Find N6, ColorOS 17, HeyTapBrowser | Chromium 115 | Full chain passed, no polyfill gap observed |
| vivo V2608A, OriginOS 17, VivoBrowser | Chromium 146 | Full chain passed, `missing=[]` (nothing to polyfill) |
| Honor / older MagicOS webview | Chromium 97 class | Works with the polyfill |
| Modern desktop Chrome | Chromium 136+ | Works (polyfill becomes a no-op) |

"Full chain" means: accept the self-signed certificate exception → password login →
workspace selection → WebSocket session → create session → model catalogue loads →
send a prompt and receive a streamed reply.

## The finding that shaped the design

Old and *new* OEM browsers both matter, for different reasons:

- **Old kernels (Chromium ~97)** lack `AbortSignal.prototype.throwIfAborted`, `Object.hasOwn`,
  `Promise.withResolvers`, `Array.prototype.toSorted` and friends. DSH's RPC calls
  `signal?.throwIfAborted()` after `fetch`, so a single missing method breaks *every* API
  call and the UI sits at "reconnecting" forever. Hence `gateway/polyfill.js`.
- **Some current OEM builds (Chromium 115) are still behind** desktop Chromium, so the
  polyfill is not only for museum devices. It fills gaps only; on modern browsers every
  branch is a no-op.
- **OEM system browsers cannot be side-loaded** onto an AOSP emulator (they depend on the
  vendor framework and crash), so real verification needed real devices or cloud devices.
  That is why the compatibility notes here come from actual handsets rather than emulators
  alone.

## Reproducing the test

`tests/repro-server.mjs` serves a page that runs the same `signal?.throwIfAborted()` RPC
pattern DSH uses. Open it in a target browser before and after the polyfill is injected:

1. Without the polyfill the call throws `signal.throwIfAborted is not a function`.
2. With `gateway/polyfill.js` loaded first, the same call succeeds.

`tests/test-polyfill.mjs` and `tests/test-tosorted.mjs` automate the same assertion for
the API surface (Node only, no browser needed).

## Caveats

- Vendor browsers in browser-feature matrices move fast; the table reflects the builds
  that were available at test time, not a promise about future firmware.
- If a browser reports `CLIENT DIAG missing=[...]` in `gateway/state/gateway.log` after
  loading the page, that list is the exact set of APIs the polyfill had to supply — a
  useful bug report if something still misbehaves.
