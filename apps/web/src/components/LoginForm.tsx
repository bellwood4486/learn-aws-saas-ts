import { type FormEvent, useState } from 'react';

export interface LoginFormProps {
  onSubmit: (username: string, password: string) => void;
  error: string | null;
  isSubmitting: boolean;
}

export function LoginForm({ onSubmit, error, isSubmitting }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(username, password);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>ログイン</h1>
      <label htmlFor="login-username">ユーザー名</label>
      <input
        id="login-username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <label htmlFor="login-password">パスワード</label>
      <input
        id="login-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={isSubmitting}>
        ログイン
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}
