import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm.tsx';

describe('LoginForm', () => {
  it('入力した値でonSubmitを呼ぶ', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm onSubmit={onSubmit} error={null} isSubmitting={false} />);

    await user.type(screen.getByLabelText('ユーザー名'), 'user@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    expect(onSubmit).toHaveBeenCalledWith('user@example.com', 'password123');
  });

  it('errorがあればメッセージを表示する', () => {
    render(<LoginForm onSubmit={vi.fn()} error="ログインに失敗しました" isSubmitting={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ログインに失敗しました');
  });

  it('isSubmittingならボタンを無効化する', () => {
    render(<LoginForm onSubmit={vi.fn()} error={null} isSubmitting={true} />);
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeDisabled();
  });
});
