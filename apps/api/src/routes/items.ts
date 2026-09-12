import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { CreateItemBody, Item, ItemParams } from '@repo/contracts';
import type { Db } from '@repo/core';
import { createItem, getItem } from '@repo/core';
import type { FastifyInstance } from 'fastify';

export interface ItemRoutesOptions {
  db: Db['db'];
  itemsTableName: string;
  itemsQueueUrl: string;
}

/**
 * items の作成・参照。DBとAWSリソースへのアクセスは @repo/core の items ドメイン関数に委譲する。
 * `app.authenticate`（plugins/auth.ts。server.ts が先に登録する）を両ルートの preHandler にし、認証必須にする。
 */
export async function itemRoutes(app: FastifyInstance, opts: ItemRoutesOptions): Promise<void> {
  const server = app.withTypeProvider<TypeBoxTypeProvider>();

  server.post(
    '/api/items',
    { preHandler: app.authenticate, schema: { body: CreateItemBody, response: { 201: Item } } },
    async (request, reply) => {
      const item = await createItem(
        { db: opts.db, itemsTableName: opts.itemsTableName, itemsQueueUrl: opts.itemsQueueUrl },
        request.body,
      );
      reply.code(201);
      return item;
    },
  );

  server.get(
    '/api/items/:id',
    { preHandler: app.authenticate, schema: { params: ItemParams } },
    async (request, reply) => {
      const item = await getItem(
        { db: opts.db, itemsTableName: opts.itemsTableName },
        request.params.id,
      );
      if (item === undefined) {
        reply.code(404);
        return { message: 'item not found' };
      }
      return item;
    },
  );
}
