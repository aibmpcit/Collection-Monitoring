import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiRequest } from "../services/api";
import type { Role, User } from "../types/models";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeRole(role: string | null | undefined): Role {
  const value = (role ?? "").trim().toLowerCase();
  if (value === "super_admin" || value === "superadmin" || value === "super admin" || value === "admin") {
    return "super_admin";
  }
  if (value === "branch_admin" || value === "branchadmin" || value === "branch admin") {
    return "branch_admin";
  }
  return "staff";
}

function normalizeUserRole<T extends { role?: string }>(user: T): T & { role: Role } {
  return {
    ...user,
    role: normalizeRole(user.role)
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    return normalizeUserRole(parsed);
  });

  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));

  async function login(username: string, password: string) {
    const response = await apiRequest<{ token: string; user: Omit<User, "role"> & { role: string } }>("/auth/login", "POST", {
      username,
      password
    });
    const normalizedUser = normalizeUserRole(response.user);

    setToken(response.token);
    setUser(normalizedUser);
    localStorage.setItem("token", response.token);
    localStorage.setItem("user", JSON.stringify(normalizedUser));
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

  const value = useMemo(() => ({ user, token, login, logout }), [user, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
