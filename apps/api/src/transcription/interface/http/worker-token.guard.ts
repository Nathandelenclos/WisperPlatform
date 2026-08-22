import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Jeton porteur partagé par les workers. Fourni par la racine de composition : la couche
 * interface ne lit jamais la configuration elle-même.
 */
export const WORKER_ACCESS_TOKEN = Symbol('WorkerAccessToken');

const BEARER_PREFIX = 'Bearer ';

/**
 * Protège les routes du worker. La comparaison porte sur les empreintes SHA-256 des deux
 * jetons : elles ont toujours la même longueur, ce qui rend `timingSafeEqual` utilisable
 * quelle que soit la valeur présentée, et aucune fuite par la longueur n'est possible.
 * Le jeton présenté n'est jamais journalisé.
 */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(WORKER_ACCESS_TOKEN) sharedToken: string) {
    this.expected = createHash('sha256').update(sharedToken, 'utf8').digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    const header = request.headers.authorization ?? '';
    const presented = header.startsWith(BEARER_PREFIX)
      ? header.slice(BEARER_PREFIX.length)
      : '';
    const candidate = createHash('sha256').update(presented, 'utf8').digest();

    if (!timingSafeEqual(candidate, this.expected)) {
      throw new UnauthorizedException('Jeton de worker invalide');
    }
    return true;
  }
}
