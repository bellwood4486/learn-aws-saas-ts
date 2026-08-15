import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function putItem(tableName: string, item: Record<string, unknown>): Promise<void> {
  await client.send(new PutCommand({ TableName: tableName, Item: item }));
}

export async function getItem(
  tableName: string,
  key: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.send(new GetCommand({ TableName: tableName, Key: key }));
  return result.Item;
}
