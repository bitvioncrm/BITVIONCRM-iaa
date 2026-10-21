import type { MouseEvent } from "react";
import { whatsAppHref } from "@/lib/phone";
import { cn } from "@/lib/utils";

export function WhatsAppLink({ phone, text = "", label = "Open WhatsApp", className }: { phone: string; text?: string; label?: string; className?: string }) {
  const href = whatsAppHref(phone, text);
  if (!href) return <span className={cn("text-xs text-muted", className)}>No number</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={cn("inline-flex size-8 items-center justify-center rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5d]", className)}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
    >
      <WhatsAppMark className="size-4" />
    </a>
  );
}

function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.5 3.5A11 11 0 0 0 2.1 16.8L1 23l6.4-1.1A11 11 0 0 0 12 23a11 11 0 0 0 8.5-19.5zM12 21a9 9 0 0 1-4.6-1.3l-.3-.2-3.8.6.6-3.7-.2-.3A9 9 0 1 1 12 21zm5-6.7c-.3-.1-1.6-.8-1.8-.9s-.4-.1-.6.1-.7.9-.8 1-.3.2-.6.1a7.4 7.4 0 0 1-2.2-1.4 8.2 8.2 0 0 1-1.5-1.9c-.2-.3 0-.4.1-.6l.4-.5c.1-.1.2-.3.2-.4s0-.3-.1-.5-.6-1.4-.8-1.9-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3s-1 .9-1 2.3 1 2.6 1.1 2.8 2 3.1 4.8 4.3c.7.3 1.2.4 1.6.5.7.2 1.3.2 1.8.1.5-.1 1.6-.7 1.8-1.3s.2-1.2.2-1.3-.2-.2-.5-.3z"
      />
    </svg>
  );
}
