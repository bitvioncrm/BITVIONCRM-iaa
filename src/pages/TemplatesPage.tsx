import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp } from "@/lib/production-access";
import { useCrm } from "@/context/CrmContext";
import { renderTemplate, userName } from "@/lib/template";

export function TemplatesPage() {
  const { productionUser } = useAuth();
  if (productionUser && !canOperateWhatsApp(productionUser.roleKey)) return <p className="text-sm text-muted">WhatsApp templates are limited to Admin.</p>;
  if (productionUser) return <p className="text-sm text-muted">Template names are sent to Meta from the WhatsApp page. This screen does not store a fake template as sent.</p>;
  return <DemoTemplates />;
}

function DemoTemplates() {
  const { state, saveTemplate, duplicateTemplate, removeTemplate } = useCrm();
  const [editing, setEditing] = useState<{ id?: string; name: string; key: string; body: string } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState(state.leads.find((lead) => lead.fullName === "Rahul Kumar")?.id ?? state.leads[0]?.id ?? "");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const previewTemplate = state.templates.find((item) => item.id === previewId);
  const previewLead = state.leads.find((lead) => lead.id === leadId);

  return (
    <div className="space-y-4">
      <PageHeader title="Templates" description="Reusable WhatsApp copy with candidate variables." actions={<Button type="button" onClick={() => setEditing({ name: "", key: "", body: "Hi {{name}}, " })}>Create template</Button>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.templates.map((template) => (
          <Card key={template.id} className="flex flex-col p-4">
            <p className="text-[11px] font-medium tracking-wide text-muted">{template.key}</p>
            <h2 className="mt-1 font-semibold">{template.name}</h2>
            <p className="mt-2 line-clamp-4 flex-1 text-sm text-muted">{template.body}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setPreviewId(template.id)}>Preview</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(template)}>Edit</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => duplicateTemplate(template.id)}>Duplicate</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteId(template.id)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit template" : "Create template"}</DialogTitle></DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <Input placeholder="Name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
              <Input placeholder="KEY" value={editing.key} onChange={(event) => setEditing({ ...editing, key: event.target.value.toUpperCase() })} />
              <Textarea value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
              <p className="text-xs text-muted">{"Variables: {{name}} {{position}} {{company}} {{date}} {{time}} {{assigned_agent}}"}</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="button" onClick={() => { if (saveTemplate(editing)) setEditing(null); }}>Save</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => { if (!open) setPreviewId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Preview</DialogTitle></DialogHeader>
          <Select value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            {state.leads.slice(0, 40).map((lead) => <option key={lead.id} value={lead.id}>{lead.fullName} · {lead.position}</option>)}
          </Select>
          <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm leading-6">
            {previewTemplate && previewLead ? renderTemplate(previewTemplate.body, previewLead, state.settings, userName(state.users, previewLead.assignedTo)) : null}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={Boolean(deleteId)} danger title="Delete template?" description="Existing conversations keep the messages already sent." confirmLabel="Delete" onOpenChange={(open) => { if (!open) setDeleteId(null); }} onConfirm={() => { if (deleteId) removeTemplate(deleteId); }} />
    </div>
  );
}
