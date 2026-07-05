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
    // pg_get_serial_sequence resolves the actual sequence backing the id
    // column, without assuming a fixed naming convention.
    const result = await this.repository.query(
      `SELECT nextval(pg_get_serial_sequence('urls', 'id')) AS id`,
    );
    return Number(result[0].id);
  }

  async save(url: {
    id: number;
    shortUrl: string;
    longUrl: string;
    createdAt: Date;
    expiresAt: Date | null;
  }): Promise<Url> {
    const entity = this.repository.create({
      id: url.id,
      shortUrl: url.shortUrl,
      longUrl: url.longUrl,
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
      createdAt: entity.createdAt,
      expiresAt: entity.expiresAt,
    });
  }
}
