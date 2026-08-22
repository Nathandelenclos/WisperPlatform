/**
 * Construit un en-tête `Content-Disposition` sûr. Le nom d'origine vient de l'utilisateur :
 * tout ce qui sort de l'ASCII imprimable est remplacé, ce qui neutralise au passage
 * l'injection d'en-tête par retour chariot. La forme RFC 5987 (`filename*`) conserve
 * le nom exact pour les clients qui la comprennent.
 */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').trim();
  const fallback = ascii.length === 0 ? 'download' : ascii;
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
