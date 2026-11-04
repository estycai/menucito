export interface LocalTab {
  id: "general" | "appearance" | "hours" | "payments" | "zones";
  label: string;
  /** Path segment under `/local`. */
  path: string;
}

/** Tabs of "Mi local", in display order. Each one has its own URL so it can be linked. */
export const LOCAL_TABS: readonly LocalTab[] = [
  { id: "appearance", label: "Apariencia", path: "apariencia" },
  { id: "general", label: "General", path: "general" },
  { id: "hours", label: "Horarios", path: "horarios" },
  { id: "payments", label: "Métodos de pago", path: "pagos" },
  { id: "zones", label: "Zonas de entrega", path: "zonas" },
];

export const localTabPath = (tab: LocalTab) => `/local/${tab.path}`;

/** Where `/local` (and any unknown `/local/...`) lands: "Apariencia". */
export const DEFAULT_LOCAL_TAB_PATH = "/local/apariencia";
