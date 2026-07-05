export const URL_CACHE = Symbol('URL_CACHE');

export interface UrlCachePort {
  get(shortUrl: string): Promise<string | null>;

  set(shortUrl: string, longUrl: string, ttlSeconds: number): Promise<void>;
}
