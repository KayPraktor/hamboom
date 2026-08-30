import type { CreateInviteBody } from "@hamboom/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client.ts";
import type { AssignableTeamRole } from "./role-labels.ts";

export function useTeam(teamId: string) {
  return useQuery({ queryKey: ["team", teamId], queryFn: () => api.teams.get(teamId) });
}

export function useMembers(teamId: string) {
  return useQuery({
    queryKey: ["team", teamId, "members"],
    queryFn: () => api.teams.members(teamId),
    select: (data) => data.members,
  });
}

export function useSetMemberRole(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AssignableTeamRole }) =>
      api.teams.setMemberRole(teamId, userId, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
  });
}

export function useRemoveMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.teams.removeMember(teamId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
  });
}

export function useCreateInvite(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInviteBody) => api.teams.createInvite(teamId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
  });
}
