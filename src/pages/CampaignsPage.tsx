import { useState } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp } from "@/lib/production-access";
import { useCrm } from "@/context/CrmContext";
import { audienceLeads } from "@/services/mutations";
import { renderTemplate, userName } from "@/lib/template";
import type { CampaignAudience } from "@/types";

const AUDIENCES: Array<{ id: CampaignAudience; label: string }> = [
  { id: "all", label: "All leads" },
  { id: "new", label: "New leads" },
  { id: "interested", label: "Interested" },
  { id: "pending_follow_up", label: "Pending follow-up" },
  { id: "documents_pending", label: "Documents pending" },
  { id: "custom", label: "Custom selection" },
];

export function CampaignsPage() {
  const { productionUser } = useAuth();
  if (productionUser && !canOperateWhatsApp(productionUser.roleKey)) return <p className="text-sm text-muted">WhatsApp campaigns are limited to Admin.</p>;
  if (productionUser) return <p className="text-sm text-muted">Campaigns send only through the official Cloud API after WhatsApp is configured. This screen does not launch a fake campaign.</p>;
  return <DemoCampaigns />;
}

function DemoCampaigns() {
  const { state, createCampaign, tickCampaign, finishCampaign } = useCrm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<CampaignAudience>("interested");
  const [templateId, setTemplateId] = useState(state.templates[0]?.id ?? "");
  const [schedule, setSchedule] = useState<"now" | "later">("now");
  const [when, setWhen] = useState("");
  const [sending, setSending] = useState<{ id: string; total: number; done: number } | null>(null);
  const template = state.templates.find((item) => item.id === templateId) ?? state.templates[0];
  const sample = state.leads.find((lead) => lead.fullName === "Rahul Kumar") ?? state.leads[0];
  const preview = template && sample ? renderTemplate(template.body, sample, state.settings, userName(state.users, sample.assignedTo)) : "";
  const recipients = audienceLeads(state, audience).length;

  const launch = () => {
    if (!template || !name.trim()) return;
    const leads = audienceLeads(state, audience);
    const created = createCampaign({
      name: name.trim(),
      audience,
      templateId: template.id,
      leadIds: leads.map((lead) => lead.id),
      schedule,
      scheduledAt: schedule === "later" && when ? new Date(when).toISOString() : null,
      messagePreview: preview,
    });
    setOpen(false);
    if (!created || schedule === "later") return;
    const failed = Math.max(1, Math.round(leads.length * 0.04));
    let done = 0;
    setSending({ id: created.id, total: leads.length, done: 0 });
    const timer = window.setInterval(() => {
      done += Math.ceil(leads.length / 12);
      const current = Math.min(done, leads.length);
      const failedNow = current === leads.length ? failed : 0;
      tickCampaign(created.id, {
        status: "sending",
        successful: Math.max(current - failedNow, 0),
        failed: failedNow,
        pending: Math.max(leads.length - current, 0),
      });
      setSending({ id: created.id, total: leads.length, done: current });
      if (current >= leads.length) {
        window.clearInterval(timer);
        finishCampaign(created.id, leads.map((lead) => lead.id), template.body);
        setSending(null);
      }
    }, 180);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Campaigns" description="Demo Mode — bulk sends are simulated and are not delivered on WhatsApp." actions={<Button type="button" onClick={() => setOpen(true)}>New campaign</Button>} />
      {sending ? (
        <Card className="p-4">
          <p className="text-sm font-medium">Sending campaign</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-navy" style={{ width: `${Math.round((sending.done / sending.total) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{sending.done.toLocaleString("en-IN")} of {sending.total.toLocaleString("en-IN")} processed</p>
        </Card>
      ) : null}
      {state.campaigns.length === 0 ? <Card><EmptyState title="No campaigns yet" description="Create your first WhatsApp campaign." action={<Button type="button" onClick={() => setOpen(true)}>New campaign</Button>} /></Card> : (
        <div className="grid gap-3">
          {state.campaigns.map((campaign) => (
            <Card key={campaign.id} className="grid gap-3 p-4 md:grid-cols-[1.4fr_repeat(4,minmax(0,0.5fr))] md:items-center">
              <div>
                <p className="font-medium">{campaign.name}</p>
                <p className="text-xs text-muted capitalize">{campaign.status} · {campaign.audience.replaceAll("_", " ")}</p>
              </div>
              <Metric label="Recipients" value={campaign.recipients} />
              <Metric label="Successful" value={campaign.successful} />
              <Metric label="Pending" value={campaign.pending} />
              <Metric label="Failed" value={campaign.failed} />
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>Demo Mode — progress is simulated. A sample of threads is updated so the activity log stays readable.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-[13px] font-medium">Campaign name<Input className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="block text-[13px] font-medium">Audience
                <Select className="mt-1.5" value={audience} onChange={(event) => setAudience(event.target.value as CampaignAudience)}>
                  {AUDIENCES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </Select>
              </label>
              <label className="block text-[13px] font-medium">Message template
                <Select className="mt-1.5" value={template?.id ?? ""} onChange={(event) => setTemplateId(event.target.value)}>
                  {state.templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </label>
              <label className="block text-[13px] font-medium">Schedule
                <Select className="mt-1.5" value={schedule} onChange={(event) => setSchedule(event.target.value as "now" | "later")}>
                  <option value="now">Send now</option>
                  <option value="later">Schedule later</option>
                </Select>
              </label>
              {schedule === "later" ? <Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} /> : null}
              <p className="text-sm text-muted">{recipients.toLocaleString("en-IN")} recipients</p>
            </div>
            <div className="rounded-lg border border-line bg-canvas p-3">
              <p className="text-[11px] font-medium tracking-wide text-muted uppercase">WhatsApp preview</p>
              <div className="mt-3 rounded-lg bg-white p-3 text-sm leading-6">{preview}</div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!name.trim()} onClick={launch}>{schedule === "later" ? "Schedule campaign" : "Send campaign"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-lg font-semibold tabular">{value.toLocaleString("en-IN")}</p>
    </div>
  );
}
