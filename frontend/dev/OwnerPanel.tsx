"use client";

// His owner panel, behind a hidden door and his password.
//
//   "i can upload any photos to this site… have an upload option somewhere
//    hidden… also i can upload any music… change the order of the song… whether
//    to use this song only in album or in landing page too or in both… music
//    volume control option also needed"
//   "so many things we made customisable using the password… so why can't
//    résumé updation… if I need, I can replace it with an updated résumé"
//   "the centre photo of me… I need full customisation, like I can change
//    photo, add photos, edit time interval"
//
// The door: tap the "PS" monogram three times quickly. Nothing on the page
// says it exists. Every action is checked on the server with the password.

import { useEffect, useRef, useState } from "react";
import type { Photo } from "./Album";
import { useDev } from "./context";
import type { MusicManifest, Track } from "./music";
import { Popup, type Origin } from "./Popup";
import type { ResumeManifest } from "./Resume";
import type { PortraitSet } from "./portraits";
import { PORTRAIT_LOOKS, isPortraitLook, type PortraitLook } from "./portraits";
import { CorePreview } from "./PortraitCore";
import { DesignPreview } from "./PortraitDesign";
import { DESIGNS, findTheme } from "./theme";
import { COPY_DEFAULTS, COPY_GROUPS, EMPTY_COPY, MAX_SKILLS, NAME_COLORS, NAME_FONTS, cleanCopy, nameLook, word, type Copy } from "./copy";
import { Nameplate } from "./Nameplate";
import { PLATES } from "./plates";
import { ALL_SKILLS, DEFAULT_ORBIT, ORBIT_MAX_LEN, canonSkill, hueOf, type OrbitSkill } from "./skills";

type PortraitFile = { id: string; file: string };
/** "/api/dev-site/portrait/pt-1a2b3c.webp" ⇄ {id: "pt-1a2b3c", file: "portrait/pt-1a2b3c.webp"} */
const toFile = (url: string): PortraitFile => {
  const file = url.replace(/^\/api\/dev-site\//, "");
  return { id: file.replace(/^portrait\//, "").replace(/\.webp$/, ""), file };
};
type PortraitJSON = { photos: PortraitFile[]; interval: number; look?: string };
const toSet = (m: PortraitJSON): PortraitSet => ({
  photos: m.photos.map((p) => `/api/dev-site/${p.file}`),
  interval: m.interval,
  look: isPortraitLook(m.look) ? m.look : "natural",
});

const SCOPES: { id: Track["scope"]; label: string }[] = [
  { id: "both", label: "Everywhere" },
  { id: "landing", label: "On the site" },
  { id: "album", label: "In the album" },
];

const BTN =
  "rounded-xl border border-[var(--d-line2)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--d-ink2)] transition enabled:hover:border-[var(--d-b)] enabled:hover:text-[var(--d-ink)] disabled:opacity-40";
const PRIMARY =
  "rounded-xl px-4 py-2 text-[13px] font-semibold text-[var(--d-on)] transition enabled:hover:brightness-110 disabled:opacity-45";
const FIELD =
  "rounded-lg border border-[var(--d-line2)] bg-[var(--d-shade)] px-2.5 py-1.5 text-[13px] text-[var(--d-ink)] outline-none focus:border-[var(--d-b)]";

export function OwnerPanel({
  origin,
  album,
  music,
  resume,
  portraits,
  onAlbum,
  onMusic,
  onResume,
  onPortraits,
  onClose,
}: {
  origin: Origin;
  album: Photo[];
  music: MusicManifest;
  resume: ResumeManifest | null;
  portraits: PortraitSet;
  onAlbum: (a: Photo[]) => void;
  onMusic: (m: MusicManifest) => void;
  onResume: (r: ResumeManifest) => void;
  onPortraits: (p: PortraitSet) => void;
  onClose: () => void;
}) {
  const { ownerFetch, toast, setPortraitLook, portraitLook, themeId, designId, siteDefault, saveDefault, copy, setCopy } = useDev();
  const [tab, setTab] = useState<"photos" | "portrait" | "template" | "music" | "sound" | "résumé" | "site">("photos");
  // The Template: his words, live on the page behind as he types; `savedCopy`
  // is what visitors see until he saves.
  const [savedCopy, setSavedCopy] = useState<Copy>(copy);
  const copyDirty = JSON.stringify(copy) !== JSON.stringify(savedCopy);
  // Closed without saving: the page shows the saved words again.
  const savedRef = useRef(savedCopy);
  useEffect(() => {
    savedRef.current = savedCopy;
  }, [savedCopy]);
  useEffect(() => () => setCopy(savedRef.current), [setCopy]);
  const setWord = (key: string, v: string) => {
    const texts = { ...copy.texts };
    if (v === "" || v === COPY_DEFAULTS[key]) delete texts[key];
    else texts[key] = v;
    setCopy({ ...copy, texts });
  };
  const saveCopy = async (next: Copy, msg: string) => {
    setBusy(true);
    const r = await ownerFetch("texts", { method: "PUT", json: { texts: next.texts, style: next.style, ...(next.skills ? { skills: next.skills } : {}) } });
    setBusy(false);
    if (r?.ok) {
      const saved = cleanCopy(((await r.json()) as { texts: unknown }).texts);
      setCopy(saved);
      setSavedCopy(saved);
      toast(msg);
    } else await fail(r, "Save");
  };
  const [savingSite, setSavingSite] = useState(false);
  // The portrait: his order and pace, as a draft until he saves.
  const [pDraft, setPDraft] = useState<string[]>(portraits.photos);
  const [pSeconds, setPSeconds] = useState<number>(portraits.interval);
  const [pLook, setPLook] = useState<PortraitLook>(portraits.look);
  const portraitInput = useRef<HTMLInputElement>(null);
  const pDirty = JSON.stringify(pDraft) !== JSON.stringify(portraits.photos) || pSeconds !== portraits.interval || pLook !== portraits.look;
  const [cv, setCv] = useState<{ pdf: File | null; docx: File | null }>({ pdf: null, docx: null });
  // Bumped after an upload so the two file pickers start empty again.
  const [cvKey, setCvKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Track[]>(music.tracks);
  const [volume, setVolume] = useState(music.volume);
  const [song, setSong] = useState<{ file: File | null; title: string; scope: Track["scope"] }>({ file: null, title: "", scope: "both" });
  const photoInput = useRef<HTMLInputElement>(null);
  // The pickers are hidden inputs opened by a button — the way the Photos
  // button always worked; the bare "Choose File" boxes did not open (22 Nov).
  const songInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const docxInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(music.tracks) || volume !== music.volume;

  const fail = async (r: Response | null, what: string) => {
    let detail = "";
    try {
      detail = r ? ((await r.json()) as { detail?: string }).detail ?? "" : "";
    } catch {
      /* keep it short */
    }
    toast(r?.status === 401 ? "Locked — unlock again." : `${what} failed${detail ? `: ${detail}` : "."}`);
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const form = new FormData();
    Array.from(files).slice(0, 20).forEach((f) => form.append("files", f));
    const r = await ownerFetch("photos", { method: "POST", form });
    setBusy(false);
    if (r?.ok) {
      const j = (await r.json()) as { album: Photo[]; added: Photo[] };
      onAlbum(j.album);
      toast(`Added ${j.added.length} photo${j.added.length === 1 ? "" : "s"} to the album`);
    } else await fail(r, "Upload");
    if (photoInput.current) photoInput.current.value = "";
  };

  const removePhoto = async (id: string) => {
    setBusy(true);
    const r = await ownerFetch("photos/remove", { method: "POST", json: { id } });
    setBusy(false);
    if (r?.ok) {
      onAlbum(((await r.json()) as { album: Photo[] }).album);
      toast("Removed from the album");
    } else await fail(r, "Remove");
  };

  const uploadSong = async () => {
    if (!song.file || !song.title.trim()) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", song.file);
    form.append("title", song.title.trim());
    form.append("scope", song.scope);
    const r = await ownerFetch("music", { method: "POST", form });
    setBusy(false);
    if (r?.ok) {
      const m = ((await r.json()) as { music: MusicManifest }).music;
      onMusic(m);
      setDraft(m.tracks);
      setSong({ file: null, title: "", scope: "both" });
      toast("Song added");
    } else await fail(r, "Upload");
  };

  const saveMusic = async () => {
    setBusy(true);
    const r = await ownerFetch("music", { method: "PUT", json: { tracks: draft, volume } });
    setBusy(false);
    if (r?.ok) {
      onMusic(((await r.json()) as { music: MusicManifest }).music);
      toast("Music saved");
    } else await fail(r, "Save");
  };

  const uploadResume = async () => {
    if (!cv.pdf) return;
    setBusy(true);
    const form = new FormData();
    form.append("pdf", cv.pdf);
    if (cv.docx) form.append("docx", cv.docx);
    const r = await ownerFetch("resume", { method: "POST", form });
    setBusy(false);
    if (r?.ok) {
      onResume(((await r.json()) as { resume: ResumeManifest }).resume);
      setCv({ pdf: null, docx: null });
      setCvKey((k) => k + 1);
      toast("Résumé replaced — the site shows the new one now");
    } else await fail(r, "Upload");
  };

  const uploadPortrait = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const form = new FormData();
    Array.from(files).slice(0, 10).forEach((f) => form.append("files", f));
    const r = await ownerFetch("portrait", { method: "POST", form });
    setBusy(false);
    if (r?.ok) {
      const set = toSet(((await r.json()) as { portrait: PortraitJSON }).portrait);
      onPortraits(set);
      setPDraft(set.photos);
      setPSeconds(set.interval);
      setPLook(set.look);
      toast(`Added ${files.length} photo${files.length === 1 ? "" : "s"} to the portrait`);
    } else await fail(r, "Upload");
    if (portraitInput.current) portraitInput.current.value = "";
  };

  const savePortrait = async () => {
    setBusy(true);
    const seconds = Math.min(3600, Math.max(3, Math.round(pSeconds) || 3));
    const r = await ownerFetch("portrait", { method: "PUT", json: { photos: pDraft.map(toFile), interval: seconds, look: pLook } });
    setBusy(false);
    if (r?.ok) {
      const set = toSet(((await r.json()) as { portrait: PortraitJSON }).portrait);
      onPortraits(set);
      setPDraft(set.photos);
      setPSeconds(set.interval);
      setPLook(set.look);
      toast("Portrait saved");
    } else await fail(r, "Save");
  };

  const shiftPortrait = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= pDraft.length) return;
    const next = [...pDraft];
    [next[i], next[j]] = [next[j], next[i]];
    setPDraft(next);
  };

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };

  return (
    <Popup label="Owner panel" origin={origin} onClose={onClose} wide>
      <p className="font-mono text-[10px] tracking-[0.3em] text-[var(--d-a)]">OWNER</p>
      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">Your site</h2>
      {/* Five tabs are wider than a phone: the row scrolls sideways there. */}
      <div className="mt-4 flex max-w-full overflow-x-auto rounded-full border border-[var(--d-line)] bg-[var(--d-shade)] p-1 [scrollbar-width:none] sm:inline-flex">
        {(["photos", "portrait", "template", "music", "sound", "résumé", "site"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize transition sm:px-4 sm:text-[13px] ${tab === k ? "text-[var(--d-on)]" : "text-[var(--d-ink4)] hover:text-[var(--d-ink)]"}`}
            style={tab === k ? { background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" } : undefined}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === "photos" && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void uploadPhotos(e.target.files)} />
            <button type="button" disabled={busy} onClick={() => photoInput.current?.click()} className={PRIMARY} style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
              {busy ? "Working…" : "＋ Add photos"}
            </button>
            <p className="text-[12px] text-[var(--d-ink5)]">Up to 20 at once. Resized on the server; location data removed.</p>
          </div>
          <div className="mt-4 grid max-h-[46dvh] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
            {[...album].reverse().map((p) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-[var(--d-line)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend */}
                <img src={`/api/dev-site/thumb/${p.id}.webp`} alt="" className="h-full w-full object-cover" loading="lazy" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removePhoto(p.id)}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-[11px] text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Remove ${p.id}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[10px] text-[var(--d-ink6)]">{album.length} PHOTOS · NEWEST FIRST</p>
        </div>
      )}

      {tab === "portrait" && (
        <div className="mt-5">
          <p className="text-[13px] text-[var(--d-ink3)]">
            The photos at the centre of your orbit, in this order. Each one stays for the time below, then the next fades in.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input ref={portraitInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void uploadPortrait(e.target.files)} />
            <button type="button" disabled={busy} onClick={() => portraitInput.current?.click()} className={PRIMARY} style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
              {busy ? "Working…" : "＋ Add photos"}
            </button>
            <p className="text-[12px] text-[var(--d-ink5)]">Up to 10 at once. Resized on the server; location data removed.</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {pDraft.map((src, i) => (
              <div key={src} className="group relative">
                <div className="aspect-square overflow-hidden rounded-full border border-[var(--d-line2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend */}
                  <img src={src} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 30%" }} loading="lazy" />
                </div>
                <span className="absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-full bg-black/70 font-mono text-[11px] text-white">{i + 1}</span>
                <div className="mt-1.5 flex justify-center gap-1">
                  <button type="button" onClick={() => shiftPortrait(i, -1)} disabled={i === 0} className={`${BTN} px-2.5`} aria-label="Move earlier">←</button>
                  <button type="button" onClick={() => shiftPortrait(i, 1)} disabled={i === pDraft.length - 1} className={`${BTN} px-2.5`} aria-label="Move later">→</button>
                  <button type="button" onClick={() => setPDraft(pDraft.filter((_, k) => k !== i))} disabled={pDraft.length === 1} className={`${BTN} px-2.5`} aria-label="Remove from the portrait">✕</button>
                </div>
              </div>
            ))}
          </div>
          <label className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-[var(--d-ink3)]">
            Each photo stays for
            <input
              type="number"
              min={3}
              max={3600}
              value={pSeconds}
              onChange={(e) => setPSeconds(Number(e.target.value))}
              className={`${FIELD} w-24 text-right tabular-nums`}
              aria-label="Seconds per photo"
            />
            seconds
          </label>
          {/* The portrait's design (§101): a way of showing the photo, or, with
              no photo, a living piece in its place. A tap shows it on the page
              behind at once; the button below makes it the site's. */}
          <p className="mt-7 font-mono text-[10px] tracking-[0.25em] text-[var(--d-a)]">THE PORTRAIT&apos;S DESIGN</p>
          <p className="mt-1 text-[13px] text-[var(--d-ink3)]">Tap one to see it on the page behind. With the photo:</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {PORTRAIT_LOOKS.filter((l) => l.kind === "photo").map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setPLook(l.id);
                  setPortraitLook(l.id);
                }}
                aria-pressed={pLook === l.id}
                title={l.hint}
                className={`flex w-[88px] flex-col items-center gap-1.5 rounded-2xl border p-2 text-[11px] transition ${
                  pLook === l.id ? "border-[var(--d-b)] text-[var(--d-ink)]" : "border-[var(--d-line2)] text-[var(--d-ink4)] hover:text-[var(--d-ink)]"
                }`}
              >
                <span className="relative block h-14 w-14">
                  <DesignPreview src={pDraft[0] ?? portraits.photos[0]} look={l.id} />
                </span>
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-[var(--d-ink3)]">No photo — a living piece in its place:</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {PORTRAIT_LOOKS.filter((l) => l.kind === "core").map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setPLook(l.id);
                  setPortraitLook(l.id);
                }}
                aria-pressed={pLook === l.id}
                title={l.hint}
                className={`flex w-[88px] flex-col items-center gap-1.5 rounded-2xl border p-2 text-[11px] transition ${
                  pLook === l.id ? "border-[var(--d-b)] text-[var(--d-ink)]" : "border-[var(--d-line2)] text-[var(--d-ink4)] hover:text-[var(--d-ink)]"
                }`}
              >
                <span className="relative block h-14 w-14">
                  <CorePreview look={l.id} />
                </span>
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-[var(--d-ink5)]">
            {PORTRAIT_LOOKS.find((l) => l.id === pLook)?.hint}
            {portraitLook !== portraits.look ? " — showing it now; not the site's yet." : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || pLook === portraits.look || pDraft.length === 0}
              onClick={() => void savePortrait()}
              className={PRIMARY}
              style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}
            >
              Make this the site&apos;s look
            </button>
            {portraitLook !== portraits.look && (
              <button
                type="button"
                onClick={() => {
                  setPLook(portraits.look);
                  setPortraitLook(portraits.look);
                }}
                className={BTN}
              >
                Back to the site&apos;s look
              </button>
            )}
          </div>
          <button type="button" disabled={!pDirty || busy || pDraft.length === 0} onClick={() => void savePortrait()} className={`${PRIMARY} mt-6`} style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
            Save order & time
          </button>
        </div>
      )}

      {tab === "music" && (
        <div className="mt-5 space-y-4">
          <ol className="space-y-2">
            {draft.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--d-line)] bg-[var(--d-glass)] p-2.5">
                <span className="w-5 text-center font-mono text-[11px] text-[var(--d-ink5)]">{i + 1}</span>
                <input
                  value={t.title}
                  maxLength={80}
                  onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
                  className={`${FIELD} min-w-0 flex-1`}
                  aria-label="Song title"
                />
                <select
                  value={t.scope}
                  onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, scope: e.target.value as Track["scope"] } : x)))}
                  className={FIELD}
                  aria-label="Where it plays"
                >
                  {SCOPES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={BTN} aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} className={BTN} aria-label="Move down">↓</button>
                <button type="button" onClick={() => setDraft(draft.filter((_, k) => k !== i))} className={BTN} aria-label="Remove song">✕</button>
              </li>
            ))}
            {draft.length === 0 && <p className="text-[13px] text-[var(--d-ink5)]">No songs yet.</p>}
          </ol>
          <button type="button" disabled={!dirty || busy} onClick={() => void saveMusic()} className={PRIMARY} style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
            Save order & settings
          </button>

          <div className="rounded-2xl border border-dashed border-[var(--d-line2)] p-4">
            <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-b)]">ADD A SONG</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={songInput}
                type="file"
                accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.m4a,.ogg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setSong((s) => ({ ...s, file: f, title: s.title || (f ? f.name.replace(/\.[^.]+$/, "").slice(0, 60) : "") }));
                  e.target.value = "";
                }}
              />
              <button type="button" disabled={busy} onClick={() => songInput.current?.click()} className={BTN}>
                {song.file ? "Change song" : "Choose a song"}
              </button>
              <span className="max-w-[12rem] truncate text-[12px] text-[var(--d-ink4)]">{song.file ? song.file.name : "No file chosen"}</span>
              <input value={song.title} onChange={(e) => setSong({ ...song, title: e.target.value })} placeholder="Title" maxLength={80} className={`${FIELD} min-w-[10rem] flex-1`} />
              <select value={song.scope} onChange={(e) => setSong({ ...song, scope: e.target.value as Track["scope"] })} className={FIELD}>
                {SCOPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!song.file || !song.title.trim() || busy} onClick={() => void uploadSong()} className={BTN}>
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--d-ink6)]">MP3, M4A or OGG, under 20 MB.</p>
          </div>
        </div>
      )}

      {tab === "résumé" && (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-4">
            <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-b)]">ON THE SITE NOW</p>
            {resume ? (
              <p className="mt-2 text-[13px] text-[var(--d-ink3)]">
                {resume.pages.length} page{resume.pages.length === 1 ? "" : "s"} · updated {resume.updated} · PDF {resume.pdfKB} KB
                {resume.docx ? ` · Word ${resume.docxKB} KB` : " · no Word file"}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--d-ink5)]">No résumé yet.</p>
            )}
          </div>
          <div className="rounded-2xl border border-dashed border-[var(--d-line2)] p-4">
            <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-b)]">REPLACE IT</p>
            <p className="mt-3 text-[12.5px] text-[var(--d-ink3)]">The new résumé as a PDF</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                key={`pdf-${cvKey}`}
                ref={pdfInput}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => setCv((c) => ({ ...c, pdf: e.target.files?.[0] ?? null }))}
              />
              <button type="button" disabled={busy} onClick={() => pdfInput.current?.click()} className={BTN}>
                {cv.pdf ? "Change PDF" : "Choose the PDF"}
              </button>
              <span className="max-w-[16rem] truncate text-[12px] text-[var(--d-ink4)]">{cv.pdf ? cv.pdf.name : "No file chosen"}</span>
            </div>
            <p className="mt-3 text-[12.5px] text-[var(--d-ink3)]">The same résumé as Word (.docx), optional</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                key={`docx-${cvKey}`}
                ref={docxInput}
                type="file"
                accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                className="hidden"
                onChange={(e) => setCv((c) => ({ ...c, docx: e.target.files?.[0] ?? null }))}
              />
              <button type="button" disabled={busy} onClick={() => docxInput.current?.click()} className={BTN}>
                {cv.docx ? "Change Word file" : "Choose the Word file"}
              </button>
              <span className="max-w-[16rem] truncate text-[12px] text-[var(--d-ink4)]">{cv.docx ? cv.docx.name : "No file chosen"}</span>
            </div>
            <button
              type="button"
              disabled={!cv.pdf || busy}
              onClick={() => void uploadResume()}
              className={`${PRIMARY} mt-4`}
              style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}
            >
              {busy ? "Replacing…" : "Replace the résumé"}
            </button>
            <p className="mt-2 text-[11px] text-[var(--d-ink6)]">
              PDF up to 6 pages, under 10 MB. Its pages are drawn for the viewer on the server. Without a Word file the Word download is
              removed, so nobody downloads the old one.
            </p>
          </div>
        </div>
      )}

      {tab === "template" && (
        // His words for the site (§101.8): "the name and the font of that name
        // and colours… the slogan… the company… the role… literally all texts…
        // a single-click button to make all default".
        <div className="mt-5">
          <p className="text-[13px] text-[var(--d-ink3)]">Every word here is yours to change. It shows on the page behind as you type; Save makes it the site&apos;s.</p>
          {/* The name's area: how the whole of it is designed (§102.2). */}
          <div className="mt-5 rounded-2xl border border-[var(--d-line2)] bg-[color-mix(in_srgb,var(--d-bg)_70%,transparent)] p-4" data-plates>
            <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-a)]">YOUR NAME&apos;S AREA</p>
            <p className="mt-1 text-[12px] text-[var(--d-ink4)]">Tap one: it plays just below, with your words, and on the page behind. Save makes it the site&apos;s.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {PLATES.map((pl) => {
                const on = copy.style.plate === pl.id;
                return (
                  <button
                    key={pl.id}
                    type="button"
                    data-plate-pick={pl.id}
                    onClick={() => setCopy({ ...copy, style: { ...copy.style, plate: pl.id } })}
                    aria-pressed={on}
                    title={pl.note}
                    className={`rounded-xl border px-2 py-2.5 text-center text-[12.5px] font-medium transition-colors ${on ? "border-[var(--d-b)] bg-[color-mix(in_srgb,var(--d-b)_14%,transparent)] text-[var(--d-ink)]" : "border-[var(--d-line2)] text-[var(--d-ink3)] hover:border-[var(--d-ink5)] hover:text-[var(--d-ink)]"}`}
                  >
                    {pl.label}
                    {pl.id === "classic" && <span className="block text-[10px] font-normal text-[var(--d-ink5)]">as it began</span>}
                    {pl.id === "water" && <span className="block text-[10px] font-normal text-[var(--d-ink5)]">matches the page</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 min-h-9 text-[12px] text-[var(--d-ink3)]">{PLATES.find((pl) => pl.id === copy.style.plate)?.note}</p>
            <div className="mt-3 flex min-h-[250px] flex-col justify-center overflow-hidden rounded-xl border border-[var(--d-line)] bg-[var(--d-bg)] px-4 py-5">
              <Nameplate key={copy.style.plate} entered preview />
            </div>
          </div>
          {/* The name's look. */}
          <div className="mt-5 rounded-2xl border border-[var(--d-line2)] p-4">
            <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-a)]">YOUR NAME&apos;S LOOK</p>
            <p className="mt-1 text-[12px] text-[var(--d-ink4)]">The font is used by most designs; the colour is Classic&apos;s (the others wear the theme&apos;s own).</p>
            <p className={`mt-2 text-[28px] font-semibold leading-tight ${nameLook(copy.style).fontClass} ${nameLook(copy.style).colorClass}`} style={nameLook(copy.style).colorStyle}>
              {word(copy, "name")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {NAME_FONTS.map((f) => (
                <button key={f.id} type="button" onClick={() => setCopy({ ...copy, style: { ...copy.style, nameFont: f.id } })} aria-pressed={copy.style.nameFont === f.id} className={`${BTN} ${copy.style.nameFont === f.id ? "!border-[var(--d-b)] !text-[var(--d-ink)]" : ""}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {NAME_COLORS.map((c) => (
                <button key={c.id} type="button" onClick={() => setCopy({ ...copy, style: { ...copy.style, nameColor: c.id } })} aria-pressed={copy.style.nameColor === c.id} className={`${BTN} ${copy.style.nameColor === c.id ? "!border-[var(--d-b)] !text-[var(--d-ink)]" : ""}`}>
                  {c.label}
                </button>
              ))}
            </div>
            {copy.style.nameColor === "custom" && (
              <div className="mt-3 flex items-center gap-3 text-[12px] text-[var(--d-ink4)]">
                <label className="flex items-center gap-2">
                  From
                  <input type="color" value={copy.style.nameC1} onChange={(e) => setCopy({ ...copy, style: { ...copy.style, nameC1: e.target.value } })} className="h-8 w-12 cursor-pointer rounded border border-[var(--d-line2)] bg-transparent" aria-label="First colour" />
                </label>
                <label className="flex items-center gap-2">
                  to
                  <input type="color" value={copy.style.nameC2} onChange={(e) => setCopy({ ...copy, style: { ...copy.style, nameC2: e.target.value } })} className="h-8 w-12 cursor-pointer rounded border border-[var(--d-line2)] bg-transparent" aria-label="Second colour" />
                </label>
              </div>
            )}
          </div>
          {/* The words, group by group. */}
          {COPY_GROUPS.map((g) => (
            <div key={g.title} className="mt-5">
              <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-a)]">{g.title.toUpperCase()}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <label key={f.key} className={`block text-[12px] text-[var(--d-ink4)] ${f.long ? "sm:col-span-2" : ""}`}>
                    {f.label}
                    {f.long ? (
                      <textarea rows={2} value={word(copy, f.key)} onChange={(e) => setWord(f.key, e.target.value)} className={`${FIELD} mt-1 w-full resize-y`} />
                    ) : (
                      <input type="text" value={word(copy, f.key)} onChange={(e) => setWord(f.key, e.target.value)} className={`${FIELD} mt-1 w-full`} />
                    )}
                    {copy.texts[f.key] !== undefined && <span className="mt-0.5 block text-[10.5px] text-[var(--d-ink6)]">Original: {f.def}</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {/* The skills going round his photo (§102.6). */}
          <SkillsEditor copy={copy} setCopy={setCopy} />
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !copyDirty} onClick={() => void saveCopy(copy, "Your words are saved")} className={PRIMARY} style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
              {busy ? "Saving…" : "Save my words"}
            </button>
            {copyDirty && (
              <button type="button" onClick={() => setCopy(savedCopy)} className={BTN}>
                Undo my changes
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => void saveCopy(EMPTY_COPY, "Every word is back to the original")} className={BTN}>
              Every word back to the original
            </button>
          </div>
        </div>
      )}

      {tab === "site" && (
        // The site's default theme and design (moved here from the Studio,
        // §101.2: "better hide it inside our PS button").
        <div className="mt-5">
          <p className="text-[13px] text-[var(--d-ink3)]">What every visitor sees first, until they choose their own in Themes.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--d-line2)] p-4">
              <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-ink5)]">THE SITE&apos;S DEFAULT NOW</p>
              <p className="mt-1.5 text-[15px] font-semibold">
                {findTheme(siteDefault.theme).name} · {DESIGNS.find((d) => d.id === siteDefault.design)?.name}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--d-line2)] p-4">
              <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-ink5)]">ON YOUR SCREEN</p>
              <p className="mt-1.5 text-[15px] font-semibold">
                {findTheme(themeId).name} · {DESIGNS.find((d) => d.id === designId)?.name}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-[var(--d-ink5)]">Pick a theme and a design in Themes (the top menu), then make them the site&apos;s here.</p>
          <button
            type="button"
            disabled={savingSite || (siteDefault.theme === themeId && siteDefault.design === designId)}
            onClick={async () => {
              setSavingSite(true);
              const ok = await saveDefault();
              setSavingSite(false);
              toast(ok ? "The site's default is saved" : "Could not save the default");
            }}
            className={`${PRIMARY} mt-4`}
            style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}
          >
            {siteDefault.theme === themeId && siteDefault.design === designId ? "This is the site's default" : savingSite ? "Saving…" : "Make what I see the site's default"}
          </button>
        </div>
      )}

      {tab === "sound" && (
        <div className="mt-5">
          <p className="text-[13px] text-[var(--d-ink3)]">The volume every visitor starts at. They can still change their own.</p>
          <label className="mt-4 flex items-center gap-3">
            <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} className="dev-range flex-1" aria-label="Default volume" />
            <span className="w-10 text-right font-mono text-[13px] tabular-nums">{Math.round(volume * 100)}</span>
          </label>
          <button type="button" disabled={!dirty || busy} onClick={() => void saveMusic()} className={`${PRIMARY} mt-4`} style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
            Save as the site default
          </button>
        </div>
      )}
    </Popup>
  );
}

/** The skills going round his photo (§102.6): "I can remove any skill, add any
 *  skill". Live on the page behind as he edits; saved with his words. New ones
 *  go first in the list, so they take a seat in the orbit straight away. */
function SkillsEditor({ copy, setCopy }: { copy: Copy; setCopy: (c: Copy) => void }) {
  const list = copy.skills ?? DEFAULT_ORBIT;
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const same = (x: OrbitSkill[], y: OrbitSkill[]) => x.length === y.length && x.every((sk, i) => sk.name === y[i].name && sk.pin === y[i].pin);
  const put = (next: OrbitSkill[]) => setCopy({ ...copy, skills: same(next, DEFAULT_ORBIT) ? null : next });
  const have = new Set(list.map((sk) => sk.name.toLowerCase()));
  const add = () => {
    const name = canonSkill(draft.replace(/\s+/g, " ").trim());
    if (!name) return;
    if (have.has(name.toLowerCase())) {
      setNote(`${name} is already going round.`);
      return;
    }
    if (list.length >= MAX_SKILLS) {
      setNote(`${MAX_SKILLS} skills at most.`);
      return;
    }
    put([{ name, pin: false }, ...list]);
    setDraft("");
    setNote(`${name} is going round now.`);
  };
  const pinned = list.filter((sk) => sk.pin).length;
  const ideas = ALL_SKILLS.filter((sk) => sk.length <= ORBIT_MAX_LEN && !have.has(sk.toLowerCase()));
  return (
    <div className="mt-5 rounded-2xl border border-[var(--d-line2)] bg-[color-mix(in_srgb,var(--d-bg)_70%,transparent)] p-4" data-skills-editor>
      <p className="font-mono text-[10px] tracking-[0.25em] text-[var(--d-a)]">THE SKILLS ROUND YOUR PHOTO</p>
      <p className="mt-1 text-[12px] text-[var(--d-ink4)]">★ stays in sight; the rest take turns, the next coming round each time a chip passes behind your photo. × takes one out.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          type="text"
          list="dev-skill-ideas"
          value={draft}
          maxLength={ORBIT_MAX_LEN}
          onChange={(e) => {
            setDraft(e.target.value);
            setNote("");
          }}
          placeholder="Add a skill"
          aria-label="A skill to add"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <datalist id="dev-skill-ideas">
          {ideas.map((sk) => (
            <option key={sk} value={sk} />
          ))}
        </datalist>
        <button type="submit" disabled={!draft.trim()} className={BTN}>
          Add
        </button>
      </form>
      <p className="mt-1 min-h-4 text-[11px] text-[var(--d-ink5)]" aria-live="polite">
        {note || (draft ? `${draft.length}/${ORBIT_MAX_LEN} letters — longer names would run into each other on a phone` : "")}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {list.map((sk, i) => {
          const hue = hueOf(sk.name);
          return (
            <li
              key={sk.name}
              className="flex items-center gap-0.5 rounded-full border bg-[color-mix(in_srgb,var(--d-bg2)_88%,transparent)] py-0.5 pl-0.5 pr-0.5 font-mono text-[11px]"
              style={{ color: hue, borderColor: `color-mix(in srgb, ${hue} 35%, transparent)` }}
            >
              <button
                type="button"
                onClick={() => put(list.map((x, j) => (j === i ? { ...x, pin: !x.pin } : x)))}
                aria-pressed={sk.pin}
                aria-label={`${sk.name}: ${sk.pin ? "always in sight" : "taking turns"}`}
                title={sk.pin ? "Always in sight (tap: let it take turns)" : "Taking turns (tap: keep it in sight)"}
                className="grid h-6 w-6 place-items-center rounded-full text-[12px] leading-none hover:bg-white/10"
              >
                {sk.pin ? "★" : "☆"}
              </button>
              <span className="px-0.5">{sk.name}</span>
              <button
                type="button"
                onClick={() => {
                  put(list.filter((_, j) => j !== i));
                  setNote(`${sk.name} is out.`);
                }}
                aria-label={`Take ${sk.name} out`}
                title="Take it out"
                className="grid h-6 w-6 place-items-center rounded-full text-[14px] leading-none text-[var(--d-ink5)] hover:bg-white/10 hover:text-[var(--d-ink)]"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p className="mt-2 text-[12px] text-[var(--d-ink5)]">Nothing is going round your photo now. Add a skill, or bring back the résumé&apos;s.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--d-ink5)]">
        <span>
          {list.length} skill{list.length === 1 ? "" : "s"} · {pinned} always in sight
          {pinned > 8 ? " (eight fit at once; the rest of your ★ come round first)" : ""}
        </span>
        {copy.skills && (
          <button
            type="button"
            onClick={() => {
              setCopy({ ...copy, skills: null });
              setNote("The résumé's skills are back.");
            }}
            className={BTN}
          >
            The résumé&apos;s skills back
          </button>
        )}
      </div>
    </div>
  );
}
