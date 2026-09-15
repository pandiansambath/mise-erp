/** Where to go after signing in — and what is NOT allowed to be a destination.
 *
 *  THE BUG THIS FIXES: the app-group guard did `router.replace("/login")` and
 *  threw the destination away, while sign-in always pushed "/dashboard". So a
 *  deep link was swallowed. That is not only an annoyance for someone typing a
 *  URL: password-reset and document-request links arrive BY EMAIL, and a
 *  recipient who is not signed in lost the thing they were sent to.
 *
 *  THE RISK THIS GUARDS: a `?next=` parameter is attacker-controlled. Anyone
 *  can send a restaurant `…/login?next=https://evil.example/pay`, and if we
 *  redirect there after a successful sign-in the page looks like part of the
 *  app and asks for a card. That is the classic open redirect, and it is worth
 *  more care than the feature itself.
 *
 *  So this is an ALLOWLIST of shape, not a denylist of known-bad strings:
 *  one leading slash, no scheme, no host, and not a login screen (which would
 *  bounce forever).
 */

const FORBIDDEN_PREFIXES = ["/login", "/signup", "/logout", "/verify-email", "/reset-password", "/forgot-password"];

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // A malformed escape is not a path we are willing to guess at.
    return null;
  }

  // Must be a path on THIS origin.
  if (!value.startsWith("/")) return null;
  // "//evil.example" is protocol-relative — the browser treats it as a HOST.
  // This is the one that gets missed, because it does start with a slash.
  if (value.startsWith("//")) return null;
  // "/\evil.example" is the same trick with a backslash; some browsers
  // normalise it to "//".
  if (value.startsWith("/\\") || value.startsWith("/\\\\")) return null;
  // A scheme can hide after the slash in some parsers.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  // Control characters and whitespace can be used to smuggle past a check.
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;

  const path = value.split(/[?#]/)[0];
  if (FORBIDDEN_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return null;

  return value;
}

/** Read it off the current URL. Safe to call during render. */
export function nextFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return safeNext(new URLSearchParams(window.location.search).get("next"));
  } catch {
    return null;
  }
}
