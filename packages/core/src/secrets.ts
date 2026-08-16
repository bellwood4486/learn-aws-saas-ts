import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

export async function getSecretValue(secretId: string): Promise<string> {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (result.SecretString === undefined) {
    throw new Error(`secret has no string value: ${secretId}`);
  }
  return result.SecretString;
}
