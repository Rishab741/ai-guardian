"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void; resolvedDark: boolean }>({
  theme: "system",
  setTheme: () => {},
  resolvedDark: false,
});

const STORAGE_KEY = "sovereignfabric-theme";

// Runs before paint (inlined in <head> via the script below in layout.tsx)
// to stamp data-theme ahead of hydration, so there's no flash of the wrong
// theme on load. Kept here as the source of truth for the string.
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedDark, setResolvedDark] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark") setThemeState(stored);
    } catch {}
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      setResolvedDark(dark);
      const root = document.documentElement;
      root.classList.add("theme-transition");
      if (theme === "system") {
        root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", theme);
      }
      window.setTimeout(() => root.classList.remove("theme-transition"), 300);
    }
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      if (t === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, t);
    } catch {}
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, resolvedDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
