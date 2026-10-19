import { optimizeImage } from "@/lib/files";
import { supabase } from "@/lib/supabase";

function db() {
  if (!supabase) throw new Error("Configuration Required");
  return supabase;
}

export const INVENTORY_CATEGORIES = [
  "Face Wash & Cleansers",
  "Moisturizers",
  "Sunscreens",
  "Serums",
  "Night Creams & Skin-Care",
  "Hair Care",
  "Foot Care",
  "Other",
] as const;

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface CatalogueProduct {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  imagePath: string;
  purchasePrice: number | null;
  sellingPrice: number | null;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
  requiresNameVerification: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMove {
  id: string;
  productId: string;
  productName: string;
  transactionType: string;
  quantity: number;
  previousQuantity: number | null;
  resultingQuantity: number | null;
  note: string;
  createdAt: string;
  createdBy: string | null;
}

export interface InventoryDashboard {
  products: number;
  units: number;
  lowStock: number;
  outOfStock: number;
  inventoryValue: number | null;
  recentProducts: CatalogueProduct[];
  recentMoves: StockMove[];
}

function mapProduct(row: Record<string, unknown>): CatalogueProduct {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    sku: String(row.sku ?? ""),
    category: String(row.category ?? ""),
    description: String(row.description ?? ""),
    imagePath: String(row.image_path ?? ""),
    purchasePrice: row.purchase_price == null ? null : Number(row.purchase_price),
    sellingPrice: row.selling_price == null ? null : Number(row.selling_price),
    currentStock: Number(row.current_stock ?? 0),
    minimumStock: Number(row.minimum_stock ?? 0),
    isActive: row.is_active !== false,
    requiresNameVerification: Boolean(row.requires_name_verification),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function stockStatus(product: Pick<CatalogueProduct, "currentStock" | "minimumStock">): StockStatus {
  if (product.currentStock <= 0) return "out_of_stock";
  if (product.currentStock <= product.minimumStock) return "low_stock";
  return "in_stock";
}

export function stockStatusLabel(status: StockStatus) {
  if (status === "out_of_stock") return "Out of stock";
  if (status === "low_stock") return "Low stock";
  return "In stock";
}

export function formatInr(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "Not entered";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

export async function listCatalogueProducts(workspaceId: string) {
  const { data, error } = await db()
    .from("inventory_products")
    .select("id, organization_id, workspace_id, name, sku, category, description, image_path, purchase_price, selling_price, current_stock, minimum_stock, is_active, requires_name_verification, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("category")
    .order("name")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapProduct(row as Record<string, unknown>));
}

export async function loadInventoryDashboard(workspaceId: string): Promise<InventoryDashboard> {
  const products = await listCatalogueProducts(workspaceId);
  const priced = products.filter((item) => item.purchasePrice != null);
  const inventoryValue = priced.length
    ? priced.reduce((sum, item) => sum + Number(item.purchasePrice) * item.currentStock, 0)
    : null;
  return {
    products: products.length,
    units: products.reduce((sum, item) => sum + item.currentStock, 0),
    lowStock: products.filter((item) => stockStatus(item) === "low_stock").length,
    outOfStock: products.filter((item) => stockStatus(item) === "out_of_stock").length,
    inventoryValue,
    recentProducts: [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    recentMoves: await listInventoryHistory(workspaceId, 8),
  };
}

export async function listInventoryHistory(workspaceId: string, limit = 40) {
  const { data, error } = await db()
    .from("inventory_transactions")
    .select("id, product_id, transaction_type, quantity, previous_quantity, resulting_quantity, note, created_at, created_by, inventory_products(name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const linked = row.inventory_products as { name: string } | { name: string }[] | null;
    const productName = Array.isArray(linked) ? linked[0]?.name : linked?.name;
    return {
      id: String(row.id),
      productId: String(row.product_id),
      productName: productName ?? "Product",
      transactionType: String(row.transaction_type),
      quantity: Number(row.quantity),
      previousQuantity: row.previous_quantity == null ? null : Number(row.previous_quantity),
      resultingQuantity: row.resulting_quantity == null ? null : Number(row.resulting_quantity),
      note: String(row.note ?? ""),
      createdAt: String(row.created_at),
      createdBy: (row.created_by as string | null) ?? null,
    } satisfies StockMove;
  });
}

export async function createCatalogueProduct(input: {
  organizationId: string;
  workspaceId: string;
  name: string;
  sku: string;
  category: string;
  description?: string;
  purchasePrice: number | null;
  sellingPrice: number | null;
  stock: number;
  minimumStock: number;
  isActive: boolean;
}) {
  const sku = input.sku.trim().toUpperCase();
  if (!input.name.trim()) throw new Error("Product name is required.");
  if (!sku) throw new Error("SKU is required.");
  if (!input.category.trim()) throw new Error("Category is required.");
  if (input.stock < 0 || input.minimumStock < 0) throw new Error("Stock values cannot be negative.");
  if (input.purchasePrice != null && !Number.isFinite(input.purchasePrice)) throw new Error("Purchase price must be a number or blank.");
  if (input.sellingPrice != null && !Number.isFinite(input.sellingPrice)) throw new Error("Selling price must be a number or blank.");

  const { data, error } = await db()
    .from("inventory_products")
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      sku,
      category: input.category.trim(),
      description: input.description?.trim() ?? "",
      purchase_price: input.purchasePrice,
      selling_price: input.sellingPrice,
      current_stock: 0,
      minimum_stock: input.minimumStock,
      is_active: input.isActive,
      requires_name_verification: false,
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.toLowerCase().includes("inventory_products_workspace_sku_uidx") || error.message.toLowerCase().includes("duplicate")) {
      throw new Error("That SKU is already used on this desk.");
    }
    throw new Error(error.message);
  }
  if (input.stock > 0) {
    const { error: stockError } = await db().rpc("apply_stock_change", {
      product: data.id,
      kind: "purchase",
      qty: input.stock,
      note: "Opening stock",
    });
    if (stockError) {
      await db().from("inventory_products").delete().eq("id", data.id);
      throw new Error(stockError.message);
    }
  }
  return String(data.id);
}

export async function updateCatalogueProduct(input: {
  productId: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  purchasePrice: number | null;
  sellingPrice: number | null;
  minimumStock: number;
  isActive: boolean;
  requiresNameVerification?: boolean;
}) {
  const sku = input.sku.trim().toUpperCase();
  if (!input.name.trim()) throw new Error("Product name is required.");
  if (!sku) throw new Error("SKU is required.");
  if (input.purchasePrice != null && !Number.isFinite(input.purchasePrice)) throw new Error("Purchase price must be a number or blank.");
  if (input.sellingPrice != null && !Number.isFinite(input.sellingPrice)) throw new Error("Selling price must be a number or blank.");
  const { data, error } = await db()
    .from("inventory_products")
    .update({
      name: input.name.trim(),
      sku,
      category: input.category.trim(),
      description: input.description.trim(),
      purchase_price: input.purchasePrice,
      selling_price: input.sellingPrice,
      minimum_stock: Math.max(0, input.minimumStock),
      is_active: input.isActive,
      requires_name_verification: input.requiresNameVerification ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.productId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.message.toLowerCase().includes("duplicate") || error.message.toLowerCase().includes("sku")) {
      throw new Error("That SKU is already used on this desk.");
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error("Product was not updated. Check permissions or refresh the catalogue.");
}

export async function removeCatalogueProduct(productId: string) {
  const userId = (await db().auth.getUser()).data.user?.id ?? null;
  const { data, error } = await db()
    .from("inventory_products")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId, updated_at: new Date().toISOString(), is_active: false })
    .eq("id", productId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Product was not removed. Check permissions or refresh the catalogue.");
}

export async function adjustCatalogueStock(productId: string, kind: "purchase" | "adjustment" | "treatment" | "sale", quantity: number, note: string) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a positive quantity.");
  const signed = kind === "purchase" ? Math.abs(quantity) : -Math.abs(quantity);
  const { error } = await db().rpc("apply_stock_change", { product: productId, kind, qty: signed, note: note.trim() || "Stock adjustment" });
  if (error) throw new Error(error.message);
}

export async function confirmCartStockOut(workspaceId: string, items: Array<{ productId: string; quantity: number }>, reason: string) {
  const payload = items.map((item) => ({ product_id: item.productId, quantity: item.quantity }));
  const { data, error } = await db().rpc("confirm_inventory_stock_out", {
    p_workspace: workspaceId,
    p_items: payload,
    p_reason: reason.trim() || "Cart stock-out",
    p_kind: "sale",
  });
  if (error) throw new Error(error.message);
  return data as { ok?: boolean; units?: number };
}

export async function uploadProductImage(input: { organizationId: string; workspaceId: string; productId: string; file: File }) {
  if (!input.file.type.startsWith("image/")) throw new Error("Choose a JPG, PNG, WEBP, or GIF image.");
  if (input.file.size > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");
  const optimized = await optimizeImage(input.file);
  const extension = optimized.name.includes(".") ? optimized.name.split(".").pop() : "jpg";
  const path = `${input.organizationId}/${input.workspaceId}/${input.productId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await db().storage.from("product-images").upload(path, optimized, {
    contentType: optimized.type || "image/jpeg",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);
  const { data, error } = await db()
    .from("inventory_products")
    .update({ image_path: path, updated_at: new Date().toISOString() })
    .eq("id", input.productId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Image uploaded but the product record was not updated.");
  return path;
}

export async function productImageUrl(path: string) {
  if (!path) return "";
  const { data, error } = await db().storage.from("product-images").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function seedClinicCatalogue(workspaceId?: string) {
  const { data, error } = await db().rpc("seed_clinic_inventory_catalogue", {
    p_workspace: workspaceId ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
