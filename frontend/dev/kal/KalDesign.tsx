"use client";

// KAL · கல் — the temple (§107.2; docs/TEMPLE_DESIGN.md is its checklist, docs/temple/ART.md its drawing).
//
//   "i need one more new design like we have in [the] chest page… that ancient style, temple
//    detailings… that Thirukkural"
//
// In Tamil one word, கல், says stone; said to somebody, it says: learn. The page is a temple cut
// from one rock, from the top down. One carries a lamp.

import { useEffect, useRef, useState } from "react";
import { useDev } from "../context";
import { KalWorld } from "./context";
import { cut, serif, tamil } from "./fonts";
import { Halls } from "./Halls";
import { Kalasam } from "./Kalasam";
import { paintSky } from "./sky";
import { World } from "./world";
import "./kal.css";

export function KalDesign() {
  const { entered } = useDev();
  const [world] = useState(() => new World());
  const [live, setLive] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sky = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const r = root.current;
    const c = canvas.current;
    if (!r || !c) return;
    world.open(r, c, setLive).catch((e) => {
      console.warn(String(e).slice(0, 300));
      setLive(false);
    });
    return () => world.close();
  }, [world]);

  useEffect(() => {
    const c = sky.current;
    if (!c) return;
    let late = 0;
    const paint = () => paintSky(c, new Date());
    paint();
    const again = () => {
      window.clearTimeout(late);
      late = window.setTimeout(paint, 200);
    };
    window.addEventListener("resize", again);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener("resize", again);
    };
  }, []);

  return (
    <KalWorld.Provider value={world}>
      <div ref={root} className={`kal ${cut.variable} ${serif.variable} ${tamil.variable}`} data-live={live ? "" : undefined} data-entered={entered ? "" : undefined}>
        <canvas ref={sky} aria-hidden className="kal-sky" />
        <canvas ref={canvas} aria-hidden className="kal-stone" />
        <main className="kal-page">
          <Kalasam />
          <Halls />
        </main>
      </div>
    </KalWorld.Provider>
  );
}
