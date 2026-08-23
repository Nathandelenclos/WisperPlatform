import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TranscriptionCatalog } from '../../src/transcription/application/ports/transcription-catalog';
import type { TranscriptionQueue } from '../../src/transcription/application/ports/transcription-queue';
import type { TranscriptionRepository } from '../../src/transcription/application/ports/transcription-repository';
import type { Claimant } from '../../src/transcription/application/ports/worker-identities';
import type { Placement } from '../../src/transcription/domain/placement';
import { MediaAsset } from '../../src/transcription/domain/media-asset';
import { ConcurrentTranscriptionWriteError } from '../../src/transcription/application/errors';
import { SpeakerTurn } from '../../src/transcription/domain/speaker-turn';
import { TimeRange } from '../../src/transcription/domain/time-range';
import { Transcription } from '../../src/transcription/domain/transcription';
import {
  TranscriptionSettings,
  type WhisperModel,
} from '../../src/transcription/domain/transcription-settings';

/**
 * Propriétaires utilisés par la suite. Un adaptateur réel doit garantir leur existence avant de
 * rejouer la suite (contrainte de clé étrangère vers la table des comptes).
 */
// Instant d'arrivée d'un lot de segments, fourni par l'horloge applicative.
const APPENDED_AT = new Date('2026-03-01T10:00:30.000Z');
export const CONTRACT_OWNER_A = '4a1b7d64-0000-4000-8000-0000000000aa';
export const CONTRACT_OWNER_B = '4a1b7d64-0000-4000-8000-0000000000bb';

export type TranscriptionRepositoryHarness = {
  repository: TranscriptionRepository;
  catalog: TranscriptionCatalog;
  queue: TranscriptionQueue;
  cleanup: () => Promise<void>;
};

const REQUESTED_AT = new Date('2026-04-02T08:00:00.000Z');
const LEASE_UNTIL = new Date('2026-04-02T08:05:00.000Z');
// LEASE_UNTIL = REQUESTED_AT + LEASE_SECONDS : la durée est ce que l'aggregate accepte.
const LEASE_SECONDS = 300;


/** Le réclamant d'un worker de la plateforme. */
const SERVICE: Claimant = { kind: 'service' };
/** Le réclamant d'une machine déclarée par le propriétaire A. */
const MACHINE_OF_A: Claimant = { kind: 'owner', ownerId: CONTRACT_OWNER_A };

function uuid(suffix: string): string {
  return `7c9e6679-0000-4000-8000-${suffix.padStart(12, '0')}`;
}

function aRequest(p: {
  id: string;
  ownerId?: string;
  model?: WhisperModel;
  requestedAt?: Date;
  originalName?: string;
  byteSize?: number;
  placement?: Placement;
}): Transcription {
  const transcription = Transcription.request({
    id: p.id,
    ownerId: p.ownerId ?? CONTRACT_OWNER_A,
    media: MediaAsset.stored({
      storageKey: uuid(p.id.slice(-6)),
      originalName: p.originalName ?? 'entretien.mp3',
      contentType: 'audio/mpeg',
      byteSize: p.byteSize ?? 2_048,
    }),
    settings: TranscriptionSettings.of(p.model ?? 'small', 'fr'),
    requestedAt: p.requestedAt ?? REQUESTED_AT,
    placement: p.placement,
  });
  transcription.pullEvents();
  return transcription;
}

/**
 * Suite de contrat du côté persistance du contexte `transcription` : dépôt de l'aggregate,
 * modèle de lecture et file de travail. Elle est rejouée à l'identique sur les doubles en
 * mémoire et sur l'adaptateur Postgres — aucune hypothèse sur la technique en dessous.
 */
export function describeTranscriptionRepositoryContract(
  name: string,
  factory: () => Promise<TranscriptionRepositoryHarness>,
): void {
  describe(name, () => {
    let harness: TranscriptionRepositoryHarness;

    beforeEach(async () => {
      harness = await factory();
    });

    afterEach(async () => {
      await harness.cleanup();
    });

    describe('dépôt de l\'aggregate', () => {
      it('relit un aggregate entier : segments, correction, bail et séquence de lots', async () => {
        const transcription = aRequest({ id: uuid('1') });
        transcription.startTranscribing({
          runId: uuid('a1'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        transcription.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a1'),
          batchSequence: 1,
          segments: [
            { range: TimeRange.fromMilliseconds(0, 1_500), text: 'bonjur' },
            { range: TimeRange.fromMilliseconds(1_500, 3_000), text: 'à tous' },
          ],
        });
        transcription.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a1'),
          batchSequence: 2,
          segments: [{ range: TimeRange.fromMilliseconds(3_000, 4_200), text: 'et bienvenue' }],
        });
        transcription.complete({ runId: uuid('a1'), at: LEASE_UNTIL });
        transcription.correctSegment({ ordinal: 1, text: 'bonjour', at: LEASE_UNTIL });

        await harness.repository.save(transcription);
        const reloaded = await harness.repository.findById(transcription.id);

        expect(reloaded).not.toBeNull();
        expect(reloaded?.state()).toEqual(transcription.state());
        const state = reloaded?.state();
        expect(state?.attempts).toBe(1);
        expect(state?.lastAppliedBatchSequence).toBe(2);
        expect(state?.currentRunId).toBe(uuid('a1'));
        expect(state?.claimedBy).toBe('worker-1');
        expect(state?.completedAt).toEqual(LEASE_UNTIL);
        expect(state?.segments).toEqual([
          {
            ordinal: 1,
            startMs: 0,
            endMs: 1_500,
            text: 'bonjour',
            corrected: true,
            speakerIndex: null,
          },
          {
            ordinal: 2,
            startMs: 1_500,
            endMs: 3_000,
            text: 'à tous',
            corrected: false,
            speakerIndex: null,
          },
          {
            ordinal: 3,
            startMs: 3_000,
            endMs: 4_200,
            text: 'et bienvenue',
            corrected: false,
            speakerIndex: null,
          },
        ]);
      });

      it('relit un aggregate en attente, sans bail, sans segment ni locuteur', async () => {
        const transcription = aRequest({ id: uuid('2') });

        await harness.repository.save(transcription);
        const reloaded = await harness.repository.findById(transcription.id);

        expect(reloaded?.state()).toEqual(transcription.state());
        expect(reloaded?.state().leaseExpiresAt).toBeNull();
        expect(reloaded?.state().segments).toEqual([]);
        expect(reloaded?.state().speakers).toEqual([]);
      });

      it('remplace l\'état précédent au lieu de l\'empiler', async () => {
        const transcription = aRequest({ id: uuid('3') });
        transcription.startTranscribing({
          runId: uuid('a3'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        transcription.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a3'),
          batchSequence: 1,
          segments: [{ range: TimeRange.fromMilliseconds(0, 1_000), text: 'un' }],
        });
        await harness.repository.save(transcription);

        transcription.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a3'),
          batchSequence: 2,
          segments: [{ range: TimeRange.fromMilliseconds(1_000, 2_000), text: 'deux' }],
        });
        transcription.complete({ runId: uuid('a3'), at: LEASE_UNTIL });
        await harness.repository.save(transcription);

        const reloaded = await harness.repository.findById(transcription.id);
        expect(reloaded?.state().status).toBe('completed');
        expect(reloaded?.state().segments).toHaveLength(2);
      });

      it('relit les locuteurs et le locuteur porté par chaque segment', async () => {
        const transcription = aRequest({ id: uuid('4') });
        transcription.startTranscribing({
          runId: uuid('a4'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        transcription.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a4'),
          batchSequence: 1,
          segments: [
            { range: TimeRange.fromMilliseconds(0, 1_000), text: 'bonjour' },
            { range: TimeRange.fromMilliseconds(1_000, 2_000), text: 'à tous' },
            { range: TimeRange.fromMilliseconds(5_000, 6_000), text: 'et voilà' },
          ],
        });
        transcription.assignSpeakers({
          runId: uuid('a4'),
          at: APPENDED_AT,
          turns: [
            SpeakerTurn.of(TimeRange.fromMilliseconds(0, 1_000), 0),
            SpeakerTurn.of(TimeRange.fromMilliseconds(1_000, 2_000), 1),
          ],
        });
        transcription.renameSpeaker({ index: 1, name: 'Marc', at: LEASE_UNTIL });

        await harness.repository.save(transcription);
        const reloaded = await harness.repository.findById(transcription.id);

        expect(reloaded?.state()).toEqual(transcription.state());
        expect(reloaded?.state().speakers).toEqual([
          { index: 0, name: null },
          { index: 1, name: 'Marc' },
        ]);
        // Le troisième segment n'est recouvert par aucun tour : il reste sans locuteur.
        expect(reloaded?.state().segments.map((segment) => segment.speakerIndex)).toEqual([
          0,
          1,
          null,
        ]);
      });

      it('remplace le jeu de locuteurs au lieu de l\'empiler', async () => {
        const transcription = aRequest({ id: uuid('5') });
        transcription.startTranscribing({
          runId: uuid('a5'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        transcription.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a5'),
          batchSequence: 1,
          segments: [{ range: TimeRange.fromMilliseconds(0, 2_000), text: 'seul' }],
        });
        transcription.assignSpeakers({
          runId: uuid('a5'),
          at: APPENDED_AT,
          turns: [
            SpeakerTurn.of(TimeRange.fromMilliseconds(0, 1_000), 0),
            SpeakerTurn.of(TimeRange.fromMilliseconds(1_000, 2_000), 1),
          ],
        });
        await harness.repository.save(transcription);

        // Une seconde passe ne trouve plus qu'une voix : la première ne doit pas survivre.
        transcription.assignSpeakers({
          runId: uuid('a5'),
          at: APPENDED_AT,
          turns: [SpeakerTurn.of(TimeRange.fromMilliseconds(0, 2_000), 0)],
        });
        await harness.repository.save(transcription);

        const reloaded = await harness.repository.findById(transcription.id);
        expect(reloaded?.state().speakers).toEqual([{ index: 0, name: null }]);
        expect(reloaded?.state().segments[0].speakerIndex).toBe(0);
      });

      it('rend null pour un aggregate inconnu', async () => {
        expect(await harness.repository.findById(uuid('ff'))).toBeNull();
      });

      it('refuse la seconde de deux écritures parties du même état', async () => {
        // Cas nominal de la plateforme : l'utilisateur corrige un segment pendant que le
        // worker publie un lot. Sans refus, la dernière écriture efface l'autre en silence.
        await harness.repository.save(aRequest({ id: uuid('2a') }));
        const first = await harness.repository.findById(uuid('2a'));
        const second = await harness.repository.findById(uuid('2a'));
        if (first === null || second === null) throw new Error('aggregate introuvable');

        first.startTranscribing({
          runId: uuid('a2a'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        await harness.repository.save(first);

        second.startTranscribing({
          runId: uuid('b2a'),
          workerId: 'worker-2',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });

        await expect(harness.repository.save(second)).rejects.toThrow(
          ConcurrentTranscriptionWriteError,
        );
        // L'état gagnant est bien celui du premier écrivain, intact.
        expect((await harness.repository.findById(uuid('2a')))?.state().claimedBy).toBe('worker-1');
      });

      it('laisse un même aggregate rechargé écrire plusieurs fois de suite', async () => {
        await harness.repository.save(aRequest({ id: uuid('2b') }));
        const transcription = await harness.repository.findById(uuid('2b'));
        if (transcription === null) throw new Error('aggregate introuvable');

        transcription.startTranscribing({
          runId: uuid('a2b'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        await harness.repository.save(transcription);
        transcription.renewLease({
          runId: uuid('a2b'),
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });

        await expect(harness.repository.save(transcription)).resolves.toBeUndefined();
      });
    });

    describe('file de travail', () => {
      it('ne remet jamais la même transcription à deux workers en concurrence', async () => {
        await harness.repository.save(aRequest({ id: uuid('10') }));

        const reservations = await Promise.all([
          harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-1',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
          harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-2',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
        ]);

        expect(reservations.filter((id) => id === uuid('10'))).toHaveLength(1);
        expect(reservations.filter((id) => id === null)).toHaveLength(1);
      });

      it('sert les demandes les plus anciennes d\'abord', async () => {
        await harness.repository.save(
          aRequest({ id: uuid('11'), requestedAt: new Date('2026-04-02T09:00:00.000Z') }),
        );
        await harness.repository.save(
          aRequest({ id: uuid('12'), requestedAt: new Date('2026-04-02T08:00:00.000Z') }),
        );

        const first = await harness.queue.reserveNextPending({
          claimant: SERVICE,
          workerId: 'worker-1',
          models: ['small'],
          reservationSeconds: 30,
          now: new Date('2026-04-02T10:00:00.000Z'),
        });

        expect(first).toBe(uuid('12'));
      });

      it('ne propose que les modèles servis par le worker', async () => {
        await harness.repository.save(aRequest({ id: uuid('13'), model: 'large' }));

        expect(
          await harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-1',
            models: ['tiny', 'base'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
        ).toBeNull();
        expect(
          await harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-1',
            models: ['tiny', 'large'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
        ).toBe(uuid('13'));
      });

      it('libère une réservation qu\'aucun worker n\'a honorée', async () => {
        await harness.repository.save(aRequest({ id: uuid('14') }));
        const reserve = (now: Date): Promise<string | null> =>
          harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-1',
            models: ['small'],
            reservationSeconds: 30,
            now,
          });

        expect(await reserve(REQUESTED_AT)).toBe(uuid('14'));
        expect(await reserve(new Date(REQUESTED_AT.getTime() + 29_000))).toBeNull();
        expect(await reserve(new Date(REQUESTED_AT.getTime() + 31_000))).toBe(uuid('14'));
      });

      it('rend une transcription réclamable dès que sa réservation est levée', async () => {
        // C'est ce qui rend utile la reddition d'une tentative : sans cette levée, la demande
        // repasse en attente mais reste invisible jusqu'à la fin de la fenêtre de réservation.
        await harness.repository.save(aRequest({ id: uuid('14b') }));
        const reserve = (now: Date): Promise<string | null> =>
          harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-1',
            models: ['small'],
            reservationSeconds: 300,
            now,
          });

        expect(await reserve(REQUESTED_AT)).toBe(uuid('14b'));
        expect(await reserve(REQUESTED_AT)).toBeNull();

        await harness.queue.clearReservation(uuid('14b'));

        expect(await reserve(REQUESTED_AT)).toBe(uuid('14b'));
      });

      it('ignore la levée de réservation d\'une transcription inconnue', async () => {
        await expect(harness.queue.clearReservation(uuid('fe'))).resolves.toBeUndefined();
      });

      it('ne propose pas une transcription qui n\'est plus en attente', async () => {
        const transcription = aRequest({ id: uuid('15') });
        transcription.startTranscribing({
          runId: uuid('a15'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        await harness.repository.save(transcription);

        expect(
          await harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-2',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
        ).toBeNull();
      });

      it('signale les transcriptions dont le bail est dépassé, les plus anciennes d\'abord', async () => {
        const abandoned = aRequest({ id: uuid('16') });
        abandoned.startTranscribing({
          runId: uuid('a16'),
          workerId: 'worker-1',
          leaseSeconds: 60,
          at: REQUESTED_AT,
        });
        const alsoAbandoned = aRequest({ id: uuid('17') });
        alsoAbandoned.startTranscribing({
          runId: uuid('a17'),
          workerId: 'worker-2',
          leaseSeconds: 30,
          at: REQUESTED_AT,
        });
        const alive = aRequest({ id: uuid('18') });
        alive.startTranscribing({
          runId: uuid('a18'),
          workerId: 'worker-3',
          leaseSeconds: 3_600,
          at: REQUESTED_AT,
        });
        await harness.repository.save(abandoned);
        await harness.repository.save(alsoAbandoned);
        await harness.repository.save(alive);
        await harness.repository.save(aRequest({ id: uuid('19') }));

        const stalled = await harness.queue.findStalled({
          now: new Date('2026-04-02T08:02:00.000Z'),
          limit: 10,
        });

        expect(stalled).toEqual([uuid('17'), uuid('16')]);
      });

      it('borne le nombre de transcriptions abandonnées rendues', async () => {
        for (const suffix of ['20', '21', '22']) {
          const transcription = aRequest({ id: uuid(suffix) });
          transcription.startTranscribing({
            runId: uuid(`a${suffix}`),
            workerId: 'worker-1',
            leaseSeconds: 60,
            at: REQUESTED_AT,
          });
          await harness.repository.save(transcription);
        }

        const stalled = await harness.queue.findStalled({
          now: new Date('2026-04-02T08:02:00.000Z'),
          limit: 2,
        });

        expect(stalled).toHaveLength(2);
      });

      it('ne propose au service que les transcriptions placées sur le service', async () => {
        await harness.repository.save(aRequest({ id: uuid('23'), placement: 'owner' }));

        expect(
          await harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-du-service',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
        ).toBeNull();

        await harness.repository.save(aRequest({ id: uuid('24'), placement: 'service' }));

        expect(
          await harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-du-service',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          }),
        ).toBe(uuid('24'));
      });

      it('ne propose à une machine que les transcriptions placées sur les machines de SON propriétaire', async () => {
        // Placée sur le service : ce n'est pas le travail des machines, même celles du bon
        // propriétaire.
        await harness.repository.save(aRequest({ id: uuid('25'), placement: 'service' }));
        // Placée sur les machines d'un AUTRE propriétaire.
        await harness.repository.save(
          aRequest({ id: uuid('26'), ownerId: CONTRACT_OWNER_B, placement: 'owner' }),
        );
        const reserve = (): Promise<string | null> =>
          harness.queue.reserveNextPending({
            claimant: MACHINE_OF_A,
            workerId: 'machine-de-a',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          });

        expect(await reserve()).toBeNull();

        await harness.repository.save(aRequest({ id: uuid('27'), placement: 'owner' }));

        expect(await reserve()).toBe(uuid('27'));
      });

      it('rend réclamable par le service une demande basculée vers lui', async () => {
        const transcription = aRequest({ id: uuid('28'), placement: 'owner' });
        await harness.repository.save(transcription);
        const reserveForService = (): Promise<string | null> =>
          harness.queue.reserveNextPending({
            claimant: SERVICE,
            workerId: 'worker-du-service',
            models: ['small'],
            reservationSeconds: 30,
            now: REQUESTED_AT,
          });

        expect(await reserveForService()).toBeNull();

        const reloaded = await harness.repository.findById(uuid('28'));
        if (reloaded === null) throw new Error('aggregate introuvable');
        reloaded.changePlacement({ placement: 'service', at: REQUESTED_AT });
        await harness.repository.save(reloaded);

        expect(await reserveForService()).toBe(uuid('28'));
      });

      it('relit le placement écrit, service comme machine', async () => {
        await harness.repository.save(aRequest({ id: uuid('29'), placement: 'owner' }));
        await harness.repository.save(aRequest({ id: uuid('29a') }));

        expect((await harness.repository.findById(uuid('29')))?.state().placement).toBe('owner');
        // Sans choix explicite, le service calcule : c'est aussi le défaut de la colonne.
        expect((await harness.repository.findById(uuid('29a')))?.state().placement).toBe('service');
      });
    });

    describe('modèle de lecture du propriétaire', () => {
      it('résume les transcriptions du propriétaire, la plus récente d\'abord', async () => {
        const older = aRequest({
          id: uuid('30'),
          requestedAt: new Date('2026-04-02T08:00:00.000Z'),
          originalName: 'ancien.mp3',
          byteSize: 1_000,
        });
        older.startTranscribing({
          runId: uuid('a30'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        older.appendTranscribedSegments({
          at: APPENDED_AT,
          runId: uuid('a30'),
          batchSequence: 1,
          segments: [
            { range: TimeRange.fromMilliseconds(0, 1_000), text: 'un' },
            { range: TimeRange.fromMilliseconds(1_000, 7_400), text: 'deux' },
          ],
        });
        older.complete({ runId: uuid('a30'), at: LEASE_UNTIL });
        const newer = aRequest({
          id: uuid('31'),
          requestedAt: new Date('2026-04-02T09:00:00.000Z'),
          model: 'turbo',
        });
        await harness.repository.save(older);
        await harness.repository.save(newer);
        await harness.repository.save(
          aRequest({ id: uuid('32'), ownerId: CONTRACT_OWNER_B }),
        );

        const summaries = await harness.catalog.listOwnedBy(CONTRACT_OWNER_A);

        expect(summaries.map((summary) => summary.id)).toEqual([uuid('31'), uuid('30')]);
        expect(summaries[1]).toEqual({
          id: uuid('30'),
          status: 'completed',
          placement: 'service',
          model: 'small',
          language: 'fr',
          mediaName: 'ancien.mp3',
          mediaByteSize: 1_000,
          segmentCount: 2,
          durationMs: 7_400,
          requestedAt: new Date('2026-04-02T08:00:00.000Z'),
          completedAt: LEASE_UNTIL,
          failureReason: null,
        });
      });

      it('résume une transcription échouée sans segment', async () => {
        const transcription = aRequest({ id: uuid('33') });
        transcription.startTranscribing({
          runId: uuid('a33'),
          workerId: 'worker-1',
          leaseSeconds: LEASE_SECONDS,
          at: REQUESTED_AT,
        });
        transcription.fail({ runId: uuid('a33'), reason: 'whisper introuvable', at: LEASE_UNTIL });
        await harness.repository.save(transcription);

        const summaries = await harness.catalog.listOwnedBy(CONTRACT_OWNER_A);

        expect(summaries).toHaveLength(1);
        expect(summaries[0].status).toBe('failed');
        expect(summaries[0].failureReason).toBe('whisper introuvable');
        expect(summaries[0].segmentCount).toBe(0);
        expect(summaries[0].durationMs).toBe(0);
        expect(summaries[0].completedAt).toBeNull();
      });

      it('ne rend rien pour un propriétaire sans transcription', async () => {
        await harness.repository.save(aRequest({ id: uuid('34') }));

        expect(await harness.catalog.listOwnedBy(CONTRACT_OWNER_B)).toEqual([]);
      });
    });
  });
}
