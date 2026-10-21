import { addDays, format } from "date-fns";
import {
  campaignById,
  CITIES,
  DATA_VERSION,
  FEMALE_NAMES,
  FIRST_NAMES,
  LAST_NAMES,
  offeringFor,
  POSITIONS,
  SOURCE_LABEL,
  STATUS_LABEL,
  USERS,
} from "@/data/catalog";
import { atHour } from "@/lib/dates";
import type {
  Activity,
  AppSettings,
  Automation,
  CallLog,
  Campaign,
  CrmState,
  FollowUp,
  FollowUpType,
  Job,
  Lead,
  LeadSource,
  LeadStatus,
  Priority,
  Task,
  Template,
  WhatsAppConversation,
  WhatsAppMessage,
} from "@/types";

const LEAD_COUNT = 1248;
const STATUS_QUOTA: Array<[LeadStatus, number]> = [
  ["new", 124],
  ["contacted", 186],
  ["interested", 210],
  ["follow_up", 148],
  ["documents_pending", 96],
  ["processing", 142],
  ["interview", 98],
  ["selected", 74],
  ["converted", 82],
  ["lost", 88],
];

const SOURCE_BAG: LeadSource[] = [
  ...Array.from({ length: 22 }, () => "website" as const),
  ...Array.from({ length: 20 }, () => "whatsapp" as const),
  ...Array.from({ length: 14 }, () => "instagram" as const),
  ...Array.from({ length: 12 }, () => "facebook" as const),
  ...Array.from({ length: 16 }, () => "google" as const),
  ...Array.from({ length: 10 }, () => "referral" as const),
  ...Array.from({ length: 6 }, () => "walk_in" as const),
];

const PRIORITIES: Priority[] = ["medium", "high", "medium", "low", "medium", "urgent", "high", "medium"];
const DOC_NAMES = ["Passport", "Photograph", "Educational Certificates", "Experience Letter"];
const NOTE_POOL = [
  "Passport is valid for more than 24 months. Candidate can attend an interview this week.",
  "Asked for salary range and accommodation details before sharing certificates.",
  "Available to travel within 45 days. Prefers a direct employer, not a subcontract role.",
  "Family discussion pending. Requested a call after 6 PM.",
  "Experience letter is ready. Medical certificate is still pending from the local clinic.",
  "Referred by a placed candidate. Responds faster on WhatsApp than email.",
];

interface Hero {
  fullName: string;
  position: string;
  source: LeadSource;
  status: LeadStatus;
  priority: Priority;
  gender: Lead["gender"];
  age: number;
  location: string;
  experience: string;
  notes: string;
  phone: string;
  email: string;
  assignedTo: string;
}

const HEROES: Hero[] = [
  {
    fullName: "Rahul Kumar",
    position: "HydraFacial",
    source: "meta_ads",
    status: "contacted",
    priority: "high",
    gender: "male",
    age: 27,
    location: "Perumbavoor",
    experience: "First visit",
    notes: "Meta lead form for HydraFacial at the Perumbavoor clinic. Asked for an evening slot.",
    phone: "+919847011220",
    email: "rahul.kumar@gmail.com",
    assignedTo: USERS[1].id,
  },
  {
    fullName: "Anjali Thomas",
    position: "Dental implant",
    source: "meta_ads",
    status: "interested",
    priority: "high",
    gender: "female",
    age: 25,
    location: "Muvattupuzha",
    experience: "Consultation",
    notes: "Came from the Perumbavoor dental Meta campaign. Wants an implant consultation.",
    phone: "+919847011221",
    email: "anjali.thomas@gmail.com",
    assignedTo: USERS[1].id,
  },
  {
    fullName: "Muhammed Shamil",
    position: "PRP hair therapy",
    source: "meta_ads",
    status: "documents_pending",
    priority: "medium",
    gender: "male",
    age: 32,
    location: "Kothamangalam",
    experience: "Consultation",
    notes: "PRP enquiry from Meta. Photos of the hairline are still pending.",
    phone: "+919847011222",
    email: "muhammed.shamil@gmail.com",
    assignedTo: USERS[2].id,
  },
  {
    fullName: "Sneha Joseph",
    position: "Clinical aesthetics certificate",
    source: "meta_ads",
    status: "interview",
    priority: "high",
    gender: "female",
    age: 29,
    location: "Kochi",
    experience: "BSc Nursing",
    notes: "IAA Kochi course enquiry. Nursing background. Consultation booked. No automated WhatsApp.",
    phone: "+919847011223",
    email: "sneha.joseph.candidate@gmail.com",
    assignedTo: USERS[4].id,
  },
  {
    fullName: "Arjun Nair",
    position: "Botox and fillers",
    source: "meta_ads",
    status: "new",
    priority: "urgent",
    gender: "male",
    age: 24,
    location: "Perumbavoor",
    experience: "First visit",
    notes: "Fresh Meta lead. Not assigned yet. Admin should place this with a clinic counsellor.",
    phone: "+919847011224",
    email: "arjun.nair@gmail.com",
    assignedTo: "",
  },
  {
    fullName: "Neha Varghese",
    position: "Microneedling",
    source: "meta_ads",
    status: "follow_up",
    priority: "medium",
    gender: "female",
    age: 28,
    location: "Aluva",
    experience: "Follow-up",
    notes: "Skin campaign lead for the Perumbavoor clinic. Wants microneedling after office hours.",
    phone: "+919847011225",
    email: "neha.varghese@gmail.com",
    assignedTo: USERS[3].id,
  },
  {
    fullName: "Vishnu Raj",
    position: "Semi-permanent makeup",
    source: "meta_ads",
    status: "processing",
    priority: "medium",
    gender: "male",
    age: 31,
    location: "Kochi",
    experience: "Makeup artist",
    notes: "Institute lead for semi-permanent makeup. Manual WhatsApp only.",
    phone: "+919847011226",
    email: "vishnu.raj.candidate@gmail.com",
    assignedTo: USERS[1].id,
  },
  {
    fullName: "Fathima Basheer",
    position: "Advanced skin studio",
    source: "meta_ads",
    status: "selected",
    priority: "high",
    gender: "female",
    age: 30,
    location: "Ernakulam",
    experience: "MLT",
    notes: "Booked into the IAA advanced skin studio batch. Institute desk will call directly.",
    phone: "+919847011227",
    email: "fathima.basheer@gmail.com",
    assignedTo: USERS[2].id,
  },
];

function mulberry32(seed: number) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap] as T;
    copy[swap] = current as T;
  }
  return copy;
}

function leadId(index: number) {
  return `ld_${String(index + 1).padStart(4, "0")}`;
}

function documentsFor(status: LeadStatus, index: number): Lead["documents"] {
  return DOC_NAMES.map((name, docIndex) => {
    let docStatus: Lead["documents"][number]["status"] = "pending";
    if (status === "documents_pending") docStatus = docIndex < 2 ? "received" : "pending";
    else if (["processing", "interview", "selected", "converted"].includes(status)) docStatus = "received";
    else if (status === "lost" && docIndex === 3) docStatus = "rejected";
    return { id: `doc_${index}_${docIndex}`, name, status: docStatus };
  });
}

function buildDates(rng: () => number) {
  const now = new Date();
  const dates: Date[] = [];
  const add = (year: number, month: number, day: number, hour: number, minute: number) => {
    const date = new Date(year, month, day, hour, minute, 0, 0);
    if (date.getTime() > now.getTime()) {
      const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
      if (sameDay) date.setTime(now.getTime() - 60 * 1000);
      else date.setFullYear(date.getFullYear() - 1);
    }
    dates.push(date);
  };

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todaySpan = Math.max(now.getTime() - startOfToday.getTime(), 60 * 1000);
  for (let index = 0; index < 24; index += 1) {
    const date = new Date(startOfToday.getTime() + Math.floor((index / 24) * todaySpan));
    dates.push(date);
  }
  for (let offset = 1; offset <= 27; offset += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    const count = offset === 1 ? 18 : 9;
    for (let index = 0; index < count; index += 1) {
      add(day.getFullYear(), day.getMonth(), day.getDate(), 9 + (index % 8), Math.floor(rng() * 40));
    }
  }
  let cursor = 0;
  while (dates.length < LEAD_COUNT) {
    const year = cursor % 5 === 0 ? now.getFullYear() - (1 + (cursor % 3)) : now.getFullYear();
    add(year, cursor % 12, 1 + (cursor % 27), 10 + (cursor % 6), (cursor * 7) % 50);
    cursor += 1;
  }
  return dates.slice(0, LEAD_COUNT);
}

function uniqueName(index: number, used: Set<string>) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? "Amal";
  let turn = 0;
  let name = "";
  do {
    const last = LAST_NAMES[(Math.floor(index / FIRST_NAMES.length) + turn) % LAST_NAMES.length] ?? "Nair";
    name = `${first} ${last}`;
    turn += 1;
  } while (used.has(name));
  used.add(name);
  return name;
}

function applyBitvion(leads: Lead[]) {
  const clinicStaff = ["usr_anu", "usr_vishnu", "usr_sneha"];
  const instituteStaff = ["usr_rahulm", "usr_meera"];
  leads.forEach((lead, index) => {
    const offer = offeringFor(lead.position) ?? POSITIONS[index % POSITIONS.length];
    const matched = OFFER_IDS.has(lead.position);
    const unit = matched ? offer.unit : index % 5 === 0 ? "institute" : "clinic";
    if (!matched) {
      const picked = unit === "institute"
        ? ["Clinical aesthetics certificate", "Semi-permanent makeup", "Advanced skin studio", "Career masterclass"][index % 4]
        : ["HydraFacial", "Botox and fillers", "Dental implant", "PRP hair therapy", "Microneedling", "Teeth whitening"][index % 6];
      if (picked) {
        lead.position = picked;
        lead.jobCategory = offeringFor(picked).category;
      }
    } else {
      lead.jobCategory = offer.category;
    }
    lead.businessUnit = unit === "institute" || offeringFor(lead.position).unit === "institute" ? "institute" : "clinic";
    const finalCampaign = campaignById(offeringFor(lead.position).campaignId);
    lead.metaCampaignId = finalCampaign.id;
    lead.metaCampaignName = finalCampaign.name;
    lead.whatsappAutomation = lead.businessUnit === "clinic";
    if (!HEROES[index] && index % 4 !== 0) lead.source = "meta_ads";
    if (lead.status === "new" && (lead.assignedTo === "" || index % 3 === 0) && index > 0) {
      lead.assignedTo = "";
    } else if (!lead.assignedTo) {
      const pool = lead.businessUnit === "clinic" ? clinicStaff : instituteStaff;
      lead.assignedTo = pool[index % pool.length] ?? clinicStaff[0]!;
    } else if (!HEROES[index]) {
      const pool = lead.businessUnit === "clinic" ? clinicStaff : instituteStaff;
      lead.assignedTo = pool[index % pool.length] ?? clinicStaff[0]!;
    } else {
      const owner = USERS.find((user) => user.id === lead.assignedTo);
      const pool = lead.businessUnit === "clinic" ? clinicStaff : instituteStaff;
      if (owner && owner.businessUnit !== "both" && owner.businessUnit !== lead.businessUnit) {
        lead.assignedTo = pool[index % pool.length] ?? pool[0]!;
      }
    }
  });
}

const OFFER_IDS = new Set([
  "HydraFacial",
  "Botox and fillers",
  "Microneedling",
  "Laser tattoo and wart removal",
  "Dental implant",
  "Teeth whitening",
  "Tooth-coloured filling",
  "PRP hair therapy",
  "Clinical aesthetics certificate",
  "Semi-permanent makeup",
  "Advanced skin studio",
  "Career masterclass",
]);

function buildCalls(leads: Lead[], now: Date): CallLog[] {
  const logs: CallLog[] = [];
  leads.forEach((lead, index) => {
    if (lead.status === "new" || !lead.assignedTo || index % 4 !== 0) return;
    const count = 1 + (index % 3);
    for (let turn = 0; turn < count; turn += 1) {
      const seconds = (4 + ((index + turn) % 14)) * 60;
      const at = new Date(lead.createdAt);
      at.setDate(at.getDate() + turn);
      at.setHours(10 + (turn % 6), (index * 3) % 50, 0, 0);
      if (at.getTime() > now.getTime()) at.setTime(now.getTime() - turn * 60 * 1000);
      logs.push({
        id: `call_${lead.id}_${turn}`,
        leadId: lead.id,
        userId: lead.assignedTo,
        startedAt: at.toISOString(),
        durationSeconds: seconds,
        notes: turn === 0 ? "First call from the assigned counsellor." : "Follow-up call.",
      });
      lead.callCount += 1;
      lead.talkSeconds += seconds;
      lead.lastContactAt = at.toISOString();
    }
  });
  return logs;
}

function settings(): AppSettings {
  return {
    companyName: "Dr. K's",
    companyEmail: "hello@bitvion.demo",
    companyPhone: "+919895529928",
    website: "https://bitvion.demo",
    address: "Dr. K's Aesthetic Clinic, Arakkappady, Vengola, Perumbavoor · IAA Kochi",
    timezone: "Asia/Kolkata",
    whatsapp: {
      accountName: "Dr. K's Aesthetic Clinic",
      phoneNumber: "+919895529928",
      businessId: "104829331122334",
      apiStatus: "demo",
    },
    meta: {
      connected: true,
      accountName: "Dr. K's Ads",
      adAccountId: "act_8842103391",
      pageName: "Dr. K's Aesthetic Clinic",
      status: "demo",
    },
    notifications: {
      followUps: true,
      replies: true,
      campaigns: true,
      overdue: true,
    },
  };
}

function templates(nowIso: string): Template[] {
  const defs = [
    ["WELCOME_MESSAGE", "Welcome Message", "Hi {{name}}, thank you for contacting Dr. K's Aesthetic Clinic about {{position}}. Our team will confirm your appointment shortly."],
    ["FOLLOW_UP", "Follow-up", "Hi {{name}}, this is a follow-up from Dr. K's Aesthetic Clinic regarding your {{position}} enquiry. Reply here if you would like to book a slot."],
    ["DOCUMENT_REMINDER", "Details Required", "Hi {{name}}, we still need a few details to proceed with your {{position}} appointment."],
    ["INTERVIEW_REMINDER", "Appointment Reminder", "Hi {{name}}, this is a reminder that your {{position}} consultation is scheduled for {{date}} at {{time}}."],
    ["PAYMENT_REMINDER", "Payment Reminder", "Hi {{name}}, this is a reminder about the pending amount for your {{position}} visit with {{company}}."],
    ["APPLICATION_UPDATE", "Enquiry Update", "Hi {{name}}, here is an update on your {{position}} enquiry. {{assigned_agent}} will contact you if anything further is required."],
    ["SELECTION_CONFIRMATION", "Booking Confirmation", "Hi {{name}}, your {{position}} appointment is confirmed. {{assigned_agent}} will meet you at the clinic."],
    ["OFFER_FOLLOW_UP", "Course Follow-up", "Hi {{name}}, we are following up on the {{position}} programme at IAA Kochi. Please confirm if you would like to continue."],
    ["VISA_UPDATE", "Batch Update", "Hi {{name}}, there is an update on the {{position}} batch. {{assigned_agent}} will share the latest schedule."],
    ["JOINING_INSTRUCTIONS", "Session Instructions", "Hi {{name}}, your {{position}} session is planned for {{date}} at {{time}}. Please arrive 10 minutes early."],
  ] as const;
  return defs.map(([key, name, body]) => ({
    id: `tpl_${key}`,
    key,
    name,
    body,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

function automation(): Automation {
  return {
    id: "auto_welcome",
    name: "Date-range follow-up",
    enabled: true,
    runOnNewLeads: false,
    nodes: [
      { id: "n1", type: "trigger", title: "Leads in a date range", description: "Pick a from date and a to date. Only leads created in that range are included." },
      { id: "n2", type: "action", title: "One custom message", description: "Write one message. {{name}} and {{position}} fill in for each lead." },
      { id: "n3", type: "action", title: "One poster", description: "Attach a single poster. The same poster goes with the message." },
      { id: "n4", type: "condition", title: "Send now or schedule?", description: "Send opens the WhatsApp thread in demo mode. Schedule creates a follow-up for the chosen time." },
      { id: "n5", type: "action", title: "Send to these leads", description: "Demo Mode — the message stays in Dr. K's. Clinic welcome can still send itself. Institute messages are only the ones you send.", branch: "yes" },
      { id: "n6", type: "action", title: "Schedule follow-up message", description: "The same message and poster are queued as a WhatsApp follow-up.", branch: "no" },
    ],
  };
}

function buildJobs(): Job[] {
  return POSITIONS.slice(0, 8).map((item, index) => ({
    id: `job_${index + 1}`,
    title: item.position.split(" – ")[0] ?? item.position,
    location: item.position.split(" – ")[1] ?? "Gulf",
    category: item.category,
    openings: 4 + (index % 7),
    status: index === 7 ? "closed" : "open",
  }));
}

export function buildSeed(now = new Date()): CrmState {
  const rng = mulberry32(42);
  const dates = buildDates(rng);
  const statusBag = shuffle(
    STATUS_QUOTA.flatMap(([status, count]) => Array.from({ length: count }, () => status)),
    rng,
  );

  HEROES.forEach((hero, index) => {
    if (statusBag[index] === hero.status) return;
    const swapAt = statusBag.findIndex((status, statusIndex) => statusIndex > HEROES.length && status === hero.status);
    if (swapAt >= 0) {
      statusBag[swapAt] = statusBag[index] as LeadStatus;
      statusBag[index] = hero.status;
    }
  });

  const usedNames = new Set(HEROES.map((hero) => hero.fullName));
  const leads: Lead[] = [];

  for (let index = 0; index < LEAD_COUNT; index += 1) {
    const hero = HEROES[index];
    const role = hero ? POSITIONS.find((item) => item.position === hero.position) ?? POSITIONS[index % POSITIONS.length] : POSITIONS[index % POSITIONS.length];
    const fullName = hero?.fullName ?? uniqueName(index, usedNames);
    const first = fullName.split(" ")[0] ?? fullName;
    const status = (hero?.status ?? statusBag[index]) as LeadStatus;
    const created = dates[index] ?? now;
    const createdAt = created.toISOString();
    const priority = hero?.priority ?? PRIORITIES[index % PRIORITIES.length] ?? "medium";
    const position = hero?.position ?? role.position;
    const phone = hero?.phone ?? `+91${7000000000 + index}`;
    const tags = [
      /UAE|Dubai|Qatar|Saudi|Kuwait|Oman|Germany|UK/.test(position) ? "Gulf" : "",
      priority === "urgent" ? "Urgent" : "",
      Number.parseInt(hero?.experience ?? `${1 + (index % 12)}`, 10) >= 8 ? "Experienced" : "",
    ].filter(Boolean);

    leads.push({
      id: leadId(index),
      fullName,
      phone,
      whatsapp: phone,
      email: hero?.email ?? `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}.${index}@gmail.com`,
      gender: hero?.gender ?? (FEMALE_NAMES.has(first) ? "female" : index % 17 === 0 ? "other" : "male"),
      age: hero?.age ?? 22 + (index % 24),
      location: hero?.location ?? CITIES[index % CITIES.length] ?? "Kochi",
      country: "India",
      position,
      jobCategory: role.category,
      experience: hero?.experience ?? `${1 + (index % 12)} years`,
      source: hero?.source ?? SOURCE_BAG[index % SOURCE_BAG.length] ?? "website",
      priority,
      assignedTo: hero?.assignedTo ?? USERS[index % 7 === 0 ? 0 : 1 + (index % 4)]!.id,
      status,
      notes: hero?.notes ?? (index % 3 === 0 ? NOTE_POOL[index % NOTE_POOL.length] ?? "" : ""),
      tags,
      documents: documentsFor(status, index),
      noteEntries: [],
      createdAt,
      updatedAt: createdAt,
      lastContactAt: status === "new" ? createdAt : new Date(created.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      nextFollowUpAt: null,
      convertedAt: null,
      businessUnit: "clinic",
      metaCampaignId: "meta_facial",
      metaCampaignName: "Facial aesthetics – Perumbavoor",
      whatsappAutomation: true,
      callCount: 0,
      talkSeconds: 0,
    });
  }

  const uncontacted = leads.filter((lead) => lead.status === "new");
  uncontacted.forEach((lead, index) => {
    lead.lastContactAt = index < 3 ? null : lead.createdAt;
  });

  const converted = leads.filter((lead) => lead.status === "converted");
  converted.forEach((lead, index) => {
    const date = new Date(now);
    if (index < 2) {
      date.setHours(11 + index, 15, 0, 0);
    } else if (index < 8) {
      date.setDate(date.getDate() - (index - 1));
      date.setHours(15, 0, 0, 0);
    } else if (index < 22) {
      date.setDate(Math.max(1, date.getDate() - (8 + index)));
      date.setHours(12, 0, 0, 0);
    } else {
      date.setMonth(date.getMonth() - (1 + Math.floor((index - 22) / 12)));
      date.setDate(4 + (index % 20));
      date.setHours(12, 0, 0, 0);
    }
    lead.convertedAt = date.toISOString();
    lead.updatedAt = lead.convertedAt;
  });

  HEROES.forEach((_, index) => {
    const lead = leads[index];
    if (!lead) return;
    if (lead.lastContactAt) {
      const contact = new Date(now);
      contact.setHours(now.getHours() - index, Math.max(now.getMinutes() - 5, 0), 0, 0);
      lead.lastContactAt = contact.toISOString();
      lead.updatedAt = lead.lastContactAt;
    } else {
      const created = new Date(now);
      created.setMinutes(created.getMinutes() - 40);
      lead.createdAt = created.toISOString();
      lead.updatedAt = lead.createdAt;
    }
  });

  applyBitvion(leads);

  const followUps: FollowUp[] = [];
  const followTypes: FollowUpType[] = ["whatsapp", "call", "email", "document_reminder", "interview_reminder", "general"];
  const usedLeadIds = new Set<string>([leads[0]?.id ?? ""]);

  function pushFollowUp(lead: Lead, dueAt: string, status: FollowUp["status"], type: FollowUpType, notes: string) {
    followUps.push({
      id: `fu_${String(followUps.length + 1).padStart(3, "0")}`,
      leadId: lead.id,
      assignedTo: lead.assignedTo,
      type,
      dueAt,
      status,
      notes,
      createdAt: addDays(new Date(dueAt), -1).toISOString(),
      completedAt: status === "completed" ? dueAt : null,
    });
    if (status === "pending") {
      if (!lead.nextFollowUpAt || +new Date(dueAt) < +new Date(lead.nextFollowUpAt)) lead.nextFollowUpAt = dueAt;
    }
  }

  const todayHeroes = [1, 2, 3, 5, 7];
  todayHeroes.forEach((leadIndex, index) => {
    const lead = leads[leadIndex];
    if (!lead) return;
    usedLeadIds.add(lead.id);
    const hours = [10, 11, 14, 16, 18][index] ?? 10;
    const minutes = [0, 30, 0, 15, 40][index] ?? 0;
    pushFollowUp(lead, atHour(0, hours, minutes, now), "pending", followTypes[index % followTypes.length] ?? "general", "Due today from the active desk.");
  });

  let cursor = 8;
  while (followUps.length < 145) {
    const lead = leads[cursor];
    cursor += 1;
    if (!lead || usedLeadIds.has(lead.id) || lead.status === "lost") continue;
    usedLeadIds.add(lead.id);
    const day = 1 + ((followUps.length - 5) % 21);
    pushFollowUp(
      lead,
      atHour(day, 10 + (followUps.length % 7), (followUps.length * 5) % 50, now),
      "pending",
      followTypes[followUps.length % followTypes.length] ?? "whatsapp",
      "Upcoming candidate follow-up.",
    );
  }

  cursor = 400;
  let overdueDocs = 0;
  while (followUps.filter((item) => item.status === "pending" && +new Date(item.dueAt) < +new Date(atHour(0, 0, 0, now))).length < 17) {
    const lead = leads[cursor];
    cursor += 3;
    if (!lead || usedLeadIds.has(lead.id)) continue;
    usedLeadIds.add(lead.id);
    const type: FollowUpType = overdueDocs < 2 ? "document_reminder" : followTypes[cursor % followTypes.length] ?? "call";
    if (type === "document_reminder") overdueDocs += 1;
    pushFollowUp(lead, atHour(-(1 + (followUps.length % 8)), 11, 0, now), "pending", type, "Missed follow-up from the previous desk day.");
  }

  cursor = 700;
  while (followUps.filter((item) => item.status === "completed").length < 28) {
    const lead = leads[cursor];
    cursor += 2;
    if (!lead || usedLeadIds.has(lead.id)) continue;
    usedLeadIds.add(lead.id);
    pushFollowUp(lead, atHour(-(2 + (followUps.length % 12)), 15, 0, now), "completed", "call", "Completed and notes were logged.");
  }

  const activities: Activity[] = [
    {
      id: "act_import",
      at: atHour(-40, 10, 0, now),
      userId: USERS[0].id,
      leadId: null,
      leadName: null,
      type: "imported",
      action: "Leads imported",
      details: "Imported the historical recruitment book into RecruitFlow.",
    },
  ];

  HEROES.forEach((_, index) => {
    const lead = leads[index];
    if (!lead) return;
    activities.push(
      {
        id: `act_created_${lead.id}`,
        at: lead.createdAt,
        userId: USERS[0].id,
        leadId: lead.id,
        leadName: lead.fullName,
        type: "lead_created",
        action: "Lead created",
        details: `Lead created from ${SOURCE_LABEL[lead.source]}.`,
      },
      {
        id: `act_assigned_${lead.id}`,
        at: new Date(+new Date(lead.createdAt) + 5 * 60 * 1000).toISOString(),
        userId: USERS[0].id,
        leadId: lead.id,
        leadName: lead.fullName,
        type: "assigned",
        action: "Lead assigned",
        details: `Assigned to ${USERS.find((user) => user.id === lead.assignedTo)?.name ?? "the team"}.`,
      },
    );
    if (lead.status !== "new") {
      activities.push({
        id: `act_status_${lead.id}`,
        at: lead.updatedAt,
        userId: lead.assignedTo,
        leadId: lead.id,
        leadName: lead.fullName,
        type: "status_changed",
        action: "Status changed",
        details: `Status changed: New → ${STATUS_LABEL[lead.status]}.`,
      });
    }
  });

  const conversations: WhatsAppConversation[] = [];
  const messages: WhatsAppMessage[] = [];

  function addMessage(lead: Lead, direction: "in" | "out", body: string, at: string, status: WhatsAppMessage["status"] = "read") {
    let conversation = conversations.find((item) => item.leadId === lead.id);
    if (!conversation) {
      conversation = { id: `conv_${lead.id}`, leadId: lead.id, unread: 0, updatedAt: at };
      conversations.push(conversation);
    }
    messages.push({
      id: `msg_${messages.length + 1}`,
      conversationId: conversation.id,
      leadId: lead.id,
      direction,
      body,
      status,
      templateId: null,
      createdAt: at,
    });
    conversation.updatedAt = at;
    if (direction === "in") conversation.unread += 1;
  }

  const rahul = leads[0];
  if (rahul) {
    const welcomeAt = atHour(-1, 9, 10, now);
    const replyAt = atHour(-1, 9, 48, now);
    addMessage(rahul, "out", "Hi Rahul, thank you for contacting Dr. K's Aesthetic Clinic about HydraFacial. Our team will confirm your appointment shortly.", welcomeAt, "read");
    addMessage(rahul, "in", "Yes, I am interested in the Software Engineer role in Dubai. Please share the next steps.", replyAt, "read");
    addMessage(rahul, "out", "Thank you Rahul. I will share the role brief and the document list today.", atHour(-1, 10, 5, now), "read");
    activities.push({
      id: "act_wa_rahul",
      at: replyAt,
      userId: rahul.assignedTo,
      leadId: rahul.id,
      leadName: rahul.fullName,
      type: "whatsapp",
      action: "WhatsApp reply",
      details: "Candidate replied on WhatsApp.",
    });
  }

  for (let index = 1; index < 15; index += 1) {
    const lead = leads[index];
    if (!lead) continue;
    const base = addDays(now, -((index % 5) + 1));
    base.setHours(10, 15, 0, 0);
    addMessage(lead, "out", `Hi ${lead.fullName.split(" ")[0]}, this is ${USERS.find((user) => user.id === lead.assignedTo)?.name ?? "Dr. K's"} from Dr. K's Aesthetic Clinic. We received your enquiry for ${lead.position}.`, base.toISOString(), index === 9 ? "failed" : "read");
    if (index !== 9 && index % 2 === 0) {
      const reply = new Date(base.getTime() + (40 + index) * 60 * 1000);
      addMessage(lead, "in", "Thank you. Please let me know the documents you need.", reply.toISOString(), "read");
    }
  }

  const tasks: Task[] = [
    ["Call Arjun Nair about the electrician opening", 4, "call", "pending", "high", 0],
    ["Collect DHA documents from Anjali", 1, "documents", "in_progress", "high", 1],
    ["Confirm Doha interview slot", 3, "interview", "pending", "urgent", 0],
    ["Share German caregiver checklist", 5, "whatsapp", "pending", "medium", 2],
    ["Verify police clearance for Shamil", 2, "documents", "in_progress", "medium", -1],
    ["Prepare UK CBT guidance", 7, "general", "pending", "high", 3],
    ["Review Qatar chef offer", 6, "general", "completed", "medium", -2],
    ["Follow up on missed document call", 12, "call", "pending", "high", -3],
    ["Update visa file for selected nurse", 20, "documents", "in_progress", "medium", 4],
    ["Weekly source quality check", null, "reporting", "pending", "low", 1],
    ["Close lost leads older than 90 days", null, "cleanup", "pending", "low", 5],
    ["Brief Anu on today's interview desk", null, "general", "completed", "medium", -1],
  ].map((entry, index) => {
    const [title, leadIndex, taskType, status, priority, day] = entry;
    const lead = typeof leadIndex === "number" ? leads[leadIndex] : undefined;
    return {
      id: `task_${index + 1}`,
      title: String(title),
      leadId: lead?.id ?? null,
      assignedTo: lead?.assignedTo ?? USERS[index % USERS.length]!.id,
      priority: priority as Priority,
      dueAt: atHour(Number(day), 11 + (index % 6), 0, now),
      taskType: String(taskType),
      description: `${title}. Logged for the recruitment desk.`,
      status: status as Task["status"],
      createdAt: atHour(-2, 9, 0, now),
    };
  });

  const campaignBase = templates(now.toISOString());
  const campaigns: Campaign[] = [
    ["Facial aesthetics – Perumbavoor", "interested", "tpl_FOLLOW_UP", 420, 398, 0, 22, "completed", -12],
    ["Dental care – Perumbavoor", "new", "tpl_WELCOME_MESSAGE", 186, 180, 0, 6, "completed", -9],
    ["Document reminder batch", "documents_pending", "tpl_DOCUMENT_REMINDER", 96, 91, 0, 5, "completed", -6],
    ["Interview confirmations", "custom", "tpl_INTERVIEW_REMINDER", 48, 48, 0, 0, "completed", -3],
    ["October walk-in follow-up", "pending_follow_up", "tpl_FOLLOW_UP", 64, 0, 64, 0, "scheduled", 2],
  ].map((entry, index) => {
    const [name, audience, templateId, recipients, successful, pending, failed, status, day] = entry;
    const template = campaignBase.find((item) => item.id === templateId);
    return {
      id: `cmp_${index + 1}`,
      name: String(name),
      audience: audience as Campaign["audience"],
      templateId: String(templateId),
      leadIds: [],
      schedule: status === "scheduled" ? "later" : "now",
      scheduledAt: status === "scheduled" ? atHour(Number(day), 10, 0, now) : null,
      status: status as Campaign["status"],
      recipients: Number(recipients),
      successful: Number(successful),
      pending: Number(pending),
      failed: Number(failed),
      createdAt: atHour(Math.min(Number(day), -1), 9, 30, now),
      messagePreview: template?.body ?? "",
    };
  });

for (let index = 8; index < 24; index += 1) {
    const lead = leads[index];
    if (!lead) continue;
    activities.push({
      id: `act_touch_${lead.id}`,
      at: lead.updatedAt,
      userId: lead.assignedTo,
      leadId: lead.id,
      leadName: lead.fullName,
      type: "follow_up",
      action: "Follow-up logged",
      details: `Desk note added for ${lead.position}.`,
    });
  }

  activities.push({
      id: "act_campaign",
    at: campaigns[0]?.createdAt ?? now.toISOString(),
    userId: USERS[0].id,
    leadId: null,
    leadName: null,
    type: "campaign",
    action: "Campaign completed",
    details: "September Gulf nurse drive completed in demo mode.",
  });

  const notifications = [
    {
      id: "sys_due_today",
      title: "Follow-ups due",
      body: "5 follow-ups are due today.",
      href: "/follow-ups",
      read: false,
      createdAt: atHour(0, 8, 0, now),
    },
    {
      id: "sys_uncontacted",
      title: "Leads not contacted",
      body: "3 leads have not been contacted.",
      href: "/leads?contact=none",
      read: false,
      createdAt: atHour(0, 8, 5, now),
    },
    {
      id: "ntf_rahul_reply",
      title: "WhatsApp reply",
      body: "Rahul Kumar replied on WhatsApp.",
      href: `/whatsapp?lead=${rahul?.id ?? ""}`,
      read: false,
      createdAt: atHour(-1, 9, 48, now),
    },
    {
      id: "sys_overdue_docs",
      title: "Document reminders",
      body: "2 document reminders are overdue.",
      href: "/follow-ups",
      read: false,
      createdAt: atHour(0, 8, 10, now),
    },
    {
      id: "ntf_campaign",
      title: "Campaign completed",
      body: "September Gulf nurse drive completed.",
      href: "/campaigns",
      read: true,
      createdAt: campaigns[0]?.createdAt ?? now.toISOString(),
    },
  ];

  const calls = buildCalls(leads, now);

  const state: CrmState = {
    version: DATA_VERSION,
    users: USERS.map((user) => ({ ...user })),
    leads,
    activities,
    followUps,
    tasks,
    conversations,
    messages,
    templates: campaignBase,
    campaigns,
    notifications,
    automation: automation(),
    jobs: buildJobs(),
    settings: settings(),
    calls,
  };

  assertSeed(state, now);
  return state;
}

function assertSeed(state: CrmState, now: Date) {
  const count = (status: LeadStatus) => state.leads.filter((lead) => lead.status === status).length;
  const problems: string[] = [];
  if (state.leads.length !== 1248) problems.push(`leads ${state.leads.length}`);
  if (count("new") !== 124) problems.push(`new ${count("new")}`);
  if (count("interested") !== 210) problems.push(`interested ${count("interested")}`);
  if (count("documents_pending") !== 96) problems.push(`documents ${count("documents_pending")}`);
  if (count("converted") !== 82) problems.push(`converted ${count("converted")}`);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const pending = state.followUps.filter((item) => item.status === "pending" && new Date(item.dueAt) >= start).length;
  const overdue = state.followUps.filter((item) => item.status === "pending" && new Date(item.dueAt) < start).length;
  const today = state.followUps.filter((item) => {
    const due = new Date(item.dueAt);
    return item.status === "pending" && due >= start && due.getDate() === now.getDate();
  }).length;
  if (pending !== 145) problems.push(`pending follow-ups ${pending}`);
  if (overdue !== 17) problems.push(`overdue ${overdue}`);
  if (today !== 5) problems.push(`today ${today}`);
  if (state.leads.filter((lead) => !lead.lastContactAt).length !== 3) problems.push("uncontacted");
  if (state.templates.length < 10) problems.push("templates");
  if (state.conversations.length < 15) problems.push(`conversations ${state.conversations.length}`);
  if (state.tasks.length < 10) problems.push("tasks");
  if (state.campaigns.length < 5) problems.push("campaigns");
  if (state.activities.length < 30) problems.push(`activities ${state.activities.length}`);
  if (problems.length) throw new Error(`Seed check failed: ${problems.join(", ")}`);
}

export function previewDateLabel(iso: string | null) {
  return iso ? format(new Date(iso), "d MMM yyyy") : format(new Date(), "d MMM yyyy");
}
