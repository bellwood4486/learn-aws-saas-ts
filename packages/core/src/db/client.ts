import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export interface Db {
  db: NodePgDatabase<typeof schema>;
  close: () => Promise<void>;
}

/**
 * 接続文字列から Drizzle クライアントを作る。
 * TLS モードは pool オプションではなく接続文字列の sslmode で決まる
 * （pg は connectionString の値で明示的な ssl オプションを上書きするため、
 * ここに ssl を渡しても無視される）。詳細は buildConnectionString のコメントを参照。
 */
export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
