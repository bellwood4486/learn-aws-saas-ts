import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Db, ItemRow } from '@repo/core';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pollOnce } from './poll.ts';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  sqsMock.reset();
});

const row: ItemRow = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'hello',
  note: 'world',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function fakeDb(rows: ItemRow[]): Db['db'] {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  } as unknown as Db['db'];
}

function deps(rows: ItemRow[]) {
  return {
    db: fakeDb(rows),
    itemsTableName: 'items',
    itemsQueueUrl: 'https://queue.example/items',
    appBucketName: 'bucket',
  };
}

describe('pollOnce', () => {
  it('受信したメッセージを処理して削除する', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [
        { MessageId: 'msg-1', ReceiptHandle: 'handle-1', Body: JSON.stringify({ id: row.id }) },
      ],
    });
    s3Mock.on(PutObjectCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(DeleteMessageCommand).resolves({});

    const count = await pollOnce(deps([row]));

    expect(count).toBe(1);
    expect(sqsMock.commandCalls(DeleteMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: 'https://queue.example/items',
      ReceiptHandle: 'handle-1',
    });
  });

  it('メッセージが無ければ0を返す', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({});

    const count = await pollOnce(deps([row]));

    expect(count).toBe(0);
  });

  it('処理に失敗してもメッセージを削除せず例外を投げない', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [
        { MessageId: 'msg-1', ReceiptHandle: 'handle-1', Body: JSON.stringify({ id: 'missing' }) },
      ],
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const count = await pollOnce(deps([]));

    expect(count).toBe(1);
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
