export function createAuthCallbackHandler(_opts: {
  setSessionFromTokens: (accessToken: string, refreshToken: string) => void;
}) {
  return (_accessToken: string, _refreshToken: string) => {};
}
