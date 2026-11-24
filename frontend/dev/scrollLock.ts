"use client";

// The page held still behind something over it (a popup, the album, the résumé).
//
// On the <html>, never the <body>: the product's stylesheet clips the page sideways, and a
// body told to hide its overflow then becomes a scroll box of its own — every sticky thing
// in it lets go. His name, the orbit and the skeleton vanished from behind any popup opened
// below the first screen; the blur hid it until the Template stood beside the clear page
// (24 Nov).

let held = 0;

export function holdScroll(): () => void {
  if (held++ === 0) document.documentElement.style.overflow = "hidden";
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--held === 0) document.documentElement.style.overflow = "";
  };
}
