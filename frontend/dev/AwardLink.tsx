"use client";

// Any way into the award room: what it needs is fetched (and on a desktop the room
// itself built) as it comes near, and a click goes through the doors (awardDoor).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { coolAward, enterAward, warmAward } from "./awardDoor";
import { did } from "./did";

export function AwardLink({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  const el = useRef<HTMLAnchorElement>(null);
  const router = useRouter();
  useEffect(() => {
    const a = el.current;
    if (!a) return;
    // Within a screen or so of it: get ready. Far from it for a while: let go.
    let cool = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        window.clearTimeout(cool);
        if (e.isIntersecting) warmAward();
        else cool = window.setTimeout(coolAward, 25000);
      },
      { rootMargin: "110% 0px" },
    );
    io.observe(a);
    return () => {
      window.clearTimeout(cool);
      io.disconnect();
    };
  }, []);
  return (
    <Link
      ref={el}
      href="/award"
      title={title}
      className={className}
      onMouseEnter={warmAward}
      onFocus={warmAward}
      onTouchStart={warmAward}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        did("rank");
        enterAward(() => router.push("/award"));
      }}
    >
      {children}
    </Link>
  );
}
