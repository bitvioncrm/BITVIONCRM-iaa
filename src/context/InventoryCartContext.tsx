import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CatalogueProduct } from "@/services/inventory";

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  imagePath: string;
  sellingPrice: number | null;
  quantity: number;
  maxStock: number;
  isActive: boolean;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  addProduct: (product: CatalogueProduct, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeProduct: (productId: string) => void;
  clear: () => void;
  syncStock: (products: CatalogueProduct[]) => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "bitvion.inventory.cart.v1";

function readStored(): CartLine[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function InventoryCartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => (typeof window === "undefined" ? [] : readStored()));

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const value = useMemo<CartContextValue>(() => ({
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    addProduct: (product, quantity = 1) => {
      if (!product.isActive) throw new Error("Inactive products cannot be added to the cart.");
      if (product.currentStock <= 0) throw new Error("This product is out of stock.");
      setLines((current) => {
        const existing = current.find((line) => line.productId === product.id);
        const nextQty = Math.min(product.currentStock, (existing?.quantity ?? 0) + Math.max(1, quantity));
        const line: CartLine = {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          imagePath: product.imagePath,
          sellingPrice: product.sellingPrice,
          quantity: nextQty,
          maxStock: product.currentStock,
          isActive: product.isActive,
        };
        if (existing) return current.map((item) => (item.productId === product.id ? line : item));
        return [...current, line];
      });
    },
    setQuantity: (productId, quantity) => {
      setLines((current) => current.flatMap((line) => {
        if (line.productId !== productId) return [line];
        const next = Math.min(line.maxStock, Math.max(0, Math.floor(quantity)));
        if (next <= 0) return [];
        return [{ ...line, quantity: next }];
      }));
    },
    removeProduct: (productId) => setLines((current) => current.filter((line) => line.productId !== productId)),
    clear: () => setLines([]),
    syncStock: (products) => {
      setLines((current) => current.flatMap((line) => {
        const product = products.find((item) => item.id === line.productId);
        if (!product || !product.isActive || product.currentStock <= 0) return [];
        return [{
          ...line,
          name: product.name,
          sku: product.sku,
          imagePath: product.imagePath,
          sellingPrice: product.sellingPrice,
          maxStock: product.currentStock,
          isActive: product.isActive,
          quantity: Math.min(line.quantity, product.currentStock),
        }];
      }));
    },
  }), [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useInventoryCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("Inventory cart is not available.");
  return value;
}
