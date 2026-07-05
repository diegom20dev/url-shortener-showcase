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
