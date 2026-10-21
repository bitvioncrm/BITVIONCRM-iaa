import { cn } from "@/lib/utils";

export function Logo({ className, mark = false }: { className?: string; mark?: boolean }) {
  return (
    <img
      src="/logo.png"
      alt="Dr. K's"
      className={cn("bg-white object-contain", mark ? "rounded-md p-0.5" : "rounded-lg", className)}
    />
  );
}
