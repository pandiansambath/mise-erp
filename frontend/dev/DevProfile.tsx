"use client";

// pandi-dev.dineai.cloud — the shell around every design.
//
// The page's TEXT stays identity-level: who he is, where he is, what he has
// been recognised for, how to reach him. No client names, no project
// architecture, no packages — his brief, and the right call for a public page.
// The résumé is a document he chose to publish (21 Nov 2026), offered from its
// own button, never copied into the page's text.
//
// The shell owns what every design shares (context.tsx): the clock, the
// theme (every colour is a --d-* variable set here), the design being shown,
// the top bar, the album and résumé viewer, and his editing — unlocked with
// a password the SERVER checks, never the page.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Album, type Photo } from "./Album";
import { BootSequence, type BootTask } from "./BootSequence";
import { primeSounds } from "./chestBits";
import { AWARD_TRACK, getPlayer, releasePlayer, type MusicManifest, type Player } from "./music";
import { AWARD_MODEL_FILES, canWarmAward } from "./awardFiles";
import { rememberWords } from "./awardDoor";
import { arrive } from "./chunks";
import { OwnerPanel } from "./OwnerPanel";
import { PortraitLookDefs } from "./PortraitLooks";
import type { PortraitLook } from "./portraits";
import type { Copy } from "./copy";
import { ChainDesign } from "./ChainDesign";
import { DevContext, NowContext, type DevState, type PortraitSet } from "./context";
import { installLetterSwell } from "./letterSwell";
import { Gate, type Origin } from "./Popup";
import { DEFAULT_MILESTONES, type Milestone } from "./profile";
import { ResumeViewer, type ResumeManifest } from "./Resume";
import { DEFAULT_DESIGN, DEFAULT_THEME, findTheme, isDesign, themeStyle, THEME_EVENT, THEMES, type DesignId } from "./theme";
import { Toast, TopBar } from "./TopBar";

// The other designs load only when someone picks one.
const MetroDesign = dynamic(() => arrive(() => import("./MetroDesign").then((m) => m.MetroDesign), ChainDesign));
const ChronicleDesign = dynamic(() => arrive(() => import("./ChronicleDesign").then((m) => m.ChronicleDesign), ChainDesign));
const TerminalDesign = dynamic(() => arrive(() => import("./TerminalDesign").then((m) => m.TerminalDesign), ChainDesign));
const BentoDesign = dynamic(() => arrive(() => import("./BentoDesign").then((m) => m.BentoDesign), ChainDesign));
const BlueprintDesign = dynamic(() => arrive(() => import("./BlueprintDesign").then((m) => m.BlueprintDesign), ChainDesign));
const StoriesDesign = dynamic(() => arrive(() => import("./StoriesDesign").then((m) => m.StoriesDesign), ChainDesign));
const EmberDesign = dynamic(() => arrive(() => import("./EmberDesign").then((m) => m.EmberDesign), ChainDesign));

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
const STORE = "pandi-dev:look";

type Look = { theme: string; design: DesignId };

/** Run a change as a circle growing from where it was clicked (View
 *  Transitions). Falls back to an instant change where unsupported. */
function reveal(change: () => void, from?: { x: number; y: number }) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }
  const html = document.documentElement;
  html.classList.add("dev-vt");
  const t = doc.startViewTransition(() => flushSync(change));
  t.ready
    .then(() => {
      const x = from?.x ?? window.innerWidth / 2;
      const y = from?.y ?? 0;
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      html.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 760, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
  t.finished.finally(() => html.classList.remove("dev-vt"));
}

export function DevProfile({
  photos,
  resume: initialResume,
  milestones: savedMilestones,
  site,
  initial,
  music: initialMusic,
  portraits: initialPortraits,
  copy: initialCopy,
}: {
  photos: Photo[];
  resume: ResumeManifest | null;
  milestones: Milestone[] | null;
  site: Look;
  /** From the link (?theme=…&design=…), which wins over everything. */
  initial: Partial<Look>;
  music: MusicManifest;
  portraits: PortraitSet;
  copy: Copy;
}) {
  const [entered, setEntered] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>(savedMilestones ?? DEFAULT_MILESTONES);
  const [siteDefault, setSiteDefault] = useState<Look>(site);
  const [look, setLook] = useState<Look>({ theme: initial.theme ?? site.theme, design: initial.design ?? site.design });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [gate, setGate] = useState<Origin | false>(false);
  const [owner, setOwner] = useState<Origin | false>(false);
  const [album, setAlbum] = useState<Photo[]>(photos);
  const [music, setMusic] = useState<MusicManifest>(initialMusic);
  const [portraits, setPortraits] = useState<PortraitSet>(initialPortraits);
  // The portrait's design: his choice for every visitor (portrait.json, set
  // behind the PS door, §101.1). setPortraitLook previews another on this
  // screen only, until he makes it the site's.
  const [portraitLook, setLookState] = useState<PortraitLook>(initialPortraits.look ?? "natural");
  const setPortraitLook = useCallback((l: PortraitLook) => setLookState(l), []);
  // His words for the site (the Template, behind the PS door).
  const [copy, setCopy] = useState<Copy>(initialCopy);
  // His résumé can be replaced from the owner panel; the page shows the new
  // one straight away.
  const [resume, setResume] = useState<ResumeManifest | null>(initialResume);
  const [player, setPlayer] = useState<Player | null>(null);
  const password = useRef<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const gateResolve = useRef<((ok: boolean) => void) | null>(null);
  const theme = findTheme(look.theme);

  // The clock, on the client only (a server clock would hydrate stale).
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // A visitor's own pick, remembered on their device — unless the link chose.
  useEffect(() => {
    if (initial.theme || initial.design) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Look> | null;
      if (saved && (THEMES.some((t) => t.id === saved.theme) || isDesign(saved.design))) {
        setLook((l) => ({
          theme: THEMES.some((t) => t.id === saved.theme) ? saved.theme! : l.theme,
          design: isDesign(saved.design) ? saved.design : l.design,
        }));
      }
    } catch {
      /* storage blocked: the site default it is */
    }
  }, [initial.theme, initial.design]);

  // Canvases re-read their colours after a theme lands.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event(THEME_EVENT)));
    return () => cancelAnimationFrame(id);
  }, [look.theme]);

  const remember = (next: Look) => {
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* fine: it just won't be remembered */
    }
  };

  const toast = useCallback((message: string) => {
    setToastMsg(null);
    requestAnimationFrame(() => setToastMsg(message));
  }, []);
  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(null), 2500);
    return () => clearTimeout(id);
  }, [toastMsg]);

  const setTheme = useCallback((id: string, from?: { x: number; y: number }) => {
    reveal(() => {
      setLook((l) => {
        const next = { ...l, theme: id };
        remember(next);
        return next;
      });
    }, from);
  }, []);

  const setDesign = useCallback((id: DesignId, from?: { x: number; y: number }) => {
    reveal(() => {
      setLook((l) => {
        const next = { ...l, design: id };
        remember(next);
        return next;
      });
      window.scrollTo({ top: 0 });
    }, from);
  }, []);

  const requestUnlock = useCallback(() => {
    if (password.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      gateResolve.current = resolve;
      setGate({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    });
  }, []);

  const send = useCallback(
    async (path: string, body: object) => {
      try {
        const r = await fetch(`/api/dev-site/${path}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: password.current, ...body }),
        });
        if (r.status === 401) {
          password.current = null;
          setUnlocked(false);
          toast("Locked again — the password changed.");
          return false;
        }
        if (!r.ok) {
          toast("Couldn’t save. Try again.");
          return false;
        }
        return true;
      } catch {
        toast("Couldn’t reach the server.");
        return false;
      }
    },
    [toast],
  );

  const saveMilestones = useCallback(
    async (list: Milestone[]) => {
      if (!password.current) return false;
      const ok = await send("milestones", { milestones: list });
      if (ok) {
        setMilestones(list);
        toast("Saved to the chain");
      }
      return ok;
    },
    [send, toast],
  );

  const saveDefault = useCallback(async () => {
    if (!password.current) return false;
    const ok = await send("site", look);
    if (ok) {
      setSiteDefault(look);
      toast("Now the site default");
    }
    return ok;
  }, [send, look, toast]);

  const openAlbum = useCallback(() => setAlbumOpen(true), []);
  const openResume = useCallback(() => setResumeOpen(true), []);

  // The hidden album: type "album" anywhere, or the Konami code.
  const buffer = useRef("");
  const konami = useRef<string[]>([]);
  useEffect(() => {
    if (!entered || resumeOpen || gate !== false) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(-5);
      if (buffer.current === "album") {
        openAlbum();
        buffer.current = "";
      }
      konami.current = [...konami.current, e.key].slice(-KONAMI.length);
      if (konami.current.join(",") === KONAMI.join(",")) {
        openAlbum();
        konami.current = [];
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, openAlbum, resumeOpen, gate]);

  // The light that follows the pointer across a card (.dev-card).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const card = (e.target as Element | null)?.closest?.(".dev-card") as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Music: the album starts its own playlist fresh; leaving it, the site's.
  useEffect(() => {
    player?.setMode(albumOpen ? "album" : "landing");
  }, [albumOpen, player]);
  // Leaving the page (e.g. for the award room, which has its own score).
  useEffect(() => () => releasePlayer(), []);

  const ownerFetch = useCallback(async (path: string, init: { method: string; json?: object; form?: FormData }) => {
    if (!password.current) return null;
    try {
      let body: BodyInit;
      const headers: Record<string, string> = {};
      if (init.form) {
        init.form.set("password", password.current);
        body = init.form;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify({ password: password.current, ...(init.json ?? {}) });
      }
      const r = await fetch(`/api/dev-site/${path}`, { method: init.method, headers, body });
      if (r.status === 401) {
        password.current = null;
        setUnlocked(false);
      }
      return r;
    } catch {
      return null;
    }
  }, []);

  // The hidden door: unlock, then the owner panel.
  const openOwner = useCallback(async () => {
    if (await requestUnlock()) setOwner({ x: 40, y: 30 });
  }, [requestUnlock]);

  // Every piece of text answers the cursor (22 Nov): the letter swell he
  // liked on "System Engineer", on all of it.
  useEffect(() => {
    if (!entered) return;
    return installLetterSwell();
  }, [entered]);

  // (The award room's words are his too: carried across with him.)
  useEffect(() => rememberWords(copy), [copy]);

  const value: DevState = useMemo(
    () => ({
      entered,
      photos: album,
      portraits,
      portraitLook,
      setPortraitLook,
      copy,
      setCopy,
      resume,
      milestones,
      openAlbum,
      openResume,
      unlocked,
      requestUnlock,
      saveMilestones,
      themeId: look.theme,
      designId: look.design,
      setTheme,
      setDesign,
      siteDefault,
      saveDefault,
      toast,
      openOwner,
      ownerFetch,
    }),
    [entered, album, portraits, portraitLook, setPortraitLook, copy, resume, milestones, openAlbum, openResume, unlocked, requestUnlock, saveMilestones, look, setTheme, setDesign, siteDefault, saveDefault, toast, openOwner, ownerFetch],
  );

  const thumbUrls = useMemo(() => photos.map((p) => `/api/dev-site/thumb/${p.id}.webp`), [photos]);
  // Everything else the visit will want, in the cache before the door opens.
  const bootTasks = useMemo<BootTask[]>(() => {
    const img = (src: string) =>
      new Promise((resolve) => {
        const i = new Image();
        i.onload = i.onerror = resolve;
        i.src = src;
      });
    return [
      ...initialPortraits.photos.map((src) => () => img(src)),
      () => {
        const p = getPlayer(initialMusic);
        setPlayer(p);
        return p ? p.preload() : Promise.resolve();
      },
      // The award room: engine, loader, scene, model, and its sounds decoded.
      () => import("three"),
      () => import("three/examples/jsm/loaders/GLTFLoader.js"),
      () => import("./AwardStage"),
      () => import("./awardRoom"),
      () => (canWarmAward() ? Promise.all(AWARD_MODEL_FILES.map((u) => fetch(u).then((r) => r.arrayBuffer()))) : Promise.resolve()),
      () => primeSounds(),
      // …and its music, into the browser's cache, so the room opens playing.
      () => fetch(AWARD_TRACK).then((r) => r.arrayBuffer()).catch(() => null),
    ];
  }, [initialMusic, initialPortraits]);

  return (
    <DevContext.Provider value={value}>
      <NowContext.Provider value={now}>
      <div
        id="top"
        className="dev-root relative min-h-dvh overflow-x-clip bg-[var(--d-bg)] text-[var(--d-ink)]"
        style={themeStyle(theme)}
        data-design={look.design}
      >
        <div aria-hidden className="dev-progress" />
        <PortraitLookDefs />
        {!entered && (
          <BootSequence
            photoUrls={thumbUrls}
            tasks={bootTasks}
            onEnter={() => {
              setEntered(true);
              // ENTER is the tap browsers require before any sound.
              getPlayer(initialMusic)?.start();
            }}
          />
        )}
        <TopBar player={player} />

        <div key={look.design}>
          {look.design === "metro" ? (
            <MetroDesign />
          ) : look.design === "chronicle" ? (
            <ChronicleDesign />
          ) : look.design === "terminal" ? (
            <TerminalDesign />
          ) : look.design === "bento" ? (
            <BentoDesign />
          ) : look.design === "blueprint" ? (
            <BlueprintDesign />
          ) : look.design === "stories" ? (
            <StoriesDesign />
          ) : look.design === "ember" ? (
            <EmberDesign />
          ) : (
            <ChainDesign />
          )}
        </div>

        {albumOpen && <Album photos={album} onClose={() => setAlbumOpen(false)} />}
        {resumeOpen && resume && <ResumeViewer resume={resume} onClose={() => setResumeOpen(false)} />}
        <Toast message={toastMsg} />
      </div>
      {owner !== false && (
        <OwnerPanel
          origin={owner}
          album={album}
          music={music}
          resume={resume}
          portraits={portraits}
          onAlbum={setAlbum}
          onResume={setResume}
          onPortraits={setPortraits}
          onMusic={(m) => {
            setMusic(m);
            player?.replace(m);
          }}
          onClose={() => setOwner(false)}
        />
      )}
      {gate !== false && (
        <Gate
          origin={gate}
          onDone={(pw) => {
            if (pw) {
              password.current = pw;
              setUnlocked(true);
              toast("Editing unlocked");
            }
            setGate(false);
            gateResolve.current?.(!!pw);
            gateResolve.current = null;
          }}
        />
      )}
      </NowContext.Provider>
    </DevContext.Provider>
  );
}

export { DEFAULT_DESIGN, DEFAULT_THEME };
