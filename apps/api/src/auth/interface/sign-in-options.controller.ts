import { Controller, Get, Inject } from '@nestjs/common';

/** What the client needs to know before displaying a sign-in screen. */
export type SignInOptions = {
  /** True when the operator has provided Google OAuth credentials. */
  google: boolean;
};

export const SIGN_IN_OPTIONS = Symbol('SignInOptions');

/**
 * Sign-in paths open on this instance. A public route, and deliberately mute: it does not say
 * which credentials are configured, only whether a path exists.
 *
 * Without it, the client would have to guess. A "Google" button displayed on an instance with no
 * credentials fails on click — the same button hidden behind a build variable would turn that
 * decision into two configurations to keep in agreement. The server alone decides.
 *
 * Outside `/api/auth`, whose controller passes EVERYTHING to the identity provider by wildcard.
 */
@Controller('sign-in-options')
export class SignInOptionsController {
  constructor(@Inject(SIGN_IN_OPTIONS) private readonly options: SignInOptions) {}

  @Get()
  read(): SignInOptions {
    return this.options;
  }
}
