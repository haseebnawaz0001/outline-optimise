# Deployment Guide

This fork ships with two production topologies built around Docker Compose and an optional Cloudflare Tunnel. Both keep your servers from exposing any inbound ports to the internet.

- **Single VPS** – everything on one machine. Simplest, recommended for most teams.
- **Multiple VPS** – stateful services, app traffic and background work on separate machines over a private network.

Both modes share the same image (`outline-optimized:local`, built by `deploy/build.sh`) and the same memory-capping strategy.

---

## Single VPS

```
                    Cloudflare (optional)
   users ──►  https://docs.example.com ──► cloudflared tunnel ─┐
                                                               ▼
        ┌────────────────────────── one VPS ────────────────────────┐
        │  outline (web + websockets + collaboration + worker+cron) │
        │      ▲            ▲                                       │
        │   postgres      redis                                     │
        └───────────────────────────────────────────────────────────┘
```

### Steps

1. **Build the image** (on the VPS, or in CI pushed to a registry):

   ```shell
   git clone <this repo> && cd outline
   deploy/build.sh
   ```

2. **Configure**:

   ```shell
   cp deploy/single/.env.example deploy/single/.env
   ```

   Fill in at minimum:

   - `URL` – the public address users visit
   - `SECRET_KEY`, `UTILS_SECRET` – `openssl rand -hex 32`
   - `POSTGRES_PASSWORD`
   - one sign-in provider (`OIDC_*`, `SLACK_*`, `GOOGLE_*`, …) or SMTP for email sign-in

3. **Start**:

   ```shell
   cd deploy/single
   docker compose up -d
   curl http://localhost:3000/_health    # -> OK
   ```

   Database migrations run automatically before each boot; they are idempotent.

   > **Testing over plain HTTP before DNS is set up?** Set `URL=http://<server-ip>:3000` and `FORCE_HTTPS=false` temporarily, otherwise requests get redirected to your (not yet live) https domain. Switch back once the tunnel is up.

4. **(Recommended) attach a Cloudflare Tunnel** so the VPS keeps its ports closed:

   - In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) create a tunnel of type *Cloudflared*.
   - Copy its token into `CF_TUNNEL_TOKEN` in `.env`.
   - Under the tunnel's *Public Hostname* tab map `docs.example.com` → service `HTTP://outline:3000`. The hostname must be proxied by Cloudflare.
   - Start the tunnel sidecar:

     ```shell
     docker compose --profile tunnel up -d
     ```

   Behind the tunnel leave `FORCE_HTTPS=true` (default). Cloudflared sends `X-Forwarded-Proto`, which Outline trusts by default (`PROXY_HEADERS_TRUSTED=true`) — no redirect loops.

### Without a tunnel

Set `OUTLINE_BIND_IP=0.0.0.0` and terminate TLS yourself with a reverse proxy in front of port `OUTLINE_PORT`. Everything else works identically.

---

## Multiple VPS (distributed)

```
                     Cloudflare
   users ──► https://docs.example.com ──► tunnel on app node ──► outline :3000
                                                                    │
   private network (WireGuard / Tailscale):  100.64.0.0/24          │
        ┌───────────────────┬───────────────────────┬───────────────┤
        │ core node         │ app node(s)           │ worker node   │
        │  postgres :5432 ──┼─ ► DATABASE_URL       │               │
        │  redis    :6379 ──┼─ ► REDIS_URL          │               │
        │                   └─────────────────────┼─ ► same URLs  │
        └─────────────────────────────────────────┴───────────────┘
```

### Prerequisites

- A private network between the nodes. Either works:
  - **Tailscale** – zero-config WireGuard mesh with stable hostnames (`core`, …)
  - **Plain WireGuard** – one `/24` per environment, e.g. core `100.64.0.1`, app `100.64.0.2`, worker `100.64.0.3`
- **S3-compatible object storage is required** for attachments when nodes are distributed (local disk cannot be shared). Cloudflare R2 works well and has no egress fees. Set `FILE_STORAGE=s3` plus the `AWS_*` variables.

### Core node (Postgres + Redis)

```shell
cp deploy/multi/core/.env.example deploy/multi/core/.env
# set CORE_BIND_IP=<node's private VPN IP> and POSTGRES_PASSWORD
cd deploy/multi/core && docker compose up -d
```

Postgres and Redis publish only on `CORE_BIND_IP` — the private interface. They are unreachable from the public internet even without a firewall.

Connections ride WireGuard encryption, so `PGSSLMODE=disable` is set by default in the app/worker `.env` files (the bundled Postgres doesn't terminate TLS). If you enable SSL on the core Postgres, remove that variable.

### App node (web + websockets + collaboration)

```shell
cp deploy/multi/app/.env.example deploy/multi/app/.env
# set URL, secrets (identical across nodes!), CORE_HOST/DB_PASSWORD in
# DATABASE_URL / REDIS_URL, S3 storage, and one auth provider
cd deploy/multi/app && docker compose up -d
curl http://localhost:3000/_health   # -> OK once core node is reachable
docker compose --profile tunnel up -d   # after creating this node's tunnel
```

Notes:

- `SECRET_KEY` and `UTILS_SECRET` **must be identical** on every Outline node.
- `REDIS_COLLABORATION_URL` (same Redis as `REDIS_URL`) is what lets multiple processes and multiple app replicas share collaborative sessions and websocket fan-out.
- Scale out by running additional copies of this stack on more VPSes, each with its own tunnel token, then load-balance the hostname across tunnels in the Cloudflare dashboard (or point several public hostnames at the same origin pool).

### Worker node (worker + cron)

```shell
cp deploy/multi/worker/.env.example deploy/multi/worker/.env
# same URL/secrets/storage as the app node, pointing at the same core
cd deploy/multi/worker && docker compose up -d
```

The worker runs queue processing and cron jobs with no published ports and no tunnel.

---

## Memory management

Every service runs under a hard kernel-enforced cap (`mem_limit` in Compose). On top of that, the Node process reads its cgroup limit at startup and automatically derives a per-process **V8 heap limit**: ~80% of the cap split across `WEB_CONCURRENCY` processes, with a 256 MB floor per process. This prevents the classic failure mode where each Node process sizes its heap against total host RAM and gets OOM-killed under load.

Knobs (all optional, sensible defaults provided):

| Variable | What it caps | Default |
|---|---|---|
| `OUTLINE_MEM_LIMIT` | All Outline processes (app or single-mode container) | `1g` single / `2g` multi-app |
| `WORKER_MEM_LIMIT` | Worker container | `1g` |
| `POSTGRES_MEM_LIMIT` | Postgres container | `512m` / `1g` |
| `REDIS_MEM_LIMIT` | Redis container | `384m` / `768m` |
| `TUNNEL_MEM_LIMIT` | cloudflared | `128m` |
| `WEB_CONCURRENCY` | Number of web/collaboration processes | `1` |
| `NODE_OPTIONS=--max-old-space-size=N` | Manual per-process heap override (MB) | derived automatically |

Supporting limits inside the services:

- **Redis** starts with `--maxmemory` (`REDIS_MAXMEMORY`) and `--maxmemory-policy volatile-lru`: only cache keys with TTLs are evictable, Bull queue and pub/sub keys never are.
- **Postgres** gets conservative `shared_buffers` / `effective_cache_size` via command-line flags (`POSTGRES_SHARED_BUFFERS`, `POSTGRES_EFFECTIVE_CACHE_SIZE`).
- **glibc malloc arenas** are already limited to 2 in the Dockerfile, cutting resident-memory inflation in multi-threaded Node.

Sizing examples:

| VPS | Mode | OUTLINE_MEM_LIMIT | WEB_CONCURRENCY | Notes |
|---|---|---|---|---|
| 1 GB | single | `600m` | 1 | heap ≈ 480 MB; keep Redis/PG small |
| 2 GB | single | `1g` | 1–2 | default configuration |
| 4 GB | single | `2g` | 2–3 | heap ≈ 800 MB/process |
| 4 GB × N | multi | `2g` per app node | 2 | dedicated core + worker nodes |

Rule of thumb: budget roughly 512 MB of `OUTLINE_MEM_LIMIT` per web/collaboration process, then give Postgres and Redis whatever remains (single mode) or their own node (multi mode).

If a container ever hits its cap it is OOM-killed and restarted (`restart: unless-stopped`). Check with:

```shell
docker inspect --format '{{.State.OOMKilled}}' outline
```

---

## Operations

- **Logs** – JSON lines with rotation (`10m × 3` files per container); `docker compose logs -f outline`.
- **Health** – every Outline process serves `GET /_health`, which checks Postgres and Redis connectivity.
- **Upgrades** – pull the new code, run `deploy/build.sh`, then `docker compose up -d`. Migrations apply automatically before boot.
- **Backups** – at minimum back up the named volumes: `postgres-data` (everything important), `uploads` (attachments when `FILE_STORAGE=local`), `redis-data` (dispensable).
- **Registry images** – build once with `deploy/build.sh`, tag/push to your registry (e.g. `ghcr.io/<you>/outline-optimise`), and set `OUTLINE_IMAGE` in each `.env` so servers only pull.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/_health` returns 500 | Postgres or Redis unreachable — check `docker compose logs` and that `CORE_BIND_IP`/VPN addresses match |
| Redirect loop behind proxy | Keep `FORCE_HTTPS=true` and ensure the proxy sends `X-Forwarded-Proto` (cloudflared does) |
| Container restarts under load | It hit its memory cap — raise `*_MEM_LIMIT` or lower `WEB_CONCURRENCY` |
| Collaboration edits lost between replicas | Ensure `REDIS_COLLABORATION_URL` is set identically on all app nodes |
| Attachments 404 on multi-node | Local file storage was used; switch to `FILE_STORAGE=s3` |
