"use client";

// /login — renders the shared AuthGate opened on the sign-in door.
// Switching to registration morphs in place (AuthGate syncs the URL).

import AuthGate from "@/components/auth/AuthGate";

export default function LoginPage() {
  return <AuthGate initialMode="login" />;
}
