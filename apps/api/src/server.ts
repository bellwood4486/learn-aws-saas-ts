import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.ts';
import { type ItemRoutesOptions, itemRoutes } from './routes/items.ts';

/**
 * Fastify インスタンスの組み立てだけを行い、listen はしない。
 * テストは `app.inject()` でこの関数の戻り値を直接叩けるようにするため main.ts と分離している。
 */
export async function buildServer(deps: ItemRoutesOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(healthRoutes);
  await app.register(itemRoutes, deps);

  return app;
}
