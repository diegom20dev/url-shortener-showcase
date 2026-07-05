import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UrlTypeOrmEntity } from './infrastructure/persistence/typeorm/url.typeorm-entity';
import { UrlTypeOrmRepository } from './infrastructure/persistence/typeorm/url-typeorm.repository';
import { IoredisUrlCacheAdapter } from './infrastructure/cache/ioredis-url-cache.adapter';
import { redisProvider } from './infrastructure/cache/redis.provider';
import { URL_REPOSITORY } from './domain/ports/url-repository.port';
import { URL_CACHE } from './domain/ports/url-cache.port';
import { CreateShortUrlUseCase } from './application/use-cases/create-short-url.use-case';
import { ResolveShortUrlUseCase } from './application/use-cases/resolve-short-url.use-case';
import { UrlsController } from './infrastructure/http/urls.controller';
import { throttlerConfigFactory } from './infrastructure/http/throttler.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([UrlTypeOrmEntity]),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: throttlerConfigFactory,
    }),
  ],
  controllers: [UrlsController],
  providers: [
    redisProvider,
    { provide: URL_REPOSITORY, useClass: UrlTypeOrmRepository },
    { provide: URL_CACHE, useClass: IoredisUrlCacheAdapter },
    CreateShortUrlUseCase,
    ResolveShortUrlUseCase,
  ],
})
export class UrlsModule {}
