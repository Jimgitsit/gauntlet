// A small History-API router. Paths are real (`/changes/42`), prefixed with
// Vite's base so one build serves under the mount point.

import { useEffect, useState } from "react";

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function href(path: string): string {
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function currentPath(): string {
  const p = window.location.pathname;
  const rel = p.startsWith(BASE) ? p.slice(BASE.length) : p;
  return rel || "/";
}

export function navigate(path: string, replace = false): void {
  const url = href(path);
  if (replace) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.origin !== window.location.origin) {
        return;
      }
      if (!a.pathname.startsWith(`${BASE}/`)) {
        return;
      }
      e.preventDefault();
      const rel = a.pathname.slice(BASE.length) + a.search;
      navigate(rel || "/");
    };
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return path;
}

export function useQuery(): URLSearchParams {
  usePath();
  return new URLSearchParams(window.location.search);
}

export function setQuery(params: Record<string, string | null>): void {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === "") {
      q.delete(k);
    } else {
      q.set(k, v);
    }
  }
  const s = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
