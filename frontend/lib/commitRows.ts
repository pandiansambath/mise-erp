/** Send a decided import in batches, and report it as one job.
 *
 *     "more than 200 items means its not accepting..pelaes check...i sent 200
 *      items but it showing more thatn 200 itms cant be added"
 *
 *  THE SERVER CAP IS RIGHT AND THE ERROR WAS WRONG. `MAX_COMMIT_ROWS` keeps
 *  one request to one bounded transaction, which is what stops a 5,000-row
 *  paste holding a connection open while it writes. That is a server
 *  concern. Turning it into a sentence that tells a restaurant owner to go
 *  and cut his own spreadsheet into pieces is making his problem out of our
 *  implementation detail.
 *
 *  So the batching happens here, once, for every caller. He picks 2,000
 *  items and sees one preview, one button and one result. The server still
 *  only ever receives 200 at a time.
 *
 *  ORDER IS PRESERVED and the batches are SEQUENTIAL, not parallel. Each one
 *  re-classifies against the database as it is at that moment — that is how
 *  `apply()` catches a duplicate that arrived mid-import — and firing them
 *  together would have batch three checking against a world batch two had
 *  not finished creating.
 *
 *  A FAILED BATCH DOES NOT LOSE THE ONES BEFORE IT. They are already
 *  written; pretending otherwise by throwing away the counts would be the
 *  silent loss this whole feature exists to prevent. The error is reported
 *  alongside what did land.
 */

import { api, ApiError } from "@/lib/api";

/** Matches the server's `MAX_COMMIT_ROWS`. Deliberately the same number: a
 *  client chunk larger than the server's cap just moves the error. */
const CHUNK = 200;

export type CommitCounts = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type CommitResult = {
  counts: CommitCounts;
  failed: { name: string; why: string }[];
  created: { n: number; name: string; id: string }[];
  notes?: string[];
  /** Set when a batch threw. What came before it is still in `counts`. */
  error?: string;
};

type Decision = { n: number; action: string; values: Record<string, unknown> };

export async function commitRows(
  base: string,
  decisions: Decision[],
  source: string,
  onProgress?: (done: number, total: number) => void,
): Promise<CommitResult> {
  const out: CommitResult = {
    counts: { created: 0, updated: 0, skipped: 0, failed: 0 },
    failed: [],
    created: [],
    notes: [],
  };

  for (let i = 0; i < decisions.length; i += CHUNK) {
    const slice = decisions.slice(i, i + CHUNK);
    try {
      const res = await api.post<CommitResult>(`/${base}/import/commit`, {
        rows: slice,
        source,
      });
      out.counts.created += res.counts?.created ?? 0;
      out.counts.updated += res.counts?.updated ?? 0;
      out.counts.skipped += res.counts?.skipped ?? 0;
      out.counts.failed += res.counts?.failed ?? 0;
      if (res.failed?.length) out.failed.push(...res.failed);
      if (res.created?.length) out.created.push(...res.created);
      if (res.notes?.length) out.notes!.push(...res.notes);
    } catch (err) {
      // Everything before this IS SAVED. Reporting only the error would tell
      // him nothing went in, send him back to re-import the lot, and hand
      // him a pile of duplicates for his trouble.
      out.error =
        err instanceof ApiError
          ? err.message
          : `Stopped after ${out.counts.created + out.counts.updated} of ${decisions.length}.`;
      return out;
    }
    onProgress?.(Math.min(i + CHUNK, decisions.length), decisions.length);
  }

  return out;
}
