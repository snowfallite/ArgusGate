import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { api } from "@/api/client";

/** Возвращает true если токен истёк или невалиден */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export interface UserInfo {
  user_id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
}

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  /** @deprecated use user.username */
  username: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  username: null,
  isLoading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    const stored = localStorage.getItem("token");
    // Сразу сбрасываем истёкший токен
    if (stored && isTokenExpired(stored)) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      return null;
    }
    return stored;
  });
  const [user, setUser] = useState<UserInfo | null>(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    // Дополнительная проверка на случай если токен истёк пока приложение было открыто
    if (isTokenExpired(token)) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setToken(null);
      setUser(null);
      setIsLoading(false);
      return;
    }
    api.get<UserInfo>("/auth/me")
      .then((me) => {
        setUser(me);
        localStorage.setItem("user", JSON.stringify(me));
        setIsLoading(false);
      })
      .catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setToken(null);
        setUser(null);
        setIsLoading(false);
      });
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ access_token: string }>("/auth/login", { username, password });
    localStorage.setItem("token", res.access_token);
    setToken(res.access_token);

    // Загружаем полный профиль после логина
    const me = await api.get<UserInfo>("/auth/me");
    setUser(me);
    localStorage.setItem("user", JSON.stringify(me));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        username: user?.username ?? null,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
