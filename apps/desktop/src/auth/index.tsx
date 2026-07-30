import { createContext, useContext, type ReactNode } from "react";

type AuthSession = {
  access_token: string;
  user: { id: string; email: string };
};

type AuthContextValue = {
  session: AuthSession | null;
  isRefreshingSession: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<AuthSession | null>;
  handleAuthCallback: (url: string) => Promise<void>;
  setSessionFromTokens: (accessToken: string, refreshToken: string) => void;
};

const defaultValue: AuthContextValue = {
  session: {
    access_token: "",
    user: { id: "local-user", email: "local@zhnote.local" },
  },
  isRefreshingSession: false,
  signIn: async () => {},
  signOut: async () => {},
  refreshSession: async () => null,
  handleAuthCallback: async () => {},
  setSessionFromTokens: () => {},
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={defaultValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
