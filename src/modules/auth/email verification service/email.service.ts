import { env } from "../../../config/env.js";

export type EmailMessage = { to: string; subject: string; text: string };

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.NODE_ENV !== "development") {
    // TODO: replace with the real provider once a sender domain exists
    throw new Error("Email provider not configured");
  }

  // Development only. Never log email bodies in production: they contain live tokens.
  console.log(`[dev email] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
}