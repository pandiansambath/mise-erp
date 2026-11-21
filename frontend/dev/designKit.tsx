"use client";

// Pieces the four newer designs share, so each one tells the same true story
// in its own visual language.

import { CAREER_START, useDev } from "./context";
import { KIND_META, monthIndex, PROJECT, type Milestone, type MilestoneKind } from "./profile";
import { resumeHref } from "./Resume";
import { EDUCATION } from "./skills";

export const PORTRAITS = ["/api/dev-site/profile.webp", "/api/dev-site/profile-alt.webp"];

export type Station = {
  when: string;
  title: string;
  note: string;
  kind: MilestoneKind | "education" | "project" | "now";
  promoted?: string;
};

/** His life as stations, oldest first: study, the rank, every milestone he
 *  keeps on the chain, his own product, and today. */
export function stations(milestones: Milestone[], now: Date | null): Station[] {
  const list: Station[] = [
    { when: "2019", title: "B.Tech, Information Technology", note: `${EDUCATION.school}, ${EDUCATION.affiliation.replace("Affiliated to ", "")}.`, kind: "education" },
    { when: "May 2023", title: "Gold Medalist · 17th University Rank", note: `Graduated with ${EDUCATION.percentage}, ranked 17th across Anna University.`, kind: "education" },
    ...milestones.map((m) => ({ when: m.when, title: m.title, note: m.note, kind: m.kind, promoted: m.promoted })),
    { when: PROJECT.since, title: `Started ${PROJECT.name}`, note: `${PROJECT.slogan} A live product for UK restaurants, built with AI-assisted development.`, kind: "project" },
  ];
  const key = (w: string) => (/^\d{4}$/.test(w) ? Number(w) * 12 : monthIndex(w));
  list.sort((a, b) => key(a.when) - key(b.when));
  if (now) {
    const day = Math.floor((now.getTime() - CAREER_START.getTime()) / 86_400_000) + 1;
    list.push({ when: "Today", title: "Still building", note: `Day ${day.toLocaleString("en-US")} in the chain.`, kind: "now" });
  }
  return list;
}

export function kindGlyph(k: Station["kind"]) {
  if (k === "education") return "◎";
  if (k === "project") return "◆";
  if (k === "now") return "●";
  return KIND_META[k].glyph;
}

export function kindRole(k: Station["kind"]) {
  if (k === "education") return "c";
  if (k === "project") return "b";
  if (k === "now") return "a";
  return KIND_META[k].role;
}

/** View / PDF / Word, styled by the caller's design. */
export function ResumeActions({ className = "", button = "" }: { className?: string; button?: string }) {
  const { resume, openResume } = useDev();
  if (!resume) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <button type="button" onClick={openResume} className={button}>
        View résumé
      </button>
      <a href={resumeHref(resume, resume.pdf, true)} download className={button}>
        ↓ PDF
      </a>
      <a href={resumeHref(resume, resume.docx, true)} download className={button}>
        ↓ Word
      </a>
    </div>
  );
}
