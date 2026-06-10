import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Display serif for the landing — the typographic voice of a fine-dining menu.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: {
    default: "Mise — Every plate, every penny, in its place.",
    template: "%s · Mise",
  },
  description:
    "The restaurant operating system: recipes costed to the gram, live inventory and purchasing, staff and payroll, and a real-time P&L — one platform for the whole brigade.",
  openGraph: {
    title: "Mise — Every plate, every penny, in its place.",
    description:
      "Recipes costed to the gram, live inventory, purchasing, payroll and a real-time P&L — the operating system for your restaurant.",
    siteName: "Mise",
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
            <CurrencyProvider>{children}</CurrencyProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
