# URL Shortener — Design Document

**Date:** 2026-07-04
**Status:** Approved by user, ready for implementation planning

## 1. Problem Statement

Construir un servicio de acortamiento de URLs con dos endpoints (crear, resolver), respaldado por Postgres (persistencia) y Redis (caché de resolución + contadores de rate limit), sobre el scaffold NestJS existente (`url-shortener`).

## 2. Codebase Analysis

El proyecto es un scaffold NestJS recién generado por `@nestjs/cli` (sin `git init`, sin commits). No existen módulos, entidades, ni integraciones previas — es un lienzo en blanco:
- `src/app.module.ts`, `app.controller.ts`, `app.service.ts`, `main.ts` — defaults del CLI.
- `package.json` solo trae `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `rxjs`.
- No hay ORM, cliente Redis, ni librería de rate limiting instalados.

No hay patrones existentes que preservar; todas las decisiones de estructura son nuevas.

## 3. Requisitos funcionales (confirmados con el usuario, sin asunciones)

### Endpoints

**POST** (crear short URL)
- Body: `{ longUrl: string, ttl?: number }` (`ttl` en segundos, opcional).
- Respuesta: `{ shortUrl, longUrl, expiresAt, fullUrl }`, donde `fullUrl = BASE_URL (.env) + shortUrl`.
- Siempre inserta una fila nueva — nunca reusa un `shortUrl` existente aunque el `longUrl` ya exista (decisión explícita: cada URL puede tener su propio TTL y ser borrada individualmente en el futuro).

**GET /:shortUrl** (resolver)
- Redis hit → `302` redirect a `longUrl`.
- Redis miss → busca en Postgres:
  - No existe → `404`.
  - Existe pero `expiresAt` ya pasó → `410 Gone`.
  - Existe y vigente → cachea en Redis (ver TTL de caché abajo) → `302` redirect.

### Tabla única `urls` (Postgres)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigserial (PK) | autoincremental, usado para derivar `shortUrl` |
| `shortUrl` | varchar, **indexado** | id convertido a base62 |
| `longUrl` | text | URL original, sin transformar |
| `ttl` | int, nullable | input crudo del usuario en segundos, o `null` si no se envió |
| `createdAt` | timestamp | fecha de creación |
| `expiresAt` | timestamp, nullable | ver cálculo abajo |

### Reglas de negocio

- **Base62**: alfabeto `0-9` (valores 0–9), `a-z` (valores 10–35), `A-Z` (valores 36–61). `shortUrl = base62(id)`.
- **Generación de ID**: se obtiene el siguiente id de forma **atómica** mediante la secuencia (`SEQUENCE`) de Postgres que respalda la columna `id` (auto-increment), usando `nextval(...)` antes de insertar la fila. Esto evita la race condition bajo POSTs concurrentes sin necesitar locks manuales.
- **TTL vs expiresAt**:
  - Si el POST trae `ttl`: `expiresAt = now + min(ttl, 86400)` segundos (capado a 24h aunque el usuario pida más). `ttl` se guarda tal cual vino (sin capar).
  - Si el POST NO trae `ttl`: `ttl = null`, `expiresAt = null` (la fila nunca expira en DB).
- **TTL de caché en Redis** (al cachear tras un miss resuelto desde DB): `min(86400, expiresAt - now)` segundos si `expiresAt` no es null; si `expiresAt` es null, usar `86400` fijo.
- **Expiración en GET**: si `expiresAt` no es null y ya pasó respecto a `now`, responder `410 Gone` (no `404`).

### Rate limiting

- **POST**: 10 requests/minuto **y** 100 requests/día (ambas ventanas activas simultáneamente). Identificado por un header opaco tipo `x-api-key` — string arbitrario enviado por el cliente, **sin validación** contra ninguna tabla/sistema de auth (no existe tabla de usuarios ni de API keys; fuera de alcance). Solo se usa como key de conteo.
- **GET**: 100 requests/segundo, por IP.

### Infraestructura

- `docker-compose.yml` con dos servicios:
  - **Redis**: `maxmemory 32gb`.
  - **Postgres**.

## 4. Arquitectura elegida

**Patrón: Hexagonal (Ports & Adapters) + Domain-Driven Design**, dentro de un único `UrlsModule` de NestJS (una sola tabla y dos endpoints no justifican múltiples módulos de dominio).

```
src/
  urls/
    domain/
      value-objects/
        short-url.vo.ts        # encapsula el valor base62 y su validación
      entities/
        url.entity.ts          # entidad de dominio (Url aggregate: id, shortUrl, longUrl, ttl, createdAt, expiresAt)
      ports/
        url-repository.port.ts # interfaz: save(), findByShortUrl(), nextId() (vía secuencia atómica de Postgres)
        url-cache.port.ts      # interfaz: get(), set() con TTL
      services/
        base62-encoder.ts      # función pura de codificación
    application/
      use-cases/
        create-short-url.use-case.ts
        resolve-short-url.use-case.ts
      dtos/
        create-short-url.dto.ts
        create-short-url-response.dto.ts
    infrastructure/
      persistence/
        typeorm/
          url.typeorm-entity.ts
          url-typeorm.repository.ts   # implementa url-repository.port
          migrations/                 # generadas por TypeORM CLI
      cache/
        ioredis-url-cache.adapter.ts  # implementa url-cache.port
      http/
        urls.controller.ts            # adapter primario (driving)
        guards/
          post-rate-limit.guard.ts    # @nestjs/throttler config (api-key, 2 ventanas)
          get-rate-limit.guard.ts     # @nestjs/throttler config (IP, 1seg/100)
    urls.module.ts
```

### Justificación de las decisiones técnicas (elegidas por el usuario)

| Decisión | Elección | Nota |
|---|---|---|
| ORM | **TypeORM** | Repository pattern se mapea naturalmente al `url-repository.port` del dominio; migraciones vía TypeORM CLI |
| Cliente Redis | **ioredis** | Cliente maduro para `SET`/`GET` con TTL y contadores de rate limit |
| Rate limiting | **@nestjs/throttler** | Guards declarativos; se configuran throttlers nombrados para las 3 ventanas (1min/10 y 1día/100 por api-key en POST, 1seg/100 por IP en GET) |
| Migraciones | **TypeORM migrations** | Vía CLI, versionadas en el repo |
| Estructura | **Hexagonal / DDD** | Dominio (entidad + puertos) aislado de infraestructura (TypeORM, ioredis, HTTP); casos de uso en capa de aplicación orquestan sin depender de detalles de framework |

## 5. Riesgos y decisiones diferidas explícitamente por el usuario

- **Sin sistema de autenticación/API keys real**: el rate limit de POST usa un header arbitrario sin validar. Cualquier cliente puede rotar el header para evadir el límite; aceptado explícitamente como fuera de alcance por ahora.
- Si falta el header `x-api-key` en el POST, se responde `400 Bad Request` antes de contar cuota o tocar el caso de uso.

## 6. Siguientes pasos

Invocar el skill `writing-plans` con este documento para generar el plan de implementación (tareas, orden de ejecución, milestones).
