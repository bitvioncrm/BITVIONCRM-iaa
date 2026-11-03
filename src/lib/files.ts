export async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function optimizeImage(file: File, maxEdge = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  if (blob.size >= file.size && file.type === "image/jpeg") return file;
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

const DOCUMENT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]);
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

export function isAllowedDocument(file: File) {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (DOCUMENT_TYPES.has(type)) return true;
  return /\.(pdf|jpe?g|png|webp)$/i.test(name);
}

export async function optimizeDocument(file: File) {
  if (!isAllowedDocument(file)) throw new Error("Use a PDF, JPG, JPEG, PNG, or WEBP file.");
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("Choose a file under 12 MB.");
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return file;
  return optimizeImage(file, 1280, 0.72);
}
