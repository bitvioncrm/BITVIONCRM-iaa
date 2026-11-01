import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Sheet({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export function SheetContent({ className, children, title }: { className?: string; children: ReactNode; title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0e1420]/40" />
      <DialogPrimitive.Content
        className={cn(
          "sheet-panel fixed inset-0 z-50 flex h-dvh w-full flex-col bg-white shadow-pop sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-w-2xl sm:border-l sm:border-line",
          className,
        )}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 z-20 flex size-11 items-center justify-center rounded-full bg-white text-muted shadow-sm hover:bg-slate-100">
          <X className="size-5" />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("sticky top-0 z-10 border-b border-line bg-white/95 px-4 py-4 pr-14 backdrop-blur-sm pt-[max(1rem,env(safe-area-inset-top))] sm:px-5", className)} {...props} />;
}

export function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto overscroll-contain bg-[#f6f4ef] px-3 py-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:bg-white sm:px-5 sm:py-4", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line px-5 py-3", className)} {...props} />;
}
