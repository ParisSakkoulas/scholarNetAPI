import { Test, TestingModule } from '@nestjs/testing';
import { ExternalSourcesService } from './external-sources.service';

describe('ExternalSourcesService', () => {
  let service: ExternalSourcesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExternalSourcesService],
    }).compile();

    service = module.get<ExternalSourcesService>(ExternalSourcesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
