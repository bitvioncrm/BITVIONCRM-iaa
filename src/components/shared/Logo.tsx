import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string; mark?: boolean }) {
  return (
    <img
      src="/logo.png"
      alt="Dr. K's"
      className={cn("h-auto w-full object-contain", className)}
    />
  );
}
