// Integration probe: drives the gateway's HTTP path against a live DSH.
//
//   DSH_GATE_TOKEN_LOG  launcher stdout log holding DSH's per-launch ?token=...
//   DSH_GATE_DSH_AUTH   upstream authority, default 127.0.0.1:5140
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import zlib from "node:zlib";
const POLYFILL = fs.readFileSync(new URL("../gateway/polyfill.js", import.meta.url), "utf8");
const GATE_BOOT = "globalThis.__DSH_TRANSPORT__=Object.assign(globalThis.__DSH_TRANSPORT__||{},{ownsHost:true});";
const CHROME97_SIM = "try{delete globalThis.structuredClone;delete Promise.withResolvers;delete AbortSignal.timeout;delete AbortSignal.any;delete AbortSignal.prototype.throwIfAborted;delete Array.prototype.toSorted;delete Array.prototype.toReversed;delete Array.prototype.toSpliced;delete Array.prototype.with;delete Object.groupBy;delete Map.groupBy;delete Array.fromAsync;delete String.prototype.isWellFormed;delete String.prototype.toWellFormed;}catch(e){}";
const ERR_CAPTURE = "window.addEventListener('error',function(e){console.error('PAGE_ERROR:',e.message,e.filename,e.lineno);});window.addEventListener('unhandledrejection',function(e){console.error('PAGE_REJECTION:',String(e.reason&&e.reason.stack||e.reason));});";
const tokenLog = process.env.DSH_GATE_TOKEN_LOG || "";
const AUTH = process.env.DSH_GATE_DSH_AUTH || "127.0.0.1:5140";
let dshCookie = "";
function refreshToken() {
  if (tokenLog === "") return "";
  try { const m = fs.readFileSync(tokenLog, "utf8").match(/token=([A-Za-z0-9_-]{20,})/); return m ? m[1] : ""; } catch (e) { return ""; }
}
function exchange() {
  return new Promise((resolve) => {
    const tok = refreshToken();
    const r = http.request({ host: "127.0.0.1", port: 5140, path: "/?token=" + tok, method: "GET", headers: { host: AUTH } }, (res) => {
      const sc = res.headers["set-cookie"];
      if (sc) { const c = sc.find(x => x.startsWith("dsh-auth-")); if (c) dshCookie = c.split(";")[0]; }
      res.resume(); res.on("end", resolve);
    });
    r.on("error", () => resolve()); r.end();
  });
}
function headers(req) {
  const h = {};
  for (const k of Object.keys(req.headers)) { if (["connection","keep-alive","transfer-encoding","upgrade"].includes(k.toLowerCase())) continue; h[k] = req.headers[k]; }
  h["host"] = AUTH;
  if (h["origin"]) h["origin"] = "http://" + AUTH;
  if (h["referer"]) { try { const u = new URL(h["referer"]); h["referer"] = "http://" + AUTH + u.pathname + u.search; } catch (e) { h["referer"] = "http://" + AUTH + "/"; } }
  if (dshCookie) h["cookie"] = dshCookie;
  return h;
}
const server = http.createServer((req, res) => {
  const gateboot = /gateboot=1/.test(req.url || "");
  if (!/\.(js|css|svg|png|woff2?|ttf|ico)(\?|$)/.test(req.url || "")) console.log("REQ", req.method, req.url, "gateboot=" + gateboot);
  const up = http.request({ host: "127.0.0.1", port: 5140, method: req.method, path: req.url, headers: headers(req) }, (ur) => {
    const ctype = String(ur.headers["content-type"] || "");
    const isIndex = (req.url.split("?")[0] === "/" || req.url.split("?")[0] === "/index.html") && /text\/html/i.test(ctype) && ur.statusCode === 200;
    if (isIndex) {
      const chunks = []; ur.on("data", c => chunks.push(c));
      ur.on("end", () => {
        let raw = Buffer.concat(chunks);
        const enc = String(ur.headers["content-encoding"] || "").toLowerCase();
        try { if (enc === "gzip") raw = zlib.gunzipSync(raw); else if (enc === "br") raw = zlib.brotliDecompressSync(raw); } catch (e) {}
        let html = raw.toString("utf8");
        const chrome97 = /chrome97=1/.test(req.url || "");
        const tag = (chrome97 ? "<script>" + CHROME97_SIM + "</script>" : "") + "<script>" + POLYFILL + "</script>" + (gateboot ? "<script>" + GATE_BOOT + "</script>" : "") + "<script>" + ERR_CAPTURE + "</script>";
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html;
        const buf = Buffer.from(html, "utf8");
        const hh = {}; for (const k of Object.keys(ur.headers)) { if (["content-length","content-encoding","transfer-encoding","connection"].includes(k.toLowerCase())) continue; hh[k] = ur.headers[k]; }
        hh["content-length"] = String(buf.length);
        res.writeHead(ur.statusCode, hh); res.end(buf);
      });
      return;
    }
    const hh = {}; for (const k of Object.keys(ur.headers)) { if (["transfer-encoding","connection"].includes(k.toLowerCase())) continue; hh[k] = ur.headers[k]; }
    res.writeHead(ur.statusCode, hh); ur.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end("upstream error"); });
  req.pipe(up);
});
server.on("upgrade", (req, socket, head) => {
  const up = net.connect(5140, "127.0.0.1", () => {
    const h = headers(req); h["connection"] = "Upgrade"; h["upgrade"] = req.headers["upgrade"] || "websocket";
    let line = req.method + " " + req.url + " HTTP/1.1\r\n";
    for (const k of Object.keys(h)) line += k + ": " + h[k] + "\r\n";
    line += "\r\n"; up.write(line); if (head && head.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  const kill = () => { socket.destroy(); up.destroy(); };
  up.on("error", kill); socket.on("error", kill);
});
exchange().then(() => server.listen(8098, "127.0.0.1", () => console.log("test http proxy on 8098, cookie=" + (dshCookie ? "yes" : "no"))));
