import { type Static, Type } from '@sinclair/typebox';

/** POST /api/items のリクエストボディ。 */
export const CreateItemBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  note: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateItemBody = Static<typeof CreateItemBody>;

/** GET /api/items/:id のレスポンス。RDS の行 + 処理状況（DynamoDB 側の状態）を合成する。 */
export const Item = Type.Object({
  id: Type.String(),
  title: Type.String(),
  note: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal('pending'), Type.Literal('processed'), Type.Literal('failed')]),
  createdAt: Type.String(),
});
export type Item = Static<typeof Item>;

/** GET /api/items のレスポンス。 */
export const ItemList = Type.Array(Item);
export type ItemList = Static<typeof ItemList>;

/** GET /api/items/:id のパスパラメータ。 */
export const ItemParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type ItemParams = Static<typeof ItemParams>;
