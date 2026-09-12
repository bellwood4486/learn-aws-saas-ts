import { buildConnectionString, createDb, getSecretValue, parseDbSecret } from '@repo/core';
import { buildServer } from './server.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const dbSecretArn = requireEnv('DB_SECRET_ARN');
const itemsTableName = requireEnv('ITEMS_TABLE_NAME');
const itemsQueueUrl = requireEnv('ITEMS_QUEUE_URL');

const dbSecret = parseDbSecret(await getSecretValue(dbSecretArn));
const { db } = createDb(buildConnectionString(dbSecret));

const app = await buildServer({ db, itemsTableName, itemsQueueUrl });

// localhost 固定だと ALB のヘルスチェックが通らないので 0.0.0.0 で listen する
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
