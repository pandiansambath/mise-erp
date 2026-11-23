"use client";

// If anything in the award room fails, the room's own page stands here — the
// medal and the way out — never the framework's white "This page couldn't
// load" (§103.1: that is what his phone showed, mid-deploy). When the cause is
// code that is no longer there, the page comes afresh by itself, once.

import Link from "next/link";
import { useEffect } from "react";
import { freshPage, isMissingCode } from "@/dev/chunks";
import { Medal } from "@/dev/Medal";

export default function AwardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isMissingCode(error)) freshPage();
  }, [error]);
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#07060a] text-[#e6edf5]">
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(60% 46% at 50% 46%, rgba(180,110,30,.34), transparent 70%)" }} />
      <Medal />
      <div className="absolute inset-x-0 bottom-0 px-6 pb-10 text-center">
        <p className="text-[15px] text-[#d9b98a]">17th in the University · Gold Medalist</p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" onClick={() => reset()} className="rounded-full border border-[#c08a4e]/50 px-5 py-2.5 text-[13px] text-[#f0d5a8] transition hover:bg-[#c08a4e]/15">
            Open the room again
          </button>
          <Link href="/" prefetch={false} className="rounded-full border border-white/15 px-5 py-2.5 text-[13px] text-[#c3d3e4] transition hover:bg-white/5">
            Back
          </Link>
        </div>
      </div>
    </main>
  );
}
