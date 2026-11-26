import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/db/session";

// Refreshes the Supabase session cookies and sends signed-out users on
// protected pages to /login. Optimistic only: pages re-check with requireUser().
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Every path except Next internals, the favicon and static images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
