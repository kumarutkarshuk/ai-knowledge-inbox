import { NavLink, Outlet } from "react-router";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Ask" },
  { to: "/library", label: "Library" },
];

export function Layout() {
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <span className="font-semibold">AI Knowledge Inbox</span>
          <nav aria-label="Main" className="flex gap-4 text-sm">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) =>
                  cn(
                    "text-muted-foreground hover:text-foreground",
                    isActive && "font-medium text-foreground",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
