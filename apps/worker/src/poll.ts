import type { Db } from '@repo/core';
import { deleteMessage, processItem, receiveMessages } from '@repo/core';

export interface PollDeps {
  db: Db['db'];
  itemsTableName: string;
  itemsQueueUrl: string;
  appBucketName: string;
}

/**
 * キューを1回ロングポーリングし、受信した各メッセージを処理する。
 * 処理に失敗したメッセージはログを出すだけで削除しない（SQSの再配送・DLQに任せる。M4では'failed'ステータスは作らない）。
 */
export async function pollOnce(deps: PollDeps): Promise<number> {
  const messages = await receiveMessages(deps.itemsQueueUrl);

  for (const message of messages) {
    try {
      const { id } = JSON.parse(message.body) as { id: string };
      await processItem(
        { db: deps.db, itemsTableName: deps.itemsTableName, appBucketName: deps.appBucketName },
        id,
      );
      await deleteMessage(deps.itemsQueueUrl, message.receiptHandle);
      console.log(`processed item ${id}`);
    } catch (error) {
      console.error('failed to process message', message.body, error);
    }
  }

  return messages.length;
}
