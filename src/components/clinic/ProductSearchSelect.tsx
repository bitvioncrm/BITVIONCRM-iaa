import { useEffect, useId, useMemo, useRef, useState } from "react";
import { inr } from "@/lib/money";

export type ProductOption = {
  id: string;
  name: string;
  stock: number;
  price: number;
};

function matches(product: ProductOption, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return `${product.name} ${product.stock} ${product.price}`.toLowerCase().includes(term);
}

export function ProductSearchSelect({
  products,
  value,
  onChange,
  disabled = false,
  placeholder = "Search product…",
  emptyLabel = "No product",
  className = "",
}: {
  products: ProductOption[];
  value: string;
  onChange: (productId: string, product: ProductOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = products.find((item) => item.id === value) ?? null;
  const filtered = useMemo(() => products.filter((item) => matches(item, query)).slice(0, 80), [products, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const pick = (product: ProductOption | null) => {
    onChange(product?.id ?? "", product);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className="mt-1 flex h-11 w-full items-center justify-between gap-2 rounded-md border border-line bg-white px-3 text-left text-sm disabled:opacity-60"
      >
        <span className={`min-w-0 truncate ${chosen ? "text-ink" : "text-muted"}`}>
          {chosen ? `${chosen.name} · ${chosen.stock} in stock · ${inr(chosen.price)}` : emptyLabel}
        </span>
        <span className="shrink-0 text-muted" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-[60] mt-1 overflow-hidden rounded-md border border-line bg-white shadow-pop">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="h-10 w-full rounded-md border border-line px-3 text-sm"
              aria-label="Search products"
              autoComplete="off"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className="flex w-full px-3 py-2 text-left text-sm text-muted hover:bg-[#f7f4ee]"
                onClick={() => pick(null)}
              >
                {emptyLabel}
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No product matches “{query.trim()}”.</li>
            ) : filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#f7f4ee] ${item.id === value ? "bg-[#f7f4ee]" : ""}`}
                  onClick={() => pick(item)}
                >
                  <span className="font-medium text-ink">{item.name}</span>
                  <span className="text-xs text-muted">{item.stock} in stock · {inr(item.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
