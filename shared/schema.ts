import { z } from "zod";

export const botStatusSchema = z.object({
  status: z.enum(["ready", "partial"]),
  activeSessions: z.number(),
  uptime: z.number(),
  config: z.object({
    wati: z.boolean(),
    slackBug: z.boolean(),
    slackAdmin: z.boolean(),
    anthropic: z.boolean(),
    slackSigning: z.boolean(),
  }),
  stats: z.object({
    total: z.number(),
    bugs: z.number(),
    admins: z.number(),
    today: z.number(),
  }),
  whitelist: z.object({
    enabled: z.boolean(),
    count: z.number(),
  }).optional(),
});

export type BotStatus = z.infer<typeof botStatusSchema>;

export const reportLogSchema = z.object({
  id: z.number(),
  type: z.string(),
  reporter: z.string(),
  phoneNumber: z.string(),
  summary: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

export type ReportLog = z.infer<typeof reportLogSchema>;
