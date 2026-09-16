import type { Item } from '@repo/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, UnauthorizedError } from './client.ts';

const item: Item = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'hello',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('createApiClient', () => {
  it('listItemsはAuthorizationヘッダ付きでGET /api/itemsを呼ぶ', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, [item]));
    const client = createApiClient({ getAccessToken: () => 'token-123', onUnauthorized: vi.fn() });

    const result = await client.listItems();

    expect(result).toEqual([item]);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/items');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-123');
  });

  it('createItemはPOST /api/itemsにJSONボディを送る', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(201, item));
    const client = createApiClient({ getAccessToken: () => 'token-123', onUnauthorized: vi.fn() });

    const result = await client.createItem({ title: 'hello' });

    expect(result).toEqual(item);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ title: 'hello' }));
  });

  it('401が返ったらonUnauthorizedを呼びUnauthorizedErrorを投げる', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const onUnauthorized = vi.fn();
    const client = createApiClient({ getAccessToken: () => 'token-123', onUnauthorized });

    await expect(client.listItems()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('401以外のエラーレスポンスは例外を投げる', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const client = createApiClient({ getAccessToken: () => 'token-123', onUnauthorized: vi.fn() });

    await expect(client.listItems()).rejects.toThrow('request failed: 500');
  });
});
