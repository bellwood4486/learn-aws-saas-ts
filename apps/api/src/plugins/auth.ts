import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export type VerifyToken = (token: string) => Promise<unknown>;

export interface AuthPluginOptions {
  verifyToken: VerifyToken;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

const BEARER_PREFIX = 'Bearer ';

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      reply.code(401).send({ message: 'missing bearer token' });
      return;
    }

    const token = header.slice(BEARER_PREFIX.length);
    try {
      await opts.verifyToken(token);
    } catch {
      reply.code(401).send({ message: 'invalid token' });
    }
  });
}

/**
 * CognitoのJWTを検証するpreHandlerを`authenticate`としてdecorateする。
 * 検証方法自体は`verifyToken`に委譲する（本番の実装はmain.tsが`aws-jwt-verify`で組み立てる。
 * ユニットテストではAWSに繋がずフェイク関数を渡す）。
 */
export const authPlugin = fp(authPluginImpl);
