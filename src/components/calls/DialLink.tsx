import type { MouseEvent, ReactNode } from "react";
import { useCallSession } from "@/context/CallSessionContext";
import { phoneTel } from "@/lib/phone";

export function DialLink({ organizationId, workspaceId, leadId, name, phone, className, children }: {
  organizationId: string;
  workspaceId: string;
  leadId?: string | null;
  name: string;
  phone: string;
  className?: string;
  children?: ReactNode;
}) {
  const { start, live, busy } = useCallSession();
  const href = phoneTel(phone);
  if (!href) return null;
  return (
    <a
      href={href}
      className={className ?? "inline-flex min-h-11 items-center text-sm font-medium text-navy"}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
        if (busy || live) {
          event.preventDefault();
          return;
        }
        void start({ organizationId, workspaceId, leadId, name }).catch(() => undefined);
      }}
    >
      {children ?? "Call"}
    </a>
  );
}
