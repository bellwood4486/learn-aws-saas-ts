import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('見出しを表示する', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'learn-aws-saas-ts' })).toBeInTheDocument();
  });
});
