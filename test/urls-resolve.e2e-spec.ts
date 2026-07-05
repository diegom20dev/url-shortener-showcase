import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /api/urls/:shortUrl (e2e)', () => {
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

  it('returns 404 for a shortUrl that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/urls/does-not-exist')
      .expect(404);
  });

  it('redirects with 302 for a freshly created shortUrl', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/urls')
      .set('x-api-key', 'test-key')
      .send({ longUrl: 'https://example.com/redirect-target' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/api/urls/${created.body.shortUrl}`)
      .expect(302);

    expect(response.headers.location).toBe(
      'https://example.com/redirect-target',
    );
  });

  it('returns 410 for a shortUrl whose ttl already expired', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/urls')
      .set('x-api-key', 'test-key')
      .send({ longUrl: 'https://example.com/expired', ttl: 1 })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    await request(app.getHttpServer())
      .get(`/api/urls/${created.body.shortUrl}`)
      .expect(410);
  });
});
