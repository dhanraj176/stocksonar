export type AuthRedirectInput = {
  pathname: string;
  search: string;
  signedIn: boolean;
};

export function isPublicPath(_pathname: string): boolean {
  throw new Error("not implemented");
}

export function safeNextPath(_next: string | null): string {
  throw new Error("not implemented");
}

export function authRedirect(_input: AuthRedirectInput): string | null {
  throw new Error("not implemented");
}
