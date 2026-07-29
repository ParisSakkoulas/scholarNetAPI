import { Injectable } from '@nestjs/common';
import { CreateExternalSourceDto } from './dto/create-external-source.dto';
import { UpdateExternalSourceDto } from './dto/update-external-source.dto';

@Injectable()
export class ExternalSourcesService {
  create(createExternalSourceDto: CreateExternalSourceDto) {
    return 'This action adds a new externalSource';
  }

  findAll() {
    return `This action returns all externalSources`;
  }

  findOne(id: number) {
    return `This action returns a #${id} externalSource`;
  }

  update(id: number, updateExternalSourceDto: UpdateExternalSourceDto) {
    return `This action updates a #${id} externalSource`;
  }

  remove(id: number) {
    return `This action removes a #${id} externalSource`;
  }
}
