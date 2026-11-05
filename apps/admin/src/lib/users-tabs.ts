export interface UsersTab {
  id: "members" | "roles";
  label: string;
  /** Path segment under `/usuarios`. */
  path: string;
}

/** Tabs of "Usuarios", in display order. Each one has its own URL so it can be linked. */
export const USERS_TABS: readonly UsersTab[] = [
  { id: "members", label: "Usuarios", path: "lista" },
  { id: "roles", label: "Roles y permisos", path: "roles" },
];

export const usersTabPath = (tab: UsersTab) => `/usuarios/${tab.path}`;

/** Where `/usuarios` (and any unknown `/usuarios/...`) lands: the user list. */
export const DEFAULT_USERS_TAB_PATH = "/usuarios/lista";
