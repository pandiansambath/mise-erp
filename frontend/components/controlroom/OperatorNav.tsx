"use client";

// The rail. One list, two shapes: a sticky vertical rail from `lg:` up, a
// horizontal scrolling strip below it — same links, same active logic, so
// there is exactly one place "which route am I on" can go wrong.
//
// D1-D5 of the acceptance rubric are entirely about this component: an
// active item must be a filled `mise-btn-key` pill on every route, including
// the two-level case (Hotels rail item + a hotel's own sub-tab, which lives
// in hotels/[hotelId]/layout.tsx, not here), and at 390px every destination
// must be reachable with a fade telling you there is more to scroll to.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { CR_NAV, isActive } from "./nav";
import { useFleet } from "./FleetProvider";

export function OperatorNav() {
  const rawPathname = usePathname();
  // On controlroom.dineai.cloud, middleware.ts rewrites "/" to "/control-room"
  // server-side, but a rewrite (unlike a redirect) never touches the browser's
  // address bar — so the client router's usePathname() keeps reporting "/",
  // and isActive() (which matches on "/control-room" prefixes) lit up nothing
  // at all on the operator's actual bookmark.
  const pathname = rawPathname === "/" ? "/control-room" : rawPathname;
  const { hotels } = useFleet();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Arriving on a route whose nav chip is scrolled off-screen at 390px used to
  // land you looking at "Overview" with no idea Operators was even selected.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav
      aria-label="Control Room"
      className="mise-well mise-noscrollbar relative flex w-full shrink-0 gap-1 overflow-x-auto rounded-2xl p-1.5 lg:sticky lg:top-[73px] lg:h-fit lg:w-52 lg:flex-col lg:overflow-visible"
    >
      {CR_NAV.map((item) => {
        const on = isActive(pathname, item);
        const count = item.href === "/control-room/fleet" ? hotels.length : undefined;
        return (
          <Link
            key={item.href}
            href={item.href}
            ref={on ? activeRef : undefined}
            aria-current={on ? "page" : undefined}
            className={`mise-press flex shrink-0 items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition lg:w-full ${
              on ? "mise-btn-key" : "text-fg-soft hover:bg-glass/[0.06] hover:text-brand-300"
            }`}
          >
            <span className="whitespace-nowrap">{item.label}</span>
            {count !== undefined && count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  on ? "bg-white/20 text-white" : "bg-glass/10 text-fg-faint"
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
      {/* Right-edge fade — the only tell at 390px that Operators is one swipe
          further along, rather than the row simply ending at Plans. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-2xl bg-gradient-to-l from-paper-2 to-transparent lg:hidden"
      />
    </nav>
  );
}
