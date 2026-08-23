import { Controller, Get, Inject } from '@nestjs/common';

/** Ce que le client a besoin de savoir avant d'afficher un écran de connexion. */
export type SignInOptions = {
  /** Vrai quand l'exploitant a fourni des identifiants OAuth Google. */
  google: boolean;
};

export const SIGN_IN_OPTIONS = Symbol('SignInOptions');

/**
 * Voies de connexion ouvertes sur cette instance. Route publique et volontairement muette :
 * elle ne dit pas quels identifiants sont configurés, seulement si une voie existe.
 *
 * Sans elle, le client devrait deviner. Un bouton « Google » affiché sur une instance sans
 * identifiants échoue au clic ; le même bouton caché derrière une variable du build ferait de
 * cette décision deux configurations à tenir d'accord. Le serveur est seul juge.
 *
 * Hors de `/api/auth`, dont le contrôleur passe TOUT au fournisseur d'identité par joker.
 */
@Controller('sign-in-options')
export class SignInOptionsController {
  constructor(@Inject(SIGN_IN_OPTIONS) private readonly options: SignInOptions) {}

  @Get()
  read(): SignInOptions {
    return this.options;
  }
}
