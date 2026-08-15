import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { CreateItemBody } from './item.ts';

describe('CreateItemBody', () => {
  it('title があれば有効', () => {
    expect(Value.Check(CreateItemBody, { title: 'hello' })).toBe(true);
  });

  it('title が空文字なら無効', () => {
    expect(Value.Check(CreateItemBody, { title: '' })).toBe(false);
  });

  it('title が欠けていれば無効', () => {
    expect(Value.Check(CreateItemBody, { note: 'no title' })).toBe(false);
  });
});
