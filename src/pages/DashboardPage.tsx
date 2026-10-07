import { format } from "date-fns";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DayFilter } from "@/components/dashboard/DayFilter";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { exportLeadSheet } from "@/lib/lead-export";
import { formatDateTime } from "@/lib/dates";
import { dayFilterBounds, defaultDayFilter, inDayRange, yearsIn, type DayFilterValue } from "@/lib/day-filter";
import { deskLeads, isAdmin } from "@/lib/scope";
import { renderTemplate, userName } from "@/lib/template";
import { firstName, formatTalk, greeting } from "@/lib/utils";
import { ProductionDashboard } from "@/pages/production/ProductionDashboard";
import type { CallLog, Lead, LeadStatus, User } from "@/types";

export function DashboardPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionDashboard />;
  return <DemoDashboard />;
}

function DemoDashboard() {
  const { session } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const [filter, setFilter] = useState<DayFilterValue>(() => defaultDayFilter());
  const years = useMemo(() => yearsIn([...state.leads.map((lead) => lead.createdAt), ...state.calls.map((call) => call.startedAt)]), [state.calls, state.leads]);
  const bounds = dayFilterBounds(filter);
  if (isAdmin(me)) return <AdminHome name={session?.name ?? "Akhil"} filter={filter} years={years} label={bounds.label} from={bounds.from} to={bounds.to} onFilter={setFilter} />;
  return <DeskHome me={me} filter={filter} years={years} label={bounds.label} from={bounds.from} to={bounds.to} onFilter={setFilter} />;
}

function AdminHome({
  name,
  filter,
  years,
  label,
  from,
  to,
  onFilter,
}: {
  name: string;
  filter: DayFilterValue;
  years: string[];
  label: string;
  from: string | null;
  to: string | null;
  onFilter: (value: DayFilterValue) => void;
}) {
  const { state } = useCrm();
  const clinic = state.leads.filter((lead) => lead.businessUnit === "clinic" && inDayRange(lead.createdAt, from, to));
  const institute = state.leads.filter((lead) => lead.businessUnit === "institute" && inDayRange(lead.createdAt, from, to));
  const calls = state.calls.filter((call) => inDayRange(call.startedAt, from, to));
  const fresh = state.leads.filter((lead) => lead.status === "new" && !lead.assignedTo);
  const staff = state.users.filter((user) => user.role !== "administrator");

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs text-muted">{format(new Date(), "EEEE, d MMM yyyy")} · Admin</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{greeting()}, {firstName(name)}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Pick a day, a month, or a year. You see both desks: leads that arrived then, and who they are assigned to.</p>
      </header>
      <DayFilter value={filter} years={years} label={label} onChange={onFilter} />
      <StageBoard leads={[...clinic, ...institute]} users={state.users} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DeskSummary title="Clinic · Perumbavoor" detail="Leads created in this period, and how many already have a counsellor." leads={clinic} talk={talkFor(state.leads, calls, "clinic")} href="/leads" />
        <DeskSummary title="Institute · IAA Kochi" detail="Institute leads from the same period. WhatsApp stays manual on this desk." leads={institute} talk={talkFor(state.leads, calls, "institute")} href="/leads" />
      </div>
      <CallSummary leads={state.leads} calls={calls} from={from} to={to} />
      <Leaderboard users={staff} leads={[...clinic, ...institute]} calls={calls} />
      <LeadBook title="Leads and assignment" leads={[...clinic, ...institute]} users={state.users} />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">{fresh.length} fresh leads are waiting</p>
          <p className="text-sm text-muted">They have a name, phone and place, and no counsellor yet. This queue is not limited to the day filter.</p>
        </div>
        <Link to="/team" className="inline-flex h-9 items-center rounded-md bg-navy px-3 text-sm font-medium text-white">Assign on Team</Link>
      </Card>
    </div>
  );
}

function DeskHome({
  me,
  filter,
  years,
  label,
  from,
  to,
  onFilter,
}: {
  me: User | undefined;
  filter: DayFilterValue;
  years: string[];
  label: string;
  from: string | null;
  to: string | null;
  onFilter: (value: DayFilterValue) => void;
}) {
  const { state, sendWhatsApp } = useCrm();
  const unit = me?.businessUnit === "institute" ? "institute" : "clinic";
  const book = deskLeads(state.leads, me);
  const periodLeads = book.filter((lead) => inDayRange(lead.createdAt, from, to));
  const ownCalls = state.calls.filter((call) => call.userId === me?.id && inDayRange(call.startedAt, from, to));
  const [sent, setSent] = useState("");
  const template = state.templates.find((item) => item.key === "WELCOME_MESSAGE");
  const sample = book.find((lead) => lead.assignedTo === me?.id && lead.whatsappAutomation) ?? book.find((lead) => lead.assignedTo === me?.id);
  const preview = template && sample ? renderTemplate(template.body, sample, state.settings, me?.name ?? "") : "";

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs text-muted">{format(new Date(), "EEEE, d MMM yyyy")} · {unit === "clinic" ? "Clinic desk" : "Institute desk"}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{greeting()}, {firstName(me?.name ?? "")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {unit === "clinic"
            ? "Your Perumbavoor book. Change the day or year to see the leads assigned to you, then tap a number to call."
            : "Your IAA Kochi book. Change the day or year to see the leads assigned to you. Tap a number to call. WhatsApp is never automatic."}
        </p>
      </header>
      <DayFilter value={filter} years={years} label={label} onChange={onFilter} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Leads in this period" value={String(periodLeads.length)} />
        <Stat label="Assigned to you" value={String(periodLeads.filter((lead) => lead.assignedTo === me?.id).length)} />
        <Stat label="Your call time" value={formatTalk(ownCalls.reduce((sum, call) => sum + call.durationSeconds, 0))} />
      </div>
      <CallSummary leads={book} calls={ownCalls} from={from} to={to} />
      {unit === "clinic" ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">WhatsApp automation demo</h2>
          <p className="text-sm text-muted">Clinic only. A new clinic lead can receive this welcome without you typing it.</p>
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">{preview || "Assign yourself a clinic lead to preview the welcome."}</p>
          <p className="text-xs text-muted">Demo Mode — the message stays inside BITVION. A phone number still opens the phone app.</p>
          <Button
            type="button"
            disabled={!sample || !template}
            onClick={() => {
              if (!sample || !template || !preview) return;
              const ok = sendWhatsApp({ leadId: sample.id, body: preview, templateId: template.id });
              if (ok) setSent(sample.fullName);
            }}
          >
            Send demo welcome{sample ? ` to ${sample.fullName.split(" ")[0]}` : ""}
          </Button>
          {sent ? <p className="text-sm">Sent to {sent}. Open WhatsApp to read it.</p> : null}
        </Card>
      ) : (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">No automatic WhatsApp</h2>
          <p className="mt-1 text-sm text-muted">Tap the phone number to call. Open WhatsApp on a lead when you want to send one message yourself.</p>
        </Card>
      )}
      <StageBoard leads={periodLeads} users={state.users} />
      <LeadBook title="Your leads" leads={periodLeads} users={state.users} />
    </div>
  );
}

function talkFor(leads: Lead[], calls: CallLog[], unit: "clinic" | "institute") {
  const ids = new Set(leads.filter((lead) => lead.businessUnit === unit).map((lead) => lead.id));
  return calls.filter((call) => ids.has(call.leadId)).reduce((sum, call) => sum + call.durationSeconds, 0);
}

function DeskSummary({ title, detail, leads, talk, href }: { title: string; detail: string; leads: Lead[]; talk: number; href: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Leads" value={leads.length.toLocaleString("en-IN")} />
        <Stat label="Assigned" value={leads.filter((lead) => lead.assignedTo).length.toLocaleString("en-IN")} />
        <Stat label="Call time" value={formatTalk(talk)} />
      </div>
      <Link to={href} className="mt-3 inline-block text-[13px] text-muted hover:text-ink">Open leads</Link>
    </Card>
  );
}

function CallSummary({ leads, calls, from, to }: { leads: Lead[]; calls: CallLog[]; from: string | null; to: string | null }) {
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const known = calls.filter((call) => byId.has(call.leadId));
  const freshIds = new Set(leads.filter((lead) => inDayRange(lead.createdAt, from, to)).map((lead) => lead.id));
  const freshCalls = known.filter((call) => freshIds.has(call.leadId));
  const followCalls = known.filter((call) => !freshIds.has(call.leadId));
  const unique = new Set(known.map((call) => call.leadId)).size;
  const seconds = known.reduce((sum, call) => sum + call.durationSeconds, 0);
  const average = known.length ? Math.round(seconds / known.length) : 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Stat label="Fresh calls" value={String(freshCalls.length)} />
      <Stat label="Follow-up calls" value={String(followCalls.length)} />
      <Stat label="Total calls" value={String(known.length)} />
      <Stat label="Unique calls" value={String(unique)} />
      <Stat label="Total call time" value={formatTalk(seconds)} />
      <Stat label="Average call time" value={known.length ? formatTalk(average) : "0m"} />
    </div>
  );
}

function Leaderboard({ users, leads, calls }: { users: User[]; leads: Lead[]; calls: CallLog[] }) {
  const rows = users.map((user) => {
    const owned = leads.filter((lead) => lead.assignedTo === user.id);
    const mine = calls.filter((call) => call.userId === user.id);
    const unique = new Set(mine.map((call) => call.leadId)).size;
    return { user, leads: owned.length, calls: mine.length, unique, seconds: mine.reduce((sum, call) => sum + call.durationSeconds, 0) };
  }).filter((row) => row.leads > 0 || row.calls > 0);

  return (
    <Card className="overflow-x-auto">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Assignment</h2>
        <p className="text-sm text-muted">Who received leads in this period, and how long they talked.</p>
      </div>
      {rows.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No leads or calls in this period. Choose another day or All days.</p> : (
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Person", "Desk", "Leads assigned", "Calls", "Unique leads", "Call time"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">{row.user.name}</td>
                <td className="px-3 py-2">{row.user.businessUnit === "clinic" ? "Clinic" : row.user.businessUnit === "institute" ? "Institute" : "Both"}</td>
                <td className="px-3 py-2 tabular">{row.leads}</td>
                <td className="px-3 py-2 tabular">{row.calls}</td>
                <td className="px-3 py-2 tabular">{row.unique}</td>
                <td className="px-3 py-2 tabular">{formatTalk(row.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function StageBoard({ leads, users }: { leads: Lead[]; users: User[] }) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<LeadStatus, number>;
  for (const lead of leads) counts[lead.status] += 1;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Lead stages</h2>
          <p className="text-sm text-muted">{leads.length.toLocaleString("en-IN")} leads in this period. Export writes each stage name, including Converted.</p>
        </div>
        <Button type="button" variant="secondary" disabled={leads.length === 0} onClick={() => exportLeadSheet(leads, users)}>
          Export Excel
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="rounded-md border border-line px-3 py-2">
            <p className="text-[11px] text-muted">{STATUS_LABEL[status]}</p>
            <p className="text-lg font-semibold tabular">{counts[status].toLocaleString("en-IN")}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LeadBook({ title, leads, users }: { title: string; leads: Lead[]; users: User[] }) {
  const shown = leads.slice(0, 20);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted">{leads.length.toLocaleString("en-IN")} leads arrived in this period. Tap a number to open the phone.</p>
      </div>
      {shown.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No leads on this day. Switch to Month, Year, or All days.</p> : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-line text-xs text-muted">
                <tr>{["Name", "Phone", "Place", "Source", "Stage", "Assigned", "Created"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((lead) => (
                  <tr key={lead.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`}>{lead.fullName}</Link></td>
                    <td className="px-3 py-2"><PhoneLink phone={lead.phone} /></td>
                    <td className="px-3 py-2">{lead.location}</td>
                    <td className="px-3 py-2">{SOURCE_LABEL[lead.source]}</td>
                    <td className="px-3 py-2"><StatusBadge status={lead.status} /></td>
                    <td className="px-3 py-2">{lead.assignedTo ? userName(users, lead.assignedTo) : "Unassigned"}</td>
                    <td className="px-3 py-2 text-muted">{formatDateTime(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-line lg:hidden">
            {shown.map((lead) => (
              <div key={lead.id} className="space-y-1 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/leads/${lead.id}`} className="font-medium">{lead.fullName}</Link>
                  <StatusBadge status={lead.status} />
                </div>
                <p className="text-xs text-muted">{lead.location} · {SOURCE_LABEL[lead.source]}</p>
                <PhoneLink phone={lead.phone} className="text-sm" />
                <p className="text-xs text-muted">{lead.assignedTo ? userName(users, lead.assignedTo) : "Unassigned"}</p>
                <p className="text-xs text-muted">Created {formatDateTime(lead.createdAt)}</p>
              </div>
            ))}
          </div>
          {leads.length > shown.length ? <p className="border-t border-line px-4 py-2 text-xs text-muted">Showing {shown.length} of {leads.length}.</p> : null}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>
    </Card>
  );
}
