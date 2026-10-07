import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/shared/EmptyState";
import { HowItWorks } from "@/components/shared/HowItWorks";
import { PageHeader } from "@/components/shared/PageHeader";
import { SendWhatsAppDialog } from "@/components/whatsapp/SendWhatsAppDialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { FOLLOW_UP_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { followUpBucket, formatDateTime } from "@/lib/dates";
import { userName } from "@/lib/template";
import { listFollowUps } from "@/services/production-ops";
import { listWorkspaces } from "@/services/production-leads";
import type { AutomationNode, FollowUp, Lead } from "@/types";

export function FollowUpsPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionFollowUps />;
  return <DemoFollowUps />;
}

function ProductionFollowUps() {
  const [rows, setRows] = useState<{ id: string; due_at: string; status: string; notes: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void listWorkspaces()
      .then((workspaces) => listFollowUps(workspaces[0]?.id ?? ""))
      .then((items) => setRows(items as typeof rows))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load follow-ups"));
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Follow-ups</h1>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {rows.length === 0 ? <p className="text-sm text-muted">No follow-ups in PostgreSQL for the first workspace.</p> : rows.map((row) => <p key={row.id} className="text-sm">{row.due_at} · {row.status} · {row.notes}</p>)}
    </div>
  );
}

function DemoFollowUps() {
  const { state, completeFollowUp, rescheduleFollowUp, updateAutomation, simulateReply, sendWhatsApp, createFollowUp, saveTask } = useCrm();
  const [lead, setLead] = useState<Lead | null>(null);
  const [reschedule, setReschedule] = useState<{ id: string; value: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const visibleFollowUps = useMemo(() => state.followUps.filter((item) => {
    const person = state.leads.find((lead) => lead.id === item.leadId);
    if (type && item.type !== type) return false;
    if (owner && item.assignedTo !== owner) return false;
    if (leadStatus && person?.status !== leadStatus) return false;
    const day = item.dueAt.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }), [from, leadStatus, owner, state.followUps, state.leads, to, type]);
  const buckets = useMemo(() => ({
    today: visibleFollowUps.filter((item) => followUpBucket(item.dueAt, item.status) === "today"),
    upcoming: visibleFollowUps.filter((item) => followUpBucket(item.dueAt, item.status) === "upcoming"),
    overdue: visibleFollowUps.filter((item) => followUpBucket(item.dueAt, item.status) === "overdue"),
    completed: visibleFollowUps.filter((item) => item.status === "completed"),
  }), [visibleFollowUps]);

  const runSimulation = async () => {
    const target = state.leads.find((item) => item.whatsappAutomation && item.status === "new") ?? state.leads.find((item) => item.whatsappAutomation) ?? state.leads[0];
    if (!target) return;
    const steps = state.automation.nodes;
    for (const step of steps) {
      setRunning(step.id);
      await wait(450);
      if (step.title.includes("Welcome")) {
        const template = state.templates.find((item) => item.key === "WELCOME_MESSAGE");
        if (template) sendWhatsApp({ leadId: target.id, body: template.body.replace("{{name}}", target.fullName.split(" ")[0] ?? target.fullName).replace("{{company}}", state.settings.companyName).replace("{{position}}", target.position), templateId: template.id });
      }
      if (step.title === "Candidate Responded?") {
        const replied = state.messages.some((message) => message.leadId === target.id && message.direction === "in");
        if (replied) break;
      }
      if (step.title.includes("Follow-up Message")) {
        const template = state.templates.find((item) => item.key === "FOLLOW_UP");
        if (template) sendWhatsApp({ leadId: target.id, body: `Hi ${target.fullName.split(" ")[0]}, we're following up regarding your ${target.position} enquiry.`, templateId: template.id });
      }
      if (step.title.includes("Call Task")) {
        saveTask({ title: `Call ${target.fullName}`, leadId: target.id, assignedTo: target.assignedTo, priority: "high", dueAt: new Date().toISOString(), taskType: "call", description: "Created by the welcome sequence.", status: "pending" });
      }
    }
    setRunning(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Follow-ups" description="Filter by type, counsellor, lead status and due date." />
      <HowItWorks page="follow" />
      <div className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-5">
        <Select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">Follow-up type</option>
          {Object.entries(FOLLOW_UP_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">Assigned to</option>
          {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </Select>
        <Select value={leadStatus} onChange={(event) => setLeadStatus(event.target.value)}>
          <option value="">Lead status</option>
          {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
        </Select>
        <Input type="date" aria-label="Due from" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" aria-label="Due to" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="space-y-4 pt-4">
          <Section title="Today's follow-ups" empty="No follow-ups today" detail="Your follow-up queue is clear." rows={buckets.today} state={state} onComplete={completeFollowUp} onReschedule={(id) => setReschedule({ id, value: "" })} onWhatsApp={(id) => setLead(state.leads.find((item) => item.id === id) ?? null)} />
          <Section title="Upcoming" empty="Nothing upcoming" detail="Scheduled follow-ups will appear here." rows={buckets.upcoming.slice(0, 12)} state={state} onComplete={completeFollowUp} onReschedule={(id) => setReschedule({ id, value: "" })} onWhatsApp={(id) => setLead(state.leads.find((item) => item.id === id) ?? null)} />
          <Section title="Overdue" empty="No overdue follow-ups" detail="The desk is clear of missed follow-ups." rows={buckets.overdue} state={state} onComplete={completeFollowUp} onReschedule={(id) => setReschedule({ id, value: "" })} onWhatsApp={(id) => setLead(state.leads.find((item) => item.id === id) ?? null)} />
          <Section title="Completed" empty="No completed follow-ups" detail="Completed work will stay here for the audit trail." rows={buckets.completed.slice(0, 12)} state={state} onComplete={completeFollowUp} onReschedule={(id) => setReschedule({ id, value: "" })} onWhatsApp={(id) => setLead(state.leads.find((item) => item.id === id) ?? null)} />
        </TabsContent>
        <TabsContent value="automation" className="pt-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{state.automation.name}</h2>
                <p className="text-sm text-muted">Demo Mode — delays are simulated. No message leaves this browser.</p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2">Enabled <Switch checked={state.automation.enabled} onCheckedChange={(enabled) => updateAutomation({ enabled })} label="Enable automation" /></label>
                <label className="flex items-center gap-2">Run on new leads <Switch checked={state.automation.runOnNewLeads} onCheckedChange={(runOnNewLeads) => updateAutomation({ runOnNewLeads })} label="Run on new leads" /></label>
                <Button type="button" onClick={() => void runSimulation()} disabled={!state.automation.enabled || Boolean(running)}>Test run</Button>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {state.automation.nodes.map((node) => (
                <NodeEditor key={node.id} node={node} active={running === node.id} onChange={(patch) => updateAutomation({ nodes: state.automation.nodes.map((item) => item.id === node.id ? { ...item, ...patch } : item) })} />
              ))}
            </div>
            <Button type="button" className="mt-4" variant="secondary" onClick={() => {
              const target = state.leads[0];
              if (target) simulateReply(target.id, "Yes, please continue.");
            }}>Simulate a reply on the latest lead</Button>
            <Button type="button" className="mt-4 ml-2" variant="ghost" onClick={() => {
              const target = state.leads.find((item) => item.status === "documents_pending");
              if (!target) return;
              createFollowUp({ leadId: target.id, type: "document_reminder", dueAt: new Date().toISOString(), notes: "Manual document reminder" });
            }}>Create document reminder</Button>
          </Card>
        </TabsContent>
      </Tabs>
      <SendWhatsAppDialog lead={lead} open={Boolean(lead)} onOpenChange={(open) => { if (!open) setLead(null); }} />
      {reschedule ? (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-auto flex max-w-md items-center gap-2 rounded-lg border border-line bg-white p-3 shadow-pop lg:bottom-6">
          <Input type="datetime-local" value={reschedule.value} onChange={(event) => setReschedule({ ...reschedule, value: event.target.value })} />
          <Button type="button" onClick={() => { if (reschedule.value) rescheduleFollowUp(reschedule.id, new Date(reschedule.value).toISOString()); setReschedule(null); }}>Save</Button>
          <Button type="button" variant="secondary" onClick={() => setReschedule(null)}>Cancel</Button>
        </div>
      ) : null}
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function Section({ title, empty, detail, rows, state, onComplete, onReschedule, onWhatsApp }: {
  title: string;
  empty: string;
  detail: string;
  rows: FollowUp[];
  state: { leads: Lead[]; users: Array<{ id: string; name: string }> };
  onComplete: (id: string) => void;
  onReschedule: (id: string) => void;
  onWhatsApp: (leadId: string) => void;
}) {
  return (
    <Card>
      <h2 className="px-4 py-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? <EmptyState title={empty} description={detail} action={<Link to="/leads" className="text-sm font-medium">View all leads</Link>} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-y border-line text-xs text-muted">
              <tr>{["Candidate", "Position", "Assigned", "Follow-up type", "Due date", "Status", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const person = state.leads.find((lead) => lead.id === item.leadId);
                const bucket = followUpBucket(item.dueAt, item.status);
                return (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium">{person ? <Link to={`/leads/${person.id}`}>{person.fullName}</Link> : "Removed lead"}</td>
                    <td className="px-3 py-2">{person?.position ?? "—"}</td>
                    <td className="px-3 py-2">{userName(state.users, item.assignedTo)}</td>
                    <td className="px-3 py-2">{FOLLOW_UP_LABEL[item.type]}</td>
                    <td className="px-3 py-2">{formatDateTime(item.dueAt)}</td>
                    <td className="px-3 py-2 capitalize">{bucket}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {item.status !== "completed" ? <button type="button" className="text-xs font-medium" onClick={() => onComplete(item.id)}>Complete</button> : null}
                        <button type="button" className="text-xs text-muted" onClick={() => onReschedule(item.id)}>Reschedule</button>
                        <button type="button" className="text-xs text-muted" onClick={() => onWhatsApp(item.leadId)}>Send WhatsApp</button>
                        {person ? <Link to={`/leads/${person.id}`} className="text-xs text-muted">View lead</Link> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function NodeEditor({ node, active, onChange }: { node: AutomationNode; active: boolean; onChange: (patch: Partial<AutomationNode>) => void }) {
  return (
    <div className={`rounded-lg border px-3 py-3 ${active ? "border-navy bg-slate-50" : "border-line"} ${node.branch === "yes" ? "ml-8" : ""} ${node.branch === "no" ? "ml-8" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{node.type}{node.branch ? ` · ${node.branch}` : ""}</p>
      </div>
      <input className="mt-1 w-full bg-transparent text-sm font-medium outline-none" value={node.title} onChange={(event) => onChange({ title: event.target.value })} />
      <p className="text-xs text-muted">{node.description}</p>
      {node.type === "delay" ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          Hours
          <input type="number" min={1} className="h-8 w-20 rounded-md border border-line px-2" value={node.hours ?? 24} onChange={(event) => onChange({ hours: Number(event.target.value), title: `Wait ${event.target.value} hours` })} />
        </label>
      ) : null}
    </div>
  );
}
