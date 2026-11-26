#!/usr/bin/env node
// ============================================================================
//  DSH Remote Gen-3 / Block0 — secure LAN access gateway (zero npm deps)
//  把只监听 127.0.0.1:5140 的 DSH Web 安全暴露给同一局域网(Wi-Fi)的
//  移动端浏览器。移动端只需浏览器打开 https://<校园IP>:8443 输一次口令。
//  无需 Termux/VPN/代理/后台 App —— MagicOS 省电熄屏杀后台对本方案天然无效。
// ============================================================================
import https from "node:https";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Runtime state (self-signed cert, password hash, session secret, logs). Kept out
// of version control; DSH_GATE_STATE_DIR moves it (used by the smoke test so it
// never touches a developer's live state).
const STATE = process.env.DSH_GATE_STATE_DIR ? path.resolve(process.env.DSH_GATE_STATE_DIR) : path.join(__dirname, "state");
fs.mkdirSync(STATE, { recursive: true });

const DEFAULTS = {
  dshHost: "127.0.0.1",
  dshPort: 5140,
  listenPort: 8443,
  // Where the DSH launcher writes its stdout. The gateway scrapes the per-launch
  // `?token=...` out of it, because DSH rotates that token on every start. Point
  // this at your launcher log (or set DSH_GATE_TOKEN_LOG); left empty, the gateway
  // reports the missing token instead of failing silently.
  tokenLog: "",
  cookieMaxAgeDays: 30,
  bindIp: "",
  openssl: ""
};
let cfg = Object.assign({}, DEFAULTS);
const cfgPath = path.join(STATE, "config.json");
if (fs.existsSync(cfgPath)) {
  try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, "utf8"))); } catch (e) {}
}
if (process.env.DSH_GATE_TOKEN_LOG) cfg.tokenLog = process.env.DSH_GATE_TOKEN_LOG;
if (process.env.DSH_GATE_OPENSSL) cfg.openssl = process.env.DSH_GATE_OPENSSL;
if (process.env.DSH_GATE_DSH_PORT) cfg.dshPort = Number(process.env.DSH_GATE_DSH_PORT);
if (process.env.DSH_GATE_IP) cfg.bindIp = process.env.DSH_GATE_IP;
if (process.env.DSH_GATE_PORT) cfg.listenPort = Number(process.env.DSH_GATE_PORT);
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

const DSH_AUTH = { host: cfg.dshHost, port: cfg.dshPort };
const DSH_AUTHORITY = cfg.dshHost + ":" + cfg.dshPort;
const COOKIE_NAME = "dshgate";
const SESSION_MS = cfg.cookieMaxAgeDays * 86400000;

const logPath = path.join(STATE, "gateway.log");
function log() {
  const args = Array.prototype.slice.call(arguments);
  const line = "[" + new Date().toISOString() + "] " + args.map(function (a) { return typeof a === "string" ? a : JSON.stringify(a); }).join(" ");
  try {
    fs.appendFileSync(logPath, line + "\n");
    if (fs.statSync(logPath).size > 2000000) fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").slice(-500000));
  } catch (e) {}
  console.log(line);
}

function b64url(buf) { return Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }
function unb64url(s) { return Buffer.from(s.replaceAll("-", "+").replaceAll("_", "/"), "base64"); }
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const segs = header.split(";");
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]; const j = seg.indexOf("=");
    if (j === -1) continue;
    out[seg.slice(0, j).trim()] = seg.slice(j + 1).trim();
  }
  return out;
}
function clientIp(req) { return req.socket.remoteAddress || "unknown"; }

const authPath = path.join(STATE, "auth.json");
let auth;
if (fs.existsSync(authPath)) {
  auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
} else {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  let password = "";
  for (let i = 0; i < bytes.length; i++) password += alphabet[bytes[i] % alphabet.length];
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  auth = { salt: salt, hash: hash, sessionSecret: crypto.randomBytes(32).toString("hex"), passwordPlain: password, createdAt: new Date().toISOString() };
  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
  fs.writeFileSync(path.join(STATE, "password.txt"), password + "\n");
  log("generated new gateway password (state/password.txt)");
}
const sessionSecret = Buffer.from(auth.sessionSecret, "hex");
function verifyPassword(pw) {
  if (typeof pw !== "string" || pw.length === 0 || pw.length > 256) return false;
  const h = crypto.scryptSync(pw, auth.salt, 64);
  const expect = Buffer.from(auth.hash, "hex");
  return h.length === expect.length && crypto.timingSafeEqual(h, expect);
}
function mintSession() {
  const iat = Date.now(), exp = iat + SESSION_MS;
  const body = b64url(JSON.stringify({ v: 1, iat: iat, exp: exp }));
  const sig = b64url(crypto.createHmac("sha256", sessionSecret).update(body).digest());
  return body + "." + sig;
}
function checkSession(value) {
  if (!value) return false;
  const parts = value.split(".");
  const body = parts[0], sig = parts[1];
  if (!body || !sig) return false;
  const expect = b64url(crypto.createHmac("sha256", sessionSecret).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let p; try { p = JSON.parse(unb64url(body).toString("utf8")); } catch (e) { return false; }
  const now = Date.now();
  return p && p.v === 1 && p.iat <= now && p.exp > now;
}
function sessionCookie(value, maxAgeSec) {
  return COOKIE_NAME + "=" + value + "; Path=/; Max-Age=" + maxAgeSec + "; HttpOnly; Secure; SameSite=Strict";
}

const loginFails = new Map();
const reqBucket = new Map();
function loginLocked(ip) {
  const f = loginFails.get(ip);
  if (!f) return 0;
  if (f.until > Date.now()) return f.until - Date.now();
  if (f.until && f.until <= Date.now()) loginFails.delete(ip);
  return 0;
}
function noteLoginFail(ip) {
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = Date.now() + Math.min(30000 * Math.pow(2, f.n - 5), 900000);
  loginFails.set(ip, f);
  log("login FAIL from", ip, "attempt", f.n, f.until ? "locked ms " + (f.until - Date.now()) : "");
}
function noteLoginOk(ip) { loginFails.delete(ip); }
function allowRequest(ip) {
  const now = Date.now();
  let b = reqBucket.get(ip);
  if (!b) { b = { tokens: 300, ts: now }; reqBucket.set(ip, b); }
  b.tokens = Math.min(300, b.tokens + ((now - b.ts) / 1000) * 50);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
setInterval(function () {
  const now = Date.now();
  for (const ent of reqBucket) if (now - ent[1].ts > 120000) reqBucket.delete(ent[0]);
  for (const ent of loginFails) if (ent[1].until && ent[1].until < now - 3600000) loginFails.delete(ent[0]);
}, 60000).unref();

let tokenCache = { value: "", mtime: 0 };
function readToken(force) {
  if (!cfg.tokenLog) return "";
  try {
    const st = fs.statSync(cfg.tokenLog);
    if (!force && st.mtimeMs === tokenCache.mtime && tokenCache.value) return tokenCache.value;
    const txt = fs.readFileSync(cfg.tokenLog, "utf8");
    const m = txt.match(/token=([A-Za-z0-9_-]{20,})/);
    tokenCache = { value: m ? m[1] : "", mtime: st.mtimeMs };
    return tokenCache.value;
  } catch (e) { return tokenCache.value; }
}

// Locate openssl without assuming this machine's layout: explicit config and env
// win, then PATH, then the usual Git-for-Windows / OpenSSL install roots derived
// from the environment rather than hardcoded drive letters.
function findOpenssl() {
  if (cfg.openssl && fs.existsSync(cfg.openssl)) return cfg.openssl;
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const rel = ["Git/usr/bin/openssl.exe", "Git/mingw64/bin/openssl.exe", "OpenSSL-Win64/bin/openssl.exe", "OpenSSL-Win32/bin/openssl.exe"];
  const cands = [];
  for (const root of roots) for (const r of rel) cands.push(path.join(root, r));
  const gitDir = (function () {
    try { return path.dirname(path.dirname(execFileSync("where", ["git"], { encoding: "utf8" }).split(/\r?\n/u)[0].trim())); } catch (e) { return ""; }
  })();
  if (gitDir) {
    cands.push(path.join(gitDir, "usr", "bin", "openssl.exe"));
    cands.push(path.join(gitDir, "mingw64", "bin", "openssl.exe"));
  }
  for (let i = 0; i < cands.length; i++) if (fs.existsSync(cands[i])) return cands[i];
  return "openssl";
}
function ensureCert(ip) {
  const keyP = path.join(STATE, "key.pem"), certP = path.join(STATE, "cert.pem"), ipP = path.join(STATE, "cert-ip.txt");
  const cur = fs.existsSync(ipP) ? fs.readFileSync(ipP, "utf8").trim() : "";
  if (fs.existsSync(keyP) && fs.existsSync(certP) && cur === ip) return;
  const ssl = findOpenssl();
  log("generating TLS cert for IP", ip, "via", ssl);
  execFileSync(ssl, ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", keyP, "-out", certP, "-days", "3650", "-nodes", "-subj", "/CN=DSH Remote Gateway", "-addext", "subjectAltName=IP:" + ip + ",IP:127.0.0.1,IP:10.0.2.2"], { cwd: STATE, stdio: "ignore" });
  fs.writeFileSync(ipP, ip);
}

function detectIp() {
  if (cfg.bindIp) return cfg.bindIp;
  const cands = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const a of (ifs[name] || [])) if (a.family === "IPv4" && !a.internal) cands.push(a.address);
  // Prefer an address a phone on the same Wi-Fi can actually reach: private
  // ranges first (RFC 1918), then anything else, then loopback. Override with
  // DSH_GATE_IP when the machine has several candidate interfaces.
  const isPrivate = function (a) { return /^10\./u.test(a) || /^192\.168\./u.test(a) || /^172\.(1[6-9]|2\d|3[01])\./u.test(a); };
  return cands.find(isPrivate) || cands[0] || "127.0.0.1";
}

function loginPage(msg) {
  return [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>DSH 远程接入</title><style>',
    ':root{color-scheme:light dark}',
    'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f4f4f5;color:#18181b}',
    '@media(prefers-color-scheme:dark){body{background:#18181b;color:#fafafa}.card{background:#27272a!important}input{background:#3f3f46!important;color:#fafafa!important;border-color:#52525b!important}}',
    '.card{background:#fff;padding:2rem;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.12);width:min(92vw,360px)}',
    'h1{font-size:1.15rem;margin:0 0 .25rem}p.sub{margin:0 0 1.25rem;font-size:.85rem;opacity:.7}',
    'label{font-size:.85rem;display:block;margin-bottom:.4rem}',
    'input{width:100%;box-sizing:border-box;padding:.7rem .8rem;font-size:1rem;border:1px solid #d4d4d8;border-radius:10px;background:#fafafa;color:#18181b}',
    'button{width:100%;margin-top:1rem;padding:.75rem;font-size:1rem;border:0;border-radius:10px;background:#2563eb;color:#fff;cursor:pointer}button:active{background:#1d4ed8}',
    '.err{color:#dc2626;font-size:.85rem;margin-top:.8rem;min-height:1.2em}',
    '.hint{font-size:.75rem;opacity:.6;margin-top:1.25rem;line-height:1.5}',
    '</style></head><body><div class="card">',
    '<h1>DSH 远程接入</h1><p class="sub">DeepSeek Harness · 校园网安全网关</p>',
    '<form method="POST" action="/__gate/login">',
    '<label for="pw">接入口令</label>',
    '<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>',
    '<button type="submit">进入</button>',
    '<div class="err">' + (msg || "") + '</div>',
    '</form>',
    '<div class="hint">首次访问若提示证书不受信任，选择「高级 → 继续前往」即可（自签证书，链路仍加密）。口令仅需输入一次，30 天内免登录。</div>',
    '</div></body></html>'
  ].join("");
}
function noticePage(title, body, refreshSec) {
  const meta = refreshSec ? '<meta http-equiv="refresh" content="' + refreshSec + ';url=/">' : "";
  return [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    meta, '<title>' + title + '</title><style>',
    'body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f4f4f5;color:#18181b;text-align:center}',
    '@media(prefers-color-scheme:dark){body{background:#18181b;color:#fafafa}}.b{padding:2rem;max-width:90vw}h1{font-size:1.1rem}p{opacity:.75;font-size:.9rem;line-height:1.6}',
    '</style></head><body><div class="b"><h1>' + title + '</h1><p>' + body + '</p></div></body></html>'
  ].join("");
}

const POLYFILL = (function () { try { return fs.readFileSync(path.join(__dirname, "polyfill.js"), "utf8"); } catch (e) { return ""; } })();
// 网关是受信任的本地认证代理：把客户端标记为 loopback-equivalent，使设置镜像走 host 持久化
// （否则非回环 origin → memory 模式 → 设置/模型页 "settings are unavailable"）。ownsHost 仅影响
// isLoopback 判定，RPC 仍走 fetch、stream 仍走 document.baseURI，不改变传输行为。
const GATE_BOOT = "globalThis.__DSH_TRANSPORT__=Object.assign(globalThis.__DSH_TRANSPORT__||{},{ownsHost:true});";
const ERROR_REPORT = "window.addEventListener(\"error\",function(e){try{navigator.sendBeacon(\"/__gate/diag\",new Blob([JSON.stringify({type:\"page-error\",message:e.message,file:e.filename,line:e.lineno,ua:navigator.userAgent})],{type:\"application/json\"}));}catch(_){}});window.addEventListener(\"unhandledrejection\",function(e){try{var r=e.reason;navigator.sendBeacon(\"/__gate/diag\",new Blob([JSON.stringify({type:\"page-rejection\",message:String(r&&r.message||r),stack:String(r&&r.stack||\"\").slice(0,600),ua:navigator.userAgent})],{type:\"application/json\"}));}catch(_){}});";
// The responsive layout layer ships inside this repository (ui/), so the default
// resolves relative to the gateway. Override with DSH_RESPONSIVE_DIR to load a
// different build, or set DSH_GATE_RESPONSIVE=0 to disable injection entirely.
const RESPONSIVE_DIR = process.env.DSH_RESPONSIVE_DIR || path.join(__dirname, "..", "ui");
const RESPONSIVE_ON = (process.env.DSH_GATE_RESPONSIVE || "1") !== "0";
const RESPONSIVE_CSS = (function () { try { return RESPONSIVE_ON ? fs.readFileSync(path.join(RESPONSIVE_DIR, "responsive.css"), "utf8") : ""; } catch (e) { return ""; } })();
const RESPONSIVE_JS = (function () { try { return RESPONSIVE_ON ? fs.readFileSync(path.join(RESPONSIVE_DIR, "responsive.js"), "utf8") : ""; } catch (e) { return ""; } })();
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|xhtml|svg|wasm)|image\/svg)/i;
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function buildUpstreamHeaders(req, tabletCookies) {
  const h = {};
  for (const k of Object.keys(req.headers)) {
    if (HOP.has(k.toLowerCase())) continue;
    h[k] = req.headers[k];
  }
  h["host"] = DSH_AUTHORITY;
  if (h["origin"]) h["origin"] = "http://" + DSH_AUTHORITY;
  if (h["referer"]) { try { const ru = new URL(h["referer"]); h["referer"] = "http://" + DSH_AUTHORITY + ru.pathname + ru.search; } catch (e2) { h["referer"] = "http://" + DSH_AUTHORITY + "/"; } }
  const dshCookies = Object.keys(tabletCookies).filter(function (k) { return k.indexOf("dsh-auth-") === 0; }).map(function (k) { return k + "=" + tabletCookies[k]; }).join("; ");
  if (dshCookies) h["cookie"] = dshCookies; else delete h["cookie"];
  h["x-forwarded-for"] = clientIp(req);
  h["x-forwarded-proto"] = "https";
  h["x-forwarded-host"] = req.headers.host || "";
  return h;
}

function sendNotice(res, code, title, body, refresh) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(noticePage(title, body, refresh));
}

function pipeResponse(req, res, ur, pathname) {
  const headers = {};
  for (const k of Object.keys(ur.headers)) {
    if (HOP.has(k.toLowerCase())) continue;
    headers[k] = ur.headers[k];
  }
  const sc = ur.headers["set-cookie"];
  if (sc) headers["set-cookie"] = sc.map(function (c) { return (c.indexOf("dsh-auth-") === 0 && !/;\s*Secure/i.test(c)) ? c + "; Secure" : c; });
  headers["x-content-type-options"] = "nosniff";
  if (pathname.indexOf("/assets/") === 0 && ur.statusCode === 200) headers["cache-control"] = "public, max-age=31536000, immutable";
  else if (pathname === "/" || pathname === "/index.html") headers["cache-control"] = "no-store";
  const ctype = String(ur.headers["content-type"] || "");
  const isIndexHtml = (pathname === "/" || pathname === "/index.html") && /text\/html/i.test(ctype) && ur.statusCode === 200;
  if (isIndexHtml && POLYFILL) {
    const chunks = [];
    ur.on("data", function (c) { chunks.push(c); });
    ur.on("end", function () {
      let raw = Buffer.concat(chunks);
      const enc = String(ur.headers["content-encoding"] || "").toLowerCase();
      try {
        if (enc === "gzip") raw = zlib.gunzipSync(raw);
        else if (enc === "deflate") raw = zlib.inflateSync(raw);
        else if (enc === "br") raw = zlib.brotliDecompressSync(raw);
      } catch (e) { log("index decompress failed", enc, e.message); }
      let html = raw.toString("utf8");
      const tag = "<script>" + POLYFILL + "<\/script><script>" + GATE_BOOT + "<\/script><script>" + ERROR_REPORT + "<\/script>" + (RESPONSIVE_CSS ? "<style>" + RESPONSIVE_CSS + "</style>" : "") + (RESPONSIVE_JS ? "<script>" + RESPONSIVE_JS + "<\/script>" : "");
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, function (m) { return m + tag; });
      else html = tag + html;
      const buf = Buffer.from(html, "utf8");
      delete headers["content-encoding"];
      const gzOk = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
      if (gzOk) {
        delete headers["content-length"];
        headers["content-encoding"] = "gzip";
        headers["vary"] = "Accept-Encoding";
        res.writeHead(ur.statusCode, headers);
        res.end(zlib.gzipSync(buf, { level: 6 }));
      } else {
        headers["content-length"] = String(buf.length);
        res.writeHead(ur.statusCode, headers);
        res.end(buf);
      }
    });
    ur.on("error", function () { res.destroy(); });
    return;
  }
  const alreadyEncoded = !!ur.headers["content-encoding"];
  const isSSE = ctype.toLowerCase().indexOf("text/event-stream") === 0;
  const clen = Number(ur.headers["content-length"]);
  const wantGzip = !alreadyEncoded && !isSSE && COMPRESSIBLE.test(ctype) && (!Number.isFinite(clen) || clen > 1024) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  if (wantGzip) {
    delete headers["content-length"];
    headers["content-encoding"] = "gzip";
    headers["vary"] = "Accept-Encoding";
    res.writeHead(ur.statusCode, headers);
    const gz = zlib.createGzip({ level: 6 });
    ur.pipe(gz).pipe(res);
    gz.on("error", function () { res.destroy(); });
  } else {
    res.writeHead(ur.statusCode, headers);
    ur.pipe(res);
  }
  ur.on("error", function () { res.destroy(); });
}

function proxyRequest(req, res) {
  const ip = clientIp(req);
  if (!allowRequest(ip)) { res.writeHead(429, { "content-type": "text/plain" }); res.end("rate limited"); return; }
  const cookies = parseCookies(req.headers.cookie);
  const urlObj = new URL(req.url, "http://x");
  const isIndex = urlObj.pathname === "/" || urlObj.pathname === "/index.html";
  const hasDshCookie = Object.keys(cookies).some(function (k) { return k.indexOf("dsh-auth-") === 0; });
  if (urlObj.pathname.indexOf("/assets/") !== 0) log("proxy", req.method, urlObj.pathname, "from", ip);
  if (isIndex) log("index UA from", ip, req.headers["user-agent"]);
  let targetPath = req.url;
  if (isIndex && !hasDshCookie) {
    const tok = readToken(false);
    if (tok) { urlObj.searchParams.set("token", tok); targetPath = urlObj.pathname + urlObj.search; }
  }
  const headers = buildUpstreamHeaders(req, cookies);
  const up = http.request({ host: DSH_AUTH.host, port: DSH_AUTH.port, method: req.method, path: targetPath, headers: headers }, function (ur) {
    if (ur.statusCode === 401) {
      ur.resume();
      const fresh = readToken(true);
      if (isIndex && fresh) {
        const u2 = new URL(req.url, "http://x"); u2.searchParams.set("token", fresh);
        const h2 = buildUpstreamHeaders(req, cookies);
        const retry = http.request({ host: DSH_AUTH.host, port: DSH_AUTH.port, method: "GET", path: u2.pathname + u2.search, headers: h2 }, function (ur2) { pipeResponse(req, res, ur2, u2.pathname); });
        retry.on("error", function () { sendNotice(res, 503, "DSH 未就绪", "正在等待 DSH Web 启动，页面将自动刷新。", 3); });
        retry.end();
        return;
      }
      sendNotice(res, 401, "需要重新接入", "认证已过期，<a href='/'>点此重新进入</a>。", 2);
      return;
    }
    pipeResponse(req, res, ur, urlObj.pathname);
  });
  up.on("error", function (e) {
    log("upstream error", e.code || e.message);
    sendNotice(res, 503, "DSH 未运行", "网关在线，但 DSH Web 尚未启动或已退出。请在电脑上启动 DSH，页面将自动刷新。", 3);
  });
  req.on("error", function () { try { up.destroy(); } catch (e) {} });
  res.on("close", function () { if (!res.writableEnded) { try { up.destroy(); } catch (e) {} } });
  req.pipe(up);
}

function handler(req, res) {
  const ip = clientIp(req);
  const urlObj = new URL(req.url, "http://x");
  const p = urlObj.pathname;
  const cookies = parseCookies(req.headers.cookie);
  const authed = checkSession(cookies[COOKIE_NAME]);

  if (p === "/__gate/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, dshTokenPresent: !!readToken(false), ip: currentIp, port: cfg.listenPort, uptimeSec: Math.round(process.uptime()) }));
    return;
  }
  if (p === "/__gate/diag" && req.method === "POST") {
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", function () { log("CLIENT DIAG", body); res.writeHead(204); res.end(); });
    return;
  }
  if (p === "/__gate/logout") {
    res.writeHead(303, { "set-cookie": sessionCookie("", 0), location: "/" });
    res.end();
    return;
  }
  if (p === "/__gate/login" && req.method === "POST") {
    const lock = loginLocked(ip);
    if (lock) { res.writeHead(429, { "content-type": "text/html; charset=utf-8" }); res.end(loginPage("尝试过于频繁，请 " + Math.ceil(lock / 1000) + " 秒后再试。")); return; }
    const origin = req.headers.origin;
    const secSite = req.headers["sec-fetch-site"];
    let cross = secSite === "cross-site";
    if (!cross && origin) { try { cross = new URL(origin).host !== req.headers.host; } catch (e) { cross = true; } }
    if (cross) { res.writeHead(403, { "content-type": "text/plain" }); res.end("cross-site login blocked"); return; }
    let body = "";
    req.on("data", function (c) { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", function () {
      let pw = "";
      try {
        if (String(req.headers["content-type"] || "").indexOf("application/json") !== -1) pw = JSON.parse(body).password;
        else pw = new URLSearchParams(body).get("password") || "";
      } catch (e) {}
      if (verifyPassword(pw)) {
        noteLoginOk(ip);
        log("login OK from", ip);
        res.writeHead(303, { "set-cookie": sessionCookie(mintSession(), Math.floor(SESSION_MS / 1000)), location: "/", "cache-control": "no-store" });
        res.end();
      } else {
        noteLoginFail(ip);
        res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(loginPage("口令不正确。"));
      }
    });
    return;
  }
  if (!authed) {
    if (p === "/" || p === "/index.html" || req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(loginPage(""));
    } else {
      res.writeHead(401, { "content-type": "text/plain" }); res.end("gateway authentication required");
    }
    return;
  }
  proxyRequest(req, res);
}

function upgradeHandler(req, socket, head) {
  const cookies = parseCookies(req.headers.cookie);
  if (!checkSession(cookies[COOKIE_NAME])) { socket.destroy(); return; }
  log("WS upgrade from", clientIp(req), req.url);
  const headers = buildUpstreamHeaders(req, cookies);
  headers["connection"] = "Upgrade";
  headers["upgrade"] = req.headers["upgrade"] || "websocket";
  const up = net.connect(DSH_AUTH.port, DSH_AUTH.host, function () {
    let reqLine = req.method + " " + req.url + " HTTP/1.1\r\n";
    for (const k of Object.keys(headers)) reqLine += k + ": " + headers[k] + "\r\n";
    reqLine += "\r\n";
    up.write(reqLine);
    if (head && head.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  const kill = function () { socket.destroy(); up.destroy(); };
  up.on("error", kill);
  socket.on("error", kill);
  socket.on("close", function () { up.destroy(); });
  up.on("close", function () { socket.destroy(); });
}

let currentIp = detectIp();
let servers = [];
function startServers(ip) {
  ensureCert(ip);
  const tls = { key: fs.readFileSync(path.join(STATE, "key.pem")), cert: fs.readFileSync(path.join(STATE, "cert.pem")) };
  const made = [];
  // Bind the LAN address and loopback. Deduplicated so a loopback-only setup
  // (DSH_GATE_IP=127.0.0.1, CI smoke tests) does not collide with itself.
  const addrs = ip === "127.0.0.1" ? ["127.0.0.1"] : [ip, "127.0.0.1"];
  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i];
    const s = https.createServer(tls, handler);
    s.requestTimeout = 1800000;
    s.headersTimeout = 60000;
    s.keepAliveTimeout = 65000;
    s.on("upgrade", upgradeHandler);
    s.on("clientError", function (e, sock) { try { sock.destroy(); } catch (e2) {} });
    s.listen(cfg.listenPort, addr, function () { log("listening https://" + addr + ":" + cfg.listenPort); });
    s.on("error", function (e) { log("server error on " + addr, e.code || e.message); });
    made.push(s);
  }
  return made;
}
function rebind(ip) {
  for (let i = 0; i < servers.length; i++) { try { servers[i].close(); } catch (e) {} }
  servers = startServers(ip);
  currentIp = ip;
  writeInfo();
}

const require = createRequire(import.meta.url);
function asciiQr(text) {
  try {
    const qrcode = require("./vendor/qrcode.js");
    const qr = qrcode(0, "M");
    qr.addData(text); qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    const lines = [];
    for (let r = -quiet; r < n + quiet; r++) {
      let row = "";
      for (let c = -quiet; c < n + quiet; c++) {
        const dark = r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c);
        row += dark ? "██" : "  ";
      }
      lines.push(row);
    }
    return lines.join("\n");
  } catch (e) { return "(QR unavailable: " + e.message + ")"; }
}
function writeInfo() {
  const url = "https://" + currentIp + ":" + cfg.listenPort + "/";
  const info = { url: url, ip: currentIp, port: cfg.listenPort, password: auth.passwordPlain, startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(STATE, "info.json"), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(STATE, "qr.txt"), asciiQr(url) + "\n");
  return info;
}
function printBanner() {
  const info = writeInfo();
  console.log("\n============================================================");
  console.log("  DSH Remote Gen-3 / Block0 安全网关已就绪");
  console.log("============================================================");
  console.log("  移动端浏览器打开:  " + info.url);
  console.log("  接入口令:          " + info.password);
  console.log("  (口令亦存于 state/password.txt；30 天免登录)");
  console.log("------------------------------------------------------------");
  console.log(asciiQr(info.url));
  console.log("------------------------------------------------------------");
  console.log("  首次访问证书不受信任 → 高级 → 继续前往（自签，链路加密）。");
  console.log("  DSH 未启动时本页自动刷新等待；断网/熄屏恢复后自动重连。");
  console.log("============================================================\n");
}

servers = startServers(currentIp);
printBanner();
log("gateway started", { ip: currentIp, port: cfg.listenPort, dsh: DSH_AUTHORITY });

setInterval(function () {
  const ip = detectIp();
  if (ip !== currentIp) { log("LAN address changed", currentIp, "->", ip); rebind(ip); printBanner(); }
}, 15000).unref();

process.on("SIGINT", function () { log("SIGINT"); for (let i = 0; i < servers.length; i++) servers[i].close(); process.exit(0); });
process.on("SIGTERM", function () { log("SIGTERM"); for (let i = 0; i < servers.length; i++) servers[i].close(); process.exit(0); });
process.on("uncaughtException", function (e) { log("uncaughtException", e.stack || e.message); });
process.on("unhandledRejection", function (e) { log("unhandledRejection", String(e)); });
