import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cognito from './cognito.ts';
import { useAuth } from './useAuth.ts';

vi.mock('./cognito.ts', () => ({ login: vi.fn() }));

const config = { region: 'ap-northeast-1', clientId: 'client-1' };

beforeEach(() => {
  vi.mocked(cognito.login).mockReset();
});

describe('useAuth', () => {
  it('初期状態はaccessTokenがnull', () => {
    const { result } = renderHook(() => useAuth(config));
    expect(result.current.accessToken).toBeNull();
  });

  it('loginが成功するとaccessTokenが入る', async () => {
    vi.mocked(cognito.login).mockResolvedValue({ accessToken: 'token-123' });
    const { result } = renderHook(() => useAuth(config));

    await act(async () => {
      await result.current.login('user@example.com', 'password123');
    });

    expect(result.current.accessToken).toBe('token-123');
    expect(result.current.error).toBeNull();
    expect(cognito.login).toHaveBeenCalledWith({
      region: 'ap-northeast-1',
      clientId: 'client-1',
      username: 'user@example.com',
      password: 'password123',
    });
  });

  it('loginが失敗するとerrorにメッセージが入る', async () => {
    vi.mocked(cognito.login).mockRejectedValue(new Error('Incorrect username or password.'));
    const { result } = renderHook(() => useAuth(config));

    await act(async () => {
      await result.current.login('user@example.com', 'wrong-password');
    });

    await waitFor(() => expect(result.current.error).toBe('Incorrect username or password.'));
    expect(result.current.accessToken).toBeNull();
  });

  it('logoutでaccessTokenがnullに戻る', async () => {
    vi.mocked(cognito.login).mockResolvedValue({ accessToken: 'token-123' });
    const { result } = renderHook(() => useAuth(config));

    await act(async () => {
      await result.current.login('user@example.com', 'password123');
    });
    act(() => {
      result.current.logout();
    });

    expect(result.current.accessToken).toBeNull();
  });
});
