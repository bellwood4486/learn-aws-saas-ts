import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// App.tsx はモジュール読み込み時に VITE_AWS_REGION / VITE_COGNITO_CLIENT_ID の
// 設定チェックを行う。.env.local は未commitなためテスト環境ではダミー値を注入する。
vi.stubEnv('VITE_AWS_REGION', 'ap-northeast-1');
vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'test-cognito-client-id');

afterEach(() => {
  cleanup();
});
