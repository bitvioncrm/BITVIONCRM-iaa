import { elapsedSeconds, remainingSeconds, sumCompleted } from "../src/lib/call-time.ts";
import { balance, invoiceTotal, netRevenue } from "../src/lib/money.ts";

const started = "2026-10-07T10:00:00.000Z";
const ended = "2026-10-07T10:02:05.000Z";
if (elapsedSeconds(started, ended) !== 125) throw new Error("elapsed");
if (elapsedSeconds(ended, started) !== null) throw new Error("inverted timer must not invent a duration");
if (elapsedSeconds("not-a-date", ended) !== null) throw new Error("invalid timer must not invent a duration");
if (remainingSeconds(150 * 60, 125) !== 150 * 60 - 125) throw new Error("remaining");
if (remainingSeconds(100, 140) !== 0) throw new Error("remaining floor");
if (sumCompleted([10, null, undefined, -1, 5]) !== 15) throw new Error("sum");

if (invoiceTotal([{ quantity: 2, unitPrice: 500 }, { quantity: 1, unitPrice: 100 }], 50) !== 1050) throw new Error("invoice");
if (invoiceTotal([{ quantity: 1, unitPrice: 20 }], 50) !== 0) throw new Error("discount floor");
if (netRevenue(1000, 100, 50) !== 850) throw new Error("net");
if (balance(1000, 400, 50) !== 650) throw new Error("balance");

console.log("phase3 call time and money ok");
