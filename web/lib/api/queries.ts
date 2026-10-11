"use client";

import { useQuery } from "@tanstack/react-query";
import { isTerminal } from "@/lib/offramp/model";
import { api } from "./index";
import { isApiError } from "./errors";

export const queryKeys = {
  banks: ["banks"] as const,
  intent: (id: string) => ["intent", id] as const,
  activity: ["activity"] as const,
};

const POLL_MS = 2_000;

export function useBanks() {
  return useQuery({
    queryKey: queryKeys.banks,
    queryFn: ({ signal }) => api.listBanks({ signal }),
    staleTime: 60 * 60 * 1000,
  });
}

/** Polls the backend projection until the intent reaches a terminal status. */
export function useIntent(id: string) {
  return useQuery({
    queryKey: queryKeys.intent(id),
    queryFn: ({ signal }) => api.getIntent(id, { signal }),
    retry: (count, error) => !isApiError(error, "not-found") && count < 2,
    refetchInterval: (query) => {
      const status = query.state.data?.projection.status;
      return status && isTerminal(status) ? false : POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export function useActivity() {
  return useQuery({
    queryKey: queryKeys.activity,
    queryFn: ({ signal }) => api.listActivity({ signal }),
    refetchInterval: (query) =>
      query.state.data?.some((i) => !isTerminal(i.projection.status)) ? POLL_MS * 2 : false,
  });
}
