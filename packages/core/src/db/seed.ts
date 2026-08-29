import { createDb } from './client.ts';
import { items } from './schema.ts';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is not set (just db-seed が組み立てて渡す)');
}

const { db, close } = createDb(connectionString);

// destroy → apply のたびに流し直す前提なので、毎回入れ直す。
await db.delete(items);
await db.insert(items).values([
  { title: 'first seeded item', note: 'M3 の seed で投入' },
  { title: 'second seeded item', note: null },
]);

const rows = await db.select().from(items);
console.log(`seeded ${rows.length} items`);

await close();
