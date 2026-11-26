export type SecFetcherDeps = {
  /** "AppName contact@email", required by the SEC on every request. */
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type SecFetcher = {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
};

export function createSecFetcher(deps: SecFetcherDeps): SecFetcher {
  const fail = async (url: string): Promise<never> => {
    throw new Error(`createSecFetcher is not implemented (${url}, ${typeof deps})`);
  };
  return { getJson: fail, getText: fail };
}
