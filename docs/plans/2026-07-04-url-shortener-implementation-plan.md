# URL Shortener Implementation Plan

> For Claude / Copilot: Use rappi-dev-tools:executing-plans to implement this plan.

Goal: Servicio NestJS con dos endpoints (crear / resolver URLs cortas) sobre Postgres + Redis, con rate limiting por api-key (POST) e IP (GET), siguiendo arquitectura hexagonal/DDD.

Architecture: Capa `domain` (entidad `Url`, value object `ShortUrl`, encoder base62, puertos `UrlRepositoryPort`/`UrlCachePort`) sin dependencias de framework; capa `application` con casos de uso (`CreateShortUrlUseCase`, `ResolveShortUrlUseCase`) que orquestan contra los puertos; capa `infrastructure` con adapters concretos (TypeORM para Postgres, ioredis para caché, controllers/guards de NestJS para HTTP). Todo vive bajo un único `UrlsModule` — una sola tabla y dos endpoints no justifican múltiples módulos de dominio.

Tech Stack: NestJS 10, TypeORM + pg (Postgres), ioredis (Redis), @nestjs/throttler + @nest-lab/throttler-storage-redis (rate limiting distribuido), class-validator/class-transformer (DTOs), Jest (unit + e2e).

## Decisiones de negocio confirmadas (no reabrir, ver `docs/plans/2026-07-04-url-shortener-design.md`)

- `shortUrl` = `id` de la fila codificado en base62 (`0-9`→0-9, `a-z`→10-35, `A-Z`→36-61).
- Generación de ID: obtener el siguiente id de forma **atómica** vía `nextval()` sobre la secuencia de Postgres que respalda la columna `id` (auto-increment), antes de insertar la fila. Evita la race condition sin locks manuales.
- `ttl` (columna): input crudo del usuario o `null`.
- `expiresAt`: si vino `ttl` → `now + min(ttl, 86400)` segundos. Si no vino → `null` (nunca expira en DB).
- TTL de caché en Redis: `min(86400, expiresAt - now)` si `expiresAt` no es null; si es null, `86400` fijo.
- GET: Redis hit → 302. Redis miss + no existe en DB → 404. Redis miss + existe pero `expiresAt` pasado → **410 Gone**. Redis miss + existe y vigente → cachear y 302.
- POST siempre inserta una fila nueva (nunca reusa `shortUrl` por `longUrl` duplicado).
- Rate limit POST: 10/min **y** 100/día, key = header `x-api-key` (sin validar contra ningún store). **Si falta el header → 400 Bad Request**, no se cuenta ni se procesa el POST.
- Rate limit GET: 100/seg por IP.
- `docker-compose.yml`: Redis (`maxmemory 32gb`) + Postgres.

---

## Task 1: Instalar dependencias

**Files:**
- `/Users/diego/Desktop/side/url-shortener/package.json` (modify)

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm install @nestjs/config @nestjs/typeorm typeorm pg ioredis @nestjs/throttler @nest-lab/throttler-storage-redis class-validator class-transformer
```

**Expected Output:**
```
added N packages, and audited M packages in Xs
```
`package.json` `dependencies` debe incluir: `@nestjs/config`, `@nestjs/typeorm`, `typeorm`, `pg`, `ioredis`, `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`, `class-validator`, `class-transformer`.

---

## Task 2: Variables de entorno

**Files:**
- `/Users/diego/Desktop/side/url-shortener/.env.example` (create)
- `/Users/diego/Desktop/side/url-shortener/.env` (create, gitignored)

**Exact Code (`.env.example`):**
```
PORT=3000
BASE_URL=http://localhost:3000/

DB_HOST=localhost
DB_PORT=5432
DB_USER=urlshortener
DB_PASSWORD=urlshortener
DB_NAME=urlshortener

REDIS_HOST=localhost
REDIS_PORT=6379
```

**Exact Code (`.env`):** copiar `.env.example` tal cual (valores locales de desarrollo).

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && cp .env.example .env && grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore
```

**Expected Output:** `.env` existe localmente y `.gitignore` contiene la línea `.env`.

---

## Task 3: docker-compose con Redis y Postgres

**Files:**
- `/Users/diego/Desktop/side/url-shortener/docker-compose.yml` (create)

**Exact Code:**
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-urlshortener}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-urlshortener}
      POSTGRES_DB: ${DB_NAME:-urlshortener}
    ports:
      - '${DB_PORT:-5432}:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --maxmemory 32gb --maxmemory-policy allkeys-lru
    ports:
      - '${REDIS_PORT:-6379}:6379'
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && docker compose config
```

**Expected Output:** Imprime el YAML resuelto sin errores (valida sintaxis y variables).

---

## Task 4: ConfigModule global

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/app.module.ts` (modify)

**Exact Code:**
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** `webpack compiled successfully` (o salida equivalente de `nest build` sin errores de TypeScript).

---

## Task 5: Test del encoder base62

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/domain/services/base62-encoder.spec.ts` (test)

**Exact Code:**
```typescript
import { encodeBase62 } from './base62-encoder';

describe('encodeBase62', () => {
  it('encodes single-digit values using the 0-9 range', () => {
    expect(encodeBase62(0)).toBe('0');
    expect(encodeBase62(9)).toBe('9');
  });

  it('encodes values in the a-z range (10-35)', () => {
    expect(encodeBase62(10)).toBe('a');
    expect(encodeBase62(35)).toBe('z');
  });

  it('encodes values in the A-Z range (36-61)', () => {
    expect(encodeBase62(36)).toBe('A');
    expect(encodeBase62(61)).toBe('Z');
  });

  it('encodes multi-digit values', () => {
    expect(encodeBase62(62)).toBe('10');
    expect(encodeBase62(63)).toBe('11');
  });

  it('throws for negative numbers', () => {
    expect(() => encodeBase62(-1)).toThrow();
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/domain/services/base62-encoder.spec.ts
```

**Expected Output:**
```
FAIL src/urls/domain/services/base62-encoder.spec.ts
  Cannot find module './base62-encoder' from ...
```
(Falla esperada — el módulo aún no existe.)

---

## Task 6: Implementar el encoder base62

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/domain/services/base62-encoder.ts` (create)

**Exact Code:**
```typescript
const ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = ALPHABET.length;

export function encodeBase62(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`encodeBase62: value must be a non-negative integer, got ${value}`);
  }

  if (value === 0) {
    return ALPHABET[0];
  }

  let result = '';
  let remaining = value;
  while (remaining > 0) {
    result = ALPHABET[remaining % BASE] + result;
    remaining = Math.floor(remaining / BASE);
  }
  return result;
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/domain/services/base62-encoder.spec.ts
```

**Expected Output:**
```
PASS src/urls/domain/services/base62-encoder.spec.ts
  encodeBase62
    ✓ encodes single-digit values using the 0-9 range
    ✓ encodes values in the a-z range (10-35)
    ✓ encodes values in the A-Z range (36-61)
    ✓ encodes multi-digit values
    ✓ throws for negative numbers

Tests: 5 passed, 5 total
```

---

## Task 7: Entidad de dominio `Url`

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/domain/entities/url.entity.ts` (create)

**Exact Code:**
```typescript
export interface UrlProps {
  id: number;
  shortUrl: string;
  longUrl: string;
  ttl: number | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export class Url {
  constructor(private readonly props: UrlProps) {}

  get id(): number {
    return this.props.id;
  }

  get shortUrl(): string {
    return this.props.shortUrl;
  }

  get longUrl(): string {
    return this.props.longUrl;
  }

  get ttl(): number | null {
    return this.props.ttl;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt !== null && this.props.expiresAt.getTime() < now.getTime();
  }
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 8: Puertos de dominio

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/domain/ports/url-repository.port.ts` (create)
- `/Users/diego/Desktop/side/url-shortener/src/urls/domain/ports/url-cache.port.ts` (create)

**Exact Code (`url-repository.port.ts`):**
```typescript
import { Url } from '../entities/url.entity';

export const URL_REPOSITORY = Symbol('URL_REPOSITORY');

export interface UrlRepositoryPort {
  /** Obtiene el siguiente id de forma atómica vía la secuencia de Postgres (nextval). */
  nextId(): Promise<number>;

  save(url: { id: number; shortUrl: string; longUrl: string; ttl: number | null; createdAt: Date; expiresAt: Date | null }): Promise<Url>;

  findByShortUrl(shortUrl: string): Promise<Url | null>;
}
```

**Exact Code (`url-cache.port.ts`):**
```typescript
export const URL_CACHE = Symbol('URL_CACHE');

export interface UrlCachePort {
  get(shortUrl: string): Promise<string | null>;

  set(shortUrl: string, longUrl: string, ttlSeconds: number): Promise<void>;
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 9: Entidad TypeORM y migración inicial

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/persistence/typeorm/url.typeorm-entity.ts` (create)
- `/Users/diego/Desktop/side/url-shortener/src/database/data-source.ts` (create)

**Exact Code (`url.typeorm-entity.ts`):**
```typescript
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'urls' })
export class UrlTypeOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'short_url', type: 'varchar' })
  shortUrl: string;

  @Column({ name: 'long_url', type: 'text' })
  longUrl: string;

  @Column({ name: 'ttl', type: 'int', nullable: true })
  ttl: number | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
}
```

**Exact Code (`data-source.ts`):**
```typescript
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { UrlTypeOrmEntity } from '../urls/infrastructure/persistence/typeorm/url.typeorm-entity';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [UrlTypeOrmEntity],
  migrations: ['src/database/migrations/*.ts'],
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm install -D dotenv ts-node && npx typeorm-ts-node-commonjs migration:generate src/database/migrations/CreateUrlsTable -d src/database/data-source.ts
```

**Expected Output:**
```
Migration .../src/database/migrations/<timestamp>-CreateUrlsTable.ts has been generated successfully.
```
La migración generada debe contener `CREATE TABLE "urls" (...)` con índice sobre `short_url`.

---

## Task 10: Adapter TypeORM del repositorio

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/persistence/typeorm/url-typeorm.repository.ts` (create)
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/persistence/typeorm/url-typeorm.repository.spec.ts` (test)

**Exact Code (repository):**
```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Url } from '../../../domain/entities/url.entity';
import { UrlRepositoryPort } from '../../../domain/ports/url-repository.port';
import { UrlTypeOrmEntity } from './url.typeorm-entity';

@Injectable()
export class UrlTypeOrmRepository implements UrlRepositoryPort {
  constructor(
    @InjectRepository(UrlTypeOrmEntity)
    private readonly repository: Repository<UrlTypeOrmEntity>,
  ) {}

  async nextId(): Promise<number> {
    // pg_get_serial_sequence resuelve el nombre real de la secuencia que respalda
    // la columna id, sin asumir una convención de nombre fija.
    const result = await this.repository.query(
      `SELECT nextval(pg_get_serial_sequence('urls', 'id')) AS id`,
    );
    return Number(result[0].id);
  }

  async save(url: {
    id: number;
    shortUrl: string;
    longUrl: string;
    ttl: number | null;
    createdAt: Date;
    expiresAt: Date | null;
  }): Promise<Url> {
    const entity = this.repository.create({
      id: url.id,
      shortUrl: url.shortUrl,
      longUrl: url.longUrl,
      ttl: url.ttl,
      createdAt: url.createdAt,
      expiresAt: url.expiresAt,
    });
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findByShortUrl(shortUrl: string): Promise<Url | null> {
    const found = await this.repository.findOne({ where: { shortUrl } });
    return found ? this.toDomain(found) : null;
  }

  private toDomain(entity: UrlTypeOrmEntity): Url {
    return new Url({
      id: Number(entity.id),
      shortUrl: entity.shortUrl,
      longUrl: entity.longUrl,
      ttl: entity.ttl,
      createdAt: entity.createdAt,
      expiresAt: entity.expiresAt,
    });
  }
}
```

**Exact Code (spec — mockea el `Repository` de TypeORM):**
```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UrlTypeOrmRepository } from './url-typeorm.repository';
import { UrlTypeOrmEntity } from './url.typeorm-entity';

describe('UrlTypeOrmRepository', () => {
  let repository: UrlTypeOrmRepository;
  const mockRepo = {
    query: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UrlTypeOrmRepository,
        { provide: getRepositoryToken(UrlTypeOrmEntity), useValue: mockRepo },
      ],
    }).compile();
    repository = module.get(UrlTypeOrmRepository);
  });

  it('gets the next id atomically from the urls_id sequence', async () => {
    mockRepo.query.mockResolvedValue([{ id: '11' }]);
    await expect(repository.nextId()).resolves.toBe(11);
    expect(mockRepo.query).toHaveBeenCalledWith(
      `SELECT nextval(pg_get_serial_sequence('urls', 'id')) AS id`,
    );
  });

  it('returns null from findByShortUrl when nothing matches', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(repository.findByShortUrl('zz')).resolves.toBeNull();
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/infrastructure/persistence/typeorm/url-typeorm.repository.spec.ts
```

**Expected Output:**
```
PASS src/urls/infrastructure/persistence/typeorm/url-typeorm.repository.spec.ts
Tests: 2 passed, 2 total
```

---

## Task 11: Adapter ioredis de caché

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/cache/ioredis-url-cache.adapter.ts` (create)
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/cache/ioredis-url-cache.adapter.spec.ts` (test)
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/cache/redis.provider.ts` (create)

**Exact Code (`redis.provider.ts`):**
```typescript
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService) =>
    new Redis({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
    }),
  inject: [ConfigService],
};
```

**Exact Code (`ioredis-url-cache.adapter.ts`):**
```typescript
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { UrlCachePort } from '../../domain/ports/url-cache.port';
import { REDIS_CLIENT } from './redis.provider';

@Injectable()
export class IoredisUrlCacheAdapter implements UrlCachePort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get(shortUrl: string): Promise<string | null> {
    return this.redis.get(this.key(shortUrl));
  }

  async set(shortUrl: string, longUrl: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(shortUrl), longUrl, 'EX', ttlSeconds);
  }

  private key(shortUrl: string): string {
    return `url:${shortUrl}`;
  }
}
```

**Exact Code (spec):**
```typescript
import { IoredisUrlCacheAdapter } from './ioredis-url-cache.adapter';

describe('IoredisUrlCacheAdapter', () => {
  const redisMock = { get: jest.fn(), set: jest.fn() } as any;
  const adapter = new IoredisUrlCacheAdapter(redisMock);

  beforeEach(() => jest.clearAllMocks());

  it('gets a cached longUrl by shortUrl key', async () => {
    redisMock.get.mockResolvedValue('https://example.com');
    await expect(adapter.get('abc123')).resolves.toBe('https://example.com');
    expect(redisMock.get).toHaveBeenCalledWith('url:abc123');
  });

  it('sets a longUrl with an explicit TTL in seconds', async () => {
    await adapter.set('abc123', 'https://example.com', 3600);
    expect(redisMock.set).toHaveBeenCalledWith('url:abc123', 'https://example.com', 'EX', 3600);
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/infrastructure/cache/ioredis-url-cache.adapter.spec.ts
```

**Expected Output:**
```
PASS src/urls/infrastructure/cache/ioredis-url-cache.adapter.spec.ts
Tests: 2 passed, 2 total
```

---

## Task 12: Caso de uso `CreateShortUrlUseCase` (test primero)

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/application/use-cases/create-short-url.use-case.spec.ts` (test)

**Exact Code:**
```typescript
import { CreateShortUrlUseCase } from './create-short-url.use-case';
import { URL_REPOSITORY } from '../../domain/ports/url-repository.port';
import { Test } from '@nestjs/testing';

describe('CreateShortUrlUseCase', () => {
  const repo = { nextId: jest.fn(), save: jest.fn() };
  let useCase: CreateShortUrlUseCase;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CreateShortUrlUseCase,
        { provide: URL_REPOSITORY, useValue: repo },
      ],
    }).compile();
    useCase = module.get(CreateShortUrlUseCase);
  });

  it('caps expiresAt at 24h when the requested ttl exceeds it', async () => {
    repo.nextId.mockResolvedValue(10); // base62('10') -> 'a'
    repo.save.mockImplementation(async (url) => ({ ...url }));

    const now = new Date('2026-07-04T00:00:00.000Z');
    const result = await useCase.execute(
      { longUrl: 'https://example.com', ttl: 999999 },
      now,
    );

    expect(result.shortUrl).toBe('a');
    expect(result.expiresAt).toEqual(new Date('2026-07-05T00:00:00.000Z'));
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10, ttl: 999999, expiresAt: new Date('2026-07-05T00:00:00.000Z') }),
    );
  });

  it('sets expiresAt to null when no ttl is provided', async () => {
    repo.nextId.mockResolvedValue(0); // base62(0) -> '0'
    repo.save.mockImplementation(async (url) => ({ ...url }));

    const now = new Date('2026-07-04T00:00:00.000Z');
    const result = await useCase.execute({ longUrl: 'https://example.com' }, now);

    expect(result.shortUrl).toBe('0');
    expect(result.expiresAt).toBeNull();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 0, ttl: null, expiresAt: null }),
    );
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/application/use-cases/create-short-url.use-case.spec.ts
```

**Expected Output:** Falla (`Cannot find module './create-short-url.use-case'`) — esperado antes de implementar.

---

## Task 13: Implementar `CreateShortUrlUseCase`

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/application/use-cases/create-short-url.use-case.ts` (create)

**Exact Code:**
```typescript
import { Inject, Injectable } from '@nestjs/common';
import { Url } from '../../domain/entities/url.entity';
import { encodeBase62 } from '../../domain/services/base62-encoder';
import {
  URL_REPOSITORY,
  UrlRepositoryPort,
} from '../../domain/ports/url-repository.port';

const MAX_TTL_SECONDS = 24 * 60 * 60;

export interface CreateShortUrlInput {
  longUrl: string;
  ttl?: number;
}

@Injectable()
export class CreateShortUrlUseCase {
  constructor(
    @Inject(URL_REPOSITORY) private readonly urlRepository: UrlRepositoryPort,
  ) {}

  async execute(input: CreateShortUrlInput, now: Date): Promise<Url> {
    const id = await this.urlRepository.nextId();
    const shortUrl = encodeBase62(id);

    const expiresAt =
      input.ttl === undefined
        ? null
        : new Date(now.getTime() + Math.min(input.ttl, MAX_TTL_SECONDS) * 1000);

    return this.urlRepository.save({
      id,
      shortUrl,
      longUrl: input.longUrl,
      ttl: input.ttl ?? null,
      createdAt: now,
      expiresAt,
    });
  }
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/application/use-cases/create-short-url.use-case.spec.ts
```

**Expected Output:**
```
PASS src/urls/application/use-cases/create-short-url.use-case.spec.ts
Tests: 2 passed, 2 total
```

---

## Task 14: Caso de uso `ResolveShortUrlUseCase` (test primero)

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/application/use-cases/resolve-short-url.use-case.spec.ts` (test)

**Exact Code:**
```typescript
import { Test } from '@nestjs/testing';
import { ResolveShortUrlUseCase, ResolveResult } from './resolve-short-url.use-case';
import { URL_REPOSITORY } from '../../domain/ports/url-repository.port';
import { URL_CACHE } from '../../domain/ports/url-cache.port';
import { Url } from '../../domain/entities/url.entity';

describe('ResolveShortUrlUseCase', () => {
  const repo = { findByShortUrl: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn() };
  let useCase: ResolveShortUrlUseCase;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ResolveShortUrlUseCase,
        { provide: URL_REPOSITORY, useValue: repo },
        { provide: URL_CACHE, useValue: cache },
      ],
    }).compile();
    useCase = module.get(ResolveShortUrlUseCase);
  });

  it('returns HIT from cache without touching the repository', async () => {
    cache.get.mockResolvedValue('https://cached.example.com');
    const result = await useCase.execute('abc', new Date());
    expect(result).toEqual<ResolveResult>({ status: 'FOUND', longUrl: 'https://cached.example.com' });
    expect(repo.findByShortUrl).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when missing from cache and DB', async () => {
    cache.get.mockResolvedValue(null);
    repo.findByShortUrl.mockResolvedValue(null);
    const result = await useCase.execute('missing', new Date());
    expect(result).toEqual<ResolveResult>({ status: 'NOT_FOUND' });
  });

  it('returns GONE when found in DB but already expired', async () => {
    cache.get.mockResolvedValue(null);
    const past = new Date('2020-01-01T00:00:00.000Z');
    repo.findByShortUrl.mockResolvedValue(
      new Url({ id: 1, shortUrl: 'abc', longUrl: 'https://example.com', ttl: 10, createdAt: past, expiresAt: past }),
    );
    const result = await useCase.execute('abc', new Date('2026-07-04T00:00:00.000Z'));
    expect(result).toEqual<ResolveResult>({ status: 'GONE' });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('caches with min(24h, expiresAt-now) and returns FOUND when valid with expiresAt', async () => {
    cache.get.mockResolvedValue(null);
    const now = new Date('2026-07-04T00:00:00.000Z');
    const expiresAt = new Date('2026-07-04T00:10:00.000Z'); // 600s away
    repo.findByShortUrl.mockResolvedValue(
      new Url({ id: 1, shortUrl: 'abc', longUrl: 'https://example.com', ttl: 600, createdAt: now, expiresAt }),
    );
    const result = await useCase.execute('abc', now);
    expect(result).toEqual<ResolveResult>({ status: 'FOUND', longUrl: 'https://example.com' });
    expect(cache.set).toHaveBeenCalledWith('abc', 'https://example.com', 600);
  });

  it('caches with a flat 24h TTL when expiresAt is null', async () => {
    cache.get.mockResolvedValue(null);
    const now = new Date('2026-07-04T00:00:00.000Z');
    repo.findByShortUrl.mockResolvedValue(
      new Url({ id: 1, shortUrl: 'abc', longUrl: 'https://example.com', ttl: null, createdAt: now, expiresAt: null }),
    );
    await useCase.execute('abc', now);
    expect(cache.set).toHaveBeenCalledWith('abc', 'https://example.com', 86400);
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/application/use-cases/resolve-short-url.use-case.spec.ts
```

**Expected Output:** Falla (módulo no existe) — esperado antes de implementar.

---

## Task 15: Implementar `ResolveShortUrlUseCase`

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/application/use-cases/resolve-short-url.use-case.ts` (create)

**Exact Code:**
```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  URL_REPOSITORY,
  UrlRepositoryPort,
} from '../../domain/ports/url-repository.port';
import { URL_CACHE, UrlCachePort } from '../../domain/ports/url-cache.port';

const MAX_CACHE_TTL_SECONDS = 24 * 60 * 60;

export type ResolveResult =
  | { status: 'FOUND'; longUrl: string }
  | { status: 'NOT_FOUND' }
  | { status: 'GONE' };

@Injectable()
export class ResolveShortUrlUseCase {
  constructor(
    @Inject(URL_REPOSITORY) private readonly urlRepository: UrlRepositoryPort,
    @Inject(URL_CACHE) private readonly urlCache: UrlCachePort,
  ) {}

  async execute(shortUrl: string, now: Date): Promise<ResolveResult> {
    const cached = await this.urlCache.get(shortUrl);
    if (cached) {
      return { status: 'FOUND', longUrl: cached };
    }

    const url = await this.urlRepository.findByShortUrl(shortUrl);
    if (!url) {
      return { status: 'NOT_FOUND' };
    }

    if (url.isExpired(now)) {
      return { status: 'GONE' };
    }

    const ttlSeconds = url.expiresAt
      ? Math.min(MAX_CACHE_TTL_SECONDS, Math.floor((url.expiresAt.getTime() - now.getTime()) / 1000))
      : MAX_CACHE_TTL_SECONDS;
    await this.urlCache.set(shortUrl, url.longUrl, ttlSeconds);

    return { status: 'FOUND', longUrl: url.longUrl };
  }
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/application/use-cases/resolve-short-url.use-case.spec.ts
```

**Expected Output:**
```
PASS src/urls/application/use-cases/resolve-short-url.use-case.spec.ts
Tests: 5 passed, 5 total
```

---

## Task 16: DTOs de HTTP

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/application/dtos/create-short-url.dto.ts` (create)
- `/Users/diego/Desktop/side/url-shortener/src/urls/application/dtos/create-short-url-response.dto.ts` (create)

**Exact Code (`create-short-url.dto.ts`):**
```typescript
import { IsInt, IsOptional, IsUrl, Min } from 'class-validator';

export class CreateShortUrlDto {
  @IsUrl()
  longUrl: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttl?: number;
}
```

**Exact Code (`create-short-url-response.dto.ts`):**
```typescript
export class CreateShortUrlResponseDto {
  shortUrl: string;
  longUrl: string;
  expiresAt: Date | null;
  fullUrl: string;
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 17: Guard de header requerido (`x-api-key`) para POST

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/http/guards/require-api-key.guard.ts` (create)
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/http/guards/require-api-key.guard.spec.ts` (test)

**Exact Code (spec):**
```typescript
import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { RequireApiKeyGuard } from './require-api-key.guard';

function contextWithHeader(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('RequireApiKeyGuard', () => {
  const guard = new RequireApiKeyGuard();

  it('allows the request when x-api-key is present', () => {
    expect(guard.canActivate(contextWithHeader({ 'x-api-key': 'abc' }))).toBe(true);
  });

  it('throws BadRequestException when x-api-key is missing', () => {
    expect(() => guard.canActivate(contextWithHeader({}))).toThrow(BadRequestException);
  });
});
```

**Exact Code (guard):**
```typescript
import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class RequireApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'];
    if (!apiKey) {
      throw new BadRequestException('Missing required header: x-api-key');
    }
    return true;
  }
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npx jest src/urls/infrastructure/http/guards/require-api-key.guard.spec.ts
```

**Expected Output:**
```
PASS src/urls/infrastructure/http/guards/require-api-key.guard.spec.ts
Tests: 2 passed, 2 total
```

---

## Task 18: Configurar `ThrottlerModule` con storage Redis y ventanas nombradas

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/http/throttler.config.ts` (create)

**Exact Code:**
```typescript
import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

export const THROTTLER_POST_MINUTE = 'post-minute';
export const THROTTLER_POST_DAY = 'post-day';
export const THROTTLER_GET_IP = 'get-ip';

export function throttlerConfigFactory(config: ConfigService): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: THROTTLER_POST_MINUTE, ttl: 60_000, limit: 10 },
      { name: THROTTLER_POST_DAY, ttl: 86_400_000, limit: 100 },
      { name: THROTTLER_GET_IP, ttl: 1_000, limit: 100 },
    ],
    storage: new ThrottlerStorageRedisService({
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
    }),
  };
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 19: Guard de rate limit para POST (por `x-api-key`)

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/http/guards/api-key-throttler.guard.ts` (create)

**Exact Code:**
```typescript
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.headers['x-api-key'];
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest(requestProps);
  }
}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores. (`handleRequest` se deja explícito por si se necesita lógica extra luego; hoy delega 1:1 al comportamiento base.)

---

## Task 20: Controller `UrlsController`

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/infrastructure/http/urls.controller.ts` (create)

**Exact Code:**
```typescript
import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CreateShortUrlUseCase } from '../../application/use-cases/create-short-url.use-case';
import { ResolveShortUrlUseCase } from '../../application/use-cases/resolve-short-url.use-case';
import { CreateShortUrlDto } from '../../application/dtos/create-short-url.dto';
import { CreateShortUrlResponseDto } from '../../application/dtos/create-short-url-response.dto';
import { RequireApiKeyGuard } from './guards/require-api-key.guard';
import { ApiKeyThrottlerGuard } from './guards/api-key-throttler.guard';
import {
  THROTTLER_GET_IP,
  THROTTLER_POST_DAY,
  THROTTLER_POST_MINUTE,
} from './throttler.config';

@Controller()
export class UrlsController {
  constructor(
    private readonly createShortUrlUseCase: CreateShortUrlUseCase,
    private readonly resolveShortUrlUseCase: ResolveShortUrlUseCase,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseGuards(RequireApiKeyGuard, ApiKeyThrottlerGuard)
  @Throttle({
    [THROTTLER_POST_MINUTE]: { limit: 10, ttl: 60_000 },
    [THROTTLER_POST_DAY]: { limit: 100, ttl: 86_400_000 },
  })
  async create(@Body() dto: CreateShortUrlDto): Promise<CreateShortUrlResponseDto> {
    const url = await this.createShortUrlUseCase.execute(dto, new Date());
    const baseUrl = this.config.get<string>('BASE_URL');
    return {
      shortUrl: url.shortUrl,
      longUrl: url.longUrl,
      expiresAt: url.expiresAt,
      fullUrl: `${baseUrl}${url.shortUrl}`,
    };
  }

  @Get(':shortUrl')
  @SkipThrottle({ [THROTTLER_POST_MINUTE]: true, [THROTTLER_POST_DAY]: true })
  @Throttle({ [THROTTLER_GET_IP]: { limit: 100, ttl: 1_000 } })
  @HttpCode(HttpStatus.FOUND)
  async resolve(@Param('shortUrl') shortUrl: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.resolveShortUrlUseCase.execute(shortUrl, new Date());

    if (result.status === 'NOT_FOUND') {
      throw new NotFoundException();
    }
    if (result.status === 'GONE') {
      res.status(HttpStatus.GONE);
      return;
    }

    res.redirect(HttpStatus.FOUND, result.longUrl);
  }
}
```

Nota: falta el import de `Body` — agregarlo desde `@nestjs/common` junto a los demás.

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 21: `UrlsModule` (wiring de puertos ↔ adapters)

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/urls/urls.module.ts` (create)

**Exact Code:**
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UrlTypeOrmEntity } from './infrastructure/persistence/typeorm/url.typeorm-entity';
import { UrlTypeOrmRepository } from './infrastructure/persistence/typeorm/url-typeorm.repository';
import { IoredisUrlCacheAdapter } from './infrastructure/cache/ioredis-url-cache.adapter';
import { redisProvider } from './infrastructure/cache/redis.provider';
import { URL_REPOSITORY } from './domain/ports/url-repository.port';
import { URL_CACHE } from './domain/ports/url-cache.port';
import { CreateShortUrlUseCase } from './application/use-cases/create-short-url.use-case';
import { ResolveShortUrlUseCase } from './application/use-cases/resolve-short-url.use-case';
import { UrlsController } from './infrastructure/http/urls.controller';
import { throttlerConfigFactory } from './infrastructure/http/throttler.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([UrlTypeOrmEntity]),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: throttlerConfigFactory,
    }),
  ],
  controllers: [UrlsController],
  providers: [
    redisProvider,
    { provide: URL_REPOSITORY, useClass: UrlTypeOrmRepository },
    { provide: URL_CACHE, useClass: IoredisUrlCacheAdapter },
    CreateShortUrlUseCase,
    ResolveShortUrlUseCase,
  ],
})
export class UrlsModule {}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 22: `AppModule` final (Postgres + módulos)

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/app.module.ts` (modify)

**Exact Code:**
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { UrlTypeOrmEntity } from './urls/infrastructure/persistence/typeorm/url.typeorm-entity';
import { UrlsModule } from './urls/urls.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities: [UrlTypeOrmEntity],
        migrationsRun: true,
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
      }),
    }),
    UrlsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores. (Nota: se elimina `AppController`/`AppService` por defecto del scaffold ya que el endpoint raíz ahora lo maneja `UrlsController`; eliminar sus imports/providers y los archivos `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts` en esta tarea.)

---

## Task 23: `main.ts` con `ValidationPipe` global

**Files:**
- `/Users/diego/Desktop/side/url-shortener/src/main.ts` (modify)

**Exact Code:**
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run build
```

**Expected Output:** Compila sin errores.

---

## Task 24: Levantar infraestructura y correr migración

**Files:** (ninguno — solo comandos)

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && docker compose up -d && sleep 3 && npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```

**Expected Output:**
```
query: CREATE TABLE "urls" (...)
Migration CreateUrlsTable... has been executed successfully.
```

---

## Task 25: E2E test — POST crea un short URL

**Files:**
- `/Users/diego/Desktop/side/url-shortener/test/urls-create.e2e-spec.ts` (test)

**Exact Code:**
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST / (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a short url and returns shortUrl/longUrl/expiresAt/fullUrl', async () => {
    const response = await request(app.getHttpServer())
      .post('/')
      .set('x-api-key', 'test-key')
      .send({ longUrl: 'https://example.com/some/path' })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        shortUrl: expect.any(String),
        longUrl: 'https://example.com/some/path',
        fullUrl: expect.stringContaining(response.body.shortUrl),
      }),
    );
  });

  it('rejects when x-api-key header is missing', async () => {
    await request(app.getHttpServer())
      .post('/')
      .send({ longUrl: 'https://example.com' })
      .expect(400);
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run test:e2e -- urls-create.e2e-spec.ts
```

**Expected Output:**
```
PASS test/urls-create.e2e-spec.ts
Tests: 2 passed, 2 total
```
(Requiere que `docker compose up -d` y la migración de la Task 24 ya se hayan corrido.)

---

## Task 26: E2E test — GET resuelve, 404 y 410

**Files:**
- `/Users/diego/Desktop/side/url-shortener/test/urls-resolve.e2e-spec.ts` (test)

**Exact Code:**
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /:shortUrl (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for a shortUrl that does not exist', async () => {
    await request(app.getHttpServer()).get('/does-not-exist').expect(404);
  });

  it('redirects with 302 for a freshly created shortUrl', async () => {
    const created = await request(app.getHttpServer())
      .post('/')
      .set('x-api-key', 'test-key')
      .send({ longUrl: 'https://example.com/redirect-target' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/${created.body.shortUrl}`)
      .expect(302);

    expect(response.headers.location).toBe('https://example.com/redirect-target');
  });

  it('returns 410 for a shortUrl whose ttl already expired', async () => {
    const created = await request(app.getHttpServer())
      .post('/')
      .set('x-api-key', 'test-key')
      .send({ longUrl: 'https://example.com/expired', ttl: 1 })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    await request(app.getHttpServer()).get(`/${created.body.shortUrl}`).expect(410);
  });
});
```

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run test:e2e -- urls-resolve.e2e-spec.ts
```

**Expected Output:**
```
PASS test/urls-resolve.e2e-spec.ts
Tests: 3 passed, 3 total
```

---

## Task 27: Correr todo el suite y lint

**Files:** (ninguno)

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && npm run lint && npm run test && npm run test:e2e
```

**Expected Output:** Todos los tests unitarios, de integración y e2e pasan; `eslint` sin errores.

---

## Task 28: Actualizar README

**Files:**
- `/Users/diego/Desktop/side/url-shortener/README.md` (modify)

**Exact Code:** documentar: cómo levantar `docker compose up -d`, correr migraciones, variables de `.env`, contrato de ambos endpoints (request/response de ejemplo), y códigos de estado (`201`, `302`, `400`, `404`, `410`, `429`).

**Command:**
```bash
cd /Users/diego/Desktop/side/url-shortener && cat README.md
```

**Expected Output:** README describe setup, endpoints y códigos de estado.
