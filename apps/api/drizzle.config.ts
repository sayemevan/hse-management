import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated from the Drizzle schema and applied with Wrangler
 * (`npm run db:migrate:local`), so D1 owns the migration history (Doc 03 Rule 8).
 */
export default defineConfig({
  dialect: 'sqlite',
  // Every file that defines tables (drizzle-kit needs the table exports themselves).
  schema: ['./src/modules/*/*.schema.ts', './src/platform/*/*.schema.ts'],
  out: './migrations',
  strict: true,
  verbose: true,
});
