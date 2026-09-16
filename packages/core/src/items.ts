import type { CreateItemBody, Item } from '@repo/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import type { ItemRow } from './db/schema.ts';
import { items } from './db/schema.ts';
import { getItem as getStatusRecord, putItem } from './dynamodb.ts';
import { putObject } from './s3.ts';
import { sendMessage } from './sqs.ts';

type Database = Db['db'];

export type ItemStatus = Item['status'];

const ITEM_STATUSES: readonly ItemStatus[] = ['pending', 'processed', 'failed'];

/** DynamoDB の status フィールド（スキーマレス）を検証してリテラル型に変換する。 */
export function parseItemStatus(value: unknown): ItemStatus {
  if (typeof value !== 'string' || !(ITEM_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`invalid item status: ${JSON.stringify(value)}`);
  }
  return value as ItemStatus;
}

/** RDS の行（items テーブル）と DynamoDB の status を合成して `@repo/contracts` の Item にする。 */
export function composeItem(row: ItemRow, status: ItemStatus): Item {
  return {
    id: row.id,
    title: row.title,
    note: row.note ?? undefined,
    status,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreateItemDeps {
  db: Database;
  itemsTableName: string;
  itemsQueueUrl: string;
}

/** RDS に insert → DynamoDB に pending を put → SQS に処理依頼を send する。 */
export async function createItem(deps: CreateItemDeps, input: CreateItemBody): Promise<Item> {
  const [row] = await deps.db
    .insert(items)
    .values({ title: input.title, note: input.note })
    .returning();
  if (row === undefined) {
    throw new Error('insert into items did not return a row');
  }

  await putItem(deps.itemsTableName, { id: row.id, status: 'pending' });
  await sendMessage(deps.itemsQueueUrl, JSON.stringify({ id: row.id }));

  return composeItem(row, 'pending');
}

export interface GetItemDeps {
  db: Database;
  itemsTableName: string;
}

/** RDS の行 + DynamoDB の status を合成して返す。RDS に行が無ければ undefined。 */
export async function getItem(deps: GetItemDeps, id: string): Promise<Item | undefined> {
  const rows = await deps.db.select().from(items).where(eq(items.id, id));
  const row = rows[0];
  if (row === undefined) {
    return undefined;
  }

  const record = await getStatusRecord(deps.itemsTableName, { id });
  if (record === undefined) {
    throw new Error(`item status record not found in DynamoDB for id: ${id}`);
  }

  return composeItem(row, parseItemStatus(record.status));
}

export interface ListItemsDeps {
  db: Database;
  itemsTableName: string;
}

/**
 * RDSの全行（作成日時の降順）にDynamoDBのstatusを合成して返す。
 * 行ごとにDynamoDBへ1回getする（N+1）が、学習用途でデータ量が少ないため許容し、
 * getItemとの実装の一貫性を優先する。
 */
export async function listItems(deps: ListItemsDeps): Promise<Item[]> {
  const rows = await deps.db.select().from(items).orderBy(desc(items.createdAt));

  const result: Item[] = [];
  for (const row of rows) {
    const record = await getStatusRecord(deps.itemsTableName, { id: row.id });
    if (record === undefined) {
      throw new Error(`item status record not found in DynamoDB for id: ${row.id}`);
    }
    result.push(composeItem(row, parseItemStatus(record.status)));
  }
  return result;
}

export interface ProcessItemDeps {
  db: Database;
  itemsTableName: string;
  appBucketName: string;
}

/** worker用。RDSから読み直し、S3にダミースナップショットを保存してDynamoDBのstatusをprocessedにする。 */
export async function processItem(deps: ProcessItemDeps, id: string): Promise<void> {
  const rows = await deps.db.select().from(items).where(eq(items.id, id));
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`item not found in RDS for id: ${id}`);
  }

  const snapshot = JSON.stringify({
    id: row.id,
    title: row.title,
    note: row.note ?? null,
    processedAt: new Date().toISOString(),
  });
  await putObject(deps.appBucketName, `items/${row.id}.json`, snapshot);
  await putItem(deps.itemsTableName, { id: row.id, status: 'processed' });
}
