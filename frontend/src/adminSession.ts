export type AdminSessionStorage = {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
};

const adminSessionKey = "mcu-admin-session";
const consoleSessionKey = "mcu-console-session";

export type ConsoleSession =
  | { readonly role: "admin"; readonly token: string }
  | { readonly role: "project_user"; readonly token: string; readonly projectId: string; readonly username: string };

export const readAdminSession = (storage: AdminSessionStorage): string => storage.getItem(adminSessionKey) ?? "";

export const saveAdminSession = (storage: AdminSessionStorage, token: string): void => {
  storage.setItem(adminSessionKey, token);
};

export const clearAdminSession = (storage: AdminSessionStorage): void => {
  storage.removeItem(adminSessionKey);
};

export const readConsoleSession = (storage: AdminSessionStorage): ConsoleSession | null => {
  const raw = storage.getItem(consoleSessionKey);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const role = Reflect.get(value, "role");
    const token = Reflect.get(value, "token");
    if (typeof token !== "string" || token.length === 0) return null;
    if (role === "admin") return { role, token };
    const projectId = Reflect.get(value, "projectId");
    const username = Reflect.get(value, "username");
    if (role === "project_user" && typeof projectId === "string" && projectId.length > 0 && typeof username === "string" && username.length > 0) return { role, token, projectId, username };
    return null;
  } catch {
    return null;
  }
};

export const saveConsoleSession = (storage: AdminSessionStorage, session: ConsoleSession): void => {
  storage.setItem(consoleSessionKey, JSON.stringify(session));
};

export const clearConsoleSession = (storage: AdminSessionStorage): void => {
  storage.removeItem(consoleSessionKey);
};
