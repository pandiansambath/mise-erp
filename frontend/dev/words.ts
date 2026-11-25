// The facts in his words (§103.7): "we have 9 cards: the cards' data and headings
// also need to be customisable, each and every word if needed".
//
// What the designs show — his project, his studies, his skills, his volunteering,
// when it all began, where to reach him — is written once (profile.ts, skills.ts);
// what he has changed in the Template (copy.ts, texts.json) is laid over it here.
// Plain module: no React.

import { safeLink, VOL_MAX, word, type Copy } from "./copy";
import { CAREER_START as START, EMAIL as MAIL, LINKS as LINKS0, PROJECT as PROJECT0 } from "./profile";
import { CLUSTERS as CLUSTERS0, EDUCATION as EDUCATION0, type Cluster } from "./skills";

export type SiteData = {
  PROJECT: typeof PROJECT0;
  EDUCATION: typeof EDUCATION0;
  VOLUNTEERING: { org: string; what: string }[];
  CLUSTERS: Cluster[];
  CAREER_START: Date;
  EMAIL: string;
  LINKS: typeof LINKS0;
};

/** "a, b, c" as a list. */
export const listOf = (s: string): string[] => [...new Set(s.split(",").map((x) => x.replace(/\s+$/g, "").replace(/^\s+/g, "")).filter(Boolean))];

const seen = new WeakMap<Copy, SiteData>();

export function dataOf(copy: Copy): SiteData {
  const had = seen.get(copy);
  if (had) return had;
  const w = (k: string) => word(copy, k);
  const link = (k: string, or: string) => safeLink(w(k)) ?? or;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(w("careerStart").trim()) ? new Date(`${w("careerStart").trim()}T00:00:00Z`) : START;
  const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(w("email").trim()) ? w("email").trim() : MAIL;
  const data: SiteData = {
    PROJECT: {
      ...PROJECT0,
      name: w("sideName"),
      slogan: w("sideSlogan"),
      pitch: w("sidePitch"),
      inUse: { label: w("sideInUse"), href: link("sideInUseLink", PROJECT0.inUse.href) },
      site: link("sideSite", PROJECT0.site),
      since: w("sideSince"),
      code: link("sideCodeLink", PROJECT0.code),
      stack: listOf(w("sideStack")),
      honesty: w("sideHonesty"),
    },
    EDUCATION: {
      ...EDUCATION0,
      degree: w("eduDegree"),
      school: w("eduSchool"),
      affiliation: w("eduAffiliation"),
      year: w("eduYear"),
      honour: w("eduHonour"),
      percentage: w("eduPercent"),
      exam: w("eduExam"),
      verifyUrl: link("eduVerifyLink", EDUCATION0.verifyUrl),
      verifyLabel: w("eduVerifyLabel"),
      verifyHint: w("eduHint"),
      officialUrl: link("eduOfficialLink", EDUCATION0.officialUrl),
      schoolUrl: link("eduSchoolLink", EDUCATION0.schoolUrl),
    },
    VOLUNTEERING: Array.from({ length: VOL_MAX }, (_, i) => ({ org: w(`vol${i + 1}Org`), what: w(`vol${i + 1}What`) })).filter((v) => v.org),
    CLUSTERS: CLUSTERS0.map((c) => ({ ...c, head: w(`skill.${c.key}.head`), label: w(`skill.${c.key}.label`), blurb: w(`skill.${c.key}.blurb`), items: listOf(w(`skill.${c.key}.items`)) })),
    CAREER_START: Number.isNaN(day.getTime()) || day.getTime() > Date.now() ? START : day,
    EMAIL,
    LINKS: { ...LINKS0, linkedin: link("linkLinkedin", LINKS0.linkedin), github: link("linkGithub", LINKS0.github), instagram: link("linkInstagram", LINKS0.instagram), email: `mailto:${EMAIL}` },
  };
  seen.set(copy, data);
  return data;
}
