import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(ResolveShortUrlUseCase.name);

  constructor(
    @Inject(URL_REPOSITORY) private readonly urlRepository: UrlRepositoryPort,
    @Inject(URL_CACHE) private readonly urlCache: UrlCachePort,
  ) {}

  async execute(shortUrl: string, now: Date): Promise<ResolveResult> {
    const cached = await this.urlCache.get(shortUrl);
    if (cached) {
      this.logger.log(`Cache hit for shortUrl="${shortUrl}"`);
      return { status: 'FOUND', longUrl: cached };
    }
    this.logger.log(
      `Cache miss for shortUrl="${shortUrl}", looking up in database`,
    );

    const url = await this.urlRepository.findByShortUrl(shortUrl);
    if (!url) {
      this.logger.log(`shortUrl="${shortUrl}" not found in database`);
      return { status: 'NOT_FOUND' };
    }

    if (url.isExpired(now)) {
      this.logger.log(
        `shortUrl="${shortUrl}" found in database but expired (expiresAt=${url.expiresAt?.toISOString()})`,
      );
      return { status: 'GONE' };
    }

    const ttlSeconds = url.expiresAt
      ? Math.min(
          MAX_CACHE_TTL_SECONDS,
          Math.floor((url.expiresAt.getTime() - now.getTime()) / 1000),
        )
      : MAX_CACHE_TTL_SECONDS;
    await this.urlCache.set(shortUrl, url.longUrl, ttlSeconds);

    return { status: 'FOUND', longUrl: url.longUrl };
  }
}
