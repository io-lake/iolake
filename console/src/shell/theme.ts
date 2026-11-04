import { useCallback, useEffect, useState } from "react";

/// The viewer's theme choice. "system" follows the operating system; the
/// other two pin it. Kept per browser.
export type ThemePref = "system" | "light" | "dark";

const KEY = "iolake.theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/// Set `data-theme` on <html> for a pinned choice; "system" removes it, and
/// console-tokens.css then follows prefers-color-scheme.
function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

/// Apply the stored choice before the first render, so a dark choice doesn't
/// flash light.
apply(readPref());

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/// The theme choice, a setter, and whether the page is dark right now.
export function useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void; dark: boolean } {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [sysDark, setSysDark] = useState<boolean>(systemDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    try {
      if (p === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      // A browser that refuses storage still switches for this visit.
    }
    apply(p);
    setPrefState(p);
  }, []);

  return { pref, setPref, dark: pref === "dark" || (pref === "system" && sysDark) };
}
