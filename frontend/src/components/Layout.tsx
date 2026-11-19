import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

export interface LayoutContext {
  setAnswering: (answering: boolean) => void;
}

const links = [
  { to: "/", label: "Ask", blockWhileAnswering: false },
  { to: "/library", label: "Library", blockWhileAnswering: true },
];

const linkClass = "text-muted-foreground hover:text-foreground";

export function Layout() {
  const navigate = useNavigate();
  const [answering, setAnswering] = useState(false);

  function logout() {
    clearToken();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <span className="font-semibold">AI Knowledge Inbox</span>
          <nav aria-label="Main" className="flex gap-4 text-sm">
            {links.map((link) =>
              answering && link.blockWhileAnswering ? (
                <span
                  key={link.to}
                  role="link"
                  aria-disabled="true"
                  title="Wait for the answer to finish"
                  className={cn(
                    linkClass,
                    "cursor-not-allowed opacity-50 hover:text-muted-foreground",
                  )}
                >
                  {link.label}
                </span>
              ) : (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end
                  className={({ isActive }) =>
                    cn(linkClass, isActive && "font-medium text-foreground")
                  }
                >
                  {link.label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4">
        <Outlet context={{ setAnswering } satisfies LayoutContext} />
      </main>
    </div>
  );
}
