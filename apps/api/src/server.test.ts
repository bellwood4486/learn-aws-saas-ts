import { describe, expect, it } from 'vitest';
import { buildServer } from './server.ts';

describe('GET /healthz', () => {
  it('200 と ok:true を返す', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });
});
