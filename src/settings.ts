import { useEffect, useState } from "react";
import type { ColumnKey, SortDir, Theme } from "./types";

export interface AlertSettings {
  enabled: boolean;
  cpu: number;
  mem: number;
  seconds: number;
}

export interface Settings {
  sortKey: ColumnKey;
  sortDir: SortDir;
  columns: ColumnKey[];
  rate: number;
  theme: Theme;
  tree: boolean;
  mineOnly: boolean;
  showGraphs: boolean;
  /** Hide to the tray instead of quitting when the window is closed. */
  closeToTray: boolean;
  alerts: AlertSettings;
}

const KEY = "systask.settings.v1";

export const DEFAULTS: Settings = {
  sortKey: "cpu",
  sortDir: "desc",
  columns: ["name", "pid", "user", "cpu", "mem", "status", "cmd"],
  rate: 1000,
  theme: "system",
  tree: false,
  mineOnly: false,
  showGraphs: true,
  closeToTray: false,
  alerts: { enabled: true, cpu: 90, mem: 90, seconds: 10 },
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...p, alerts: { ...DEFAULTS.alerts, ...(p.alerts ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }, [s]);
  return [s, (patch) => setS((cur) => ({ ...cur, ...patch }))];
}
