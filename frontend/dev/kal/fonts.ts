// KAL's letters (docs/temple/ART.md 5.1). Local, as all the page's are (app/layout.tsx).

import localFont from "next/font/local";

export const cut = localFont({ src: "../../app/fonts/cinzel.woff2", weight: "400 700", display: "swap", variable: "--kal-cut" });
export const serif = localFont({
  src: [
    { path: "../../app/fonts/source-serif.woff2", style: "normal", weight: "400 600" },
    { path: "../../app/fonts/source-serif-italic.woff2", style: "italic", weight: "400" },
  ],
  display: "swap",
  variable: "--kal-serif",
});
export const tamil = localFont({
  src: "../../app/fonts/noto-serif-tamil.woff2",
  weight: "500 700",
  display: "swap",
  variable: "--kal-tamil",
  declarations: [{ prop: "unicode-range", value: "U+0B80-0BFF, U+200C-200D, U+25CC" }],
});
