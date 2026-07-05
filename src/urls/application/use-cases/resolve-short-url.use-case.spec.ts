import { Test } from '@nestjs/testing';
import {
  ResolveShortUrlUseCase,
  ResolveResult,
} from './resolve-short-url.use-case';
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
    expect(result).toEqual<ResolveResult>({
      status: 'FOUND',
      longUrl: 'https://cached.example.com',
    });
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
      new Url({
        id: 1,
        shortUrl: 'abc',
        longUrl: 'https://example.com',
        createdAt: past,
        expiresAt: past,
      }),
    );
    const result = await useCase.execute(
      'abc',
      new Date('2026-07-04T00:00:00.000Z'),
    );
    expect(result).toEqual<ResolveResult>({ status: 'GONE' });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('caches with min(24h, expiresAt-now) and returns FOUND when valid with expiresAt', async () => {
    cache.get.mockResolvedValue(null);
    const now = new Date('2026-07-04T00:00:00.000Z');
    const expiresAt = new Date('2026-07-04T00:10:00.000Z'); // 600s away
    repo.findByShortUrl.mockResolvedValue(
      new Url({
        id: 1,
        shortUrl: 'abc',
        longUrl: 'https://example.com',
        createdAt: now,
        expiresAt,
      }),
    );
    const result = await useCase.execute('abc', now);
    expect(result).toEqual<ResolveResult>({
      status: 'FOUND',
      longUrl: 'https://example.com',
    });
    expect(cache.set).toHaveBeenCalledWith('abc', 'https://example.com', 600);
  });

  it('caches with a flat 24h TTL when expiresAt is null', async () => {
    cache.get.mockResolvedValue(null);
    const now = new Date('2026-07-04T00:00:00.000Z');
    repo.findByShortUrl.mockResolvedValue(
      new Url({
        id: 1,
        shortUrl: 'abc',
        longUrl: 'https://example.com',
        createdAt: now,
        expiresAt: null,
      }),
    );
    await useCase.execute('abc', now);
    expect(cache.set).toHaveBeenCalledWith('abc', 'https://example.com', 86400);
  });
});
