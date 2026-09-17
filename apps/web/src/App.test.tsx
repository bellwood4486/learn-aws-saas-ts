import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';
import * as cognito from './auth/cognito.ts';

vi.mock('./auth/cognito.ts', () => ({ login: vi.fn() }));

function renderApp() {
  const queryClient = new QueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

beforeEach(() => {
  vi.mocked(cognito.login).mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })),
  );
});

describe('App', () => {
  it('未ログインならLoginFormを表示する', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('ログインに成功すると一覧と作成フォームを表示する', async () => {
    vi.mocked(cognito.login).mockResolvedValue({ accessToken: 'token-123' });
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByLabelText('ユーザー名'), 'user@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    expect(await screen.findByRole('heading', { name: '新規作成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('ログアウトするとTanStack Queryのキャッシュをクリアする', async () => {
    vi.mocked(cognito.login).mockResolvedValue({ accessToken: 'token-123' });
    const user = userEvent.setup();
    const { queryClient } = renderApp();
    const clearSpy = vi.spyOn(queryClient, 'clear');

    await user.type(screen.getByLabelText('ユーザー名'), 'user@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await user.click(await screen.findByRole('button', { name: 'ログアウト' }));

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
