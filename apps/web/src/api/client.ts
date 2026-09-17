import type { CreateItemBody, Item } from '@repo/contracts';

export class UnauthorizedError extends Error {}

export interface ApiClientDeps {
  getAccessToken: () => string | null;
  onUnauthorized: () => void;
}

async function request<T>(deps: ApiClientDeps, path: string, init: RequestInit = {}): Promise<T> {
  const token = deps.getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    deps.onUnauthorized();
    throw new UnauthorizedError('unauthorized');
  }
  if (!res.ok) {
    throw new Error(`request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

/** `/api` 配下のFastify APIを呼ぶクライアント。トークン取得と401時の挙動は依存として注入する。 */
export function createApiClient(deps: ApiClientDeps) {
  return {
    listItems: () => request<Item[]>(deps, '/api/items'),
    createItem: (input: CreateItemBody) =>
      request<Item>(deps, '/api/items', { method: 'POST', body: JSON.stringify(input) }),
  };
}
