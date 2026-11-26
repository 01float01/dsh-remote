# Mobile layout layer (`ui/`)

DSH's web UI assumes a desktop: three columns, a sidebar, a right rail. On a phone in
portrait that layout is unusable however much you zoom out, so this repository ships a
small injected layer that switches behaviour by display geometry — without forking DSH.

The gateway injects `ui/responsive.css` and `ui/responsive.js` into DSH's index HTML
(after the polyfill, before DSH boots). Nothing else changes: DSH's own code is untouched,
and the layer is disabled with `DSH_GATE_RESPONSIVE=0` or pointed elsewhere with
`DSH_RESPONSIVE_DIR`.

## Two modes, chosen automatically

| Mode | When | What you get |
| --- | --- | --- |
| `default` | Tablet landscape, wide window, or a mouse pointer | DSH's official three-column layout, untouched |
| `mobile` | Phone portrait (short edge ≤ 600 px **and** aspect ratio ≥ 1.25, with hysteresis at 640 / 1.15) | Single column full width, sidebar as a fixed drawer with scrim, mobile top bar, full-width conversation and composer |

Switching happens on `resize`, `orientationchange` and `visualViewport` changes with a
120 ms debounce, and only root attributes are changed — no re-render, no reload. Rotating
a phone from portrait to landscape puts the official layout back immediately.

Two details that matter on phones (the layout layer was tuned against real devices — see [cross-device.md](cross-device.md) for the verification tiers):

- **Geometry comes from `screen.*`, not the visual viewport.** When the on-screen keyboard
  opens, the visual viewport shrinks; judging by it would flip the layout mid-typing.
- **`pointer: coarse` is required for `mobile`.** A phone-sized window on a desktop with a
  mouse keeps the official layout.

## What `mobile` actually re-arranges

- Grid first track collapsed to zero plus an explicit `grid-column`, so the conversation
  takes the full width.
- Sidebar becomes a fixed drawer with a scrim; two entry points (hamburger and an
  edge-swipe from the left).
- Mobile top bar at `z-index: 2000`; the settings dialog becomes full screen with
  horizontal category tabs.
- Composer statistics collapse into two rows on narrow screens.
- The right rail is returned to DSH's own auto-fullscreen rule, so an empty overlay can
  never swallow taps.

## Selector strategy (why it survives DSH updates)

Hashed CSS-module class names change on every DSH build, so the layer never depends on
them. It prefers stable semantic hooks — `data-composer-stats`, `data-rightbar-col`,
`dsh-arm-*` (from plugins), and the `_overlay` / `_panel` / `_nav` suffixes — and probes
the grid container at runtime, tagging it with its own `data-dshb1-*` attributes. `:has()`,
`dvh` and `color-mix()` are deliberately avoided: the oldest kernels in the compatibility
matrix do not support them.

## Known limits

- Browser caching: after updating the injected layer, reload the page (a WebSocket
  reconnect does not refetch the index HTML).
- This is a patch, not a replacement front end. DSH internal components that change
  markup may need another small adjustment — the trade-off accepted over building a
  separate mobile client (evaluated and rejected as too large a scope).
- Colour, dark mode and typography are deliberately **not** touched; that belongs to DSH
  itself, not to remote access.
