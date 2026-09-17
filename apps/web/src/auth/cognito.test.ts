import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { login } from './cognito.ts';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

beforeEach(() => {
  cognitoMock.reset();
});

describe('login', () => {
  it('USER_PASSWORD_AUTHでInitiateAuthを呼び、access tokenを返す', async () => {
    cognitoMock.on(InitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'token-123' },
    });

    const result = await login({
      region: 'ap-northeast-1',
      clientId: 'client-1',
      username: 'user@example.com',
      password: 'password123',
    });

    expect(result).toEqual({ accessToken: 'token-123' });
    expect(cognitoMock.commandCalls(InitiateAuthCommand)[0]?.args[0].input).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'client-1',
      AuthParameters: { USERNAME: 'user@example.com', PASSWORD: 'password123' },
    });
  });

  it('access tokenが返らなければ例外を投げる', async () => {
    cognitoMock.on(InitiateAuthCommand).resolves({});

    await expect(
      login({
        region: 'ap-northeast-1',
        clientId: 'client-1',
        username: 'user@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow('Cognito did not return an access token');
  });
});
