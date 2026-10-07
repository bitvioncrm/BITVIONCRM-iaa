import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HowItWorks } from "@/components/shared/HowItWorks";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { deskLeads, isAdmin } from "@/lib/scope";
import { formatDateTime } from "@/lib/dates";
import { userName } from "@/lib/template";
import { ProductionCallTime } from "@/pages/production/ProductionCallTime";
import { formatTalk } from "@/lib/utils";

export function CallsPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionCallTime />;
  return <DemoCallsPage />;
}

function DemoCallsPage() {
  const { session } = useAuth();
  const { state } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const viewAll = isAdmin(me) || Boolean(me?.access.viewAllLeads);
  const allowed = new Set(deskLeads(state.leads, me).map((lead) => lead.id));
  const [owner, setOwner] = useState(isAdmin(me) || me?.access.viewAllLeads ? "" : session?.userId ?? "");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useMemo(() => {
    return state.calls
      .filter((call) => {
        if (!isAdmin(me) && !allowed.has(call.leadId)) return false;
        if (!viewAll && call.userId !== session?.userId) return false;
        if (owner && call.userId !== owner) return false;
        const lead = state.leads.find((item) => item.id === call.leadId);
        if (status && lead?.status !== status) return false;
        if (query && !`${lead?.fullName ?? ""} ${lead?.phone ?? ""} ${lead?.location ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
        const day = call.startedAt.slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      })
      .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  }, [allowed, from, me, owner, query, session?.userId, state.calls, state.leads, status, to, viewAll]);

  const minutes = rows.reduce((sum, call) => sum + call.durationSeconds, 0);

  return (
    <div className="space-y-4">
        <PageHeader title="Calls" description={`${rows.length} calls · ${formatTalk(minutes)} on this filter. Tap a number to open the phone. The log stays inside BITVION.`} />
      <HowItWorks page="calls" />
      <div className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-5">
        <Input placeholder="Name, phone or place" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select value={owner} onChange={(event) => setOwner(event.target.value)} disabled={!viewAll}>
          <option value="">All employees</option>
          {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Lead status</option>
          {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
        </Select>
        <Input type="date" aria-label="Call from" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" aria-label="Call to" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["When", "Lead", "Phone", "Place", "Status", "Employee", "Length", "Note"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((call) => {
              const lead = state.leads.find((item) => item.id === call.leadId);
              return (
                <tr key={call.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-muted">{formatDateTime(call.startedAt)}</td>
                  <td className="px-3 py-2 font-medium">{lead ? <Link to={`/leads/${lead.id}`}>{lead.fullName}</Link> : "Removed lead"}</td>
                  <td className="px-3 py-2">{lead ? <PhoneLink phone={lead.phone} /> : "—"}</td>
                  <td className="px-3 py-2">{lead?.location ?? "—"}</td>
                  <td className="px-3 py-2">{lead ? <StatusBadge status={lead.status} /> : "—"}</td>
                  <td className="px-3 py-2">{userName(state.users, call.userId)}</td>
                  <td className="px-3 py-2 tabular">{formatTalk(call.durationSeconds)}</td>
                  <td className="px-3 py-2 text-muted">{call.notes || "Logged call"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No calls match these filters.</p> : null}
      </Card>
    </div>
  );
}
