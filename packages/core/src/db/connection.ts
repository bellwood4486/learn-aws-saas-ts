/** Secrets Manager の `<project>/db` に入っている JSON の形。 */
export interface DbSecret {
  host: string;
  port: number;
  dbname: string;
  username: string;
  password: string;
}

const REQUIRED_FIELDS = ['host', 'port', 'dbname', 'username', 'password'] as const;

/** Secrets Manager から取得した SecretString を DbSecret に変換する。 */
export function parseDbSecret(json: string): DbSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('db secret is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('db secret is not valid JSON');
  }

  const record = parsed as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`db secret is missing fields: ${missing.join(', ')}`);
  }

  return {
    host: String(record.host),
    port: Number(record.port),
    dbname: String(record.dbname),
    username: String(record.username),
    password: String(record.password),
  };
}

/**
 * postgres 接続文字列を組み立てる。
 * RDS の parameter group で rds.force_ssl = 1 にしているので TLS は必須だが、
 * sslmode=require は付けない。pg（node-postgres）は `Object.assign({}, config, parse(connectionString))`
 * で接続文字列の値を明示的な ssl オプションに上書きする実装になっており
 * （pg/lib/connection-parameters.js）、pg-connection-string は sslmode=require を
 * 「CA 検証あり」（rejectUnauthorized 既定 true 相当）に解決してしまう。
 * RDS の CA バンドルを取得しない方針（このプロジェクトの前提）だと、SSM トンネル越しに
 * host が localhost になった瞬間に証明書検証・ホスト名検証の両方で確実に失敗する。
 * sslmode=no-verify は pg-connection-string 独自拡張で rejectUnauthorized: false 相当になり、
 * 経路暗号化はしつつ証明書は検証しない。rds.force_ssl = 1 が要求する「TLS 必須」は満たしつつ
 * 検証だけ諦める、という意図を接続文字列一箇所に集約できる。
 * SSM ポートフォワード経由で繋ぐときは host/port を localhost に上書きする。
 */
export function buildConnectionString(
  secret: DbSecret,
  overrides: { host?: string; port?: number } = {},
): string {
  const host = overrides.host ?? secret.host;
  const port = overrides.port ?? secret.port;
  const user = encodeURIComponent(secret.username);
  const password = encodeURIComponent(secret.password);

  return `postgres://${user}:${password}@${host}:${port}/${secret.dbname}?sslmode=no-verify`;
}
