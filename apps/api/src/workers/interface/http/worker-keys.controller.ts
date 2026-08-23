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
 * Machine key routes. The creation response is the ONLY place where the secret appears: the user
 * pastes it into the launch command of their worker, the platform keeps nothing but its
 * fingerprint and will never be able to show it to them again.
 */
@UseGuards(SessionGuard)
@Controller('worker-keys')
export class WorkerKeysController {
  constructor(
    // See TranscriptionsController: injection by explicit token, not by type metadata.
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
