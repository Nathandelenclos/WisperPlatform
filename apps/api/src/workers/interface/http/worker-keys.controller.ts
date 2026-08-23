import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../auth/application/ports/authentication';
import { CurrentUser } from '../../../auth/interface/current-user.decorator';
import { SessionGuard } from '../../../auth/interface/session.guard';
import { ListWorkerKeysUseCase } from '../../application/use-cases/list-worker-keys.use-case';
import { RegisterWorkerKeyUseCase } from '../../application/use-cases/register-worker-key.use-case';
import { RevokeWorkerKeyUseCase } from '../../application/use-cases/revoke-worker-key.use-case';
import type { RegisteredWorkerKeyView, WorkerKeyView } from '../../application/views';
import { registerWorkerKeyBodySchema, workerKeyIdSchema } from './dto/worker-keys.dto';
import { parseHttpInput } from './parse-http-input';

/**
 * Routes des clés de machine. La réponse de création est le SEUL endroit où le secret apparaît :
 * l'utilisateur le colle dans la commande de lancement de son worker, la plateforme n'en garde
 * que l'empreinte et ne saura plus le lui montrer.
 */
@UseGuards(SessionGuard)
@Controller('worker-keys')
export class WorkerKeysController {
  constructor(
    // Voir TranscriptionsController : injection par jeton explicite, pas par métadonnée de type.
    @Inject(RegisterWorkerKeyUseCase) private readonly registerWorkerKey: RegisterWorkerKeyUseCase,
    @Inject(ListWorkerKeysUseCase) private readonly listWorkerKeys: ListWorkerKeysUseCase,
    @Inject(RevokeWorkerKeyUseCase) private readonly revokeWorkerKey: RevokeWorkerKeyUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<RegisteredWorkerKeyView> {
    const { label } = parseHttpInput(registerWorkerKeyBodySchema, body);
    return this.registerWorkerKey.execute({ ownerId: user.id, label });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<WorkerKeyView[]> {
    return this.listWorkerKeys.execute({ ownerId: user.id });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.revokeWorkerKey.execute({
      ownerId: user.id,
      workerKeyId: parseHttpInput(workerKeyIdSchema, id),
    });
  }
}
