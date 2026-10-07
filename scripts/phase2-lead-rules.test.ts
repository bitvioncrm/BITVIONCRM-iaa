import { chunk, duplicateKind, normalizeEmail, normalizePhone, sanitizeSearch } from "../src/lib/lead-normalize.ts";

const phone = normalizePhone("+91 98470-11220");
if (phone !== "919847011220") throw new Error("phone");

const email = normalizeEmail("  Anu@Bitvion.Demo ");
if (email !== "anu@bitvion.demo") throw new Error("email");

const kind = duplicateKind(
  { name: "Anu Thomas", phone: "+919847011220", email: "anu@bitvion.demo" },
  { name: "Anu Thomas", phone: "9847011220", email: "other@example.com" },
);
if (kind !== "phone_name") throw new Error(`kind ${kind}`);

const emailKind = duplicateKind(
  { name: "Anu Thomas", phone: "100", email: "anu@bitvion.demo" },
  { name: "Someone Else", phone: "200", email: "ANU@bitvion.demo" },
);
if (emailKind !== "email") throw new Error(`email kind ${emailKind}`);

if (duplicateKind({ name: "A", phone: "111", email: "a@b.c" }, { name: "B", phone: "222", email: "c@d.e" }) !== null) {
  throw new Error("expected no duplicate");
}

const batches = chunk([1, 2, 3, 4, 5], 2);
if (batches.length !== 3 || batches[2]?.join() !== "5") throw new Error("chunk");

if (sanitizeSearch("100%_drop") !== "100  drop") throw new Error("sanitize");

console.log("phase2 lead rules ok");
