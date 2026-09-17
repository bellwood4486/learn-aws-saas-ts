import { buildConnectionString, createDb, getSecretValue, parseDbSecret } from '@repo/core';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { buildServer } from './server.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** 空文字列を未設定として扱う。process.env[name] は空文字列でも定義済み扱いになるため。 */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

const dbSecretArn = requireEnv('DB_SECRET_ARN');
const itemsTableName = requireEnv('ITEMS_TABLE_NAME');
const itemsQueueUrl = requireEnv('ITEMS_QUEUE_URL');
const cognitoUserPoolId = requireEnv('COGNITO_USER_POOL_ID');
const cognitoClientId = requireEnv('COGNITO_CLIENT_ID');

const dbSecret = parseDbSecret(await getSecretValue(dbSecretArn));
const dbHost = optionalEnv('DB_HOST');
const dbPort = optionalEnv('DB_PORT');
const { db } = createDb(
  buildConnectionString(dbSecret, {
    host: dbHost,
    port: dbPort !== undefined ? Number(dbPort) : undefined,
  }),
);

const verifier = CognitoJwtVerifier.create({
  userPoolId: cognitoUserPoolId,
  tokenUse: 'access',
  clientId: cognitoClientId,
});
const verifyToken = (token: string) => verifier.verify(token);

const app = await buildServer({ db, itemsTableName, itemsQueueUrl, verifyToken });

// localhost 固定だと ALB のヘルスチェックが通らないので 0.0.0.0 で listen する
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
