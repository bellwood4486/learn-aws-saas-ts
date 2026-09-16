import { createApiClient } from './api/client.ts';
import { useAuth } from './auth/useAuth.ts';
import { CreateItemForm } from './components/CreateItemForm.tsx';
import { ItemList } from './components/ItemList.tsx';
import { LoginForm } from './components/LoginForm.tsx';

const authConfig = {
  region: import.meta.env.VITE_AWS_REGION,
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
};

export function App() {
  const auth = useAuth(authConfig);

  if (auth.accessToken === null) {
    return <LoginForm onSubmit={auth.login} error={auth.error} isSubmitting={auth.isLoggingIn} />;
  }

  const client = createApiClient({
    getAccessToken: () => auth.accessToken,
    onUnauthorized: auth.logout,
  });

  return (
    <>
      <h1>Items</h1>
      <button type="button" onClick={auth.logout}>
        ログアウト
      </button>
      <CreateItemForm createItem={client.createItem} />
      <ItemList listItems={client.listItems} />
    </>
  );
}
