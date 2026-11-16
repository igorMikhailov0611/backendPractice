import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRegistrationChallenges1794857593510 implements MigrationInterface {
  name = 'CreateRegistrationChallenges1794857593510';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."registration_challenge_method" AS ENUM('otp', 'magic_link')`,
    );
    await queryRunner.query(
      `CREATE TABLE "registration_challenges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "method" "public"."registration_challenge_method" NOT NULL, "secret_hash" character(64) NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "last_sent_at" TIMESTAMP WITH TIME ZONE, "consumed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_518c0664929d6d414210cd2ac3" UNIQUE ("user_id"), CONSTRAINT "CHK_registration_challenges_secret_hash" CHECK ("secret_hash" ~ '^[0-9a-f]{64}$'), CONSTRAINT "CHK_registration_challenges_attempts" CHECK ("attempts" BETWEEN 0 AND 5), CONSTRAINT "PK_d6fa191ff3d39187fdd4f889406" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_registration_challenges_magic_link_secret" ON "registration_challenges" ("secret_hash") WHERE "method" = 'magic_link'`,
    );
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" ADD CONSTRAINT "FK_518c0664929d6d414210cd2ac30" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" DROP CONSTRAINT "FK_518c0664929d6d414210cd2ac30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_registration_challenges_magic_link_secret"`,
    );
    await queryRunner.query(`DROP TABLE "registration_challenges"`);
    await queryRunner.query(
      `DROP TYPE "public"."registration_challenge_method"`,
    );
  }
}
