import type { CreateItemBody, Item } from '@repo/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';

export interface CreateItemFormProps {
  createItem: (input: CreateItemBody) => Promise<Item>;
}

export function CreateItemForm({ createItem }: CreateItemFormProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (variables: CreateItemBody) => createItem(variables),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setTitle('');
      setNote('');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ title, note: note === '' ? undefined : note });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>新規作成</h2>
      <label htmlFor="create-title">タイトル</label>
      <input
        id="create-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <label htmlFor="create-note">メモ</label>
      <input id="create-note" value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="submit" disabled={mutation.isPending}>
        作成
      </button>
      {mutation.isError && <p role="alert">作成に失敗しました</p>}
    </form>
  );
}
