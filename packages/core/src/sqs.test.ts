import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteMessage, receiveMessages, sendMessage } from './sqs.ts';

const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  sqsMock.reset();
});

describe('sendMessage', () => {
  it('MessageId を返す', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    const result = await sendMessage('https://queue.example/items', 'hello');

    expect(result).toBe('msg-1');
    expect(sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: 'https://queue.example/items',
      MessageBody: 'hello',
    });
  });

  it('MessageId が無い場合はエラーを投げる', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    await expect(sendMessage('https://queue.example/items', 'hello')).rejects.toThrow(
      'SQS did not return a MessageId',
    );
  });
});

describe('receiveMessages', () => {
  it('受信したメッセージを receiptHandle / body の配列に変換する', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [{ MessageId: 'msg-1', ReceiptHandle: 'handle-1', Body: 'hello' }],
    });

    const result = await receiveMessages('https://queue.example/items');

    expect(result).toEqual([{ receiptHandle: 'handle-1', body: 'hello' }]);
  });

  it('メッセージが無い場合は空配列を返す', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({});

    const result = await receiveMessages('https://queue.example/items');

    expect(result).toEqual([]);
  });
});

describe('deleteMessage', () => {
  it('指定した queueUrl / receiptHandle で DeleteMessageCommand を呼ぶ', async () => {
    sqsMock.on(DeleteMessageCommand).resolves({});

    await deleteMessage('https://queue.example/items', 'handle-1');

    expect(sqsMock.commandCalls(DeleteMessageCommand)[0]?.args[0].input).toEqual({
      QueueUrl: 'https://queue.example/items',
      ReceiptHandle: 'handle-1',
    });
  });
});
