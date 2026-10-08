import type { MessageType } from '@wootrico/config';

export function chatwootAttachmentType(fileType: string | undefined): MessageType {
  switch (fileType) {
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    default:
      return 'document';
  }
}

export function getMessageTypeFromChatwoot(
  attachments: any[] | undefined,
): MessageType {
  if (attachments && attachments.length > 0) {
    return chatwootAttachmentType(attachments[0]?.file_type);
  }
  return 'text';
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

export function fileNameFor(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback;
  const ext = EXT[mime];
  return ext ? `${fallback}.${ext}` : fallback;
}
