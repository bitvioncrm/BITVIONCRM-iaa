import { Button } from "@/components/ui/button";
import type { CallOutcome } from "@/lib/call-time";

export function CallResultButtons({ busy, onResult }: { busy?: boolean; onResult: (outcome: CallOutcome) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={() => onResult("connected")}>Connected</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onResult("rejected")}>Rejected</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onResult("no_answer")}>No answer</Button>
    </div>
  );
}
