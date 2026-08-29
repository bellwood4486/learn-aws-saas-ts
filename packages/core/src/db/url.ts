import { buildConnectionString, parseDbSecret } from './connection.ts';

// Secrets Manager の SecretString（JSON）を標準入力から受け取り、
// SSM トンネル（localhost:5432）向けの接続文字列を標準出力に書く。
// just db-url がこのスクリプトに `aws secretsmanager get-secret-value ...` の出力をパイプする。
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
}

if (input.trim() === '') {
  throw new Error('stdin is empty (Secrets Manager の SecretString を渡すこと)');
}

const url = buildConnectionString(parseDbSecret(input), { host: 'localhost', port: 5432 });
process.stdout.write(`${url}\n`);
