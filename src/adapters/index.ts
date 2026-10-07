/** Provider boundaries. Payment, telephony, email, and SMS adapters are intentionally absent. */

export interface StorageAdapter {
  upload(path: string, bytes: ArrayBuffer, contentType: string): Promise<{ path: string }>;
  signedUrl(path: string): Promise<string>;
}

export interface WhatsAppAdapter {
  sendTemplate(input: { to: string; template: string; variables: string[] }): Promise<{ providerMessageId: string }>;
}

export interface MetaAdapter {
  fetchLead(leadgenId: string): Promise<{ name: string; phone: string; email: string; campaign: string; form: string }>;
}

export interface AIAdapter {
  summarize(text: string): Promise<string>;
}
