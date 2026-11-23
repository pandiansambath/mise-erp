"use client";

// If the profile fails as a whole: his own dark page, not the framework's white
// one, and (when the cause is code that is no longer there, after a deploy) the
// page comes afresh by itself, once (§103.1).

import { useEffect } from "react";
import { freshPage, isMissingCode } from "@/dev/chunks";

export default function DevError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isMissingCode(error)) freshPage();
  }, [error]);
  return (
    <main className="fixed inset-0 grid place-items-center bg-[#070a0f] px-6 text-center text-[#e6edf5]">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl text-xl font-semibold text-[#071016]" style={{ background: "linear-gradient(135deg,#f0a064,#2dd4bf)" }}>
          PS
        </span>
        <p className="mt-6 text-[17px]">Pandian Sambath</p>
        <p className="mt-1 text-[13px] text-[#7d93ad]">The page stumbled on its way here.</p>
        <button
          type="button"
          onClick={() => {
            if (!freshPage()) reset();
          }}
          className="mt-6 rounded-full border border-white/20 px-6 py-2.5 text-[13px] transition hover:bg-white/5"
        >
          Bring it back
        </button>
      </div>
    </main>
  );
}
