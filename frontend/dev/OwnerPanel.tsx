"use client";

// His owner panel, behind a hidden door and his password.
//
//   "i can upload any photos to this site… have an upload option somewhere
//    hidden… also i can upload any music… change the order of the song… whether
//    to use this song only in album or in landing page too or in both… music
//    volume control option also needed"
//   "so many things we made customisable using the password… so why can't
//    résumé updation… if I need, I can replace it with an updated résumé"
//
// The door: tap the "PS" monogram three times quickly. Nothing on the page
// says it exists. Every action is checked on the server with the password.

import { useRef, useState } from "react";
import type { Photo } from "./Album";
import { useDev } from "./context";
import type { MusicManifest, Track } from "./music";
import { Popup, type Origin } from "./Popup";
import type { ResumeManifest } from "./Resume";

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
  onAlbum,
  onMusic,
  onResume,
  onClose,
}: {
  origin: Origin;
  album: Photo[];
  music: MusicManifest;
  resume: ResumeManifest | null;
  onAlbum: (a: Photo[]) => void;
  onMusic: (m: MusicManifest) => void;
  onResume: (r: ResumeManifest) => void;
  onClose: () => void;
}) {
  const { ownerFetch, toast } = useDev();
  const [tab, setTab] = useState<"photos" | "music" | "sound" | "résumé">("photos");
  const [cv, setCv] = useState<{ pdf: File | null; docx: File | null }>({ pdf: null, docx: null });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Track[]>(music.tracks);
  const [volume, setVolume] = useState(music.volume);
  const [song, setSong] = useState<{ file: File | null; title: string; scope: Track["scope"] }>({ file: null, title: "", scope: "both" });
  const photoInput = useRef<HTMLInputElement>(null);
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
      toast("Résumé replaced — the site shows the new one now");
    } else await fail(r, "Upload");
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
      <div className="mt-4 inline-flex rounded-full border border-[var(--d-line)] bg-[var(--d-shade)] p-1">
        {(["photos", "music", "sound", "résumé"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold capitalize transition ${tab === k ? "text-[var(--d-on)]" : "text-[var(--d-ink4)] hover:text-[var(--d-ink)]"}`}
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
                type="file"
                accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.m4a,.ogg"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setSong((s) => ({ ...s, file: f, title: s.title || (f ? f.name.replace(/\.[^.]+$/, "").slice(0, 60) : "") }));
                }}
                className="max-w-full text-[12px] text-[var(--d-ink3)]"
              />
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
            <label className="mt-3 block text-[12.5px] text-[var(--d-ink3)]">
              The new résumé as a PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setCv((c) => ({ ...c, pdf: e.target.files?.[0] ?? null }))}
                className="mt-1 block max-w-full text-[12px] text-[var(--d-ink3)]"
              />
            </label>
            <label className="mt-3 block text-[12.5px] text-[var(--d-ink3)]">
              The same résumé as Word (.docx), optional
              <input
                type="file"
                accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                onChange={(e) => setCv((c) => ({ ...c, docx: e.target.files?.[0] ?? null }))}
                className="mt-1 block max-w-full text-[12px] text-[var(--d-ink3)]"
              />
            </label>
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
