import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupervisionsService } from './supervisions.service';
import { InviteSupervisorDto, RespondSupervisionDto } from './dto/supervision.dto';
import { Access, SupervisionAccess, SupervisionAccessGuard } from './guards/supervision-access.guard';

@Controller('supervisions')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class SupervisionsController {
  constructor(private readonly service: SupervisionsService) {}

  @Post()
  invite(@CurrentUser() user, @Body() dto: InviteSupervisorDto) {
    return this.service.invite(user.userId, dto);
  }

  /** Student dashboard. Declared before ':id' so these literals are not read as ids. */
  @Get('mine')
  mine(@CurrentUser() user) {
    return this.service.mine(user.userId);
  }

  /** Supervisor dashboard: "my students" plus invitations waiting for an answer. */
  @Get('students')
  students(@CurrentUser() user) {
    return this.service.students(user.userId);
  }

  /** The invited supervisor answers; they cannot pass the access guard before accepting. */
  @Patch(':id/respond')
  respond(@CurrentUser() user, @Param('id') id: string, @Body() dto: RespondSupervisionDto) {
    return this.service.respond(user.userId, id, dto.accept);
  }

  @Get(':id/overview')
  @UseGuards(SupervisionAccessGuard)
  overview(@Access() access: SupervisionAccess) {
    return this.service.overview(access);
  }

  @Patch(':id/end')
  @UseGuards(SupervisionAccessGuard)
  end(@Access() access: SupervisionAccess) {
    return this.service.end(access);
  }

  @Get(':id/export')
  @UseGuards(SupervisionAccessGuard)
  export(@Access() access: SupervisionAccess) {
    return this.service.exportSummary(access);
  }
}
