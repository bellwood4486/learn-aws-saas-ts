import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export interface Db {
  db: NodePgDatabase<typeof schema>;
  close: () => Promise<void>;
}

/**
 * 接続文字列から Drizzle クライアントを作る。
 * rds.force_ssl = 1 なので TLS は必須。RDS の CA バンドルは取得しない方針のため
 * rejectUnauthorized: false（経路暗号化のみ担保する = sslmode=require 相当）。
 */
export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
