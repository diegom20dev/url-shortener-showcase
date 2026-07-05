import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('POST /api/urls (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('/api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a short url and returns shortUrl/longUrl/expiresAt/fullUrl', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/urls')
      .set('x-api-key', 'test-key')
      .send({ longUrl: 'https://example.com/some/path' })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        shortUrl: expect.any(String),
        longUrl: 'https://example.com/some/path',
        fullUrl: expect.stringContaining(response.body.shortUrl),
      }),
    );
  });

  it('rejects when x-api-key header is missing', async () => {
    await request(app.getHttpServer())
      .post('/api/urls')
      .send({ longUrl: 'https://example.com' })
      .expect(400);
  });
});
