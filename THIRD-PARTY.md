# Third-party code

This repository is MIT-licensed. It vendors one third-party file.

## gateway/vendor/qrcode.js

- **What**: QR Code Generator for JavaScript (the `qrcode.js` classic, `qrcode(0, "M")` API).
- **Author**: Kazuhiko Arase
- **Copyright**: © 2009 Kazuhiko Arase
- **License**: MIT — http://www.opensource.org/licenses/mit-license.php
- **Source**: http://www.d-project.com/
- **Why it is vendored**: the gateway must stay dependency-free (no `npm install` on the
  machine acting as the host), and it uses the library only to draw the access URL as an
  ASCII QR code in the console.

The file is kept unmodified so it stays diffable against upstream. `"QR Code"` is a
registered trademark of DENSO WAVE INCORPORATED; the library and this project use it only
to describe the encoding.
