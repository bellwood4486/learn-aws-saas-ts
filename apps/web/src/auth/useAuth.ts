import { useCallback, useState } from 'react';
import { login as cognitoLogin } from './cognito.ts';

export interface AuthConfig {
  region: string;
  clientId: string;
}

export interface UseAuthResult {
  accessToken: string | null;
  error: string | null;
  isLoggingIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

/** Cognitoへの直接ログインの状態をReact stateだけで保持する（sessionStorage等は使わない）。 */
export function useAuth(config: AuthConfig): UseAuthResult {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const login = useCallback(
    async (username: string, password: string) => {
      setIsLoggingIn(true);
      setError(null);
      try {
        const result = await cognitoLogin({ ...config, username, password });
        setAccessToken(result.accessToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ログインに失敗しました');
      } finally {
        setIsLoggingIn(false);
      }
    },
    [config],
  );

  const logout = useCallback(() => {
    setAccessToken(null);
  }, []);

  return { accessToken, error, isLoggingIn, login, logout };
}
