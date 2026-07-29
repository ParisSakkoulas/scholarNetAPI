import { Test, TestingModule } from '@nestjs/testing';
import { ExternalSourcesController } from './external-sources.controller';
import { ExternalSourcesService } from './external-sources.service';

describe('ExternalSourcesController', () => {
  let controller: ExternalSourcesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExternalSourcesController],
      providers: [ExternalSourcesService],
    }).compile();

    controller = module.get<ExternalSourcesController>(ExternalSourcesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
