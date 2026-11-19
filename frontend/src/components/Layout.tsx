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

const linkClass =
  "relative flex h-full items-center font-medium whitespace-nowrap text-muted-foreground transition-[color] duration-(--dur-micro) after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-transparent hover:text-foreground";

export function Layout() {
  const navigate = useNavigate();
  const [answering, setAnswering] = useState(false);

  function logout() {
    clearToken();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-svh">
      <header className="rule-double sticky top-0 z-(--z-sticky-nav) bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 px-4 sm:h-16 sm:flex-nowrap sm:px-6">
          <span className="flex h-14 items-center font-heading text-lg leading-none font-bold tracking-[-0.02em] whitespace-nowrap sm:h-auto sm:text-xl">
            AI Knowledge Inbox
          </span>
          <nav
            aria-label="Main"
            className="order-last flex h-11 w-full gap-5 sm:order-none sm:h-full sm:w-auto"
          >
            {links.map((link) =>
              answering && link.blockWhileAnswering ? (
                <span
                  key={link.to}
                  role="link"
                  aria-disabled="true"
                  title="Wait for the answer to finish"
                  className={cn(
                    linkClass,
                    "cursor-not-allowed opacity-55 hover:text-muted-foreground",
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
                    cn(linkClass, isActive && "text-foreground after:bg-brick")
                  }
                >
                  {link.label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet context={{ setAnswering } satisfies LayoutContext} />
      </main>
    </div>
  );
}
