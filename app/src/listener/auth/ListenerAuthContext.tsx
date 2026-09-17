import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { listenerApi } from "../../api/client";

interface ListenerAuthState {
  status: "checking" | "authenticated" | "anonymous";
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const ListenerAuthContext = createContext<ListenerAuthState | null>(null);

// Unlike Studio auth, this never blocks rendering - the listener app stays
// fully browsable while anonymous, and only favouriting / history reads and
// writes require being signed in.
export function ListenerAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ListenerAuthState["status"]>("checking");

  useEffect(() => {
    listenerApi
      .session()
      .then((r) => setStatus(r.authenticated ? "authenticated" : "anonymous"))
      .catch(() => setStatus("anonymous"));
  }, []);

  const login = useCallback(async (password: string) => {
    await listenerApi.login(password);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await listenerApi.logout();
    setStatus("anonymous");
  }, []);

  return (
    <ListenerAuthContext.Provider value={{ status, login, logout }}>{children}</ListenerAuthContext.Provider>
  );
}

export function useListenerAuth(): ListenerAuthState {
  const ctx = useContext(ListenerAuthContext);
  if (!ctx) throw new Error("useListenerAuth must be used within ListenerAuthProvider");
  return ctx;
}
