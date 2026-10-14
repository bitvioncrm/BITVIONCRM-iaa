import { Phone } from "lucide-react";
import type { MouseEvent } from "react";
import { phoneTel } from "@/lib/phone";
import { cn, formatPhone } from "@/lib/utils";

export function PhoneLink({ phone, className, onClick }: { phone: string; className?: string; onClick?: () => void }) {
  const label = formatPhone(phone);
  const href = phoneTel(phone);
  if (!href) return <span className={className}>{label}</span>;
  return (
    <a
      href={href}
      className={cn("inline-flex items-center gap-1 font-medium text-navy hover:underline", className)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <Phone className="size-3.5 shrink-0" />
      {label}
    </a>
  );
}
