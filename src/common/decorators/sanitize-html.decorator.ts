import { Transform } from 'class-transformer';

/** Removes HTML tags and control characters. Needs ValidationPipe({ transform: true }). */
export function stripHtml(value: string): string {
  let out = value;
  let previous: string;
  // repeat: "<scr<b>ipt>" becomes "<script>" after one pass
  do {
    previous = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== previous);
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

export const SanitizeHtml = () =>
  Transform(({ value }) => (typeof value === 'string' ? stripHtml(value) : value));
