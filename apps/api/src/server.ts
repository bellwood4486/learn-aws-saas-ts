import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin, type VerifyToken } from './plugins/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { type ItemRoutesOptions, itemRoutes } from './routes/items.ts';

export interface BuildServerDeps extends ItemRoutesOptions {
  verifyToken: VerifyToken;
}

/**
 * Fastify インスタンスの組み立てだけを行い、listen はしない。
 * テストは `app.inject()` でこの関数の戻り値を直接叩けるようにするため main.ts と分離している。
 */
export async function buildServer(deps: BuildServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(healthRoutes);
  await app.register(authPlugin, { verifyToken: deps.verifyToken });
  await app.register(itemRoutes, deps);

  return app;
}
