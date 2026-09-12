import type { Db } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { buildServer } from './server.ts';

function fakeDb(): Db['db'] {
  return {} as unknown as Db['db'];
}

describe('GET /healthz', () => {
  it('200 と ok:true を返す', async () => {
    const app = await buildServer({
      db: fakeDb(),
      itemsTableName: 'items',
      itemsQueueUrl: 'https://queue.example/items',
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });
});
