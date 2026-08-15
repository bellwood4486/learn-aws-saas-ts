import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSecretValue } from './secrets.ts';

const secretsMock = mockClient(SecretsManagerClient);

beforeEach(() => {
  secretsMock.reset();
});

describe('getSecretValue', () => {
  it('SecretString を返す', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: '{"api_key":"dummy"}' });

    const result = await getSecretValue('learn-aws-saas-ts/app');

    expect(result).toBe('{"api_key":"dummy"}');
    expect(secretsMock.commandCalls(GetSecretValueCommand)[0]?.args[0].input).toEqual({
      SecretId: 'learn-aws-saas-ts/app',
    });
  });

  it('SecretString が無い場合はエラーを投げる', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({});

    await expect(getSecretValue('learn-aws-saas-ts/app')).rejects.toThrow(
      'secret has no string value: learn-aws-saas-ts/app',
    );
  });
});
