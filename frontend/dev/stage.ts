"use client";

// Whether the page can be seen yet (§103.10: the site opens by itself).
//
// While the door is shut nothing behind it can be seen, so nothing of it should be
// spent: a canvas draws its first few frames there — its shaders built, its pictures
// on the GPU — and then holds still until the door opens, which leaves the machine
// to the loading, and to the opening itself. And what plays once, when it is first
// seen (the bones rising into place, the galaxy opening), plays THEN: behind the
// door nobody ever saw it.

import { useEffect, useState } from "react";

let at = -1;
let before = false;
let turn = 0;
let sealed = false;
const waiting = new Set<(bang: boolean) => void>();

/** The door is shut. */
export const covered = () => at < 0;
/** It has already opened once in this visit (you are coming back from the award room). */
export const openedBefore = () => before;

export function shutStage() {
  at = -1;
  turn++;
  sealed = false;
}
/** Everything is here: the opening is about to play. */
export function sealStage() {
  sealed = true;
}

/** It opens. `bang`: with the burst (not for somebody who wants no motion). */
export function openStage(bang: boolean) {
  if (at >= 0) return;
  at = performance.now();
  before = true;
  const all = [...waiting];
  waiting.clear();
  for (const f of all) f(bang);
}

/** Once the door opens (at once, if it has). */
export function whenOpen(f: (bang: boolean) => void): () => void {
  if (at >= 0) {
    f(false);
    return () => {};
  }
  waiting.add(f);
  return () => {
    waiting.delete(f);
  };
}

/** Something heavy that may be done at any time: `early` ms from now if the page is still
 *  loading then, else well after it has opened — never in the opening. */
export function atLeisure(f: () => void, early: number): () => void {
  let late = 0;
  let done = false;
  const once = () => {
    if (!done) f();
    done = true;
  };
  const first = window.setTimeout(() => {
    if (at < 0 && !sealed) once();
  }, early);
  const off = whenOpen(() => {
    late = window.setTimeout(once, 5000);
  });
  return () => {
    done = true;
    window.clearTimeout(first);
    window.clearTimeout(late);
    off();
  };
}

/** Whether it has opened: for what plays by itself when the page is first seen. */
export function useOpened(): boolean {
  const [open, setOpen] = useState(() => at >= 0);
  useEffect(() => whenOpen(() => setOpen(true)), []);
  return open;
}

/** Whether a canvas should hold still this frame: behind the door, after its first
 *  `warm` frames; and for `after` ms once it opens, if it is a heavy one. */
export function holder(warm = 4, after = 0): () => boolean {
  let n = 0;
  let mine = turn;
  return () => {
    if (at >= 0) return performance.now() - at < after;
    if (mine !== turn) {
      mine = turn;
      n = 0;
    }
    return ++n > warm;
  };
}

// Where the galaxy at the head of the skeleton is: the opening's dust goes home to it.
export type Spot = { x: number; y: number; r: number };
let heart: (() => Spot | null) | null = null;
export function setHeart(f: (() => Spot | null) | null) {
  heart = f;
}
export function heartSpot(): Spot | null {
  return heart?.() ?? null;
}
