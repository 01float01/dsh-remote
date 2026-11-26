// Integration test: needs a running gateway in front of a live DSH.
//
//   DSH_GATE_BASE       default https://127.0.0.1:8443
//   DSH_GATE_PASSWORD   gateway password; defaults to reading gateway/state/password.txt
//   DSH_GATE_TEST_CWD   cwd handed to session/create (default: process.cwd())
//   DSH_ATTACHMENTS_DIR optional, to assert the stored object byte-for-byte
import fs from "node:fs";
import crypto from "node:crypto";
const BASE = process.env.DSH_GATE_BASE || "https://127.0.0.1:8443";
const pw = (process.env.DSH_GATE_PASSWORD || fs.readFileSync(new URL("../gateway/state/password.txt", import.meta.url), "utf8")).trim();
const cookies = {};
function jar(res) { for (const c of res.headers.getSetCookie()) { const kv = c.split(";")[0]; const i = kv.indexOf("="); cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } }
function cookieHeader() { return Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; "); }
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), cookie: cookieHeader() }, redirect: "manual" });
  jar(res);
  return res;
}
// 1. login
let r = await req("/__gate/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=" + encodeURIComponent(pw) });
console.log("login:", r.status, "dshgate=", !!cookies["dshgate"]);
// 2. establish DSH cookie via index (gateway injects token)
r = await req("/", {});
console.log("index:", r.status, "location=", r.headers.get("location"));
if (r.status === 303) { const loc = new URL(r.headers.get("location") || "/", BASE + "/"); r = await req(loc.pathname + loc.search, {}); }
console.log("after index dsh-auth=", Object.keys(cookies).some(k => k.startsWith("dsh-auth-")));
// 3. create session
r = await req("/api/session/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "client-request", rpcId: "up1", method: "session/create", payload: { args: { request: { cwd: process.env.DSH_GATE_TEST_CWD || process.cwd() } } } }) });
const cj = await r.json();
console.log("session create ok:", cj.result && cj.result.ok);
if (!cj.result || !cj.result.ok) { console.log("CREATE ERROR:", JSON.stringify(cj).slice(0, 500)); process.exit(1); }
const sessionId = cj.result.value.sessionId;
console.log("sessionId=", sessionId);
// 4. build known 3MB test file
const data = crypto.randomBytes(3 * 1024 * 1024);
const sha = crypto.createHash("sha256").update(data).digest("hex");
console.log("test file bytes:", data.length, "sha256:", sha);
// 5. upload through gateway (raw binary, octet-stream)
r = await req("/api/session/uploadFileBinary?sessionId=" + encodeURIComponent(sessionId) + "&name=upload-test.bin", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: data });
const uj = await r.json();
console.log("upload HTTP:", r.status, "ok:", uj.ok, "receipt bytes:", uj.value && uj.value.file && uj.value.file.bytes, "attachmentId:", uj.value && uj.value.file && uj.value.file.attachmentId);
// 6. verify stored object integrity (only when DSH_ATTACHMENTS_DIR is provided)
const prefix = sha.slice(0, 2);
const objPath = process.env.DSH_ATTACHMENTS_DIR
  ? process.env.DSH_ATTACHMENTS_DIR.replace(/[/\\]+$/u, "") + "/objects/" + prefix + "/" + sha
  : "";
if (objPath !== "" && fs.existsSync(objPath)) {
  const stored = fs.readFileSync(objPath);
  const storedSha = crypto.createHash("sha256").update(stored).digest("hex");
  console.log("stored object exists:", objPath);
  console.log("stored bytes:", stored.length, "sha match:", storedSha === sha, "byte-identical:", stored.equals(data));
} else {
  console.log("stored object NOT at content-addressed path; attachmentId=", uj.value && uj.value.file && uj.value.file.attachmentId);
}
console.log("UPLOAD INTEGRITY TEST DONE");
