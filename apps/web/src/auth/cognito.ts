import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export interface LoginParams {
  region: string;
  clientId: string;
  username: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
}

/**
 * Cognitoに USER_PASSWORD_AUTH で直接ログインする。
 * InitiateAuthCommand は ClientId のみを要求し UserPoolId は使わない。
 */
export async function login(params: LoginParams): Promise<LoginResult> {
  const client = new CognitoIdentityProviderClient({ region: params.region });
  const result = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: params.clientId,
      AuthParameters: {
        USERNAME: params.username,
        PASSWORD: params.password,
      },
    }),
  );

  const accessToken = result.AuthenticationResult?.AccessToken;
  if (accessToken === undefined) {
    throw new Error('Cognito did not return an access token');
  }

  return { accessToken };
}
