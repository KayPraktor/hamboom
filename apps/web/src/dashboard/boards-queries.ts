import type { BoardSummary } from "@hamboom/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

/** فیلترهای فهرستِ بورد — همان‌هایی که `GET /boards` می‌پذیرد. */
export interface BoardsFilter {
  q?: string;
  favorite?: boolean;
  folderId?: string;
}

const boardsKey = (filter: BoardsFilter) => ["boards", filter] as const;

export function useBoards(filter: BoardsFilter) {
  return useQuery({
    queryKey: boardsKey(filter),
    queryFn: () => api.boards.list(filter),
    select: (data): BoardSummary[] => data.boards,
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => api.boards.create(title ? { title } : {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boards"] });
    },
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      isFavorite ? api.boards.unfavorite(id) : api.boards.favorite(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boards"] });
    },
  });
}
