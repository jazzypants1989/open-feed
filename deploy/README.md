# Deploying the bridge

The interop bridge (`bridge/`) serving one Open Feed identity at a real origin, so the ActivityPub,
Nostr, and IndieWeb translations can be tested against real instances rather than in memory. This is
a **test deployment of a draft protocol** — see the version policy in `CLAUDE.md`.

## What runs

`bridge/mastodon-test.js` starts a hub, an identity, three posts, and the unified bridge in one
process on port 4568. It is entirely stdlib — the image installs nothing.

| variable | meaning |
| --- | --- |
| `BRIDGE_ORIGIN` | **required.** The public origin, e.g. `https://bridge.jovialpenguin.com`. Every AP id, WebFinger link, and feed URL is built from it |
| `BRIDGE_DATA` | a directory for keys, hub files, and followers. **Set it for anything a remote instance will see** |
| `BRIDGE_PORT` | listen port, default 4568 |
| `BRIDGE_NAME` | the identity's name, default `alice` |

### `BRIDGE_DATA` is not optional in practice

Without it the process mints a new Ed25519 identity key, a new RSA Actor key, and a new Nostr key on
every start, and holds the hub in memory. A remote instance caches the Actor's public key, so a
restart leaves it verifying signatures against a key that no longer exists — and there is no fix
from this side but to wait out its cache. Leave it unset only behind a throwaway tunnel.

`bridge/state.js` writes three files, all `0600`: `keys.json` (the three private keys), `hub.json`
(every signed file the hub holds), `followers.json`. **`keys.json` is the identity.** It is in a
Docker named volume (`bridge-data`); back it up before destroying anything.

## The origin must be a domain you control

A tunnel is not a substitute. `trycloudflare.com` is blocklisted by mastodon.social — the Actor is
never fetched and the failure looks like nothing at all. `ngrok` and friends are worth assuming the
same of. Use a real hostname with a real certificate.

## Deploy

Requires a reverse proxy terminating TLS. This compose file targets the Traefik on
`jovial-penguin-1`, which routes by Docker label on the external `traefik-public` network.

```bash
# 1. DNS first -- the HTTP-01 challenge fails without it, and failures count against a rate limit
dig +short bridge.jovialpenguin.com A     # must answer with the host's public IP

# 2. Build and start
git clone https://github.com/jazzypants1989/open-feed.git ~/services/openfeed-bridge
cd ~/services/openfeed-bridge
docker compose -f deploy/docker-compose.yml up -d --build
docker logs -f openfeed-bridge
```

Traefik runs `exposedByDefault: false`, so `traefik.enable=true` is what attaches the router; without
it the container starts and is simply never routed.

## Verify

```bash
curl -sI https://bridge.jovialpenguin.com/users/alice                     # 200, valid cert
curl -sH 'Accept: application/activity+json' \
     https://bridge.jovialpenguin.com/users/alice                         # Person + RSA publicKeyPem
curl -s "https://bridge.jovialpenguin.com/.well-known/webfinger?resource=acct:alice@bridge.jovialpenguin.com"
curl -s https://bridge.jovialpenguin.com/users/alice/outbox               # 3 Create/Note
curl -s https://bridge.jovialpenguin.com/users/alice/followers            # totalItems
```

Then from any Mastodon account, search `@alice@bridge.jovialpenguin.com` and follow it. The bridge
answers the Follow with a signed Accept; `docker logs openfeed-bridge` shows the request.

To confirm persistence is really on: note the `publicKeyPem`, `docker compose -f
deploy/docker-compose.yml restart`, and re-fetch. The key must be unchanged and the outbox must still
hold exactly posts 1-3.

## Update

```bash
cd ~/services/openfeed-bridge && git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

The volume survives, so the identity does.

## Known gap

If a remote instance runs `authorized_fetch` (Mastodon's secure mode), it requires a signed GET.
`resolveInbox` in `bridge/inbox.js` fetches the follower's Actor unsigned, so it would get a 401 and
never learn where to deliver the Accept — the follow would sit pending with nothing in the logs but a
202. `sign()` in `bridge/signatures.js` is what that path would need.

## If Traefik 404s a container that is plainly running

Traefik will not route a container Docker reports as **unhealthy**, and it says nothing about it —
the router simply never appears in `/api/http/routers`. Check `docker ps` for the health column
before suspecting the labels.
