export type AuthRedirectInput = {
  pathname: string;
  search: string;
  signedIn: boolean;
};

const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);
const AUTH_PAGES = new Set(["/login", "/signup"]);
const DEFAULT_NEXT = "/dashboard";

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/")) return DEFAULT_NEXT;
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT;
  // Browsers strip tabs and newlines, which could turn "/\t/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(next)) return DEFAULT_NEXT;
  return next;
}

export function authRedirect({ pathname, search, signedIn }: AuthRedirectInput): string | null {
  if (signedIn) {
    return AUTH_PAGES.has(pathname) ? DEFAULT_NEXT : null;
  }
  if (isPublicPath(pathname)) return null;
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}
