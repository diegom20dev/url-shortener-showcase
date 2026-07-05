import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { UrlTypeOrmEntity } from '../urls/infrastructure/persistence/typeorm/url.typeorm-entity';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [UrlTypeOrmEntity],
  migrations: ['src/database/migrations/*.ts'],
});
