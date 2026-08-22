import { ConcurrentTranscriptionWriteError } from './errors';

/**
 * Un aggregate écrit par deux acteurs à partir du même état voit sa seconde écriture refusée
 * par le verrou optimiste du dépôt. Les collisions réelles de la plateforme sont brèves et
 * bénignes — la balayeuse des bails expirés croise un worker encore vivant, deux onglets
 * corrigent le même segment — et se règlent en repartant d'une lecture fraîche.
 *
 * La tentative doit donc TOUT refaire : relire, décider, écrire. C'est la raison pour laquelle
 * on prend une fonction et non une transcription déjà chargée.
 *
 * ponytail: un seul nouvel essai. Au-delà, l'appelant reçoit le conflit et le traduit en 409 ;
 * une file par transcription serait la sortie si la contention devenait mesurable.
 */
export async function retryOnConcurrentWrite<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof ConcurrentTranscriptionWriteError)) {
      throw error;
    }
    return attempt();
  }
}
