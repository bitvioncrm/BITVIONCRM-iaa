import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field } from "@/components/shared/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SheetBody, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/context/CrmContext";
import { OFFERINGS, POSITIONS, PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/data/catalog";
import { isValidPhone } from "@/lib/utils";
import type { Lead, LeadInput, LeadSource, LeadStatus, Priority } from "@/types";

const schema = z.object({
  fullName: z.string().trim().min(2, "Full name is required"),
  phone: z.string().trim().refine(isValidPhone, "Invalid phone number"),
  whatsapp: z.string().trim().refine(isValidPhone, "Invalid phone number"),
  email: z.string().trim().email("Invalid email"),
  gender: z.enum(["male", "female", "other"]),
  age: z.number({ invalid_type_error: "Age is required" }).int().min(18, "Age must be at least 18").max(70, "Enter a realistic age"),
  location: z.string().trim().min(2, "Location is required"),
  country: z.string().trim().min(2, "Country is required"),
  position: z.string().trim().min(2, "Position is required"),
  jobCategory: z.string().trim().min(2, "Job category is required"),
  experience: z.string().trim().min(1, "Experience is required"),
  source: z.enum(["website", "whatsapp", "instagram", "facebook", "google", "referral", "walk_in", "meta_ads", "other"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  assignedTo: z.string(),
  businessUnit: z.enum(["clinic", "institute"]),
  status: z.enum(["excel", "new", "contacted", "interested", "follow_up", "documents_pending", "processing", "interview", "selected", "converted", "lost"]),
  notes: z.string().optional(),
  tags: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function valuesFromLead(lead: Lead | null | undefined, _actorId: string): FormValues {
  if (!lead) {
    return {
      fullName: "",
      phone: "+91 ",
      whatsapp: "+91 ",
      email: "",
      gender: "male",
      age: 26,
      location: "Perumbavoor",
      country: "India",
      position: "HydraFacial",
      jobCategory: "Facial aesthetics",
      experience: "First visit",
      source: "meta_ads",
      priority: "medium",
      assignedTo: "",
      status: "new",
      notes: "",
      tags: "",
      businessUnit: "clinic",
    };
  }
  return {
    fullName: lead.fullName,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    email: lead.email,
    gender: lead.gender,
    age: lead.age,
    location: lead.location,
    country: lead.country,
    position: lead.position,
    jobCategory: lead.jobCategory,
    experience: lead.experience,
    source: lead.source,
    priority: lead.priority,
    assignedTo: lead.assignedTo,
    status: lead.status,
    notes: lead.notes,
    tags: lead.tags.join(", "),
    businessUnit: lead.businessUnit,
  };
}

export function LeadForm({ lead, onClose }: { lead?: Lead | null; onClose: () => void }) {
  const { actorId, state, addLead, updateLead } = useCrm();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesFromLead(lead, actorId),
  });

  useEffect(() => {
    form.reset(valuesFromLead(lead, actorId));
  }, [actorId, form, lead]);

  const onSubmit = form.handleSubmit((values) => {
    const input: LeadInput = {
      fullName: values.fullName,
      phone: values.phone,
      whatsapp: values.whatsapp,
      email: values.email,
      gender: values.gender,
      age: values.age,
      location: values.location,
      country: values.country,
      position: values.position,
      jobCategory: values.jobCategory,
      experience: values.experience,
      source: values.source as LeadSource,
      priority: values.priority as Priority,
      assignedTo: values.assignedTo,
      status: values.status as LeadStatus,
      notes: values.notes ?? "",
      tags: (values.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      businessUnit: values.businessUnit,
      metaCampaignId: OFFERINGS.find((item) => item.position === values.position)?.campaignId ?? lead?.metaCampaignId,
      metaCampaignName: lead?.metaCampaignName,
    };
    const error = lead ? updateLead(lead.id, input) : addLead(input);
    if (!error) onClose();
  });

  const fillDemo = () => {
    const suffix = String(Date.now()).slice(-6);
    form.reset({
      ...valuesFromLead(null, actorId),
      fullName: "Anjali Thomas",
      phone: `+9198${suffix}01`,
      whatsapp: `+9198${suffix}01`,
      email: `anjali.thomas.${suffix}@gmail.com`,
      gender: "female",
      age: 28,
      location: "Perumbavoor",
      country: "India",
      position: "HydraFacial",
      jobCategory: "Facial aesthetics",
      experience: "First visit",
      source: "meta_ads",
      priority: "high",
      status: "new",
      businessUnit: "clinic",
      notes: "Fresh Meta lead for HydraFacial at the Perumbavoor clinic.",
      tags: "Meta",
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col">
      <SheetHeader>
        <h2 className="text-base font-semibold">{lead ? "Edit lead" : "Add lead"}</h2>
        <p className="mt-1 text-sm text-muted">Name, phone and place. Leave assignment empty to keep the lead in the fresh queue.</p>
      </SheetHeader>
      <SheetBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={form.formState.errors.fullName?.message}>
          <Input {...form.register("fullName")} />
        </Field>
        <Field label="Phone" error={form.formState.errors.phone?.message}>
          <Input {...form.register("phone")} onBlur={(event) => {
            const whatsapp = form.getValues("whatsapp");
            if (!whatsapp.trim() || whatsapp.trim() === "+91") form.setValue("whatsapp", event.target.value);
          }} />
        </Field>
        <Field label="WhatsApp number" error={form.formState.errors.whatsapp?.message}>
          <Input {...form.register("whatsapp")} />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" {...form.register("email")} />
        </Field>
        <Field label="Gender" error={form.formState.errors.gender?.message}>
          <Select {...form.register("gender")}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Age" error={form.formState.errors.age?.message}>
          <Input type="number" {...form.register("age", { valueAsNumber: true })} />
        </Field>
        <Field label="Desk" error={form.formState.errors.businessUnit?.message}>
          <Select {...form.register("businessUnit")}>
            <option value="clinic">Clinic · Dr. K's Aesthetic Clinic</option>
            <option value="institute">Institute · IAA Kochi</option>
          </Select>
        </Field>
        <Field label="Place" error={form.formState.errors.location?.message}>
          <Input {...form.register("location")} />
        </Field>
        <Field label="Country" error={form.formState.errors.country?.message}>
          <Input {...form.register("country")} />
        </Field>
        <Field label="Interest" error={form.formState.errors.position?.message}>
          <Input list="positions" {...form.register("position")} />
          <datalist id="positions">
            {POSITIONS.map((item) => (
              <option key={item.position} value={item.position} />
            ))}
          </datalist>
        </Field>
        <Field label="Department" error={form.formState.errors.jobCategory?.message}>
          <Input {...form.register("jobCategory")} />
        </Field>
        <Field label="Background" error={form.formState.errors.experience?.message}>
          <Input {...form.register("experience")} />
        </Field>
        <Field label="Source" error={form.formState.errors.source?.message}>
          <Select {...form.register("source")}>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" error={form.formState.errors.priority?.message}>
          <Select {...form.register("priority")}>
            {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned to" error={form.formState.errors.assignedTo?.message}>
          <Select {...form.register("assignedTo")}>
            <option value="">Unassigned · fresh queue</option>
            {state.users.filter((user) => user.status === "active").map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status" error={form.formState.errors.status?.message}>
          <Select {...form.register("status")}>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Tags">
            <Input placeholder="Gulf, Urgent" {...form.register("tags")} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes" error={form.formState.errors.notes?.message}>
            <Textarea {...form.register("notes")} />
          </Field>
        </div>
      </SheetBody>
      <SheetFooter className="justify-between">
        {lead ? <span /> : (
          <Button type="button" variant="ghost" onClick={fillDemo}>Fill clinic demo</Button>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">{lead ? "Save changes" : "Create lead"}</Button>
        </div>
      </SheetFooter>
    </form>
  );
}
