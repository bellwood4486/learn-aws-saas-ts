import type { CreateItemBody, Item } from '@repo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateItemForm } from './CreateItemForm.tsx';

function renderWithClient(createItem: (input: CreateItemBody) => Promise<Item>) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <CreateItemForm createItem={createItem} />
    </QueryClientProvider>,
  );
}

const created: Item = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'hello',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('CreateItemForm', () => {
  it('入力した値でcreateItemを呼び、成功したらフォームをリセットする', async () => {
    const createItem = vi.fn().mockResolvedValue(created);
    const user = userEvent.setup();
    renderWithClient(createItem);

    await user.type(screen.getByLabelText('タイトル'), 'hello');
    await user.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() =>
      expect(createItem).toHaveBeenCalledWith({ title: 'hello', note: undefined }),
    );
    await waitFor(() => expect(screen.getByLabelText('タイトル')).toHaveValue(''));
  });

  it('作成に失敗したらエラーメッセージを表示する', async () => {
    const createItem = vi.fn().mockRejectedValue(new Error('failed'));
    const user = userEvent.setup();
    renderWithClient(createItem);

    await user.type(screen.getByLabelText('タイトル'), 'hello');
    await user.click(screen.getByRole('button', { name: '作成' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('作成に失敗しました');
  });
});
