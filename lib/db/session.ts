import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirect } from "@/lib/domain/auth-redirect";
import { publicEnv } from "./env";

// Runs in proxy.ts on every matched request. It refreshes the Supabase session
// cookies and does an optimistic redirect; pages still check the user with
// requireUser(), so this is not the only line of defence.
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = publicEnv();
  let response = NextResponse.next({ request });
  // Everything Supabase has written so far. setAll can run more than once, and
  // the cache headers arrive only with the first write, so each rebuilt
  // response gets all of it, not just the latest batch.
  const cookiesSet = new Map<string, CookieToSet>();
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach((cookie) => cookiesSet.set(cookie.name, cookie));
        cacheHeaders = { ...cacheHeaders, ...headers };

        // Update the request so server components in this render see the new
        // session, then rebuild the response so the browser gets it too.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        applySession(response, cookiesSet, cacheHeaders);
      },
    },
  });

  // getClaims() verifies the JWT and refreshes an expired session. Nothing may
  // run between creating the client and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const target = authRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    signedIn,
  });
  if (!target) return response;

  const redirect = NextResponse.redirect(new URL(target, request.url));
  applySession(redirect, cookiesSet, cacheHeaders);
  return redirect;
}

type CookieToSet = { name: string; value: string; options: CookieOptions };

function applySession(
  response: NextResponse,
  cookiesSet: Map<string, CookieToSet>,
  cacheHeaders: Record<string, string>,
) {
  cookiesSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
}
