import type { Item } from '@repo/contracts';
import { useQuery } from '@tanstack/react-query';

export interface ItemListProps {
  listItems: () => Promise<Item[]>;
}

export function ItemList({ listItems }: ItemListProps) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['items'], queryFn: listItems });

  if (isLoading) {
    return <p>読み込み中...</p>;
  }
  if (isError) {
    return <p role="alert">一覧の取得に失敗しました</p>;
  }

  return (
    <ul>
      {(data ?? []).map((item) => (
        <li key={item.id}>
          {item.title}（{item.status}）
        </li>
      ))}
    </ul>
  );
}
