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
    expect(redisMock.set).toHaveBeenCalledWith(
      'url:abc123',
      'https://example.com',
      'EX',
      3600,
    );
  });
});
