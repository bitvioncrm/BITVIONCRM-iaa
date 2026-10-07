import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCrm } from "@/context/CrmContext";
import { formatDateTime } from "@/lib/dates";
import { userName } from "@/lib/template";
import { useAuth } from "@/context/AuthContext";
import { ProductionActivity } from "@/pages/production/ProductionOpsPages";

export function ActivityPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionActivity />;
  return <DemoActivity />;
}

function DemoActivity() {
  const { state } = useCrm();
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => state.activities.filter((item) => {
    if (userId && item.userId !== userId) return false;
    if (type && item.type !== type) return false;
    const haystack = `${item.action} ${item.details} ${item.leadName ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [query, state.activities, type, userId]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const rows = filtered.slice((Math.min(page, pages) - 1) * 25, Math.min(page, pages) * 25);
  const types = Array.from(new Set(state.activities.map((item) => item.type)));

  return (
    <div className="space-y-4">
      <PageHeader title="Activity" description="An audit trail of lead, WhatsApp, follow-up and campaign events." />
      <div className="grid gap-2 md:grid-cols-3">
        <Input placeholder="Filter activity" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        <Select value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">All users</option>
          {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </Select>
        <Select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All actions</option>
          {types.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
        </Select>
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="No activity" description="Actions you take in the demo will be listed here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-line text-xs text-muted">
                <tr>{["Time", "User", "Action", "Candidate", "Details"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{formatDateTime(item.at)}</td>
                    <td className="px-3 py-2">{userName(state.users, item.userId)}</td>
                    <td className="px-3 py-2 font-medium">{item.action}</td>
                    <td className="px-3 py-2">{item.leadId ? <Link to={`/leads/${item.leadId}`}>{item.leadName}</Link> : item.leadName ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{item.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={Math.min(page, pages)} pages={pages} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}
