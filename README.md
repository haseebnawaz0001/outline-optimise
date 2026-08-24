<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logos/outline-logo-dark.png" height="29">
    <source media="(prefers-color-scheme: light)" srcset="./public/logos/outline-logo-light.png" height="29">
    <img src="./public/logos/outline-logo-light.png" height="29" alt="Outline" />
  </picture>
</p>
<p align="center">
  <i>A fast, collaborative knowledge base – tuned for lean self-hosting on your own VPS.</i>
</p>

---

**Outline Optimized** is a performance-focused fork of [Outline](https://github.com/outline/outline) intended for self-hosters running on small to medium VPS instances. It keeps every real user feature but cuts idle CPU, RAM, Redis/Postgres load and bundle size, and ships with production-ready Docker deployments for one or many servers.

## What's different from upstream Outline

Highlights of this fork (full details and evidence in [OPTIMIZATION_REPORT.md](OPTIMIZATION_REPORT.md)):

- **Server runtime**
  - Removed always-on telemetry: phone-home update checks, StatsD pipeline, request tracing middleware, dd-trace shim
  - Trace wrappers are pass-through when APM is off; Sentry loads lazily only when configured
  - Queue coalescing/batching: backlinks rebuild debounced per save session, notification fan-out batched, no-op search-index jobs skipped under the default Postgres provider
  - Deterministic cron job IDs prevent duplicate jobs after restarts; retention cleanups run daily instead of hourly
- **Process & memory management**
  - `WEB_CONCURRENCY` capped by default instead of one process per core
  - Automatic per-process V8 heap limits derived from the container memory cap (no more OOM kills from heap sizing against host RAM)
  - glibc malloc arena limiting baked into the Docker image (`MALLOC_ARENA_MAX=2`)
  - Redis health-check cadence reduced; fewer dedicated Bull connections
- **Frontend**
  - PWA precache narrowed to the app shell; unbounded attachment caching removed
  - Emoji dataset, katex/math and mermaid extras lazy-loaded
  - framer-motion trimmed to `domAnimation`, command bar and client plugins deferred

## Deployment

Two supported topologies, both fronted optionally by a **Cloudflare Tunnel** so your servers keep zero open inbound ports. Full guides in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Single VPS (all-in-one)

Postgres, Redis, Outline (web + collaboration + websockets + worker + cron) and an optional tunnel on one host:

```shell
cp deploy/single/.env.example deploy/single/.env   # fill in URL, secrets, auth
deploy/build.sh                                    # build the image
cd deploy/single && docker compose up -d           # add --profile tunnel once CF_TUNNEL_TOKEN is set
curl http://localhost:3000/_health                 # -> OK
```

### Multiple VPS (distributed)

Split roles across machines over a private WireGuard/Tailscale network:

| Node | Runs | Exposed |
|---|---|---|
| `deploy/multi/core` | Postgres + Redis | private VPN interface only |
| `deploy/multi/app` | web + websockets + collaboration (+ tunnel) | via Cloudflare Tunnel |
| `deploy/multi/worker` | worker + cron | nothing |

Attachments must use S3-compatible storage (Cloudflare R2 pairs well) when nodes are distributed. See the [multi-VPS guide](docs/DEPLOYMENT.md#multiple-vps-distributed).

### Memory management

Every container gets a hard kernel-enforced memory cap via `mem_limit` in the compose files, and Node sizes its V8 heap automatically from that cap (~80% budget across processes, 256 MB floor each) — set one number, get predictable memory. Redis is capped with `maxmemory` using `volatile-lru` so caches can shrink under pressure while queue keys are never evicted. Sizing tables for 1–4 GB VPS instances are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#memory-management).

## Development

This is still the Outline codebase; upstream development docs apply.

### Quick start

```shell
make up          # start postgres + redis, install deps, dev server
```

### Tests

```shell
make test        # recreate test database and run everything
yarn test server/path/to/file.test.ts   # single file
yarn test:server # backend only
yarn test:app    # frontend only
```

### Lint, format, types

```shell
yarn lint        # oxlint
yarn format      # oxfmt
yarn tsc         # typecheck
```

### Migrations

```shell
yarn db:create-migration --name my-migration
yarn db:migrate
yarn db:rollback
```

### Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SERVICES.md](docs/SERVICES.md) for how the backend services fit together.

## Debugging

In development Outline logs to the console prefixed by category; in production it emits JSON logs. Enable HTTP logging with `DEBUG=http`, everything with `DEBUG=*`, or raise verbosity with `LOG_LEVEL=debug`.

## License

Outline is [BSL 1.1 licensed](LICENSE). This fork carries the same license; all credit for the original work belongs to the Outline team and contributors.
