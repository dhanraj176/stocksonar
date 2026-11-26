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

// A same-site path starts with a single "/". "//host" and "/\host" are read
// as other hosts, and browsers strip tabs and newlines, which could turn
// "/\t/evil.com" into "//evil.com".
function isSameSitePath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\") &&
    !/[\u0000-\u001f\u007f]/.test(path)
  );
}

export function safeNextPath(next: string | null): string {
  return next && isSameSitePath(next) ? next : DEFAULT_NEXT;
}

export function authRedirect({ pathname, search, signedIn }: AuthRedirectInput): string | null {
  if (signedIn) {
    return AUTH_PAGES.has(pathname) ? DEFAULT_NEXT : null;
  }
  if (isPublicPath(pathname)) return null;
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}
