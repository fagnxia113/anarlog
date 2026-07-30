export async function resolveShellEntryPath(): Promise<"/app/main"> {
  return "/app/main";
}

export async function resolveAppEntryPath(): Promise<"/app/main"> {
  return resolveShellEntryPath();
}

export function normalizeAppPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function isShellEntryPath(pathname: string): boolean {
  const normalizedPath = normalizeAppPath(pathname);
  return normalizedPath === "/app" || normalizedPath === "/app/main";
}
