import { z } from 'zod';

/** S3-compatible storage credentials (MinIO/R2/AWS). */
export const S3ConfigSchema = z.object({
  endpoint: z.string().trim().optional(),
  region: z.string().trim().min(1),
  bucket: z.string().trim().min(1),
  accessKeyId: z.string().trim().min(1),
  secretAccessKey: z.string().trim().min(1),
  forcePathStyle: z.boolean().default(false),
});
export type S3ConfigInput = z.infer<typeof S3ConfigSchema>;

/** Media-library configuration DTO from the panel (System / SetupWizard). */
export const MediaConfigSchema = z.object({
  enabled: z.boolean().default(true),
  driver: z.enum(['local', 's3']).default('local'),
  retentionDays: z.number().int().positive().nullable().default(null),
  // Required only when driver === 's3'. The secret may be omitted on update to
  // keep the stored one (the route handles the merge).
  s3: S3ConfigSchema.partial({ secretAccessKey: true }).optional(),
});
export type MediaConfigInput = z.infer<typeof MediaConfigSchema>;

/** Query params for the media library listing. */
export const MediaQuerySchema = z.object({
  search: z.string().trim().optional(),
  integrationId: z.string().trim().optional(),
  direction: z.enum(['incoming', 'outgoing']).optional(),
  messageType: z.enum(['image', 'audio', 'video', 'document']).optional(),
  mimeType: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  jid: z.string().trim().optional(),
  lid: z.string().trim().optional(),
  senderName: z.string().trim().optional(),
  isGroup: z.enum(['true', 'false']).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
export type MediaQueryInput = z.infer<typeof MediaQuerySchema>;
