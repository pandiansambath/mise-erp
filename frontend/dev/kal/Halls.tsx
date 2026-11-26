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
import { BRONZE, Couplet, Hall, taNumber, type HallPaint, type HallScene } from "./Hall";
import { Lamps } from "./lamps";
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

/** The tank: four lamps afloat, chained by their wakes; two fish that come to a hand that is still. */
function useTank() {
  const [made] = useState(() => {
    let box: { x: number; y: number; w: number; h: number } | null = null;
    const boats = [0, 1, 2, 3].map(() => new Lamps(1));
    const fish = new Float32Array(8);
    const f = [
      { x: 0, y: 0, a: 0, v: 0, ph: 0.1 },
      { x: 0, y: 0, a: Math.PI, v: 0, ph: 0.6 },
    ];
    let lit = -1;
    let stillFor = 0;
    let lx = 0;
    let ly = 0;
    let dawn = 0;
    const pics: HallPaint = (p, w, scene) => {
      const el = scene.el.querySelector<HTMLElement>("[data-water]");
      if (!el || !w.stone) return;
      const b = el.getBoundingClientRect();
      const r0 = scene.el.getBoundingClientRect();
      box = { x: p.x + b.left - r0.left, y: p.y + b.top - r0.top, w: b.width, h: b.height };
      f.forEach((q, i) => {
        q.x = box!.x + box!.w * (0.3 + 0.4 * i);
        q.y = box!.y + box!.h * 0.62;
      });
      scene.rows = [scene.lamps.row, ...boats.map((l) => l.row)];
    };
    const tick = (t: number, dt: number, w: World, scene: HallScene) => {
      const st = w.stone;
      if (!box || !st) return false;
      const B = box;
      // The lamps, set afloat as the hall wakes, drifting.
      if (scene.awake >= 0 && lit < 0) {
        lit = t;
        boats.forEach((l, i) => l.wake(t + 0.6 + i * 0.14, 0));
      }
      boats.forEach((l, i) => {
        const x = B.x + B.w * (0.2 + 0.2 * i) + 40 * Math.sin(t * 0.13 + i * 1.7);
        const y = B.y + B.h * (0.3 + 0.08 * Math.sin(i * 2.1)) + 3 * Math.sin(t * 0.9 + i);
        l.place(x, y, 1, 22);
        l.tick(t, -1e5, -1e5);
      });
      if (lit >= 0) dawn = Math.min(1, dawn + dt * 0.03);
      // The fish: they wander; a light held still over the water, and they come to it.
      const tx = st.torch.x;
      const ty = st.torch.y;
      const over = tx > B.x && tx < B.x + B.w && ty > B.y && ty < B.y + B.h;
      stillFor = over && Math.hypot(tx - lx, ty - ly) < 3 ? stillFor + dt : 0;
      lx = tx;
      ly = ty;
      f.forEach((q, i) => {
        let gx = B.x + B.w * (0.5 + 0.38 * Math.sin(t * 0.11 + i * 2.6));
        let gy = B.y + B.h * (0.6 + 0.28 * Math.sin(t * 0.17 + i * 1.3));
        if (stillFor > 1.6) {
          // …and circle it, side by side.
          const a = t * 0.9 + i * Math.PI;
          gx = tx + Math.cos(a) * 46;
          gy = ty + Math.sin(a) * 22;
        }
        const want = Math.atan2(gy - q.y, gx - q.x);
        let da = want - q.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        q.a += da * Math.min(1, dt * 1.6);
        const far = Math.hypot(gx - q.x, gy - q.y);
        q.v += ((far > 30 ? 46 : 18) - q.v) * Math.min(1, dt * 1.2);
        q.x += Math.cos(q.a) * q.v * dt;
        q.y += Math.sin(q.a) * q.v * dt;
        q.x = Math.min(B.x + B.w - 30, Math.max(B.x + 30, q.x));
        q.y = Math.min(B.y + B.h - 14, Math.max(B.y + 24, q.y));
        q.ph += dt * (0.4 + q.v / 60);
        fish.set([q.x, q.y, q.a + Math.PI, q.ph], i * 4);
      });
      st.water = { ...B, fish, dawn, still: Math.min(1, stillFor / 1.6) };
      return true;
    };
    return { pics, tick };
  });
  return made;
}

function Well() {
  const tank = useTank();
  const { LINKS, PROJECT } = useData();
  const { resume, openResume } = useDev();
  const w = useWord();
  return (
    <Hall id="well" className="kal-well" pics={tank.pics} onTick={tank.tick}>
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
      <div className="kal-water" data-water aria-hidden />
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
