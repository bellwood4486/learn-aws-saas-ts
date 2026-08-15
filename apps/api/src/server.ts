import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.ts';

/**
 * Fastify インスタンスの組み立てだけを行い、listen はしない。
 * テストは `app.inject()` でこの関数の戻り値を直接叩けるようにするため main.ts と分離している。
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(healthRoutes);
  // items ルート・auth プラグインは M1 以降で追加する

  return app;
}
