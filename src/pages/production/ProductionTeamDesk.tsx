import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp } from "@/lib/production-access";
import {
  assignLeadCount,
  assignUnassignedLeads,
  clearAssignedLeads,
  leadAssignmentTotals,
  listAssignableMembers,
  type AssignmentTotals,
  listLeads,
  listWorkspaces,
  type MemberOption,
  type ProductionLead,
  type WorkspaceOption,
} from "@/services/production-leads";

export function ProductionTeamPage() {
  const { productionUser } = useAuth();
  const admin = canOperateWhatsApp(productionUser?.roleKey ?? "");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [totals, setTotals] = useState<AssignmentTotals>({ unassigned: 0, desks: {}, assigned: {} });
  const [assignee, setAssignee] = useState("");
  const [count, setCount] = useState("10");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const workspace = workspaces.find((item) => item.id === workspaceId);

  const reload = async (id = workspaceId) => {
    if (!id) return;
    const [people, board] = await Promise.all([
      listAssignableMembers(id, workspace?.workspaceType),
      leadAssignmentTotals(),
    ]);
    setMembers(people);
    setTotals(board);
    setAssignee((current) => (people.some((item) => item.userId === current) ? current : people[0]?.userId ?? ""));
  };

  useEffect(() => {
    void listWorkspaces()
      .then((rows) => {
        setWorkspaces(rows);
        setWorkspaceId((current) => (rows.some((item) => item.id === current) ? current : rows[0]?.id ?? ""));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load workspaces"));
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void reload(workspaceId).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load team"));
  }, [workspaceId]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team"
        description=""
        actions={workspaces.length > 1 ? (
          <Select className="w-full sm:w-64" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        ) : undefined}
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{notice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">Staff on this desk</p><p className="mt-1 text-2xl font-semibold tabular">{members.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Waiting on this desk</p><p className="mt-1 text-2xl font-semibold tabular">{Number(totals.desks[workspaceId] ?? 0).toLocaleString("en-IN")}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Assigned on this desk</p><p className="mt-1 text-2xl font-semibold tabular">{members.reduce((sum, member) => sum + Number(totals.assigned[member.userId] ?? 0), 0).toLocaleString("en-IN")}</p></Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Name", "Role", "Leads assigned"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr><td className="px-3 py-6 text-sm text-muted" colSpan={3}>No assignable staff on this desk yet.</td></tr>
            ) : members.map((member) => (
              <tr key={member.userId} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">{member.name}</td>
                <td className="px-3 py-2 capitalize">{member.role.replaceAll("_", " ")}</td>
                <td className="px-3 py-2 tabular">{Number(totals.assigned[member.userId] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {admin ? (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="w-full text-sm sm:w-auto">
            Assign to
            <Select className="mt-1 w-full sm:w-56" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
            </Select>
          </label>
          <label className="w-full text-sm sm:w-auto">
            How many
            <Input className="mt-1 w-full sm:w-28" type="number" min={1} max={Math.max(Number(totals.desks[workspaceId] ?? 0), 1)} value={count} onChange={(event) => setCount(event.target.value)} />
          </label>
          <Button
            type="button"
            disabled={busy || !assignee || Number(totals.desks[workspaceId] ?? 0) === 0}
            onClick={() => {
              const limit = Number(count);
              if (!Number.isInteger(limit) || limit < 1) {
                setError("Enter how many leads to assign.");
                return;
              }
              setBusy(true);
              setError("");
              void assignLeadCount(assignee, limit)
                .then((moved) => {
                  const deskName = workspace?.name ?? "this desk";
                  setNotice(moved > 0 ? `Assigned ${moved.toLocaleString("en-IN")} ${deskName} lead${moved === 1 ? "" : "s"}.` : `No waiting leads on ${deskName}.`);
                  return reload();
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Assignment failed"))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Assigning…" : "Assign"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !assignee || Number(totals.desks[workspaceId] ?? 0) === 0}
            onClick={() => {
              const waiting = Number(totals.desks[workspaceId] ?? 0);
              const person = members.find((item) => item.userId === assignee);
              if (!window.confirm(`Assign all ${waiting.toLocaleString("en-IN")} waiting leads on ${workspace?.name ?? "this desk"} to ${person?.name ?? "this telecaller"}?`)) return;
              setBusy(true);
              setError("");
              void assignUnassignedLeads(workspaceId, assignee)
                .then((moved) => {
                  setNotice(moved > 0 ? `Assigned ${moved.toLocaleString("en-IN")} leads on ${workspace?.name ?? "this desk"}.` : `No waiting leads on ${workspace?.name ?? "this desk"}.`);
                  return reload();
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Assignment failed"))
                .finally(() => setBusy(false));
            }}
          >
            Assign all waiting
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !assignee || Number(totals.assigned[assignee] ?? 0) < 1}
            onClick={() => {
              const held = Number(totals.assigned[assignee] ?? 0);
              const person = members.find((item) => item.userId === assignee);
              if (!window.confirm(`Remove assignment from ${held.toLocaleString("en-IN")} leads held by ${person?.name ?? "this telecaller"} on ${workspace?.name ?? "this desk"}?`)) return;
              setBusy(true);
              setError("");
              void clearAssignedLeads(assignee)
                .then((moved) => {
                  setNotice(moved > 0 ? `Removed assignment from ${moved.toLocaleString("en-IN")} leads on ${workspace?.name ?? "this desk"}.` : `No assigned leads to remove on ${workspace?.name ?? "this desk"}.`);
                  return reload();
                })
                .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not remove the assignment"))
                .finally(() => setBusy(false));
            }}
          >
            Remove assigned
          </Button>
          <Link className="text-sm text-accent underline-offset-2 hover:underline" to="/leads?status=new&assigned=unassigned">Open unassigned leads</Link>
        </Card>
      ) : (
        <p className="text-sm text-muted">Assignment is available to Admin.</p>
      )}
    </div>
  );
}

export function ProductionDeskPage() {
  const { productionUser } = useAuth();
  const admin = canOperateWhatsApp(productionUser?.roleKey ?? "");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [ownerId, setOwnerId] = useState(productionUser?.userId ?? "");
  const [leads, setLeads] = useState<ProductionLead[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const workspace = workspaces.find((item) => item.id === workspaceId);
  const owner = useMemo(
    () => members.find((item) => item.userId === ownerId) ?? { userId: ownerId, name: "My desk", role: productionUser?.roleKey ?? "", workspaceId },
    [members, ownerId, productionUser?.roleKey, workspaceId],
  );

  useEffect(() => {
    void listWorkspaces()
      .then((rows) => {
        setWorkspaces(rows);
        setWorkspaceId((current) => (rows.some((item) => item.id === current) ? current : rows[0]?.id ?? ""));
      })
      .catch((reason: unknown) => {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : "Could not load workspaces");
      });
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    void listAssignableMembers(workspaceId, workspace?.workspaceType)
      .then((people) => {
        setMembers(people);
        setOwnerId((current) => {
          if (!admin) return productionUser?.userId ?? current;
          if (people.some((item) => item.userId === current)) return current;
          return people[0]?.userId ?? productionUser?.userId ?? "";
        });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load desk staff"));
  }, [workspaceId, admin, productionUser?.userId, workspace?.workspaceType]);

  useEffect(() => {
    if (!workspaceId || !ownerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void listLeads({ page: 1, workspaceId, assignedTo: ownerId })
      .then((result) => {
        setLeads(result.leads);
        setTotal(result.total);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load desk leads"))
      .finally(() => setLoading(false));
  }, [workspaceId, ownerId]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={admin ? "Employee desk" : "My desk"}
        description=""
        actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            {workspaces.length > 1 ? (
              <Select className="w-full sm:w-56" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
                {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            ) : null}
            {admin ? (
              <Select className="w-full sm:w-64" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
              </Select>
            ) : null}
          </div>
        )}
      />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">Assigned leads</p><p className="mt-1 text-2xl font-semibold tabular">{total}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Desk</p><p className="mt-1 text-lg font-semibold">{workspace?.name ?? "—"}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Owner</p><p className="mt-1 text-lg font-semibold">{owner.name}</p></Card>
      </div>
      <div className="space-y-2 lg:hidden">
        {loading ? <p className="text-sm text-muted">Loading desk…</p> : null}
        {!loading && leads.length === 0 ? <p className="rounded-lg border border-line bg-white px-4 py-6 text-sm text-muted">No leads assigned to this desk.</p> : null}
        {leads.map((lead) => (
          <article key={lead.id} className="space-y-1 rounded-lg border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <Link className="font-medium" to={`/leads/${lead.id}`}>{lead.fullName}</Link>
              <span className="text-xs capitalize text-muted">{lead.status.replaceAll("_", " ")}</span>
            </div>
            <PhoneLink phone={lead.phone} />
            <p className="text-xs text-muted">{lead.location || "No place"} · {lead.position || "No interest"}</p>
            <Link className="inline-flex min-h-11 items-center text-sm text-accent" to={`/leads/${lead.id}`}>Open</Link>
          </article>
        ))}
      </div>
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="border-b border-line text-xs text-muted">
            <tr>{["Name", "Phone", "Place", "Interest", "Status", ""].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-6 text-sm text-muted" colSpan={6}>Loading desk…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td className="px-3 py-6 text-sm text-muted" colSpan={6}>No leads assigned to this desk.</td></tr>
            ) : leads.map((lead) => (
              <tr key={lead.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`}>{lead.fullName}</Link></td>
                <td className="px-3 py-2"><PhoneLink phone={lead.phone} /></td>
                <td className="px-3 py-2">{lead.location || "—"}</td>
                <td className="px-3 py-2">{lead.position || "—"}</td>
                <td className="px-3 py-2 capitalize">{lead.status.replaceAll("_", " ")}</td>
                <td className="px-3 py-2 text-right"><Link className="text-accent" to={`/leads/${lead.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {total > leads.length ? (
        <p className="text-sm text-muted">Showing first {leads.length} of {total}. <Link className="text-accent" to="/leads">Open full lead book</Link></p>
      ) : null}
    </div>
  );
}
