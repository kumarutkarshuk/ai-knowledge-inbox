import { Analytics } from "@vercel/analytics/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { routes } from "@/routes";
import "./index.css";

const router = createBrowserRouter(routes);
const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Analytics />
  </StrictMode>,
);
