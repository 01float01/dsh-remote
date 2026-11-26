# Reaching the gateway from outside the LAN

The intended deployment is a phone and the host on the **same Wi-Fi**: zero external
dependencies, no tunnel, nothing to buy. This document covers the cases where that is not
possible.

## Option A — a TCP tunnel (no domain, no VPS)

Any TCP tunnel that forwards a public port to `127.0.0.1:8443` works, because the gateway
speaks ordinary TLS. A minimal `cpolar` configuration ships as
[`cpolar.yml.template`](cpolar.yml.template):

```yaml
authtoken: REPLACE_WITH_USER_TOKEN
tunnels:
  dshgate:
    proto: tcp
    addr: 8443
```

Then `https://<random-host>:<random-port>/` reaches the gateway. Trade-offs:

- **Certificate name mismatch.** The generated certificate's SAN holds the LAN address,
  loopback and the Android emulator alias — not the tunnel hostname. The phone will warn
  about both the untrusted CA and the name mismatch; you accept the exception once. If that
  warning bothers you, put a real certificate in `gateway/state/cert.pem` + `key.pem` (the
  gateway reuses them as long as `cert-ip.txt` matches the bound address) and use a domain.
- **Free tiers are slow and unstable.** In the setup this project was developed against, a
  free tunnel gave roughly 1 Mbps and the first DSH load took about a minute. Treat that as
  an anecdote from one provider, not a benchmark.
- **The public URL changes** when the tunnel restarts. Re-read it from the tunnel output or
  from `gateway/state/info.json` on the next gateway start.

## Option B — frp + a cheap VPS (most stable)

Forward the gateway port with `frpc` on the host and `frps` on the VPS, then browse to the
VPS. This is the setup to prefer if you need this daily: stable address, stable bandwidth,
no random port. It costs a VPS.

## Option C — a mesh VPN (EasyTier, Tailscale, …)

A mesh network with a no-TUN port forward keeps the browser pointed at loopback
(`http://127.0.0.1:8443`), which is the smoothest experience, but it puts a client on the
phone — and on some Android builds the vendor's battery manager kills background VPN
processes. This project exists largely to avoid that class of problem, so treat it as a
fallback rather than the primary path.

## What never changes

Whatever transport you add, the trust boundary stays the same: the gateway is the only
thing exposed, DSH stays on `127.0.0.1:5140`, and the password gate plus session cookie
still apply. Do not "fix" a tunnel by exposing DSH's port directly.
