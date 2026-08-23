import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import { WORKER_IDENTITIES } from '../../application/ports/worker-identities';
import type { WorkerIdentities } from '../../application/ports/worker-identities';
import type { ClaimingRequest } from './claimant.decorator';

const BEARER_PREFIX = 'Bearer ';

/**
 * Protège les routes du worker et attache à la requête le réclamant résolu : le worker de la
 * plateforme et la machine d'un utilisateur passent par la même porte, et c'est ici qu'on
 * apprend lequel parle.
 *
 * Un jeton inconnu — mauvais secret partagé, clé inexistante ou clé révoquée — donne le même
 * 401 avec le même message : rien ne permet de distinguer les trois. Le jeton présenté n'est
 * jamais journalisé.
 */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  constructor(@Inject(WORKER_IDENTITIES) private readonly identities: WorkerIdentities) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IncomingMessage & ClaimingRequest>();
    const header = request.headers.authorization ?? '';
    const presented = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';

    const claimant = await this.identities.resolve(presented);
    if (claimant === null) {
      throw new UnauthorizedException('Jeton de worker invalide');
    }
    request.claimant = claimant;
    return true;
  }
}
