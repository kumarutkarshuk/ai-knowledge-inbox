import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getTheme, setTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    setTheme(next);
    setThemeState(next);
  }

  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Switch to ${next} mode`} onClick={toggle}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
