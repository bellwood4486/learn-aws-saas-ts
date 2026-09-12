import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.ts';
import type { ItemRow } from './db/schema.ts';
import { composeItem, createItem, getItem, parseItemStatus, processItem } from './items.ts';

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

function fakeInsertDb(returning: ItemRow[]): Db['db'] {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => returning,
      }),
    }),
  } as unknown as Db['db'];
}

function fakeSelectDb(rows: ItemRow[]): Db['db'] {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  } as unknown as Db['db'];
}

describe('composeItem', () => {
  it('RDSの行とstatusを合成する', () => {
    expect(composeItem(row, 'pending')).toEqual({
      id: row.id,
      title: 'hello',
      note: 'world',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('noteがnullならundefinedにする', () => {
    expect(composeItem({ ...row, note: null }, 'processed').note).toBeUndefined();
  });
});

describe('parseItemStatus', () => {
  it('pending/processed/failedを受け入れる', () => {
    expect(parseItemStatus('pending')).toBe('pending');
    expect(parseItemStatus('processed')).toBe('processed');
    expect(parseItemStatus('failed')).toBe('failed');
  });

  it('不正な値は例外を投げる', () => {
    expect(() => parseItemStatus('unknown')).toThrow('invalid item status');
    expect(() => parseItemStatus(undefined)).toThrow('invalid item status');
  });
});

describe('createItem', () => {
  it('RDSにinsertし、DynamoDBにpendingを書き、SQSに送信する', async () => {
    ddbMock.on(PutCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    const result = await createItem(
      {
        db: fakeInsertDb([row]),
        itemsTableName: 'items',
        itemsQueueUrl: 'https://queue.example/items',
      },
      { title: 'hello', note: 'world' },
    );

    expect(result).toEqual({
      id: row.id,
      title: 'hello',
      note: 'world',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'items',
      Item: { id: row.id, status: 'pending' },
    });
    expect(sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: 'https://queue.example/items',
      MessageBody: JSON.stringify({ id: row.id }),
    });
  });

  it('insertが行を返さない場合は例外を投げる', async () => {
    await expect(
      createItem(
        {
          db: fakeInsertDb([]),
          itemsTableName: 'items',
          itemsQueueUrl: 'https://queue.example/items',
        },
        { title: 'hello' },
      ),
    ).rejects.toThrow('insert into items did not return a row');
  });
});

describe('getItem', () => {
  it('RDS行とDynamoDBのstatusを合成して返す', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: row.id, status: 'processed' } });

    const result = await getItem({ db: fakeSelectDb([row]), itemsTableName: 'items' }, row.id);

    expect(result?.status).toBe('processed');
  });

  it('RDSに行が無ければundefinedを返す', async () => {
    const result = await getItem({ db: fakeSelectDb([]), itemsTableName: 'items' }, 'missing');
    expect(result).toBeUndefined();
  });

  it('DynamoDBにstatusレコードが無ければ例外を投げる', async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(
      getItem({ db: fakeSelectDb([row]), itemsTableName: 'items' }, row.id),
    ).rejects.toThrow('item status record not found in DynamoDB');
  });
});

describe('processItem', () => {
  it('S3にスナップショットを保存し、DynamoDBのstatusをprocessedにする', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    await processItem(
      { db: fakeSelectDb([row]), itemsTableName: 'items', appBucketName: 'bucket' },
      row.id,
    );

    const s3Call = s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(s3Call?.Bucket).toBe('bucket');
    expect(s3Call?.Key).toBe(`items/${row.id}.json`);
    expect(JSON.parse(String(s3Call?.Body))).toMatchObject({
      id: row.id,
      title: 'hello',
      note: 'world',
    });

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'items',
      Item: { id: row.id, status: 'processed' },
    });
  });

  it('RDSに行が無ければ例外を投げる', async () => {
    await expect(
      processItem(
        { db: fakeSelectDb([]), itemsTableName: 'items', appBucketName: 'bucket' },
        'missing',
      ),
    ).rejects.toThrow('item not found in RDS for id: missing');
  });
});
