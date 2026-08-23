/**
 * Builds a safe `Content-Disposition` header. The original name comes from the user:
 * everything outside printable ASCII is replaced, which incidentally neutralises header
 * injection through carriage returns. The RFC 5987 form (`filename*`) preserves the exact
 * name for the clients that understand it.
 */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').trim();
  const fallback = ascii.length === 0 ? 'download' : ascii;
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
