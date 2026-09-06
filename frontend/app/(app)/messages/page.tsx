"use client";

// The old address for hotel-to-hotel chat.
//
// It is now one side of a single Messages page rather than a page of its own —
// "here itself integrate all message related" — so this address forwards rather
// than 404s. Bookmarks and the ⌘K palette both still work, and anyone who lands
// here from an old link ends up where the conversation actually is.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MessagesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/chat");
  }, [router]);
  return null;
}
