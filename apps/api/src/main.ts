import { buildServer } from './server.ts';

const app = await buildServer();

// localhost 固定だと ALB のヘルスチェックが通らないので 0.0.0.0 で listen する
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
