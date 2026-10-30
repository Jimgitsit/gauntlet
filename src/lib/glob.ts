/** Minimal glob matcher: `**` spans directories, `*` stays within one segment. */
export function matchGlob(glob: string, path: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
