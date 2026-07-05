import { Url } from '../entities/url.entity';

export const URL_REPOSITORY = Symbol('URL_REPOSITORY');

export interface UrlRepositoryPort {
  /** Atomically obtains the next id via the Postgres sequence (nextval). */
  nextId(): Promise<number>;

  save(url: {
    id: number;
    shortUrl: string;
    longUrl: string;
    createdAt: Date;
    expiresAt: Date | null;
  }): Promise<Url>;

  findByShortUrl(shortUrl: string): Promise<Url | null>;
}
