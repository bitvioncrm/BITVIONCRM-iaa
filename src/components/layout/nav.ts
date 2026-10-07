import {
  BarChart3,
  Building2,
  CalendarClock,
  Phone,
  CheckSquare,
  FileText,
  GraduationCap,
  Kanban,
  LayoutDashboard,
  ContactRound,
  Megaphone,
  MessageCircle,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";
import { pathsForRole } from "@/lib/production-access";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/desk", label: "My desk", icon: ContactRound, end: false },
  { to: "/leads", label: "Leads", icon: Users, end: false },
  { to: "/pipeline", label: "Pipeline", icon: Kanban, end: false },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock, end: false },
  { to: "/calls", label: "Calls", icon: Phone, end: false },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, end: false },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone, end: false },
  { to: "/templates", label: "Templates", icon: FileText, end: false },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, end: false },
  { to: "/reports", label: "Reports", icon: BarChart3, end: false },
  { to: "/team", label: "Team", icon: UsersRound, end: false },
  { to: "/activity", label: "Activity", icon: ScrollText, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

export const STAFF_NAV = NAV_ITEMS.filter((item) => ["/", "/leads", "/calls", "/whatsapp"].includes(item.to));

export const MOBILE_NAV = [NAV_ITEMS[0], NAV_ITEMS[2], NAV_ITEMS[5], NAV_ITEMS[6]] as const;

export const ADMIN_ONLY_PREFIXES = ["/desk", "/pipeline", "/follow-ups", "/campaigns", "/templates", "/tasks", "/reports", "/team", "/activity", "/settings"];

const MODULE_NAV = [
  { to: "/clinic", label: "Clinic", icon: Building2, end: false },
  { to: "/institute", label: "Institute", icon: GraduationCap, end: false },
  { to: "/inventory", label: "Inventory", icon: Package, end: false },
  { to: "/billing", label: "Billing", icon: Receipt, end: false },
] as const;

export function productionNav(roleKey: string) {
  const allowed = new Set(pathsForRole(roleKey));
  return [...NAV_ITEMS, ...MODULE_NAV].filter((item) => allowed.has(item.to));
}
