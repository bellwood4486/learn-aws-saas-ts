import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getObject, putObject } from './s3.ts';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

describe('putObject', () => {
  it('指定した bucket / key / body で PutObjectCommand を呼ぶ', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await putObject('my-bucket', 'my-key', 'hello');

    expect(s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input).toEqual({
      Bucket: 'my-bucket',
      Key: 'my-key',
      Body: 'hello',
    });
  });
});

describe('getObject', () => {
  it('オブジェクトの中身を文字列として返す', async () => {
    const stream = sdkStreamMixin(Readable.from(['hello']));
    s3Mock.on(GetObjectCommand).resolves({ Body: stream });

    const result = await getObject('my-bucket', 'my-key');

    expect(result).toBe('hello');
  });

  it('Body が無い場合はエラーを投げる', async () => {
    s3Mock.on(GetObjectCommand).resolves({});

    await expect(getObject('my-bucket', 'my-key')).rejects.toThrow(
      'S3 object body is empty: s3://my-bucket/my-key',
    );
  });
});
