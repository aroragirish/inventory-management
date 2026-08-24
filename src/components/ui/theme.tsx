"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { cn } from "@/lib/format";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "inv-theme";

/**
 * Runs before paint so the page never flashes the wrong theme. Kept as a raw
 * string because it has to be inlined into <head> ahead of React hydrating.
 */
export const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var dark = stored === 'dark' ||
      ((!stored || stored === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

function apply(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * The stored choice lives in localStorage, which is outside React. Reading it
 * through useSyncExternalStore keeps the server render ("system") and the
 * client render consistent without an effect that re-renders after mount.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the theme should update this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if ((localStorage.getItem(STORAGE_KEY) ?? "system") === "system") apply("system");
  };
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onMedia);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMedia);
  };
}

function getSnapshot(): ThemeChoice {
  try {
    return (localStorage.getItem(STORAGE_KEY) as ThemeChoice) ?? "system";
  } catch {
    return "system";
  }
}

/** The server has no localStorage; "system" matches what the inline script does. */
const getServerSnapshot = (): ThemeChoice => "system";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const choose = useCallback((next: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    for (const listener of listeners) listener();
  }, []);

  if (compact) {
    // Single button that flips between light and dark — for the mobile header.
    const isDark =
      choice === "dark" ||
      (choice === "system" &&
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    return (
      <button
        type="button"
        aria-label="Switch theme"
        onClick={() => choose(isDark ? "light" : "dark")}
        className="grid h-10 w-10 place-items-center rounded-lg text-muted-strong transition-colors hover:bg-surface-2"
      >
        <Sun className="h-5 w-5 dark:hidden" />
        <Moon className="hidden h-5 w-5 dark:block" />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            "grid h-8 w-9 place-items-center rounded-md transition-colors",
            choice === value
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
