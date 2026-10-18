import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'src/database/schema.prisma',
  migrations: {
    path: 'src/database/migrations',
    seed: 'tsx src/database/seed.ts',
  },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
