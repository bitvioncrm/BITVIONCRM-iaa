import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { PriorityBadge } from "@/components/shared/StatusBadge";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { PIPELINE_COLUMNS, STATUS_LABEL } from "@/data/catalog";
import { deskLeads } from "@/lib/scope";
import { formatSmart } from "@/lib/dates";
import { userName } from "@/lib/template";
import { cn } from "@/lib/utils";
import { ProductionPipeline } from "@/pages/production/ProductionOpsPages";
import type { Lead, LeadStatus } from "@/types";

export function PipelinePage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionPipeline />;
  return <DemoPipeline />;
}

function DemoPipeline() {
  const { session } = useAuth();
  const { state, setStatus } = useCrm();
  const me = state.users.find((user) => user.id === session?.userId);
  const book = deskLeads(state.leads, me);
  const [owner, setOwner] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<LeadStatus | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const grouped = useMemo(() => {
    const map = Object.fromEntries(PIPELINE_COLUMNS.map((column) => [column.id, [] as Lead[]])) as Record<LeadStatus, Lead[]>;
    book.forEach((lead) => {
      if (owner && lead.assignedTo !== owner) return;
      map[lead.status].push(lead);
    });
    return map;
  }, [book, owner]);
  const active = state.leads.find((lead) => lead.id === activeId) ?? null;

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const leadId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!PIPELINE_COLUMNS.some((column) => column.id === overId)) return;
    setStatus(leadId, overId as LeadStatus);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline"
        description="Drag a candidate into the next stage. Status, activity and dashboard totals update together."
        actions={
          <Select className="w-48" value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">All recruiters</option>
            {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </Select>
        }
      />
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(event) => setActiveId(String(event.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {PIPELINE_COLUMNS.map((column) => {
            const cards = grouped[column.id];
            const shown = expanded === column.id ? cards : cards.slice(0, 8);
            return (
              <Column key={column.id} id={column.id} title={column.title} count={cards.length}>
                {shown.map((lead) => <LeadCard key={lead.id} lead={lead} users={state.users} onMove={(status) => setStatus(lead.id, status)} />)}
                {cards.length > 8 && expanded !== column.id ? (
                  <button type="button" className="w-full py-1 text-xs text-muted hover:text-ink" onClick={() => setExpanded(column.id)}>Show {cards.length - 8} more</button>
                ) : null}
              </Column>
            );
          })}
        </div>
        <DragOverlay>{active ? <LeadCard lead={active} users={state.users} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={cn("w-[260px] shrink-0 rounded-lg border border-line bg-[#eef0f3] p-2", isOver && "border-navy")}>
      <header className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="text-xs text-muted tabular">{count}</span>
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function LeadCard({ lead, users, onMove, overlay = false }: { lead: Lead; users: { id: string; name: string }[]; onMove?: (status: LeadStatus) => void; overlay?: boolean }) {
  if (overlay) return <CardFace lead={lead} users={users} className="shadow-pop" />;
  return <DraggableCard lead={lead} users={users} onMove={onMove} />;
}

function DraggableCard({ lead, users, onMove }: { lead: Lead; users: { id: string; name: string }[]; onMove?: (status: LeadStatus) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });
  return (
    <article ref={setNodeRef} className={cn("rounded-md border border-line bg-white p-3 shadow-card", isDragging && "opacity-40")} {...listeners} {...attributes}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/leads/${lead.id}`} className="text-sm font-medium" onPointerDown={(event) => event.stopPropagation()}>{lead.fullName}</Link>
        <PriorityBadge priority={lead.priority} />
      </div>
      <p className="mt-1 text-xs text-muted">{lead.position}</p>
      <p className="text-xs text-muted">{lead.location}</p>
      <p className="mt-2 text-[11px] text-muted">{userName(users, lead.assignedTo)} · {formatSmart(lead.updatedAt)}</p>
      {lead.nextFollowUpAt ? <p className="text-[11px] text-muted">Follow-up {formatSmart(lead.nextFollowUpAt)}</p> : null}
      {onMove ? (
        <select className="mt-2 w-full bg-transparent text-[11px] text-muted" value={lead.status} onChange={(event) => onMove(event.target.value as LeadStatus)} onPointerDown={(event) => event.stopPropagation()}>
          {PIPELINE_COLUMNS.map((column) => <option key={column.id} value={column.id}>{STATUS_LABEL[column.id]}</option>)}
        </select>
      ) : null}
    </article>
  );
}

function CardFace({ lead, users, className }: { lead: Lead; users: { id: string; name: string }[]; className?: string }) {
  return (
    <article className={cn("rounded-md border border-line bg-white p-3 shadow-card", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{lead.fullName}</p>
        <PriorityBadge priority={lead.priority} />
      </div>
      <p className="mt-1 text-xs text-muted">{lead.position}</p>
      <p className="text-xs text-muted">{users.find((user) => user.id === lead.assignedTo)?.name}</p>
    </article>
  );
}
