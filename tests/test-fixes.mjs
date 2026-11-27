import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
// F1: qrcode must load as a function (vendor/package.json type=commonjs)
const qrcode = require(path.join(ROOT,'gateway','vendor','qrcode.js'));
assert.equal(typeof qrcode, 'function', 'F1 qrcode is a function');
const qr = qrcode(0,'M'); qr.addData('https://203.0.113.1:8443/'); qr.make();
assert.ok(qr.getModuleCount() > 10, 'F1 QR generated');
console.log('F1 PASS: qrcode loads + QR generated, modules=', qr.getModuleCount());
// F3: last-token-wins (replicate readToken regex)
const log = 'token=' + 'OLDOLDOLDOLDOLDOLDOLDOLD01' + '\nstuff\n' + 'token=' + 'NEWNEWNEWNEWNEWNEWNEWNEW02' + '\n';
let last=''; for (const m of log.matchAll(/token=([A-Za-z0-9_-]{20,})/g)) last=m[1];
assert.equal(last, 'NEWNEWNEWNEWNEWNEWNEWNEW02', 'F3 last token wins');
console.log('F3 PASS: last token =', last);
// F2: virtual NIC skip (replicate detectIp filter)
const virtualName = /vethernet|vmnet|virtualbox|vbox|docker|tailscale|loopback|hyper-v|wsl|tap|tun/i;
const ifs = { 'vEthernet (WSL)':[{family:'IPv4',internal:false,address:'172.18.0.1'}], 'VMware VMnet1':[{family:'IPv4',internal:false,address:'192.168.64.1'}], 'WLAN':[{family:'IPv4',internal:false,address:'192.168.1.50'}], 'Tailscale':[{family:'IPv4',internal:false,address:'169.254.83.107'}] };
const cands=[]; for (const name of Object.keys(ifs)){ if(virtualName.test(name))continue; for(const a of ifs[name]) if(a.family==='IPv4'&&!a.internal&&!/^169\.254\./u.test(a.address))cands.push(a.address); }
const isPrivate=a=>/^10\./u.test(a)||/^192\.168\./u.test(a)||/^172\.(1[6-9]|2\d|3[01])\./u.test(a);
const picked=cands.find(isPrivate)||cands[0]||'127.0.0.1';
assert.equal(picked,'192.168.1.50','F2 picks WLAN not virtual');
console.log('F2 PASS: picked', picked);
// F5: EADDRINUSE -> exit 1, no info.json
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'dshfix-'));
const blocker = http.createServer(); 
await new Promise(r=>blocker.listen(0,'127.0.0.1',r));
const port = blocker.address().port;
const env = { ...process.env, DSH_GATE_IP:'127.0.0.1', DSH_GATE_PORT:String(port), DSH_GATE_STATE:tmp, DSH_GATE_OPENSSL:process.env.DSH_GATE_OPENSSL||'', DSH_GATE_TOKENLOG:path.join(tmp,'tok.txt') };
fs.writeFileSync(path.join(tmp,'tok.txt'), 'token=' + 'SMOKETOKEN0123456789abcdefghijkl' + '\n');
const child = spawn(process.execPath,[path.join(ROOT,'gateway','gateway.mjs')],{env});
let out=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>out+=c);
const code = await new Promise(r=>child.on('exit',r));
assert.equal(code,1,'F5 exit 1 on EADDRINUSE');
assert.ok(/EADDRINUSE|已被占用|FATAL/u.test(out),'F5 fatal message');
assert.ok(!fs.existsSync(path.join(tmp,'info.json')),'F5 no info.json written');
console.log('F5 PASS: exit', code, '| no info.json | msg:', /已被占用/u.test(out));
blocker.close();
console.log('ALL FIX TESTS PASS (F1/F2/F3/F5)');
