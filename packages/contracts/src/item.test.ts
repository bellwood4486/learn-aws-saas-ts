import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { CreateItemBody, ItemList } from './item.ts';

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

describe('ItemList', () => {
  it('Itemの配列なら有効', () => {
    const items = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        title: 'hello',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(Value.Check(ItemList, items)).toBe(true);
  });

  it('空配列でも有効', () => {
    expect(Value.Check(ItemList, [])).toBe(true);
  });

  it('配列でなければ無効', () => {
    expect(Value.Check(ItemList, { id: 'not-an-array' })).toBe(false);
  });
});
