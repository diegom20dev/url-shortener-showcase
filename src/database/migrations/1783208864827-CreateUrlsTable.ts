import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUrlsTable1783208864827 implements MigrationInterface {
  name = 'CreateUrlsTable1783208864827';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "urls" ("id" BIGSERIAL NOT NULL, "short_url" character varying NOT NULL, "long_url" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_eaf7bec915960b26aa4988d73b0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94d3cb6d1ef354835a1d3810d7" ON "urls" ("short_url") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94d3cb6d1ef354835a1d3810d7"`,
    );
    await queryRunner.query(`DROP TABLE "urls"`);
  }
}
