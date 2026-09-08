"use client";

import { useEffect, useRef } from "react";

/** Set while WE unwind the history stack, so the resulting popstate is
 *  ignored by every overlay rather than closing whichever one happens to
 *  be listening when it lands. Module-level on purpose: the pop is a page
 *  event, and only one can be in flight. */
let selfPop = false;

/** Claim the next `popstate` as OURS, for every listener in the round.
 *
 *  The clear is registered as a listener rather than done on a timer because
 *  `history.back()` is asynchronous: a `setTimeout(0)` scheduled here could fire
 *  before the pop ever arrives, and then the flag is already gone when the
 *  handlers run. Registering now means this listener is LAST in the round —
 *  after every overlay's — so all of them see the flag, and then it clears.
 *
 *  The timer is only a safety net for a pop that never comes (a blocked
 *  `back()`), so a stuck flag cannot silently disable every later overlay. */
function claimPop(): void {
  selfPop = true;
  const done = () => {
    selfPop = false;
    window.removeEventListener("popstate", done);
    window.clearTimeout(bail);
  };
  const bail = window.setTimeout(done, 1000);
  window.addEventListener("popstate", done);
}

/** Set when an overlay is closing BECAUSE we are navigating somewhere.
 *
 *  THE SEVEN-TIME BUG. "Change the restaurant's timezone" did nothing, and he
 *  reported it seven times while three different fixes were applied to three
 *  different innocent things — the anchor it pointed at, who was allowed to see
 *  it, and a <Link> being unmounted mid-click. All three were real faults. None
 *  of them was this one.
 *
 *  What actually happened, measured on the live site by patching `history` and
 *  recording the calls: pressing the button produced `["back()", "popstate"]`
 *  and no push at all. The handler ran `router.push(...)` and then closed the
 *  popup; closing runs the cleanup below, which takes the overlay's history
 *  entry back off the stack. `router.push` is a TRANSITION — at the moment the
 *  cleanup runs it has not written its entry yet, so the guard that checks
 *  "is the top of the stack still mine?" says yes, quite correctly, and pops.
 *  The pending navigation goes with it. Nothing throws, nothing logs, and you
 *  are exactly where you were.
 *
 *  So an overlay that closes in order to GO somewhere has to say so. Its entry
 *  is left on the stack, which is also the behaviour you want: Back from the
 *  new page returns to the page the overlay was opened from. */
let navigatingAway = false;

/** Call immediately BEFORE `router.push`/`replace` when a click both navigates
 *  and closes an overlay. Without it the close undoes the navigation. */
export function keepOverlayHistoryOnNavigate(): void {
  navigatingAway = true;
  // Self-clearing, so a navigation that never happens cannot leave every later
  // overlay unable to tidy up after itself. One frame is far longer than the
  // gap between the click handler and the effect cleanup it triggers.
  setTimeout(() => {
    navigatingAway = false;
  }, 0);
}

/** Make the browser BACK button close an overlay instead of leaving the page.
 *
 * Without this, opening a modal and pressing back navigates away entirely —
 * which on the Vendors page meant clicking "Edit details" and then back threw
 * you off the page you were working on. Back is the natural "dismiss" gesture
 * on a phone, and it was doing something far more destructive.
 *
 * How it works: opening pushes one history entry that changes nothing visible.
 * Back pops that entry, we see popstate, and close. Closing by any other route
 * (the ✕, Escape, the backdrop) removes the entry we added, so the user is never
 * left with a phantom step that appears to do nothing.
 */
export function useBackToClose(open: boolean, onClose: () => void) {
  // Whether OUR entry is currently on the stack, so we never pop somebody
  // else's — going back twice as fast as React re-renders would otherwise
  // steal a real navigation.
  const pushed = useRef(false);
  // Kept in a ref so a changing onClose never re-runs the effect (which would
  // push a second history entry). Written in an effect, not during render:
  // React may render speculatively and throw the result away.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    // A token unique to THIS overlay, so cleanup can tell its own history
    // entry from somebody else's.
    const id = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.history.pushState({ overlay: id }, "");
    pushed.current = true;

    const onPop = () => {
      // Was this OUR doing?
      //
      // history.back() is ASYNCHRONOUS. When one overlay closes and opens
      // another in the same commit — the vendor sheet's "Edit details" — the
      // sheet's cleanup calls back(), the modal mounts and subscribes, and
      // THEN the popstate arrives and hits the modal instead. That is why the
      // edit form opened and vanished in the same breath, three reports
      // running. A pop we caused ourselves belongs to nobody.
      if (selfPop) {
        // NOT cleared here. `popstate` is dispatched to EVERY registered
        // listener in one round, and clearing the flag in the first one to run
        // meant the second saw `false` and closed itself.
        //
        // With two overlays that was invisible — the only other listener was
        // the one doing the popping. With THREE it is the bug he reported:
        //
        //   "if i click any item see, previous popup closed, which is making me
        //    to jump 1 popup, skip in between."
        //
        // Measured, not guessed. Instrumenting `history` on the live site gave:
        //   -listener (live=3)   the price sheet detaches
        //   history.back() with live=3
        //   popstate delivered (live=3)   ONE event, THREE listeners
        //   -listener (live=2)   the CATEGORY unmounts
        // The supplier's handler (registered first) ate the flag; the
        // category's then saw false and closed. So ✕ on the price sheet landed
        // on the supplier, exactly the skipped step he described — even after
        // the stacking itself was fixed.
        //
        // `claimPop` clears it after the whole round instead.
        return;
      }
      pushed.current = false;
      close.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way: take our entry back off, or the next Back press
      // would appear to do nothing at all.
      //
      // ⚠️ ONLY if the top of the stack is still OURS. One overlay opening
      // another — the vendor sheet's "Edit details" — closes the first while
      // the second has already pushed. A blind history.back() then popped the
      // NEW overlay's entry, whose popstate handler closed it immediately: the
      // edit form opened and vanished in the same frame, which looked exactly
      // like a dead button. If somebody else is on top, leave the stack alone.
      // Going somewhere: leave the entry alone. See the note on
      // `navigatingAway` above — popping here is what silently cancelled the
      // navigation seven times running.
      if (navigatingAway) {
        pushed.current = false;
        return;
      }
      const top = (window.history.state as { overlay?: string } | null)?.overlay;
      if (pushed.current && top === id) {
        pushed.current = false;
        // Claim the pop before it happens, so whichever overlay is listening
        // when it lands knows it was not meant for them.
        claimPop();
        window.history.back();
      }
      pushed.current = false;
    };
  }, [open]);
}
