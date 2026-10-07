import { Download, MoreHorizontal, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ImportDialog } from "@/components/leads/ImportDialog";
import { LeadForm } from "@/components/leads/LeadForm";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { HowItWorks } from "@/components/shared/HowItWorks";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { PriorityBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { SendWhatsAppDialog } from "@/components/whatsapp/SendWhatsAppDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { FOLLOW_UP_LABEL } from "@/data/catalog";
import { exportLeadSheet } from "@/lib/lead-export";
import { formatDate, formatDateTime, formatSmart, toDateTimeLocal, tomorrowAt10 } from "@/lib/dates";
import { deskLeads } from "@/lib/scope";
import { PhoneLink } from "@/components/shared/PhoneLink";
import { ProductionLeadsPage } from "@/pages/ProductionLeadsPage";
import { userName } from "@/lib/template";
import type { FollowUpType, Lead, LeadStatus } from "@/types";

const PAGE_SIZE = 20;

export function LeadsPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionLeadsPage />;
  return <DemoLeadsPage />;
}

function DemoLeadsPage() {
  const { session } = useAuth();
  const { state, removeLeads, assignLeads, changeStatus, tagLeads, createFollowUps } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const book = deskLeads(state.leads, me);
  const { canWrite, canDelete } = usePermissions();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [position, setPosition] = useState("");
  const [location, setLocation] = useState("");
  const [priority, setPriority] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unit, setUnit] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [whatsappLead, setWhatsappLead] = useState<Lead | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"assign" | "status" | "tag" | "follow" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [followType, setFollowType] = useState<FollowUpType>("whatsapp");

  const filtered = useMemo(() => {
    return book.filter((lead) => {
      if (params.get("contact") === "none" && lead.lastContactAt) return false;
      const haystack = `${lead.fullName} ${lead.phone} ${lead.email} ${lead.position}`.toLowerCase();
      if (query && !haystack.includes(query.trim().toLowerCase())) return false;
      if (status && lead.status !== status) return false;
      if (source && lead.source !== source) return false;
      if (owner && lead.assignedTo !== owner) return false;
      if (position && !lead.position.toLowerCase().includes(position.toLowerCase())) return false;
      if (location && !lead.location.toLowerCase().includes(location.toLowerCase())) return false;
      if (priority && lead.priority !== priority) return false;
      if (unit && lead.businessUnit !== unit) return false;
      const created = lead.createdAt.slice(0, 10);
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
  }, [book, from, location, owner, params, position, priority, query, source, status, to, unit]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const allVisibleSelected = visible.length > 0 && visible.every((lead) => selected.includes(lead.id));

  const exportRows = (leads: Lead[]) => {
    exportLeadSheet(leads, state.users);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description={`${filtered.length.toLocaleString("en-IN")} leads in this view. Use status and dates to narrow the list.`}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setImportOpen(true)} disabled={!canWrite}><Upload className="size-4" /> Import</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary"><Download className="size-4" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => exportRows(state.leads)}>Export all</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows(filtered)}>Export filtered</DropdownMenuItem>
                <DropdownMenuItem disabled={!selected.length} onSelect={() => exportRows(state.leads.filter((lead) => selected.includes(lead.id)))}>Export selected</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" disabled={!canWrite} onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="size-4" /> Add Lead</Button>
          </>
        }
      />
      <HowItWorks page="leads" />
      <div className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-4 xl:grid-cols-8">
        <Input className="md:col-span-2" placeholder="Search leads" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Status</option>
          {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
        </Select>
        <Select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">Source</option>
          {Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">Assigned to</option>
          {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </Select>
        <Input placeholder="Position" value={position} onChange={(event) => setPosition(event.target.value)} />
        <Select value={unit} onChange={(event) => { setUnit(event.target.value); setPage(1); }}>
          <option value="">Clinic or institute</option>
          <option value="clinic">Clinic · Perumbavoor</option>
          <option value="institute">Institute · Kochi</option>
        </Select>
        <Input placeholder="Place" value={location} onChange={(event) => setLocation(event.target.value)} />
        <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">Priority</option>
          {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Input type="date" aria-label="From date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
        <Input type="date" aria-label="To date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
      </div>
      {selected.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite} onClick={() => { setBulk("assign"); setBulkValue(state.users[0]?.id ?? ""); }}>Assign</Button>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite} onClick={() => { setBulk("status"); setBulkValue("contacted"); }}>Change status</Button>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite} onClick={() => { setBulk("tag"); setBulkValue(""); }}>Add tag</Button>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite} onClick={() => { setBulk("follow"); setBulkValue(toDateTimeLocal(tomorrowAt10())); }}>Create follow-up</Button>
          <Button type="button" size="sm" variant="secondary" disabled={!canWrite} onClick={() => setWhatsappLead(state.leads.find((lead) => lead.id === selected[0]) ?? null)}>Send WhatsApp</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => exportRows(state.leads.filter((lead) => selected.includes(lead.id)))}>Export</Button>
          <Button type="button" size="sm" variant="danger" disabled={!canDelete} onClick={() => setDeleteIds(selected)}>Delete</Button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        {visible.length === 0 ? (
          <EmptyState title="No leads match" description="Try a different search or clear the filters." action={<Button type="button" variant="secondary" onClick={() => { setQuery(""); setStatus(""); setSource(""); setOwner(""); setPosition(""); setLocation(""); setPriority(""); setFrom(""); setTo(""); setUnit(""); }}>Clear filters</Button>} />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1100px] text-left text-[13px]">
                <thead className="border-b border-line bg-slate-50 text-xs text-muted">
                  <tr>
                    <th className="w-10 px-3 py-2"><Checkbox ariaLabel="Select page" checked={allVisibleSelected ? true : selected.some((id) => visible.some((lead) => lead.id === id)) ? "indeterminate" : false} onCheckedChange={(checked) => setSelected(checked ? Array.from(new Set([...selected, ...visible.map((lead) => lead.id)])) : selected.filter((id) => !visible.some((lead) => lead.id === id)))} /></th>
                    {["Candidate", "Phone", "Email", "Position", "Source", "Status", "Priority", "Assigned", "Created", "Last activity", "Next follow-up", ""].map((heading) => (
                      <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((lead) => (
                    <tr key={lead.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                      <td className="px-3 py-2"><Checkbox ariaLabel={`Select ${lead.fullName}`} checked={selected.includes(lead.id)} onCheckedChange={(checked) => setSelected(checked ? [...selected, lead.id] : selected.filter((id) => id !== lead.id))} /></td>
                      <td className="px-3 py-2 font-medium"><Link to={`/leads/${lead.id}`}>{lead.fullName}</Link></td>
                      <td className="px-3 py-2"><PhoneLink phone={lead.phone} /></td>
                      <td className="px-3 py-2 text-muted">{lead.email}</td>
                      <td className="px-3 py-2">{lead.position}</td>
                      <td className="px-3 py-2">{SOURCE_LABEL[lead.source]}</td>
                      <td className="px-3 py-2"><StatusBadge status={lead.status} /></td>
                      <td className="px-3 py-2"><PriorityBadge priority={lead.priority} /></td>
                      <td className="px-3 py-2">{userName(state.users, lead.assignedTo)}</td>
                      <td className="px-3 py-2 text-muted">{formatDateTime(lead.createdAt)}</td>
                      <td className="px-3 py-2 text-muted">{formatSmart(lead.updatedAt)}</td>
                      <td className="px-3 py-2 text-muted">{formatDate(lead.nextFollowUpAt, "d MMM, h:mm a")}</td>
                      <td className="px-3 py-2 text-right">
                        <RowMenu lead={lead} canWrite={canWrite} canDelete={canDelete} onEdit={() => { setEditing(lead); setFormOpen(true); }} onWhatsApp={() => setWhatsappLead(lead)} onFollow={() => { setSelected([lead.id]); setBulk("follow"); setBulkValue(toDateTimeLocal(tomorrowAt10())); }} onDelete={() => setDeleteIds([lead.id])} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-line lg:hidden">
              {visible.map((lead) => (
                <div key={lead.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/leads/${lead.id}`} className="font-medium">{lead.fullName}</Link>
                    <StatusBadge status={lead.status} />
                  </div>
                  <p className="text-xs text-muted">{lead.position}</p>
                  <PhoneLink phone={lead.phone} className="text-sm" />
                  <p className="text-xs text-muted">{userName(state.users, lead.assignedTo)} · Created {formatDateTime(lead.createdAt)}</p>
                </div>
              ))}
            </div>
            <Pagination page={safePage} pages={pages} onPage={setPage} />
          </>
        )}
      </div>
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent title={editing ? "Edit lead" : "Add lead"}>
          {formOpen ? <LeadForm lead={editing} onClose={() => setFormOpen(false)} /> : null}
        </SheetContent>
      </Sheet>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <SendWhatsAppDialog lead={whatsappLead} open={Boolean(whatsappLead)} onOpenChange={(open) => { if (!open) setWhatsappLead(null); }} />
      <ConfirmDialog open={deleteIds.length > 0} danger title="Delete leads?" description="This removes the selected candidates from the demo workspace. The action is stored in the activity log." confirmLabel="Delete" onOpenChange={(open) => { if (!open) setDeleteIds([]); }} onConfirm={() => { removeLeads(deleteIds); setSelected([]); }} />
      <Dialog open={Boolean(bulk)} onOpenChange={(open) => { if (!open) setBulk(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk action</DialogTitle></DialogHeader>
          {bulk === "assign" ? (
            <Select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>
              {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
          ) : null}
          {bulk === "status" ? (
            <Select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>
              {STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
            </Select>
          ) : null}
          {bulk === "tag" ? <Input placeholder="Tag name" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} /> : null}
          {bulk === "follow" ? (
            <div className="space-y-3">
              <Select value={followType} onChange={(event) => setFollowType(event.target.value as FollowUpType)}>
                {Object.entries(FOLLOW_UP_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              <Input type="datetime-local" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setBulk(null)}>Cancel</Button>
            <Button type="button" onClick={() => {
              if (bulk === "assign") assignLeads(selected, bulkValue);
              if (bulk === "status") changeStatus(selected, bulkValue as LeadStatus);
              if (bulk === "tag") tagLeads(selected, bulkValue);
              if (bulk === "follow") createFollowUps(selected, followType, new Date(bulkValue).toISOString(), "Created from bulk actions.");
              setBulk(null);
              setSelected([]);
            }}>Apply</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowMenu({ lead, canWrite, canDelete, onEdit, onWhatsApp, onFollow, onDelete }: { lead: Lead; canWrite: boolean; canDelete: boolean; onEdit: () => void; onWhatsApp: () => void; onFollow: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-md p-1 hover:bg-slate-100" aria-label={`Actions for ${lead.fullName}`}><MoreHorizontal className="size-4" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild><Link to={`/leads/${lead.id}`}>View</Link></DropdownMenuItem>
        <DropdownMenuItem disabled={!canWrite} onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem disabled={!canWrite} onSelect={onWhatsApp}>WhatsApp</DropdownMenuItem>
        <DropdownMenuItem disabled={!canWrite} onSelect={onFollow}>Add follow-up</DropdownMenuItem>
        <DropdownMenuItem disabled={!canDelete} onSelect={onDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
