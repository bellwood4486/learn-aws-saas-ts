import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Db, ItemRow } from '@repo/core';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.ts';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
});

const row: ItemRow = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'hello',
  note: 'world',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const authHeader = { authorization: 'Bearer valid-token' };

function fakeDb(rows: ItemRow[]): Db['db'] {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => rows,
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  } as unknown as Db['db'];
}

function buildTestServer(rows: ItemRow[]) {
  return buildServer({
    db: fakeDb(rows),
    itemsTableName: 'items',
    itemsQueueUrl: 'https://queue.example/items',
    verifyToken: async () => ({ sub: 'user-1' }),
  });
}

describe('POST /api/items', () => {
  it('Authorizationヘッダが無ければ401', async () => {
    const app = await buildTestServer([row]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { title: 'hello' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('201でitemを返す', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });
    ddbMock.on(PutCommand).resolves({});

    const app = await buildTestServer([row]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      headers: authHeader,
      payload: { title: 'hello', note: 'world' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'hello', note: 'world', status: 'pending' });
    await app.close();
  });

  it('titleが無ければ400', async () => {
    const app = await buildTestServer([row]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      headers: authHeader,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /api/items/:id', () => {
  it('Authorizationヘッダが無ければ401', async () => {
    const app = await buildTestServer([row]);
    const res = await app.inject({ method: 'GET', url: `/api/items/${row.id}` });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('存在すれば200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: row.id, status: 'processed' } });

    const app = await buildTestServer([row]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/items/${row.id}`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: row.id, status: 'processed' });
    await app.close();
  });

  it('存在しなければ404', async () => {
    const app = await buildTestServer([]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/items/${row.id}`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
