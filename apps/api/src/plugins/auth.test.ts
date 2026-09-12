import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { authPlugin } from './auth.ts';

async function buildTestApp(verifyToken: (token: string) => Promise<unknown>) {
  const app = Fastify();
  await app.register(authPlugin, { verifyToken });
  app.get('/protected', { preHandler: app.authenticate }, async () => ({ ok: true }));
  return app;
}

describe('authPlugin', () => {
  it('Authorizationヘッダが無ければ401', async () => {
    const app = await buildTestApp(async () => ({ sub: 'user-1' }));

    const res = await app.inject({ method: 'GET', url: '/protected' });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('Bearer形式でなければ401', async () => {
    const app = await buildTestApp(async () => ({ sub: 'user-1' }));

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic xxx' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('verifyTokenが例外を投げれば401', async () => {
    const app = await buildTestApp(async () => {
      throw new Error('invalid signature');
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('verifyTokenが解決すれば200', async () => {
    const app = await buildTestApp(async (token) => {
      expect(token).toBe('valid-token');
      return { sub: 'user-1' };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
