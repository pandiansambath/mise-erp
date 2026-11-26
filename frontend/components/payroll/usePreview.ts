"use client";

// What the run would pay, kept up to date while it is being put together.
//
// The server does every sum, so the number on the screen is the number that is
// saved. A change waits a moment before it asks (somebody ticking down a list is
// one question, not twelve), and an answer that arrives after a newer question
// was asked is thrown away.

import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { Preview } from "@/components/payroll/lib";

export function usePreview(body: string | null): {
  data: Preview | null;
  loading: boolean;
  error: string | null;
  /** Ask again although nothing on this screen has changed. */
  refresh: () => void;
} {
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const asked = useRef(0);

  useEffect(() => {
    if (body === null) return;
    const mine = ++asked.current;
    setLoading(true);
    const wait = window.setTimeout(() => {
      api
        .post<Preview>("/payroll/runs/preview", JSON.parse(body))
        .then((res) => {
          if (asked.current !== mine) return;
          setData(res);
          setError(null);
        })
        .catch((err: unknown) => {
          if (asked.current !== mine) return;
          setError(err instanceof ApiError ? err.message : "Could not work it out. Try again.");
        })
        .finally(() => {
          if (asked.current === mine) setLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(wait);
  }, [body, again]);

  return { data, loading, error, refresh: () => setAgain((n) => n + 1) };
}
