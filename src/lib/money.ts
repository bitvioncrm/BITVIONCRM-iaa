export function invoiceTotal(items: Array<{ quantity: number; unitPrice: number }>, discount: number) {
  const gross = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return Math.max(0, gross - discount);
}

export function netRevenue(gross: number, discounts: number, refunds: number) {
  return gross - discounts - refunds;
}

export function balance(total: number, paid: number, refunded: number) {
  return Math.max(0, total - paid + refunded);
}

export function inr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}
