"use client";

// /signup — renders the shared AuthGate opened on the registration door.
// Switching to sign-in morphs in place (AuthGate syncs the URL).

import AuthGate from "@/components/auth/AuthGate";

export default function SignupPage() {
  return <AuthGate initialMode="signup" />;
}
