import { useQueryClient } from '@tanstack/react-query';
import { createApiClient } from './api/client.ts';
import { useAuth } from './auth/useAuth.ts';
import { CreateItemForm } from './components/CreateItemForm.tsx';
import { ItemList } from './components/ItemList.tsx';
import { LoginForm } from './components/LoginForm.tsx';

function requireEnvVar(value: string | undefined, name: string): string {
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set (.env.local を確認してください)`);
  }
  return value;
}

const authConfig = {
  region: requireEnvVar(import.meta.env.VITE_AWS_REGION, 'VITE_AWS_REGION'),
  clientId: requireEnvVar(import.meta.env.VITE_COGNITO_CLIENT_ID, 'VITE_COGNITO_CLIENT_ID'),
};

export function App() {
  const auth = useAuth(authConfig);
  const queryClient = useQueryClient();

  // ログアウト（ボタン操作・401どちらも）ではキャッシュも破棄する。
  // gcTime内に別ユーザーで再ログインすると前ユーザーの一覧が一瞬表示されてしまうため。
  const logout = () => {
    auth.logout();
    queryClient.clear();
  };

  if (auth.accessToken === null) {
    return <LoginForm onSubmit={auth.login} error={auth.error} isSubmitting={auth.isLoggingIn} />;
  }

  const client = createApiClient({
    getAccessToken: () => auth.accessToken,
    onUnauthorized: logout,
  });

  return (
    <>
      <h1>Items</h1>
      <button type="button" onClick={logout}>
        ログアウト
      </button>
      <CreateItemForm createItem={client.createItem} />
      <ItemList listItems={client.listItems} />
    </>
  );
}
