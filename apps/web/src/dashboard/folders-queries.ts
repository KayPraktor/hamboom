import type { Folder } from "@hamboom/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";

/**
 * hookهای فولدر — فولدرها **per-team** اند (`GET /teams/:id/folders`). نویگیشنِ داشبورد
 * برای هر تیمِ کاربر یکی از این‌ها می‌سازد. بعد از هر تغییر هم فهرستِ فولدرِ همان تیم و هم
 * فهرستِ بورد (چون فولدرِ حذف‌شده بوردها را بی‌فولدر می‌کند) باطل می‌شود.
 */
const foldersKey = (teamId: string) => ["folders", teamId] as const;

export function useFolders(teamId: string, enabled = true) {
  return useQuery({
    queryKey: foldersKey(teamId),
    queryFn: () => api.folders.list(teamId),
    select: (data): Folder[] => data.folders,
    enabled,
  });
}

export function useCreateFolder(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.folders.create(teamId, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
}

export function useRenameFolder(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.folders.update(id, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
}

export function useDeleteFolder(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.folders.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: foldersKey(teamId) });
      void qc.invalidateQueries({ queryKey: ["boards"] }); // بوردهای داخلش بی‌فولدر شدند
    },
  });
}
