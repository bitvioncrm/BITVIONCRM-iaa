import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("bitvion.theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      type="button"
      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-slate-100"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => setDark((value) => !value)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
