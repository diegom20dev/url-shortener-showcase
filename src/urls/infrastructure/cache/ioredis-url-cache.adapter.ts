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

  async set(
    shortUrl: string,
    longUrl: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(this.key(shortUrl), longUrl, 'EX', ttlSeconds);
  }

  private key(shortUrl: string): string {
    return `url:${shortUrl}`;
  }
}
