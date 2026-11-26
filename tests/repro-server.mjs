import http from "node:http";
import fs from "node:fs";
const POLYFILL = fs.readFileSync(new URL("../gateway/polyfill.js", import.meta.url), "utf8");
const RPC = [
  "async function callRpc(){",
  "  var c = new AbortController(); var signal = c.signal;",
  "  var resp = await fetch('api/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'x',method:'echo',payload:{}}),signal:signal});",
  "  if(!resp.ok) throw new Error('transport HTTP '+resp.status);",
  "  var full = await resp.json();",
  "  signal?.throwIfAborted();",
  "  return full;",
  "}",
  "function show(t){document.getElementById('out').textContent=t;document.title=t;}",
  "callRpc().then(function(r){show('OK: RPC succeeded, rpcId='+r.rpcId);}).catch(function(e){show('ERROR: '+e.message);});"
].join("\n");
function page(extra) {
  return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='font-family:sans-serif;padding:2rem'><h2>DSH RPC reproduction</h2><pre id='out' style='font-size:1.2rem;white-space:pre-wrap'>running...</pre>" + extra + "<script>" + RPC + "</script></body></html>";
}
const sab = page("<script>try{delete AbortSignal.prototype.throwIfAborted;delete Object.hasOwn;}catch(e){}</script>");
const fix = page("<script>try{delete AbortSignal.prototype.throwIfAborted;}catch(e){}</script><script>" + POLYFILL + "</script>");
http.createServer(function (req, res) {
  if (req.url === "/api/echo") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ rpcId: "x", result: { ok: true } })); return; }
  if (req.url === "/sab") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(sab); return; }
  if (req.url === "/fix") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(fix); return; }
  res.writeHead(200, { "content-type": "text/html" }); res.end("<a href='/sab'>sab</a> | <a href='/fix'>fix</a>");
}).listen(8099, "0.0.0.0", function () { console.log("repro server on 8099"); });
