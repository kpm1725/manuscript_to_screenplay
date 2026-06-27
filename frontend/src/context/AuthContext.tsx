import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { makeRedirectUri } from "expo-auth-session";
import { apiFetch, clearToken, getToken, setToken } from "@/src/api/client";

WebBrowser.maybeCompleteAuthSession();

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // expo-auth-session Google provider
  // Replace the clientId values with your actual Google OAuth client IDs
  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,        // Web OAuth client (also used for Expo Go)
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    redirectUri: makeRedirectUri({ scheme: "scribe" }),
  });

  // Bootstrap: check for existing session token
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const t = await getToken();
        if (t) {
          const me = await apiFetch<{ user: User }>("/auth/me");
          if (mounted) setUser(me.user);
        }
      } catch {
        await clearToken();
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Handle Google OAuth response
  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.authentication?.idToken;
      if (idToken) {
        (async () => {
          try {
            const data = await apiFetch<{ user: User; session_token: string }>(
              "/auth/google",
              { method: "POST", body: { id_token: idToken }, auth: false }
            );
            await setToken(data.session_token);
            setUser(data.user);
          } catch (e) {
            console.warn("Google sign-in exchange failed", e);
          }
        })();
      }
    }
  }, [response]);

  const signIn = useCallback(async () => {
    await promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
