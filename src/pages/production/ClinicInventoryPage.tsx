import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Package, Search, ShoppingCart, AlertTriangle, Plus, Pencil } from "lucide-react";
import { InventoryCartProvider, useInventoryCart } from "@/context/InventoryCartContext";
import { useAuth } from "@/context/AuthContext";
import { canOperateWhatsApp } from "@/lib/production-access";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import {
  INVENTORY_CATEGORIES,
  adjustCatalogueStock,
  confirmCartStockOut,
  createCatalogueProduct,
  formatInr,
  listCatalogueProducts,
  listInventoryHistory,
  loadInventoryDashboard,
  productImageUrl,
  removeCatalogueProduct,
  seedClinicCatalogue,
  stockStatus,
  stockStatusLabel,
  updateCatalogueProduct,
  uploadProductImage,
  type CatalogueProduct,
  type InventoryDashboard,
  type StockMove,
} from "@/services/inventory";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type TabKey = "overview" | "catalogue" | "cart" | "history";
type SortKey = "name" | "price" | "stock";

function canManageInventory(roleKey: string) {
  return canOperateWhatsApp(roleKey) || roleKey === "doctor";
}

function ProductImage({ path, name, size = "card" }: { path: string; name: string; size?: "card" | "thumb" | "preview" }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl("");
      return;
    }
    void productImageUrl(path)
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
    };
  }, [path]);

  const frame =
    size === "thumb"
      ? "size-14 shrink-0 rounded-lg"
      : size === "preview"
        ? "h-28 w-28 rounded-lg"
        : "size-[4.75rem] shrink-0 rounded-xl sm:size-[5.25rem]";

  if (!url) {
    return (
      <div className={`flex items-center justify-center border border-line/80 bg-[linear-gradient(160deg,#f8fafc_0%,#eef2f7_100%)] text-[10px] font-medium tracking-wide text-muted uppercase ${frame}`}>
        <Package className="size-4 text-slate-300" aria-hidden />
        <span className="sr-only">No image for {name}</span>
      </div>
    );
  }
  return <img src={url} alt={name} className={`object-cover shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] ${frame}`} />;
}

function stockBadgeClass(status: ReturnType<typeof stockStatus>) {
  if (status === "out_of_stock") return "bg-red-50 text-danger ring-red-100";
  if (status === "low_stock") return "bg-amber-50 text-warning ring-amber-100";
  return "bg-emerald-50 text-success ring-emerald-100";
}

export function ClinicInventoryPage() {
  return (
    <InventoryCartProvider>
      <InventoryShell />
    </InventoryCartProvider>
  );
}

function InventoryShell() {
  const { productionUser } = useAuth();
  const roleKey = productionUser?.roleKey ?? "";
  const manager = canManageInventory(roleKey);
  const admin = canOperateWhatsApp(roleKey);
  const cart = useInventoryCart();

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [tab, setTab] = useState<TabKey>("catalogue");
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [dashboard, setDashboard] = useState<InventoryDashboard | null>(null);
  const [history, setHistory] = useState<StockMove[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogueProduct | null>(null);
  const [stockProduct, setStockProduct] = useState<CatalogueProduct | null>(null);

  const workspace = workspaces.find((item) => item.id === workspaceId);

  const reload = async (id = workspaceId) => {
    if (!id) return;
    setLoading(true);
    try {
      const [rows, board, moves] = await Promise.all([
        listCatalogueProducts(id),
        loadInventoryDashboard(id),
        listInventoryHistory(id, 50),
      ]);
      setProducts(rows);
      setDashboard(board);
      setHistory(moves);
      cart.syncStock(rows);
      setError("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Inventory could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void listWorkspaces()
      .then((rows) => {
        const clinic = rows.filter((item) => item.workspaceType === "clinic");
        setWorkspaces(clinic);
        setWorkspaceId((current) => (clinic.some((item) => item.id === current) ? current : clinic[0]?.id ?? ""));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void reload(workspaceId);
  }, [workspaceId]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = products.filter((product) => {
      if (category !== "all" && product.category !== category) return false;
      if (statusFilter !== "all" && stockStatus(product) !== statusFilter) return false;
      if (!needle) return true;
      return product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle);
    });
    rows.sort((a, b) => {
      if (sortKey === "price") return (a.sellingPrice ?? Number.POSITIVE_INFINITY) - (b.sellingPrice ?? Number.POSITIVE_INFINITY);
      if (sortKey === "stock") return b.currentStock - a.currentStock;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [products, search, category, statusFilter, sortKey]);

  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, category, statusFilter, sortKey]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-accent uppercase">Clinic inventory</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Product catalogue</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Stock, prices, images, and cart issue are stored in Supabase. Adding items to the cart does not reduce stock until you confirm a stock-out.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length > 1 ? (
            <Select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          ) : null}
          {admin ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void seedClinicCatalogue()
                  .then((count) => {
                    setNotice(`Catalogue sync touched ${count} products without resetting stock or prices.`);
                    return reload();
                  })
                  .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Seed failed"));
              }}
            >
              Sync sheet products
            </Button>
          ) : null}
          {manager ? (
            <Button type="button" onClick={() => { setEditing(null); setEditorOpen(true); }}>
              <Plus className="size-4" /> Add product
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => setTab("cart")}>
            <ShoppingCart className="size-4" /> Cart ({cart.count})
          </Button>
        </div>
      </header>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        {([
          ["overview", "Overview"],
          ["catalogue", "Catalogue"],
          ["cart", "Cart"],
          ["history", "History"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${tab === key ? "border-accent text-accent" : "border-line"}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-muted">Loading inventory…</p> : null}

      {tab === "overview" && dashboard ? (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Products" value={String(dashboard.products)} />
            <Stat label="Units in stock" value={String(dashboard.units)} />
            <Stat label="Low stock" value={String(dashboard.lowStock)} />
            <Stat label="Out of stock" value={String(dashboard.outOfStock)} />
            <Stat label="Inventory value" value={dashboard.inventoryValue == null ? "—" : formatInr(dashboard.inventoryValue)} detail="Purchase price × units when entered" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Recently added">
              {dashboard.recentProducts.length === 0 ? <p className="text-sm text-muted">No products yet.</p> : dashboard.recentProducts.map((product) => (
                <p key={product.id} className="border-t border-line py-2 text-sm first:border-0">{product.name} · {product.currentStock} units · {formatInr(product.sellingPrice)}</p>
              ))}
            </Card>
            <Card title="Recent stock adjustments">
              {dashboard.recentMoves.length === 0 ? <p className="text-sm text-muted">No stock history yet.</p> : dashboard.recentMoves.map((move) => (
                <p key={move.id} className="border-t border-line py-2 text-sm first:border-0">
                  {move.productName} · {move.transactionType} · {move.quantity}
                  {move.previousQuantity != null ? ` · ${move.previousQuantity} → ${move.resultingQuantity}` : ""}
                </p>
              ))}
            </Card>
          </div>
        </section>
      ) : null}

      {tab === "catalogue" ? (
        <section className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-4">
            <label className="relative md:col-span-2">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
              <Input className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or SKU" />
            </label>
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {INVENTORY_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All stock states</option>
              <option value="in_stock">In stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
            </Select>
            <Select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="name">Sort by name</option>
              <option value="price">Sort by price</option>
              <option value="stock">Sort by stock</option>
            </Select>
          </div>

          {pageRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-white px-4 py-16 text-center text-sm text-muted">
              <Package className="mx-auto mb-3 size-8 text-muted" />
              No products match these filters.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {pageRows.map((product) => {
                const status = stockStatus(product);
                return (
                  <article
                    key={product.id}
                    className="group flex gap-3 rounded-xl border border-line/90 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(16,24,40,0.06)]"
                  >
                    <ProductImage path={product.imagePath} name={product.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">{product.category}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${stockBadgeClass(status)}`}>
                          {stockStatusLabel(status)}
                        </span>
                      </div>
                      <h2 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-ink">{product.name}</h2>
                      <p className="mt-1 font-mono text-[11px] text-muted">{product.sku || "No SKU"}</p>
                      {product.requiresNameVerification ? (
                        <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                          <AlertTriangle className="size-3" /> Verify name
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <div>
                          <p className={`text-base font-semibold tracking-tight tabular ${product.sellingPrice == null ? "text-muted" : "text-navy"}`}>
                            {formatInr(product.sellingPrice)}
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted">
                            <span className="font-medium tabular text-ink">{product.currentStock}</span> in stock
                            {!product.isActive ? <span className="text-danger"> · Inactive</span> : null}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line/70 pt-2.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-[12px]"
                          disabled={!product.isActive || product.currentStock <= 0}
                          onClick={() => {
                            try {
                              cart.addProduct(product, 1);
                              setNotice(`${product.name} added to cart. Stock is unchanged until you confirm stock-out.`);
                              setError("");
                            } catch (reason: unknown) {
                              setError(reason instanceof Error ? reason.message : "Could not add to cart");
                            }
                          }}
                        >
                          Add to cart
                        </Button>
                        {manager ? (
                          <>
                            <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-[12px]" onClick={() => { setEditing(product); setEditorOpen(true); }}>
                              <Pencil className="size-3" /> Edit
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-muted" onClick={() => setStockProduct(product)}>
                              Stock
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <p className="text-muted">Page {page} of {pages} · {filtered.length} products</p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
                <Button type="button" variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "cart" ? (
        <CartPanel
          manager={manager}
          workspace={workspace}
          onError={setError}
          onNotice={setNotice}
          onDone={() => { void reload(); setTab("catalogue"); }}
        />
      ) : null}

      {tab === "history" ? (
        <section className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr>{["When", "Product", "Type", "Change", "Before", "After", "Reason"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {history.length === 0 ? <tr><td className="px-3 py-8 text-muted" colSpan={7}>No stock movements yet.</td></tr> : history.map((move) => (
                <tr key={move.id} className="border-t border-line">
                  <td className="px-3 py-2">{new Date(move.createdAt).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2">{move.productName}</td>
                  <td className="px-3 py-2">{move.transactionType}</td>
                  <td className="px-3 py-2 tabular">{move.quantity}</td>
                  <td className="px-3 py-2 tabular">{move.previousQuantity ?? "—"}</td>
                  <td className="px-3 py-2 tabular">{move.resultingQuantity ?? "—"}</td>
                  <td className="px-3 py-2">{move.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {workspace ? (
        <ProductEditorDialog
          open={editorOpen}
          workspace={workspace}
          product={editing}
          manager={manager}
          onOpenChange={setEditorOpen}
          onSaved={(message) => {
            setNotice(message);
            setEditorOpen(false);
            void reload();
          }}
          onError={setError}
        />
      ) : null}

      {stockProduct && workspace ? (
        <StockDialog
          product={stockProduct}
          open={Boolean(stockProduct)}
          onOpenChange={(open) => { if (!open) setStockProduct(null); }}
          onSaved={(message) => {
            setNotice(message);
            setStockProduct(null);
            void reload();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function CartPanel({
  manager,
  workspace,
  onError,
  onNotice,
  onDone,
}: {
  manager: boolean;
  workspace?: WorkspaceOption;
  onError: (value: string) => void;
  onNotice: (value: string) => void;
  onDone: () => void;
}) {
  const cart = useInventoryCart();
  const [reason, setReason] = useState("Clinic issue / sale");
  const [busy, setBusy] = useState(false);
  const priced = cart.lines.filter((line) => line.sellingPrice != null);
  const unpriced = cart.lines.filter((line) => line.sellingPrice == null);
  const subtotal = priced.reduce((sum, line) => sum + Number(line.sellingPrice) * line.quantity, 0);

  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Shopping cart</h2>
        <Button type="button" variant="secondary" size="sm" disabled={!cart.lines.length} onClick={() => cart.clear()}>Clear cart</Button>
      </div>
      <p className="text-sm text-muted">Cart quantities do not reduce inventory. Confirm stock-out only when the items leave the shelf.</p>
      {cart.lines.length === 0 ? <p className="py-8 text-sm text-muted">Cart is empty.</p> : (
        <div className="space-y-3">
          {cart.lines.map((line) => (
            <div key={line.productId} className="grid gap-3 rounded-xl border border-line/90 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:grid-cols-[auto_1fr_auto]">
              <ProductImage path={line.imagePath} name={line.name} size="thumb" />
              <div>
                <p className="font-medium">{line.name}</p>
                <p className="text-xs text-muted">SKU {line.sku || "—"}</p>
                <p className="mt-1 text-sm">{formatInr(line.sellingPrice)}</p>
                {line.sellingPrice == null ? <p className="mt-1 text-xs text-amber-700">Selling price must be entered before a priced total includes this item.</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => cart.setQuantity(line.productId, line.quantity - 1)}>-</Button>
                  <span className="tabular">{line.quantity}</span>
                  <Button type="button" size="sm" variant="secondary" disabled={line.quantity >= line.maxStock} onClick={() => cart.setQuantity(line.productId, line.quantity + 1)}>+</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => cart.removeProduct(line.productId)}>Remove</Button>
                </div>
              </div>
              <div className="text-right text-sm font-semibold tabular">
                {line.sellingPrice == null ? "—" : formatInr(Number(line.sellingPrice) * line.quantity)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-md bg-canvas px-3 py-3 text-sm">
        <p>Priced lines: {priced.length} · Needs price: {unpriced.length}</p>
        <p className="mt-1 text-lg font-semibold">Subtotal {formatInr(subtotal)}</p>
      </div>
      {manager && workspace ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-60 flex-1 text-sm">
            Stock-out reason
            <Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <Button
            type="button"
            disabled={busy || !cart.lines.length}
            onClick={() => {
              setBusy(true);
              void confirmCartStockOut(
                workspace.id,
                cart.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
                reason,
              )
                .then((result) => {
                  cart.clear();
                  onNotice(`Stock-out confirmed for ${result.units ?? 0} units. Inventory updated.`);
                  onDone();
                })
                .catch((reasonValue: unknown) => onError(reasonValue instanceof Error ? reasonValue.message : "Stock-out failed"))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Confirming…" : "Confirm stock-out"}
          </Button>
        </div>
      ) : <p className="text-sm text-muted">Only authorised clinic staff can confirm stock-out.</p>}
    </section>
  );
}

function ProductEditorDialog({
  open,
  workspace,
  product,
  manager,
  onOpenChange,
  onSaved,
  onError,
}: {
  open: boolean;
  workspace: WorkspaceOption;
  product: CatalogueProduct | null;
  manager: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    setFile(null);
    setPreview("");
  }, [product, open]);

  if (!manager) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>Prices stay empty until you enter them. Do not invent purchase or selling prices.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const purchaseRaw = String(data.get("purchase") ?? "").trim();
            const sellingRaw = String(data.get("selling") ?? "").trim();
            const payload = {
              name: String(data.get("name") ?? ""),
              sku: String(data.get("sku") ?? ""),
              category: String(data.get("category") ?? ""),
              description: String(data.get("description") ?? ""),
              purchasePrice: purchaseRaw === "" ? null : Number(purchaseRaw),
              sellingPrice: sellingRaw === "" ? null : Number(sellingRaw),
              minimumStock: Number(data.get("minimum") || 5),
              isActive: String(data.get("status") ?? "active") === "active",
              requiresNameVerification: data.get("verify") === "on",
            };
            setBusy(true);
            const run = product
              ? updateCatalogueProduct({ productId: product.id, ...payload }).then(async () => {
                if (file) await uploadProductImage({ organizationId: workspace.organizationId, workspaceId: workspace.id, productId: product.id, file });
                onSaved(`${payload.name} updated.`);
              })
              : createCatalogueProduct({
                organizationId: workspace.organizationId,
                workspaceId: workspace.id,
                stock: Number(data.get("stock") || 0),
                ...payload,
              }).then(async (id) => {
                if (file) await uploadProductImage({ organizationId: workspace.organizationId, workspaceId: workspace.id, productId: id, file });
                onSaved(`${payload.name} saved.`);
              });
            void run
              .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not save the product"))
              .finally(() => setBusy(false));
          }}
        >
          <label className="text-sm md:col-span-2">
            Product name
            <Input name="name" required defaultValue={product?.name ?? ""} className="mt-1" />
          </label>
          <label className="text-sm">
            SKU
            <Input name="sku" required defaultValue={product?.sku ?? ""} className="mt-1" placeholder="CLN-XX-000" />
          </label>
          <label className="text-sm">
            Category
            <Select name="category" defaultValue={product?.category || INVENTORY_CATEGORIES[0]} className="mt-1">
              {INVENTORY_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </label>
          <label className="text-sm md:col-span-2">
            Description
            <Input name="description" defaultValue={product?.description ?? ""} className="mt-1" />
          </label>
          <label className="text-sm">
            Purchase price ₹
            <Input name="purchase" type="number" min={0} step="0.01" defaultValue={product?.purchasePrice ?? ""} className="mt-1" placeholder="Leave blank if unknown" />
          </label>
          <label className="text-sm">
            Selling price ₹
            <Input name="selling" type="number" min={0} step="0.01" defaultValue={product?.sellingPrice ?? ""} className="mt-1" placeholder="Leave blank if unknown" />
          </label>
          {!product ? (
            <label className="text-sm">
              Opening quantity
              <Input name="stock" type="number" min={0} defaultValue={0} className="mt-1" />
            </label>
          ) : null}
          <label className="text-sm">
            Low-stock threshold
            <Input name="minimum" type="number" min={0} defaultValue={product?.minimumStock ?? 5} className="mt-1" />
          </label>
          <label className="text-sm">
            Status
            <Select name="status" defaultValue={product?.isActive === false ? "inactive" : "active"} className="mt-1">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" name="verify" defaultChecked={product?.requiresNameVerification} />
            Mark name for verification
          </label>
          <label className="text-sm md:col-span-2">
            Product image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="mt-1 block w-full text-sm"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
                setPreview(next ? URL.createObjectURL(next) : "");
              }}
            />
          </label>
          {(preview || product?.imagePath) ? (
            <div className="md:col-span-2">
              {preview ? <img src={preview} alt="Preview" className="h-28 w-28 rounded-lg object-cover shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]" /> : <ProductImage path={product?.imagePath ?? ""} name={product?.name ?? "Product"} size="preview" />}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 md:col-span-2">
            {product ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Remove ${product.name}?`)) return;
                  setBusy(true);
                  void removeCatalogueProduct(product.id)
                    .then(() => onSaved(`${product.name} removed.`))
                    .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Could not remove the product"))
                    .finally(() => setBusy(false));
                }}
              >
                Remove product
              </Button>
            ) : <span />}
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save product"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StockDialog({
  product,
  open,
  onOpenChange,
  onSaved,
  onError,
}: {
  product: CatalogueProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock · {product.name}</DialogTitle>
          <DialogDescription>Current stock {product.currentStock}. Negative stock is rejected.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const quantity = Number(data.get("qty") || 0);
            const kind = String(data.get("kind") || "purchase") as "purchase" | "adjustment" | "treatment";
            const note = String(data.get("note") || "");
            setBusy(true);
            void adjustCatalogueStock(product.id, kind, quantity, note)
              .then(() => onSaved(`Stock updated for ${product.name}.`))
              .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "Stock update failed"))
              .finally(() => setBusy(false));
          }}
        >
          <Select name="kind" defaultValue="purchase">
            <option value="purchase">Increase stock</option>
            <option value="adjustment">Decrease stock</option>
            <option value="treatment">Record usage</option>
          </Select>
          <Input name="qty" type="number" min={1} defaultValue={1} required />
          <Input name="note" placeholder="Reason" required />
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save adjustment"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
