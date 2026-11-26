"use client";

// The halls, in the order one walks them (docs/temple/ART.md, S2–S11; the words: WORDS.md D).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AwardLink } from "../AwardLink";
import { elapsed, useData, useDev, useNow, useWord } from "../context";
import { did, hasDone } from "../did";
import { honours } from "../profile";
import { resumeHref } from "../Resume";
import { DOCS } from "../skills";
import { Terminal } from "../Terminal";
import { BRONZE, Couplet, Hall, taNumber, type HallPaint } from "./Hall";
import { Months } from "./Months";
import { COUPLETS, PLACES } from "./lines";
import type { Laid } from "./stone";
import type { World } from "./world";

function Plate({ href, children, onClick, primary, download }: { href?: string; children: ReactNode; onClick?: () => void; primary?: boolean; download?: boolean }) {
  const cls = `kal-btn ${primary ? "kal-btn-1" : ""}`;
  if (!href)
    return (
      <button type="button" className={cls} onClick={onClick}>
        {children}
      </button>
    );
  const out = /^https?:/.test(href);
  return (
    <a className={cls} href={href} onClick={onClick} {...(out ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...(download ? { download: true } : {})}>
      {children}
    </a>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="kal-chips">
      {items.map((s) => (
        <li key={s}>
          {DOCS[s] ? (
            <a className="kal-chip" href={DOCS[s]} target="_blank" rel="noopener noreferrer" title={`${s} — official docs`} onClick={() => did("chips")}>
              {s}
            </a>
          ) : (
            <span className="kal-chip">{s}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── S2 · சங்கிலி ──────────────────────────────────────────────────────────── */

function Ticking() {
  const now = useNow();
  if (!now) return <span>{" "}</span>;
  const p = (n: number) => String(n).padStart(2, "0");
  return <span>{`${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}`}</span>;
}

function Counts() {
  const { CAREER_START } = useData();
  const w = useWord();
  const now = useNow();
  const day = now ? Math.floor(now.getTime() / 86_400_000) : 0;
  const e = useMemo(() => (day ? elapsed(CAREER_START, new Date(day * 86_400_000 + 1)) : null), [day, CAREER_START]);
  return (
    <div className="kal-slab kal-counts" data-stone="bead">
      <div className="kal-three">
        {(
          [
            [e?.years, w("timeYears")],
            [e?.months, w("timeMonths")],
            [e?.days, w("timeDays")],
          ] as const
        ).map(([n, l]) => (
          <p key={l}>
            <b>{n ?? " "}</b>
            <span className="kal-label">{l}</span>
          </p>
        ))}
      </div>
      <p className="kal-years">
        <b>{e?.decimal ?? " "}</b> <span>{w("timeUnit")}</span>
      </p>
      <p className="kal-running">
        <b>
          + <Ticking />
        </b>
        <span className="kal-label">{w("timeCounting")}</span>
      </p>
    </div>
  );
}

function Time() {
  const w = useWord();
  return (
    <Hall id="time" num={2} title={w("timeTitle")} ta={PLACES.time}>
      <Counts />
      <Months />
      <Couplet {...COUPLETS.time} />
    </Hall>
  );
}

/* ── S3 · செப்பேடு ─────────────────────────────────────────────────────────── */

function Resume() {
  const { resume, openResume } = useDev();
  const w = useWord();
  if (!resume) return null;
  const pages = resume.pages.length;
  const [y, m, d] = resume.updated.split("-").map(Number);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return (
    <Hall id="resume" num={3} title={w("resumeTitle")} ta={PLACES.resume}>
      <div className="kal-two">
        <button type="button" className="kal-coppers" onClick={openResume} aria-label={w("resumeView")}>
          {Array.from({ length: Math.max(2, pages) }, (_, i) => (
            <i key={i} style={{ ["--i" as string]: i, ["--n" as string]: Math.max(2, pages) }} data-n={taNumber(i + 1)} />
          ))}
          <em aria-hidden />
        </button>
        <div className="kal-col">
          <div className="kal-slab kal-pad" data-stone="petal">
            <p className="kal-lead">{w("resumeName")}</p>
            <p className="kal-body">{w("resumeLine")}</p>
            <p className="kal-label">
              {pages} {w(pages === 1 ? "resumePage" : "resumePages")} · {w("resumeUpdated")} {y && m && d ? `${d} ${months[m - 1]} ${y}` : resume.updated}
            </p>
            <div className="kal-btns">
              <Plate primary onClick={openResume}>
                {w("resumeView")}
              </Plate>
              <Plate href={resumeHref(resume, resume.pdf, true)} download>
                {w("resumePdf")}
              </Plate>
              {resume.docx && (
                <Plate href={resumeHref(resume, resume.docx, true)} download>
                  {w("resumeWord")}
                </Plate>
              )}
            </div>
          </div>
          <Couplet {...COUPLETS.resume} />
        </div>
      </div>
    </Hall>
  );
}

/* ── S4–S6 · the six skills, two bays to a hall ────────────────────────────── */

const PIC_OF = ["pic_aws", "pic_kolam", "pic_genai", "pic_msg", "pic_devops", "pic_front"];
const FRAME_OF = ["rope", "bead", "petal", "bead", "rope", "petal"];

function Skills() {
  const { CLUSTERS } = useData();
  const pairs: (typeof CLUSTERS)[] = [];
  for (let i = 0; i < CLUSTERS.length; i += 2) pairs.push(CLUSTERS.slice(i, i + 2));
  return (
    <>
      {pairs.map((pair, k) => (
        <Hall key={k} id={`skills${k}`}>
          <div className="kal-bays">
            {pair.map((c, j) => {
              const i = k * 2 + j;
              const place = PLACES.skills[i] ?? "";
              return (
                <section key={c.key} className="kal-bay">
                  <div className="kal-title kal-title-bay" data-stone="band">
                    <span className="kal-num" lang="ta" data-cut aria-hidden>
                      {taNumber(4 + k)}
                    </span>
                    <h2 className="kal-cut-l" data-cut>
                      {c.label}
                    </h2>
                    <span className="kal-ta" lang="ta" data-cut>
                      {place}
                    </span>
                  </div>
                  {COUPLETS.skills[i] && <Couplet {...COUPLETS.skills[i]} />}
                  {PIC_OF[i] && <div className="kal-pic" data-stone={`pic ${PIC_OF[i]}`} aria-hidden />}
                  <div className="kal-slab kal-pad" data-stone={FRAME_OF[i % 6]}>
                    <p className="kal-body">{c.blurb}</p>
                    <Chips items={c.items} />
                  </div>
                </section>
              );
            })}
          </div>
        </Hall>
      ))}
    </>
  );
}

/* ── S7 · கருவூலம் ─────────────────────────────────────────────────────────── */

function Door() {
  const w = useWord();
  const [been, setBeen] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setBeen(hasDone("rank")), 0);
    return () => window.clearTimeout(t);
  }, []);
  const say = w(been ? "eduDoorAfter" : "eduDoor");
  return say ? <p className="kal-small">{say}</p> : null;
}

function Education() {
  const { EDUCATION: e } = useData();
  const w = useWord();
  return (
    <Hall id="edu" num={7} title={w("eduTitle")} ta={PLACES.edu}>
      <AwardLink className="kal-rank" title={e.honour}>
        <span className="kal-lintel" data-stone="bead">
          <span className="kal-cut-m" data-cut>
            {e.honour}
          </span>
        </span>
      </AwardLink>
      <div className="kal-treasury">
        <div className="kal-slab kal-pad" data-stone="bead">
          <p className="kal-lead">{e.degree}</p>
          <p className="kal-body">
            {e.year} · <b className="kal-goldtext">{e.percentage}</b>
          </p>
          <p className="kal-body">
            <a className="kal-a" href={e.schoolUrl} target="_blank" rel="noopener noreferrer">
              {e.school}
            </a>
          </p>
          <p className="kal-small">{e.affiliation}</p>
          <Door />
        </div>
        <AwardLink className="kal-door" title={e.honour}>
          <span data-stone="pic door" aria-hidden>
            <i className="kal-crack" />
          </span>
        </AwardLink>
        <div className="kal-slab kal-pad" data-stone="bead">
          <p className="kal-body">{e.exam}</p>
          <p className="kal-body">
            {w("eduVerify")}{" "}
            <a className="kal-a" href={e.verifyUrl} target="_blank" rel="noopener noreferrer">
              {e.verifyLabel} ↗
            </a>
          </p>
          <p className="kal-small">{e.verifyHint}</p>
          <p className="kal-small">
            <a className="kal-a" href={e.officialUrl} target="_blank" rel="noopener noreferrer">
              {w("eduOfficial")} ↗
            </a>
          </p>
        </div>
      </div>
      <Couplet {...COUPLETS.edu} />
    </Hall>
  );
}

/* ── S8 · பொற்றாமரை ───────────────────────────────────────────────────────── */

function Recognition() {
  const list = honours(useDev().milestones);
  const w = useWord();
  const promotions = list.filter((m) => m.kind === "promotion").length;
  return (
    <Hall id="rec" num={8} title={w("recTitle")} ta={PLACES.rec}>
      <p className="kal-pill kal-label">{w("recPill") || (promotions === 2 ? "PROMOTED TWICE IN TWO YEARS" : `PROMOTED ${promotions} TIMES SINCE 2024`)}</p>
      <ol className="kal-leaves" style={{ ["--n" as string]: list.length }}>
        {list.map((m, i) => (
          <li key={`${m.when}-${m.title}`} className="kal-honour" style={{ ["--i" as string]: i }}>
            <span className="kal-lotus" data-stone="pic lotus" aria-hidden />
            <div className="kal-leaf">
              <p className="kal-leaf-h">{m.when.toUpperCase()}</p>
              <p className="kal-leaf-t">{m.title}</p>
              {m.promoted && (
                <p className="kal-leaf-p">
                  {w("recPromoted")} · {m.promoted}
                </p>
              )}
              <p className="kal-leaf-b">{m.note}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="kal-pond" data-stone="strip pond" aria-hidden />
      <Couplet {...COUPLETS.rec} />
    </Hall>
  );
}

/* ── S9 · துலாக்கோல் ──────────────────────────────────────────────────────── */

/** The balance: the pan one's light is nearer to goes down, heavy and late. */
function useBalance() {
  const [made] = useState(() => {
    let at: { x: number; y: number; s: number } | null = null;
    let beam: Laid | null = null;
    let pans: Laid[] = [];
    let a = 0.16;
    let v = 0;
    const place = () => {
      if (!at || !beam) return;
      const { x, y, s } = at;
      beam.turn = a;
      pans.forEach((p, i) => {
        const sg = i ? 1 : -1;
        p.x = x + (sg * 172 * Math.cos(a) - 66) * s;
        p.y = y + (sg * 172 * Math.sin(a) + 4) * s;
      });
    };
    const pics: HallPaint = (p, w, scene) => {
      const el = scene.el.querySelector<HTMLElement>("[data-balance]");
      if (!el) return;
      const b = el.getBoundingClientRect();
      const r0 = scene.el.getBoundingClientRect();
      const s = b.width / 480;
      at = { x: p.x + b.left - r0.left + b.width / 2, y: p.y + b.top - r0.top + 46 * s, s };
      void Promise.all([w.piece("post"), w.piece("beam"), w.piece("pan")]).then(([post, bm, pan]) => {
        if (!at) return;
        scene.laid.push({ piece: post, x: at.x - 48 * s, y: at.y - 26 * s, s });
        beam = { piece: bm, x: at.x - 190 * s, y: at.y - 30 * s, s, z: 34, metal: BRONZE };
        pans = [0, 1].map(() => ({ piece: pan, x: 0, y: 0, s, z: 36, metal: BRONZE }) as Laid);
        place();
        scene.laid.push(beam, ...pans);
        w.dirty = true;
      });
    };
    const tick = (t: number, dt: number, w: World) => {
      if (!at || !beam || !w.stone) return false;
      const tx = w.stone.torch;
      const near = Math.exp(-(((tx.y - at.y - 90 * at.s) / (190 * at.s)) ** 2)) * (Math.abs(tx.x - at.x) < 330 * at.s ? 1 : 0);
      const want = 0.16 * Math.tanh((tx.x - at.x) / (90 * at.s)) * near + 0.012 * Math.sin(t * 1.25);
      v += ((want - a) * 7 - v * 2.1) * dt;
      a += v * dt;
      place();
      return Math.abs(v) > 0.004;
    };
    return { pics, tick };
  });
  return made;
}

function Project() {
  const weigh = useBalance();
  const { PROJECT: p } = useData();
  const w = useWord();
  return (
    <Hall id="side" num={9} title={w("sideTitle")} ta={PLACES.side} pics={weigh.pics} onTick={weigh.tick}>
      <div className="kal-two">
        <div className="kal-col">
          <Couplet {...COUPLETS.side} />
          <div className="kal-balance" aria-hidden data-balance />
        </div>
        <div className="kal-slab kal-pad" data-stone="plain">
          <div className="kal-project">
            <h3 className="kal-cut-n" data-cut>
              {p.name}
            </h3>
            <a className="kal-a" href={p.site} target="_blank" rel="noopener noreferrer">
              {w("sideSiteLabel")} ↗
            </a>
            <span className="kal-live">
              <i aria-hidden />
              {w("sideLive")}
            </span>
          </div>
          <p className="kal-slogan">“{p.slogan}”</p>
          <p className="kal-body">{p.pitch}</p>
          <p className="kal-body">
            {w("sideInUseWord")}{" "}
            <a className="kal-a" href={p.inUse.href} target="_blank" rel="noopener noreferrer">
              {p.inUse.label} ↗
            </a>
          </p>
          <Chips items={p.stack} />
          <p className="kal-small">{p.honesty}</p>
          <div className="kal-btns">
            <Plate primary href={p.site}>
              {w("sideVisit")}
            </Plate>
            <Plate href={p.code}>{w("sideCode")}</Plate>
          </div>
        </div>
      </div>
    </Hall>
  );
}

/* ── S10 · அகல் | மணல் ────────────────────────────────────────────────────── */

function LiveShell() {
  const { CAREER_START } = useData();
  const { openAlbum, resume, openResume } = useDev();
  const now = useNow();
  const day = now ? Math.floor(now.getTime() / 86_400_000) : 0;
  const exp = useMemo(() => (day ? elapsed(CAREER_START, new Date(day * 86_400_000 + 1)).decimal : "2"), [day, CAREER_START]);
  return <Terminal onAlbum={openAlbum} onResume={resume ? openResume : undefined} experience={exp} />;
}

function Garden() {
  const { VOLUNTEERING } = useData();
  const w = useWord();
  return (
    <Hall id="vol">
      <div className="kal-bays">
        <section className="kal-bay">
          <div className="kal-title kal-title-bay" data-stone="band">
            <span className="kal-num" lang="ta" data-cut aria-hidden>
              {taNumber(10)}
            </span>
            <h2 className="kal-cut-l" data-cut>
              {w("volTitle")}
            </h2>
            <span className="kal-ta" lang="ta" data-cut>
              {PLACES.vol}
            </span>
          </div>
          <Couplet {...COUPLETS.vol} />
          <ul className="kal-leaves kal-leaves-hung">
            {VOLUNTEERING.map((v, i) => (
              <li key={v.org} className="kal-leaf" style={{ ["--i" as string]: i }}>
                <p className="kal-leaf-t">{v.org}</p>
                {v.what && <p className="kal-leaf-b">{v.what}</p>}
              </li>
            ))}
          </ul>
        </section>
        <section className="kal-bay">
          <div className="kal-title kal-title-bay" data-stone="band">
            <span className="kal-num" lang="ta" data-cut aria-hidden />
            <h2 className="kal-cut-l" data-cut>
              {w("shellTitle")}
            </h2>
            <span className="kal-ta" lang="ta" data-cut>
              {PLACES.shell}
            </span>
          </div>
          <Couplet {...COUPLETS.shell} />
          <div className="kal-sand">
            <LiveShell />
          </div>
        </section>
      </div>
    </Hall>
  );
}

/* ── S11 · கேணி ───────────────────────────────────────────────────────────── */

function Days() {
  const { CAREER_START } = useData();
  const w = useWord();
  const now = useNow();
  const day = now ? elapsed(CAREER_START, now).dayNumber : null;
  return (
    <p className="kal-label">{day ? `${w("finaleDay").replace("{n}", day.toLocaleString("en-US"))} · ${w("finaleCounting")}` : " "}</p>
  );
}

function Well() {
  const { LINKS, PROJECT } = useData();
  const { resume, openResume } = useDev();
  const w = useWord();
  return (
    <Hall id="well" className="kal-well">
      <div className="kal-center">
        <p className="kal-label">{w("finaleLabel")}</p>
        <h2 className="kal-cut-xl" data-cut>
          <span>{w("slogan1")}</span>
          <br />
          <span>{w("slogan2")}</span>
        </h2>
      </div>
      <div className="kal-two">
        <div className="kal-slab kal-pad" data-stone="plain">
          <p className="kal-lead">{w("statement")}</p>
          <p className="kal-small">{w("finaleNote")}</p>
          <Days />
        </div>
        <div className="kal-col">
          <div className="kal-boulder" data-stone="pic boulder">
            <span lang="ta" data-cut>
              கல்
            </span>
          </div>
          <div className="kal-btns kal-btns-mid">
            <Plate primary href={LINKS.email}>
              {w("finaleHello")}
            </Plate>
            <Plate href={LINKS.linkedin}>{w("finaleLinkedin")}</Plate>
            {resume && <Plate onClick={openResume}>{w("finaleResume")}</Plate>}
            <Plate href={PROJECT.site}>{w("finaleProject")}</Plate>
          </div>
        </div>
      </div>
      <Couplet {...COUPLETS.well} />
      <div className="kal-steps" data-stone="strip steps" aria-hidden />
      <p className="kal-foot kal-small">
        © {new Date().getFullYear()} {w("footName")} · {w("footPlace")}
        <br />
        {w("footMade")}
      </p>
    </Hall>
  );
}

export function Halls() {
  return (
    <>
      <Time />
      <Resume />
      <Skills />
      <Education />
      <Recognition />
      <Project />
      <Garden />
      <Well />
    </>
  );
}
