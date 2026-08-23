import type { Clock } from '../../application/ports/clock';

/**
 * Horloge du système. Propre au contexte, comme son port : c'est ce qui garde le contexte
 * `workers` indépendant de `transcription` à la compilation comme à l'exécution.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
