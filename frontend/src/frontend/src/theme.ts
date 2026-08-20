import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";
const themeKey = "mcu-theme";

const readTheme = (): ThemeMode => localStorage.getItem(themeKey) === "dark" ? "dark" : "light";

export const useTheme = (): readonly [ThemeMode, () => void] => {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  useEffect(() => {
    localStorage.setItem(themeKey, theme);
  }, [theme]);
  const toggleTheme = useCallback((): void => {
    setTheme((current) => current === "dark" ? "light" : "dark");
  }, []);
  return [theme, toggleTheme] as const;
};
