"use client";

// The ONLY place a Control Room fetch is caught.
//
// Every card on the old page swallowed its own error — `.catch(() => {})`
// then an empty-state render — which made a 403 (operator access revoked)
// look identical to "there is nothing here yet". This hook and its
// <AsyncPanel> always show the real HTTP status and a Retry button instead.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

export type QueryState<T> = {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
};

/** `path` may be null to skip fetching (e.g. waiting on another value). */
export function useOperatorQuery<T>(path: string | null): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof ApiError ? e : new ApiError(0, "Something went wrong."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { data, loading, error, reload };
}

/** Copy keyed off the status code — the server's own `detail` wins where it
 *  has one to give. */
export function errorCopy(error: ApiError): string {
  if (error.status === 403) {
    return "Your operator access was refused. Your account may have been disabled — sign out and back in.";
  }
  if (error.status === 401) return "Your session expired.";
  if (error.status >= 500) return `The server failed (${error.status}). Retry.`;
  return error.message || "Something went wrong.";
}
