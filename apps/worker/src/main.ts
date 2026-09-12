import { buildConnectionString, createDb, getSecretValue, parseDbSecret } from '@repo/core';
import { pollOnce } from './poll.ts';

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
const appBucketName = requireEnv('APP_BUCKET_NAME');

const dbSecret = parseDbSecret(await getSecretValue(dbSecretArn));
const { db } = createDb(buildConnectionString(dbSecret));

const deps = { db, itemsTableName, itemsQueueUrl, appBucketName };

// receiveMessages は WaitTimeSeconds=5 のロングポーリングなので、無限ループでもAPI呼び出し過多にならない。
for (;;) {
  await pollOnce(deps);
}
