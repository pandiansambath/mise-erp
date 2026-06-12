// Remounts on every route change inside the app group, so each page glides in.
// The animation lives in globals.css (.mise-page) and respects reduced motion.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="mise-page">{children}</div>;
}
