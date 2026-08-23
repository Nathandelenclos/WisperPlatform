import { z } from 'zod';

/**
 * Schémas de la frontière HTTP des clés de machine. Ils ne valident que ce qui relève du
 * transport (présence, type, forme d'un identifiant de route). Les invariants du libellé
 * appartiennent au domaine : il les valide et répond 422, ils ne sont pas dupliqués ici.
 *
 * Le libellé est tout de même borné en longueur brute : c'est une frontière de confiance, et
 * rien ne justifie de recopier un mégaoctet de texte avant de le refuser.
 */

export const workerKeyIdSchema = z.uuid();

/** Borne de transport, très au-dessus de la borne métier (60 caractères). */
const MAX_RAW_LABEL_LENGTH = 1_000;

export const registerWorkerKeyBodySchema = z.object({
  label: z.string().max(MAX_RAW_LABEL_LENGTH),
});
