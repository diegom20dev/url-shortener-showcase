# URL Shortener

[![CI](https://github.com/diegom20dev/url-shortener-showcase/actions/workflows/ci.yml/badge.svg)](https://github.com/diegom20dev/url-shortener-showcase/actions/workflows/ci.yml)

A production-minded URL shortener built as a **backend / system-design showcase**. It converts long URLs into compact **Base62** codes, serves high-throughput **302 redirects** backed by a **Redis cache**, supports per-URL **expiry (TTL)**, and enforces **distributed, Redis-backed rate limiting** — all on a clean **hexagonal architecture**.

## Overview

The domain is intentionally simple — shorten a URL, redirect to it — but the engineering underneath is production-grade. The redirect is the hot path of any URL shortener, so it is optimized with a cache-aside strategy; the write path is protected with per-API-key rate limits; and both are fully decoupled from the framework and infrastructure via ports and adapters.

The goal is to demonstrate how a few well-chosen patterns — deterministic short-code generation, cache-aside reads, TTL-based expiry, and distributed rate limiting — combine into a system that stays fast and reliable under load.

## Architecture

Hexagonal architecture (ports and adapters). The domain core has no knowledge of NestJS, PostgreSQL, or Redis — it only exposes **ports** (interfaces) that the infrastructure layer implements.

```
┌────────────────────────── infrastructure (adapters) ──────────────────────────┐
│                                                                                │
HTTP ──► urls.controller ──► [application: use-cases] ──► [domain: Url + Base62] │
│  (guards: api-key,          CreateShortUrl                    ▲                 │
│   throttler)                ResolveShortUrl                   │                 │
│                                 │           │            (ports)                │
│                          (port) ▼           ▼ (port)                            │
│                     UrlRepository       UrlCache                                │
│                       (TypeORM)         (ioredis)                               │
│                          │                  │                                  │
│                          ▼                  ▼                                  │
│                      PostgreSQL           Redis                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Folder | Knows about | Does NOT know about |
|---|---|---|---|
| **Domain** | `src/urls/domain` | pure TS (entity, Base62, ports) | NestJS, DB, Redis |
| **Application** | `src/urls/application` | domain + ports | concrete DB, HTTP, cache |
| **Infrastructure** | `src/urls/infrastructure` | everything (implements ports) | — |

## Request Flows

### Create — `POST /api/urls`

```
x-api-key ──► [RequireApiKey] ──► [ApiKeyThrottler 10/min·100/day] ──► validate DTO
   ──► repo.nextId() ──► encodeBase62(id) = code ──► apply TTL (≤24h) ──► persist ──► 201
```

### Resolve — `GET /api/urls/:code`  (the hot path — cache-aside)

```
Redis GET url:<code>
   ├─ HIT  ─────────────────────────────────────────────► 302 redirect
   └─ MISS ─► DB lookup
                ├─ not found ─────────────────────────► 404
                ├─ expired ───────────────────────────► 410 GONE
                └─ found ─► cache SET (TTL = remaining) ► 302 redirect
```

## Engineering Patterns

### Collision-Free Short Codes — Base62 over a Monotonic ID

Codes are the **Base62 encoding of a monotonic database id**, not random strings:

```
ALPHABET = 0-9 a-z A-Z   (62 symbols)
code = encodeBase62(repo.nextId())
```

This makes generation **collision-free by construction** — no duplicate checks, no retry loops. Trade-off (worth knowing in an interview): sequential ids produce *enumerable* codes, which is acceptable for a public shortener but would need randomization/obfuscation if code enumeration were a concern.

### Cache-Aside Reads — Redis

Redirects hit Redis first and only fall back to PostgreSQL on a miss, then backfill the cache:

```
key   = url:<code>
SET url:<code> <longUrl> EX <ttlSeconds>   # ttl aligned to the URL's remaining life
```

Redis is configured as a real cache (`maxmemory` + `allkeys-lru` eviction), so it stays bounded under load, and cache entries can never outlive the record they mirror.

### Expiry & TTL

URLs can carry an optional TTL (capped at 24h). Expiry is enforced at resolve time, returning a distinct **`410 GONE`** for a code that existed but has lapsed — a correct, separate signal from `404 Not Found`.

### Distributed Rate Limiting — Redis-Backed Throttler

`@nestjs/throttler` is backed by **Redis storage** (not in-memory), so limits hold **across multiple instances**. Three independent tiers:

```
POST /urls   →  10 / minute   +  100 / day     (scoped per api-key)
GET  /:code  →  100 / second                   (scoped per IP)
```

The `x-api-key` header is an **opaque rate-limit scope**, documented in Swagger as *not* validated against any store — it identifies a caller for throttling, it is not authentication.

### Hexagonal Architecture

The domain (URL entity, Base62 service, ports) is pure and fully unit-tested; infrastructure (TypeORM repository, ioredis cache, HTTP controller + guards) implements the ports. Swapping PostgreSQL or Redis would not touch the domain.

## Tech Stack

| Technology | Role |
|---|---|
| **NestJS** | Framework — modular, DI-friendly, Swagger built-in |
| **TypeScript** | Type safety across all layers |
| **PostgreSQL** | Persistence — urls table with migrations |
| **TypeORM** | ORM — repository, migrations, data source |
| **Redis + ioredis** | Cache-aside store for redirects |
| **@nestjs/throttler + throttler-storage-redis** | Distributed, Redis-backed rate limiting |
| **class-validator / class-transformer** | DTO validation |
| **@nestjs/swagger** | Interactive OpenAPI docs |
| **Jest + Supertest** | Unit tests + e2e |
| **Docker Compose** | One-command Postgres + Redis for local dev |
| **GitHub Actions** | CI — lint, test, build on every push |

## API Endpoints

All routes are prefixed with `/api`. Interactive docs at `/docs` (Swagger UI).

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/urls` | Create a short URL (`x-api-key` required) — `201 / 400 / 429` |
| `GET` | `/api/urls/:shortUrl` | Resolve and **302** redirect to the original URL — `302 / 404 / 410 / 429` |

## Running Locally

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start dependencies (Postgres + Redis)
docker compose up -d

# 3. Install, run migrations, and start (hot reload)
npm install
npm run migration:run    # TypeORM migrations (src/database/migrations)
npm run start:dev

# API:     http://localhost:3000/api
# Swagger: http://localhost:3000/docs
```

```bash
# Tests
npm test          # unit tests
npm run test:e2e  # end-to-end (requires Postgres + Redis)
```

> `docker-compose.yml` provisions **Postgres + Redis only**; the API runs via npm.

## Project Structure

```
src/
├── urls/
│   ├── domain/                  # Pure domain — no framework dependencies
│   │   ├── entities/url.entity.ts
│   │   ├── services/base62-encoder.ts
│   │   └── ports/               # UrlRepositoryPort, UrlCachePort
│   ├── application/
│   │   ├── dtos/
│   │   └── use-cases/           # CreateShortUrl, ResolveShortUrl
│   └── infrastructure/
│       ├── http/                # Controller, guards, throttler config
│       ├── cache/               # ioredis adapter + Redis provider
│       └── persistence/typeorm/ # Repository + entity
├── database/                    # data-source + migrations
└── main.ts
```

## Roadmap / Next Steps

- **Click analytics** — async click counting via an event/queue, kept off the redirect hot path.
- **Live deployment** + public Swagger URL.
- Custom aliases and an opt-in randomized-code strategy.
