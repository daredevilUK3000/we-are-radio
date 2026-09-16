import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { studioApi } from "../../api/client";

interface StudioAuthState {
  status: "checking" | "authenticated" | "anonymous";
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const StudioAuthContext = createContext<StudioAuthState | null>(null);

export function StudioAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StudioAuthState["status"]>("checking");

  useEffect(() => {
    studioApi
      .channels()
      .then(() => setStatus("authenticated"))
      .catch(() => setStatus("anonymous"));
  }, []);

  const login = useCallback(async (password: string) => {
    await studioApi.login(password);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await studioApi.logout();
    setStatus("anonymous");
  }, []);

  return (
    <StudioAuthContext.Provider value={{ status, login, logout }}>{children}</StudioAuthContext.Provider>
  );
}

export function useStudioAuth(): StudioAuthState {
  const ctx = useContext(StudioAuthContext);
  if (!ctx) throw new Error("useStudioAuth must be used within StudioAuthProvider");
  return ctx;
}
