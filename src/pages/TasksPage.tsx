import { useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PriorityBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/context/CrmContext";
import { PRIORITY_LABEL } from "@/data/catalog";
import { followUpBucket, formatDateTime, toDateTimeLocal } from "@/lib/dates";
import { userName } from "@/lib/template";
import { useAuth } from "@/context/AuthContext";
import { ProductionTasks } from "@/pages/production/ProductionOpsPages";
import type { Priority, Task, TaskStatus } from "@/types";

export function TasksPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionTasks />;
  return <DemoTasks />;
}

function DemoTasks() {
  const empty = {
    title: "",
    leadId: "",
    assignedTo: "",
    priority: "medium" as Priority,
    dueAt: "",
    taskType: "call",
    description: "",
    status: "pending" as TaskStatus,
  };
  const { state, actorId, saveTask, removeTask, setTaskStatus } = useCrm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty, assignedTo: actorId });
  const groups = {
    today: state.tasks.filter((task) => task.status !== "completed" && followUpBucket(task.dueAt, "pending") === "today"),
    overdue: state.tasks.filter((task) => task.status !== "completed" && followUpBucket(task.dueAt, "pending") === "overdue"),
    upcoming: state.tasks.filter((task) => task.status !== "completed" && followUpBucket(task.dueAt, "pending") === "upcoming"),
    done: state.tasks.filter((task) => task.status === "completed"),
  };

  const start = (task?: Task) => {
    setEditing(task?.id ?? null);
    setForm(task ? { title: task.title, leadId: task.leadId ?? "", assignedTo: task.assignedTo, priority: task.priority, dueAt: toDateTimeLocal(task.dueAt), taskType: task.taskType, description: task.description, status: task.status } : { ...empty, assignedTo: actorId, dueAt: toDateTimeLocal(new Date()) });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Tasks" description="Calls, document checks and interview preparation." actions={<Button type="button" onClick={() => start()}>New task</Button>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <TaskColumn title="Today's tasks" tasks={groups.today} empty="No tasks today" state={state} onEdit={start} onStatus={setTaskStatus} onDelete={removeTask} />
        <TaskColumn title="Overdue tasks" tasks={groups.overdue} empty="Nothing overdue" state={state} onEdit={start} onStatus={setTaskStatus} onDelete={removeTask} />
        <TaskColumn title="Upcoming tasks" tasks={groups.upcoming} empty="No upcoming tasks" state={state} onEdit={start} onStatus={setTaskStatus} onDelete={removeTask} />
      </div>
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Completed</h2>
        {groups.done.length === 0 ? <p className="mt-2 text-sm text-muted">Completed tasks will collect here.</p> : (
          <ul className="mt-3 space-y-2">{groups.done.map((task) => <li key={task.id} className="text-sm text-muted">{task.title}</li>)}</ul>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <Select value={form.leadId} onChange={(event) => setForm({ ...form, leadId: event.target.value })}>
              <option value="">No candidate</option>
              {state.leads.slice(0, 80).map((lead) => <option key={lead.id} value={lead.id}>{lead.fullName}</option>)}
            </Select>
            <Select value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}>
              {state.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </Select>
            </div>
            <Input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
            <Select value={form.taskType} onChange={(event) => setForm({ ...form, taskType: event.target.value })}>
              {["call", "email", "documents", "interview", "whatsapp", "general"].map((type) => <option key={type} value={type}>{type}</option>)}
            </Select>
            <Textarea placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
          {!form.title.trim() ? <p className="mt-2 text-xs text-danger">Title is required.</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!form.title.trim() || !form.dueAt} onClick={() => {
              saveTask({ ...form, leadId: form.leadId || null, dueAt: new Date(form.dueAt).toISOString() }, editing ?? undefined);
              setOpen(false);
            }}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskColumn({ title, tasks, empty, state, onEdit, onStatus, onDelete }: {
  title: string;
  tasks: Task[];
  empty: string;
  state: { leads: Array<{ id: string; fullName: string }>; users: Array<{ id: string; name: string }> };
  onEdit: (task: Task) => void;
  onStatus: (id: string, status: TaskStatus) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {tasks.length === 0 ? <EmptyState title={empty} description="The desk has nothing waiting in this list." /> : (
        <ul className="mt-3 space-y-3">
          {tasks.map((task) => {
            const lead = state.leads.find((item) => item.id === task.leadId);
            return (
              <li key={task.id} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{task.title}</p>
                  <PriorityBadge priority={task.priority} />
                </div>
                <p className="mt-1 text-xs text-muted">{lead ? <Link to={`/leads/${lead.id}`}>{lead.fullName}</Link> : "Internal"} · {userName(state.users, task.assignedTo)}</p>
                <p className="text-xs text-muted">{formatDateTime(task.dueAt)} · {task.taskType}</p>
                <div className="mt-2 flex gap-2 text-xs">
                  {task.status !== "in_progress" ? <button type="button" onClick={() => onStatus(task.id, "in_progress")}>Start</button> : null}
                  <button type="button" onClick={() => onStatus(task.id, "completed")}>Complete</button>
                  <button type="button" onClick={() => onEdit(task)}>Edit</button>
                  <button type="button" className="text-danger" onClick={() => onDelete(task.id)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
