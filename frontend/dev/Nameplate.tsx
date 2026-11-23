"use client";

// His name's area: HELLO I'M · his name · his role and company · where he is
// and the time. Classic is how the site began and what it is by default; the
// others (plates.ts) are chosen behind the PS door and loaded only when chosen.

import dynamic from "next/dynamic";
import { arrive } from "./chunks";
import { chennaiTime, useDev, useNow } from "./context";
import { nameLook, word } from "./copy";
import { DecryptText } from "./DecryptText";
import { Wave } from "./flourish";

// (Should its code not come, the classic stands in.)
const PlateDesign = dynamic(() => arrive(() => import("./PlateDesigns").then((m) => m.PlateDesign), PlainPlate));

// `backwards`: held at its first frame while it waits, nothing kept after —
// a `both` fill kept these blocks as GPU layers for the life of the page.
export const plateFade = (entered: boolean, delay: number) =>
  entered ? { animation: `devFadeUp .8s ${delay}s ease-out backwards` } : { opacity: 0 };

/** His name, set like a nameplate.
 *
 *  "my name and company looks raw… there we already have one unique thing
 *   like if I place cursor word will fastly scramble… also color and font"
 *
 *  The scramble stays (hover the name). Around it: a greeting, the name in
 *  the display serif with a slow metallic light crossing it, a line drawing
 *  itself under it in the theme's colours, the role and company as one
 *  confident line, and the time in Chennai, live. */
function Classic({ entered }: { entered: boolean }) {
  const now = useNow();
  // His words and his name's look (the Template).
  const { copy } = useDev();
  const name = word(copy, "name");
  const look = nameLook(copy.style);
  return (
    <>
      <p className="font-mono text-[11px] tracking-[0.34em] text-[var(--d-a)]" style={plateFade(entered, 0.05)}>
        {word(copy, "hello")}
      </p>
      <h1 data-noswell className={`mt-2 ${look.fontClass} text-[clamp(2.4rem,6vw,3.9rem)] font-semibold leading-[1.02] tracking-tight`} style={plateFade(entered, 0.1)}>
        {entered ? (
          <DecryptText key={name} text={name} delay={420} replayOnHover textClassName={look.colorClass} textStyle={look.colorStyle} />
        ) : (
          <span className={look.colorClass} style={look.colorStyle}>
            {name}
          </span>
        )}
      </h1>
      <span
        aria-hidden
        className="mx-auto mt-3 block h-[2px] origin-left rounded-full lg:mx-0"
        style={{
          width: "min(320px, 70%)",
          background: "linear-gradient(90deg, var(--d-a), var(--d-gold), var(--d-b), transparent)",
          transform: entered ? "scaleX(1)" : "scaleX(0)",
          transition: "transform 1.4s cubic-bezier(.2,.8,.2,1) .6s",
        }}
      />
      <p
        className="mt-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[15px] lg:justify-start"
        style={plateFade(entered, 0.2)}
      >
        <Wave text={word(copy, "role")} className="font-semibold text-[var(--d-ink)]" />
        <span className="text-[var(--d-ink6)]">{word(copy, "at")}</span>
        <Wave text={word(copy, "company")} className="font-semibold" style={{ color: "var(--d-a2)" }} />
      </p>
      <p
        className="mt-2 flex flex-wrap items-center justify-center gap-x-3 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)] lg:justify-start"
        style={plateFade(entered, 0.28)}
      >
        <span>{word(copy, "place")}</span>
        <span aria-hidden className="text-[var(--d-ink7)]">·</span>
        <span className="tabular-nums text-[var(--d-ink4)]">{now ? `${chennaiTime(now)} IST` : " "}</span>
      </p>
    </>
  );
}

function PlainPlate({ entered }: { plate: string; entered: boolean }) {
  return <Classic entered={entered} />;
}

/** `preview`: inside the owner panel, as a live sample. */
export function Nameplate({ entered, preview = false }: { entered: boolean; preview?: boolean }) {
  const { copy } = useDev();
  const plate = copy.style.plate;
  return (
    // data-hero-name: the top bar shows his name only while this is off screen
    // (one lasting element: the design inside it can change). data-noswell: the
    // designs have their own effects (Classic: its name only).
    <div data-hero-name={preview ? undefined : ""} data-noswell={plate === "classic" ? undefined : ""} data-plate={plate} className="w-full text-center lg:text-left">
      {plate === "classic" ? <Classic entered={entered} /> : <PlateDesign key={plate} plate={plate} entered={entered} />}
    </div>
  );
}
