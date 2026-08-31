# Deploying

Two independent services on one host behind one Traefik, and they never move together:

| service | compose file | what it is |
| --- | --- | --- |
| **the hub** | `deploy/hub-compose.yml` | §8 at `pence.page`. Storage for signed files. Holds no key |
| **the bridge** | `deploy/docker-compose.yml` | `bridge/` at `bridge.jovialpenguin.com`. Interop, not spec. **Holds keys** |

Both are **test deployments of a draft protocol** — see the version policy in `CLAUDE.md`.

**Which machine runs what.** Both services run on `jovial-penguin-3` (production since 2026-08-27;
`jovial-penguin-1` is a spare running nothing), each from its **own clone of this repo on that
host** — `~/services/openfeed` for the hub, `~/services/openfeed-bridge` for the bridge — so that
updating one can never rebuild the other from a moved tree. Deploys are driven **from the laptop**
by the homelab repo: `homelab deploy openfeed-hub` (or `openfeed-bridge`) plans, `--apply --yes`
acts; the tool pulls the host's clone, refuses a dirty tree, dry-runs compose, applies with the
right project name, and probes every hostname before and after. The ssh blocks below are what the
tool does, kept as the manual fallback — they run **on the host**. Publishing and verifying
(`npx . claim|post|views|verify`) run **from your own machine**, never the host.

**Compose project names.** Both files live in `deploy/`, so Compose would derive the same project
name for both and put them in one project — where a single `--remove-orphans` on either would delete
the other's container. `hub-compose.yml` declares `name: openfeed-hub`; `docker-compose.yml`
deliberately declares nothing, because its running container and its `deploy_bridge-data` volume
already exist under the derived name and renaming the project now would hide them. The homelab
repo's `services/openfeed-hub` and `services/openfeed-bridge` manifests encode the same two names,
so a deploy through `homelab deploy` cannot get this wrong.

The separation is not tidiness. `up -d --build` on the bridge restarts it, and a bridge restarting
with a lost volume is how a federated identity loses the key remote instances have cached. There is
no such failure on the hub side, because a hub never holds a key at all (§4.4).

---

# The hub

`openfeed hub` (`src/cli.js`, `bin/openfeed.js`) serving `https://pence.page`. Members live at
`pence.page/<name>`: `pence.page/jesse`, `pence.page/mom`.

**It holds no private key.** Signing happens on the device that publishes; this process stores
signed files and serves back the exact bytes it was given (§2.3). So the disaster here is losing
*files*, not losing an identity — every publisher keeps its own copy (§8.9) and can re-`PUT` the lot.
That is the third floor item in `docs/GOALS.md` as an operational fact rather than a claim.

| flag | meaning |
| --- | --- |
| `--host 0.0.0.0` | **required in a container.** The CLI defaults to loopback, and a container bound to loopback is invisible to the proxy |
| `--port 4567` | must match the `loadbalancer.server.port` label |
| `--data /app/data` | the store, on the `hub-data` volume. Without it the hub is in memory and a restart is empty |
| | *`fileStore` rewrites the whole store on every write — right for a family, wrong at scale. See the bound in `src/hub.js`* |
| `--origin https://pence.page` | the public origin, used for WebFinger |

## Deploy

From the homelab repo, on the laptop:

```bash
homelab deploy openfeed-hub                 # plan only; nothing changes
homelab deploy openfeed-hub --apply --yes   # production needs both flags
```

What it does on the host, which is also the manual fallback (over ssh):

```bash
# 1. DNS first -- the HTTP-01 challenge fails without it, and failures count against a rate limit
dig +short pence.page A                   # must answer with the host's public IP

# 2. Build and start
cd ~/services/openfeed && git pull        # or clone https://github.com/jazzypants1989/open-feed.git
docker compose -f deploy/hub-compose.yml up -d --build
docker logs -f openfeed-hub               # "It holds no key" on every start
```

Cloudflare fronts `pence.page`, and the A record must be **grey-cloud (DNS only)**. Orange-cloud
proxying puts a third party in the serving path holding the TLS key for an origin whose whole premise
is that the serving path is not trusted — and it breaks the HTTP-01 challenge depending on the SSL mode.

## Verify

An empty hub 404s every path until a name is claimed (§8.4), so the first check is that the container
answers at all rather than Traefik answering for it.

Claiming and publishing happen **from your own machine**, never on the host — the key never goes near
the server:

```bash
npx . key   --out ~/.openfeed/jesse.json                    # 0600. This file is the identity
npx . claim --key ~/.openfeed/jesse.json --at https://pence.page/jesse
npx . post  --key ~/.openfeed/jesse.json --at https://pence.page/jesse --text 'the peonies came back'
npx . views --key ~/.openfeed/jesse.json --at https://pence.page/jesse
```

`~/.openfeed/jesse.copy/` is §8.9's copy: every signed byte, kept as it was sent. It is the export,
and re-uploading it at another origin is how a move works.

```bash
curl -sI https://pence.page/jesse/profile                  # 200, valid cert
curl -s https://pence.page/jesse/index | tail -1           # the signature line
curl -sI https://pence.page/jesse/posts/1 | grep -i etag   # the address is the hash of the body

npx . verify <anchor key> https://pence.page/jesse         # from a machine that is not the host
```

**If `openfeed` says `ENOTFOUND` while `dig` answers the record**, your system resolver cached the
NXDOMAIN from before the record existed. `dig` queries the resolver directly and bypasses that cache;
`getaddrinfo` — which is what Node, curl and everything else use — does not. The negative TTL is the
last field of the SOA (`dig +short pence.page SOA`), 1800s here, so it clears within half an hour.
To not wait:

```bash
sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder    # macOS
sudo resolvectl flush-caches                                       # systemd-resolved
```

The last one is the only check that matters: it is the reader (§7), run against the live origin,
returning `ok`, `tampered` or `contested` and nothing else. Run it from off the host's network, and
take the anchor key from your own keyfile rather than from anything the hub served.

To confirm persistence: `docker compose -f deploy/hub-compose.yml restart`, then re-fetch a post and
compare the ETag. Same bytes, same hash, or the store did not survive.

---

# The bridge

The interop bridge (`bridge/`) serving one Open Feed identity at a real origin, so the ActivityPub,
Nostr, and IndieWeb translations can be tested against real instances rather than in memory.

**Status: a finished experiment, deliberately left running** (decided 2026-08-27). It proved
Mastodon and AT Protocol interop on a real domain, and it stays up because remote instances have
cached its keys — taking it down teaches nothing and destroys the one thing it still holds. A 404
at `/` is expected, not a bug. The production bridge, when POSSE work starts, will be **born at
`bridge.pence.page`**, not migrated: an ActivityPub identity is domain-bound, so there is nothing
to move — and this domain stays the sandbox, keeping experiments off the family domain's
federation reputation.

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
`jovial-penguin-3`, which routes by Docker label on the external `traefik-public` network.

From the homelab repo, on the laptop: `homelab deploy openfeed-bridge` to plan,
`--apply --yes` to act. The manual fallback, on the host:

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

`homelab deploy openfeed-bridge --apply --yes` from the laptop, or on the host:

```bash
cd ~/services/openfeed-bridge && git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

The volume survives, so the identity does. The homelab manifest marks `deploy_bridge-data`
irreplaceable and checksums its files on every `homelab verify` — that, not this README, is the
live guard on the keys.

## Known gap

If a remote instance runs `authorized_fetch` (Mastodon's secure mode), it requires a signed GET.
`resolveInbox` in `bridge/inbox.js` fetches the follower's Actor unsigned, so it would get a 401 and
never learn where to deliver the Accept — the follow would sit pending with nothing in the logs but a
202. `sign()` in `bridge/signatures.js` is what that path would need.

## If Traefik 404s a container that is plainly running

Traefik will not route a container Docker reports as **unhealthy**, and it says nothing about it —
the router simply never appears in `/api/http/routers`. Check `docker ps` for the health column
before suspecting the labels.
