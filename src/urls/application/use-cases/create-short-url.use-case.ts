import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(CreateShortUrlUseCase.name);

  constructor(
    @Inject(URL_REPOSITORY) private readonly urlRepository: UrlRepositoryPort,
  ) {}

  async execute(input: CreateShortUrlInput, now: Date): Promise<Url> {
    this.logger.log(
      input.ttl !== undefined
        ? `Creating short URL with ttl=${input.ttl}s`
        : 'Creating short URL (no ttl provided)',
    );

    const id = await this.urlRepository.nextId();
    const shortUrl = encodeBase62(id);
    this.logger.log(`Generated shortUrl="${shortUrl}" for id=${id}`);

    const expiresAt =
      input.ttl === undefined
        ? null
        : new Date(now.getTime() + Math.min(input.ttl, MAX_TTL_SECONDS) * 1000);

    const url = await this.urlRepository.save({
      id,
      shortUrl,
      longUrl: input.longUrl,
      createdAt: now,
      expiresAt,
    });
    this.logger.log(
      `Persisted shortUrl="${shortUrl}" (expiresAt=${expiresAt ? expiresAt.toISOString() : 'null'})`,
    );

    return url;
  }
}
