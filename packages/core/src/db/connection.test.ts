import { describe, expect, it } from 'vitest';
import { buildConnectionString, parseDbSecret } from './connection.ts';

const secretJson = JSON.stringify({
  host: 'learn-aws-saas-ts-app.abc123.ap-northeast-1.rds.amazonaws.com',
  port: 5432,
  dbname: 'app',
  username: 'app',
  password: 'p@ss word/with:symbols',
});

describe('parseDbSecret', () => {
  it('Secrets Manager の JSON を DbSecret に変換する', () => {
    const secret = parseDbSecret(secretJson);

    expect(secret.host).toBe('learn-aws-saas-ts-app.abc123.ap-northeast-1.rds.amazonaws.com');
    expect(secret.port).toBe(5432);
    expect(secret.dbname).toBe('app');
    expect(secret.username).toBe('app');
    expect(secret.password).toBe('p@ss word/with:symbols');
  });

  it('必須フィールドが欠けている場合はエラーを投げる', () => {
    const broken = JSON.stringify({ host: 'h', port: 5432, dbname: 'app', username: 'app' });

    expect(() => parseDbSecret(broken)).toThrow('db secret is missing fields: password');
  });

  it('JSON でない場合はエラーを投げる', () => {
    expect(() => parseDbSecret('not json')).toThrow('db secret is not valid JSON');
  });
});

describe('buildConnectionString', () => {
  it('記号を含むパスワードを URL エンコードして接続文字列を組み立てる', () => {
    const url = buildConnectionString(parseDbSecret(secretJson));

    expect(url).toBe(
      'postgres://app:p%40ss%20word%2Fwith%3Asymbols@learn-aws-saas-ts-app.abc123.ap-northeast-1.rds.amazonaws.com:5432/app?sslmode=no-verify',
    );
  });

  it('SSM トンネル用に host と port を上書きできる', () => {
    const url = buildConnectionString(parseDbSecret(secretJson), {
      host: 'localhost',
      port: 5432,
    });

    expect(url).toBe(
      'postgres://app:p%40ss%20word%2Fwith%3Asymbols@localhost:5432/app?sslmode=no-verify',
    );
  });

  it('sslmode=require ではなく no-verify を使う（pg は接続文字列の sslmode で明示的な ssl オプションを上書きするため、require だと SSM トンネル越しの localhost 接続で証明書検証に失敗する）', () => {
    const url = buildConnectionString(parseDbSecret(secretJson));

    expect(url.endsWith('sslmode=no-verify')).toBe(true);
  });
});
