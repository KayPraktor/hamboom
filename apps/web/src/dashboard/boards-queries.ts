import type { BoardSummary } from "@hamboom/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

/** فیلترهای فهرستِ بورد — همان‌هایی که `GET /boards` می‌پذیرد. */
export interface BoardsFilter {
  q?: string;
  favorite?: boolean;
  folderId?: string;
  /** `true` → سطلِ بازیافت (بوردهای حذف‌شده)، به‌جای بوردهای زنده. */
  trashed?: boolean;
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

/** انتقال به سطلِ بازیافت (حذفِ نرم؛ فقط مالک — api گیت می‌کند). */
export function useTrashBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.boards.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boards"] });
    },
  });
}

/** بازیابی از سطل (فقط مالک). */
export function useRestoreBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.boards.restore(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boards"] });
    },
  });
}

/** تغییرِ نامِ بورد (editor+ — api گیت می‌کند). */
export function useRenameBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.boards.update(id, { title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boards"] });
      void qc.invalidateQueries({ queryKey: ["board"] }); // کشِ boards.get پوسته‌ی بورد
    },
  });
}

/** جابه‌جاییِ بورد به یک فولدر، یا `null` برای خروج از فولدر. */
export function useMoveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      api.boards.update(id, { folderId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boards"] });
      void qc.invalidateQueries({ queryKey: ["board"] }); // کشِ boards.get منوی جابه‌جایی
    },
  });
}
