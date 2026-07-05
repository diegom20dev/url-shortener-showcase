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
      expect.objectContaining({
        id: 10,
        expiresAt: new Date('2026-07-05T00:00:00.000Z'),
      }),
    );
    expect(repo.save.mock.calls[0][0]).not.toHaveProperty('ttl');
  });

  it('sets expiresAt to null when no ttl is provided', async () => {
    repo.nextId.mockResolvedValue(0); // base62(0) -> '0'
    repo.save.mockImplementation(async (url) => ({ ...url }));

    const now = new Date('2026-07-04T00:00:00.000Z');
    const result = await useCase.execute(
      { longUrl: 'https://example.com' },
      now,
    );

    expect(result.shortUrl).toBe('0');
    expect(result.expiresAt).toBeNull();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 0, expiresAt: null }),
    );
  });
});
