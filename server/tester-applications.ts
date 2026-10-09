import type { FastifyInstance } from "fastify";
import { z } from "zod";

export type TelegramTarget = { token: string; chatId: string };

const yesNo = z.enum(["yes", "no"]);
const application = z.object({
  name: z.string().trim().min(2).max(100),
  // Google Play closed testing invites testers by the Google account they use on the phone.
  email: z.string().trim().max(200).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  phone: z.string().trim().min(6).max(30).regex(/^[+\d][\d\s()./-]*$/),
  licence: yesNo,
  car: yesNo,
  // Hidden from people; bots that fill every field are dropped quietly.
  website: z.string().max(200).optional(),
}).strict();

/** Website form for the closed test on Google Play. Nothing is stored: the application goes to the
 * owner's Telegram chat, and a failed delivery is reported so the person can try again. */
export function registerTesterApplications(app: FastifyInstance, telegram?: TelegramTarget) {
  app.post("/v1/tester-applications", {
    bodyLimit: 4 * 1024,
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = application.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Check your name, email and phone number." });
    const form = parsed.data;
    if (form.website) return reply.code(201).send({ ok: true });
    if (!telegram) return reply.code(503).send({ error: "Applications are closed right now. Email contact@vasojevich.com instead." });
    const text = [
      "New Skopje Parking tester application",
      "",
      `Name: ${form.name}`,
      `Google account: ${form.email}`,
      `Phone: ${form.phone}`,
      `Driving licence: ${form.licence === "yes" ? "Yes" : "No"}`,
      `Car: ${form.car === "yes" ? "Yes" : "No"}`,
    ].join("\n");
    try {
      const response = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegram.chatId, text, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean };
      if (!response.ok || result.ok !== true) throw new Error(`Telegram ${response.status}`);
    } catch {
      console.error("tester application: Telegram delivery failed");
      return reply.code(502).send({ error: "Your application didn't go through. Try again in a minute." });
    }
    return reply.code(201).send({ ok: true });
  });
}
