import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Ask' },
  { to: '/library', label: 'Library' },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <nav className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <span className="font-semibold">AI Knowledge Inbox</span>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end
              className={({ isActive }) =>
                cn(
                  'text-sm text-muted-foreground hover:text-foreground',
                  isActive && 'font-medium text-foreground',
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
