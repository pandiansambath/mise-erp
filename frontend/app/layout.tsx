import { Ripple } from "@/components/Ripple";
import type { Metadata, Viewport } from "next";
// Local, not next/font/google.
//
// next/font/google downloads at BUILD time, and twice a deploy went red with
// "Error while requesting resource" — nothing wrong with the change, just
// Google briefly unreachable from the Docker build. A deploy that can fail for
// a reason unrelated to what is being deployed is not one you can trust, and
// the fonts are 354KB of woff2 that never change.
//
// Latin subset only: this app is English-only, so cyrillic and greek would be
// megabytes for nothing.
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";

const geistSans = localFont({
  src: "./fonts/geist.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/geist-mono.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

// Display serif for the landing — the typographic voice of a fine-dining menu.
const fraunces = localFont({
  // Variable across weight AND optical size, which is why the display face
  // holds up from a 12px label to a 48px page title.
  src: [
    { path: "./fonts/fraunces.woff2", style: "normal", weight: "100 900" },
    { path: "./fonts/fraunces-italic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DineAI — Every plate, every penny, in its place.",
    template: "%s · DineAI",
  },
  description:
    "The restaurant operating system: recipes costed to the gram, live inventory and purchasing, staff and payroll, and a real-time P&L — one platform for the whole brigade.",
  openGraph: {
    title: "DineAI — Every plate, every penny, in its place.",
    description:
      "Recipes costed to the gram, live inventory, purchasing, payroll and a real-time P&L — the operating system for your restaurant.",
    siteName: "DineAI",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased motion-safe:scroll-smooth`}
    >
      <body className="min-h-full">
        <AuthProvider>
          <ThemeProvider>
            <CurrencyProvider>
              {children}
              {/* A drop in water wherever you touch — app, landing, dev page
                  alike. It sits above everything and can never take a click. */}
              <Ripple />
            </CurrencyProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
