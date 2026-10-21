import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/context/CrmContext";
import { renderTemplate, userName } from "@/lib/template";
import type { Lead } from "@/types";

export function SendWhatsAppDialog({
  lead,
  open,
  templateKey,
  onOpenChange,
}: {
  lead: Lead | null;
  open: boolean;
  templateKey?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, sendWhatsApp } = useCrm();
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");

  const previewLead = lead;
  const selected = state.templates.find((item) => item.id === templateId);

  const preview = useMemo(() => {
    if (!previewLead) return body;
    return renderTemplate(body, previewLead, state.settings, userName(state.users, previewLead.assignedTo));
  }, [body, previewLead, state.settings, state.users]);

  useEffect(() => {
    if (!open) return;
    const match = state.templates.find((item) => item.key === templateKey) ?? state.templates.find((item) => item.key === "WELCOME_MESSAGE");
    setTemplateId(match?.id ?? "");
    if (match && lead) setBody(match.body);
  }, [lead, open, state.templates, templateKey]);

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send WhatsApp</DialogTitle>
          <DialogDescription>
            {lead.whatsappAutomation
              ? "Demo Mode — clinic automation can send this. The WhatsApp API is not connected."
              : "Direct connect — institute leads are not automated. This message stays inside Dr. K's."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-[13px] font-medium">
              Template
              <Select
                className="mt-1.5"
                value={templateId}
                onChange={(event) => {
                  const next = state.templates.find((item) => item.id === event.target.value);
                  setTemplateId(event.target.value);
                  if (next) setBody(next.body);
                }}
              >
                <option value="">Custom message</option>
                {state.templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </Select>
            </label>
            <label className="block text-[13px] font-medium">
              Message
              <Textarea className="mt-1.5" value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            {selected ? <p className="text-xs text-muted">Key: {selected.key}</p> : null}
          </div>
          <div className="rounded-lg border border-line bg-canvas p-3">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Preview</p>
            <div className="mt-3 rounded-lg border border-line bg-white p-3 text-sm leading-6">{preview || "Write a message to preview it."}</div>
            <p className="mt-3 text-xs text-muted">Variables use {lead.fullName.split(" ")[0]} and {lead.position}.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const failed = sendWhatsApp({ leadId: lead.id, body: body || " ", templateId, fail: true });
              if (!failed) onOpenChange(false);
            }}
          >
            Simulate failed send
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => {
                const ok = sendWhatsApp({ leadId: lead.id, body: preview, templateId: templateId || null });
                if (ok) onOpenChange(false);
              }}
            >
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
