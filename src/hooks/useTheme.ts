import { useTheme as useNextTheme } from 'next-themes';

export function useTheme() {
  const { resolvedTheme, theme, setTheme } = useNextTheme();

  const effectiveTheme = resolvedTheme ?? theme;
  const isDark = effectiveTheme === 'dark';

  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  return { isDark, toggleTheme };
}
