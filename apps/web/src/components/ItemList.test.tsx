import type { Item } from '@repo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ItemList } from './ItemList.tsx';

function renderWithClient(listItems: () => Promise<Item[]>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ItemList listItems={listItems} />
    </QueryClientProvider>,
  );
}

const item: Item = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'hello',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('ItemList', () => {
  it('取得したitemを表示する', async () => {
    renderWithClient(vi.fn().mockResolvedValue([item]));

    expect(await screen.findByText(/hello/)).toBeInTheDocument();
    expect(screen.getByText(/pending/)).toBeInTheDocument();
  });

  it('空配列なら一覧が空になる', async () => {
    renderWithClient(vi.fn().mockResolvedValue([]));

    await screen.findByRole('list');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('取得に失敗したらエラーメッセージを表示する', async () => {
    renderWithClient(vi.fn().mockRejectedValue(new Error('network error')));

    expect(await screen.findByRole('alert')).toHaveTextContent('一覧の取得に失敗しました');
  });
});
