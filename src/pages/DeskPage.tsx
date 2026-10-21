import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SendWhatsAppDialog } from "@/components/whatsapp/SendWhatsAppDialog";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { formatTalk } from "@/lib/utils";
import { ProductionDeskPage } from "@/pages/production/ProductionTeamDesk";
import type { Lead } from "@/types";

export function DeskPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionDeskPage />;
  return <DemoDeskPage />;
}

function DemoDeskPage() {
  const { session } = useAuth();
  const { state, logCall } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const viewAll = me?.access.viewAllLeads ?? false;
  const [focusId, setFocusId] = useState(viewAll ? "usr_anu" : session?.userId ?? "");
  const ownerId = viewAll ? focusId : session?.userId ?? "";
  const owner = state.users.find((user) => user.id === ownerId);
  const leads = state.leads.filter((lead) => lead.assignedTo === ownerId);
  const calls = (state.calls ?? []).filter((call) => call.userId === ownerId);
  const [whatsappLead, setWhatsappLead] = useState<Lead | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={viewAll ? "Employee desk" : "My desk"}
        description={viewAll ? "Open any counsellor's book. They only see the leads you assign to them." : "Your assigned enquiries. Name, phone and place are on every row."}
        actions={viewAll ? (
          <Select className="w-64" value={ownerId} onChange={(event) => setFocusId(event.target.value)}>
            {state.users.filter((user) => user.role !== "administrator").map((user) => (
              <option key={user.id} value={user.id}>{user.name} · {user.branch}</option>
            ))}
          </Select>
        ) : null}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">Assigned leads</p><p className="mt-1 text-2xl font-semibold tabular">{leads.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Calls by {owner?.name.split(" ")[0] ?? "this desk"}</p><p className="mt-1 text-2xl font-semibold tabular">{calls.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Talk time</p><p className="mt-1 text-2xl font-semibold tabular">{formatTalk(calls.reduce((sum, call) => sum + call.durationSeconds, 0))}</p></Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Name", "Phone", "Place", "Interest", "Desk", "Talks", "Status", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {leads.slice(0, 40).map((lead) => (
              <tr key={lead.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`}>{lead.fullName}</Link></td>
                <td className="px-3 py-2"><PhoneLink phone={lead.phone} /></td>
                <td className="px-3 py-2">{lead.location}</td>
                <td className="px-3 py-2">{lead.position}</td>
                <td className="px-3 py-2">{lead.businessUnit === "clinic" ? "Clinic" : "Institute"}</td>
                <td className="px-3 py-2 tabular">{lead.callCount} · {formatTalk(lead.talkSeconds)}</td>
                <td className="px-3 py-2"><StatusBadge status={lead.status} /></td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs font-medium" onClick={() => setWhatsappLead(lead)}>WhatsApp</button>
                  <button type="button" className="ml-3 text-xs font-medium" onClick={() => logCall(lead.id, "Direct call from the employee desk.", 5 * 60)}>Call</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No leads are assigned to this desk yet.</p> : null}
      </Card>
      <SendWhatsAppDialog lead={whatsappLead} open={Boolean(whatsappLead)} onOpenChange={(open) => { if (!open) setWhatsappLead(null); }} />
    </div>
  );
}
