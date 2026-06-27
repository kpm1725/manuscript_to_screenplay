import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
export const API_BASE = `${BASE}/api`;
const TOKEN_KEY = "scribe_session_token";

export async function getToken(): Promise<string | null> {
  const v = await storage.secureGet<string>(TOKEN_KEY, "");
  return v && typeof v === "string" && v.length > 0 ? v : null;
}

export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

type Opts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: any;
  auth?: boolean;
};

export async function apiFetch<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.auth !== false) {
    const t = await getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as any;
  return (await res.json()) as T;
}
