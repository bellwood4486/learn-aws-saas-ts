import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // drizzle-kit は url を渡すと ssl フィールドを無視する（"url" in credentials の分岐で
    // new pg.Pool({ connectionString: url, max: 1 }) しか呼ばないため）。
    // TLS モードは DATABASE_URL の sslmode（buildConnectionString 参照）で決まる。
    url: process.env.DATABASE_URL ?? '',
  },
});
