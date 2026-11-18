import { Navigate, Outlet } from "react-router";
import { getToken } from "@/lib/auth";

export function RequireAuth() {
  return getToken() ? <Outlet /> : <Navigate to="/login" replace />;
}
