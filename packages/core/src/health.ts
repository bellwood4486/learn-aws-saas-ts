/**
 * M0 時点のプレースホルダ。
 * 実際の AWS クライアント（S3 / DynamoDB / SQS / Secrets Manager / Drizzle）は M1 以降で追加する。
 * ここでは「apps/api が @repo/core の dist を pnpm symlink 経由で解決できるか」を確認するために存在する。
 */
export function coreVersion(): string {
  return '0.0.0';
}
