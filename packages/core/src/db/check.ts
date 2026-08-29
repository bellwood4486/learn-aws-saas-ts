import { sql } from 'drizzle-orm';
import { createDb } from './client.ts';
import { items } from './schema.ts';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is not set (just db-check が組み立てて渡す)');
}

const { db, close } = createDb(connectionString);

const tables = await db.execute(
  sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
);
console.log('tables:', tables.rows.map((row) => row.table_name).join(', '));

const rows = await db.select().from(items);
console.log(`items rows: ${rows.length}`);
for (const row of rows) {
  console.log(`  ${row.id} ${row.title}`);
}

await close();
