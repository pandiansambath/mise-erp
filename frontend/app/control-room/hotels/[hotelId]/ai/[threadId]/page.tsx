"use client";

// hotels/[hotelId]/ai/[threadId] — 33.4 transcript.
//
// NEVER feed a transcript from this page to the Ask dock. This is another
// restaurant's private conversation, not a summarisation source — do not
// "helpfully" wire that up.
//
// The endpoint writes an audit row on EVERY call, naming the thread, before
// the read happens (observability.py). So the fetch is gated behind an
// explicit button — never on mount, never prefetched, never in a loop.

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";

type Msg = { id: string; role: "user" | "assistant"; content: string; at: string };

function ErrorCard({ title, error, retry }: { title: string; error: ApiError; retry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">{error.status || "!"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button type="button" onClick={retry} className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold">
        Retry
      </button>
    </div>
  );
}

export default function HotelAiTranscriptPage({
  params,
}: {
  params: Promise<{ hotelId: string; threadId: string }>;
}) {
  const { hotelId, threadId } = use(params);
  const { user } = useAuth();
  const { hotels } = useFleet();
  const [requested, setRequested] = useState(false);

  const hotelName = hotels.find((h) => h.id === hotelId)?.name ?? "this hotel";
  const q = useOperatorQuery<{ messages: Msg[] }>(
    requested ? `/platform/hotels/${hotelId}/ai-threads/${threadId}` : null,
  );

  if (!user?.is_platform_owner) return null;

  return (
    <div className="space-y-4">
      <Link
        href={`/control-room/hotels/${hotelId}/ai`}
        className="mise-press inline-flex items-center gap-1 text-xs font-medium text-fg-soft hover:text-fg"
      >
        ‹ Back to conversations
      </Link>

      {!requested ? (
        <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-amber-400/70" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Open {hotelName}&apos;s private conversation?</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-soft">
              This records an entry in the operator trail under your name, naming this conversation, before it is shown to
              you. Open it only when you are handling a support request from this restaurant.
            </p>
            <button
              type="button"
              onClick={() => setRequested(true)}
              data-tone="brand"
              className="mise-btn-flat mise-press mt-3 px-3 py-1.5 text-xs font-semibold"
            >
              View transcript — this will be recorded
            </button>
          </div>
        </div>
      ) : q.loading && !q.data ? (
        <Spinner />
      ) : q.error ? (
        <ErrorCard title="Could not load this conversation" error={q.error} retry={q.reload} />
      ) : (
        <>
          {/* J2 — recorded-access band, above the first message. */}
          <div className="mise-well rounded-xl px-4 py-2.5 text-xs text-fg-faint">
            Recorded: <b className="text-fg-soft">{user.email}</b> opened this conversation from{" "}
            <b className="text-fg-soft">{hotelName}</b> just now.
          </div>
          <div className="mise-card-inset space-y-3 p-4">
            {(q.data?.messages ?? []).map((m) => (
              <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
                <span
                  className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-left text-sm ${
                    m.role === "user" ? "mise-well" : "border border-line bg-paper-2"
                  }`}
                >
                  <ChatMarkdown text={m.content} />
                </span>
                <span className="mt-1 block font-mono text-[10px] text-fg-faint">
                  {m.role} ·{" "}
                  {new Date(m.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
          {/* No export / copy-all / print / share control anywhere on this
              page (J3) — do not add one. */}
        </>
      )}
    </div>
  );
}
