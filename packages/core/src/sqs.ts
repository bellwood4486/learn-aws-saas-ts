import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

const client = new SQSClient({});

export async function sendMessage(queueUrl: string, body: string): Promise<string> {
  const result = await client.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }),
  );
  if (result.MessageId === undefined) {
    throw new Error(`SQS did not return a MessageId for queue: ${queueUrl}`);
  }
  return result.MessageId;
}

export interface ReceivedMessage {
  receiptHandle: string;
  body: string;
}

export async function receiveMessages(queueUrl: string): Promise<ReceivedMessage[]> {
  const result = await client.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 5 }),
  );
  return (result.Messages ?? []).map((message) => {
    if (message.ReceiptHandle === undefined || message.Body === undefined) {
      throw new Error(`SQS message is missing ReceiptHandle or Body: ${JSON.stringify(message)}`);
    }
    return { receiptHandle: message.ReceiptHandle, body: message.Body };
  });
}

export async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
}
