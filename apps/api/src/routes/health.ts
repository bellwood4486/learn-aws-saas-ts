import { coreVersion } from '@repo/core';
import type { FastifyInstance } from 'fastify';

/** ALB のヘルスチェック用。認証不要。 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => {
    return { ok: true, coreVersion: coreVersion() };
  });
}
