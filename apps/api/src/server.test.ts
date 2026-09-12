import type { Db } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { buildServer } from './server.ts';

function fakeDb(): Db['db'] {
  return {} as unknown as Db['db'];
}

describe('GET /healthz', () => {
  it('200 と ok:true を返す（認証不要）', async () => {
    const app = await buildServer({
      db: fakeDb(),
      itemsTableName: 'items',
      itemsQueueUrl: 'https://queue.example/items',
      verifyToken: async () => ({ sub: 'user-1' }),
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });
});
