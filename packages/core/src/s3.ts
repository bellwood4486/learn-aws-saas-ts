import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({});

export async function putObject(bucket: string, key: string, body: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
}

export async function getObject(bucket: string, key: string): Promise<string> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await result.Body?.transformToString();
  if (body === undefined) {
    throw new Error(`S3 object body is empty: s3://${bucket}/${key}`);
  }
  return body;
}
