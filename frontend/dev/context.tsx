"use client";

// What every design on pandi-dev shares.
//
// Five designs render the same person: the clock, the photos, the résumé, the
// milestones he edits, the doors to the album and the résumé viewer, and the
// editor's unlocked state all live in the shell (DevProfile) and reach each
// design through this context, so a design is only ever a way of SHOWING him,
// never a second copy of the facts.

import { createContext, useContext } from "react";
import type { Photo } from "./Album";
import type { Milestone } from "./profile";
import type { ResumeManifest } from "./Resume";
import type { DesignId } from "./theme";

export type DevState = {
  /** Null on the server and for the first client render (no clock yet). */
  now: Date | null;
  /** The intro screen has been passed. */
  entered: boolean;
  photos: Photo[];
  resume: ResumeManifest | null;
  milestones: Milestone[];
  openAlbum: () => void;
  openResume: () => void;
  /** His editing: unlocked once per visit with the password, checked on the server. */
  unlocked: boolean;
  requestUnlock: () => Promise<boolean>;
  saveMilestones: (list: Milestone[]) => Promise<boolean>;
  themeId: string;
  designId: DesignId;
  setTheme: (id: string, from?: { x: number; y: number }) => void;
  setDesign: (id: DesignId, from?: { x: number; y: number }) => void;
  siteDefault: { theme: string; design: DesignId };
  saveDefault: () => Promise<boolean>;
  toast: (message: string) => void;
  /** The hidden door to his uploads (photos, songs, volume). */
  openOwner: () => void;
  /** Send an owner request with the unlocked password; null on failure. */
  ownerFetch: (path: string, init: { method: string; json?: object; form?: FormData }) => Promise<Response | null>;
};

export const DevContext = createContext<DevState | null>(null);

export function useDev(): DevState {
  const ctx = useContext(DevContext);
  if (!ctx) throw new Error("useDev outside the pandi-dev shell");
  return ctx;
}

/** First day as a System Engineer. Every time-based number derives from it. */
export const CAREER_START = new Date("2024-01-01T00:00:00Z");

export const EMAIL = "pandian.s.sambath@gmail.com";

export const LINKS = {
  linkedin: "https://www.linkedin.com/in/pandiansambath",
  github: "https://github.com/pandiansambath",
  instagram: "https://instagram.com/pandian.sambath",
  email: `mailto:${EMAIL}`,
};

/** Years, months and days since `from`, by the calendar, plus decimal years. */
export function elapsed(from: Date, now: Date) {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  let months = now.getUTCMonth() - from.getUTCMonth();
  let days = now.getUTCDate() - from.getUTCDate();
  if (days < 0) {
    months -= 1;
    // Days in the month that just ended — borrowing 30 would drift.
    days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return {
    years,
    months,
    days,
    hours: now.getUTCHours(),
    minutes: now.getUTCMinutes(),
    seconds: now.getUTCSeconds(),
    decimal: ((now.getTime() - from.getTime()) / 31_557_600_000).toFixed(1),
    /** Day 1 was the first day. */
    dayNumber: Math.floor((now.getTime() - from.getTime()) / 86_400_000) + 1,
  };
}

/** The time in Chennai, e.g. "5:32 PM", whatever the visitor's own zone. */
export function chennaiTime(now: Date): string {
  return now.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}
