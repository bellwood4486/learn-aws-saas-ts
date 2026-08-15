import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getItem, putItem } from './dynamodb.ts';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('putItem', () => {
  it('指定した table / item で PutCommand を呼ぶ', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putItem('items', { id: '1', name: 'test' });

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'items',
      Item: { id: '1', name: 'test' },
    });
  });
});

describe('getItem', () => {
  it('該当する item を返す', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: '1', name: 'test' } });

    const result = await getItem('items', { id: '1' });

    expect(result).toEqual({ id: '1', name: 'test' });
  });

  it('該当する item が無い場合は undefined を返す', async () => {
    ddbMock.on(GetCommand).resolves({});

    const result = await getItem('items', { id: 'missing' });

    expect(result).toBeUndefined();
  });
});
