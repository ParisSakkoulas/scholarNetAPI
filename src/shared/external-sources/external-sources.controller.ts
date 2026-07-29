import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ExternalSourcesService } from './external-sources.service';
import { CreateExternalSourceDto } from './dto/create-external-source.dto';
import { UpdateExternalSourceDto } from './dto/update-external-source.dto';

@Controller('external-sources')
export class ExternalSourcesController {
  constructor(private readonly externalSourcesService: ExternalSourcesService) {}

  @Post()
  create(@Body() createExternalSourceDto: CreateExternalSourceDto) {
    return this.externalSourcesService.create(createExternalSourceDto);
  }

  @Get()
  findAll() {
    return this.externalSourcesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.externalSourcesService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateExternalSourceDto: UpdateExternalSourceDto) {
    return this.externalSourcesService.update(+id, updateExternalSourceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.externalSourcesService.remove(+id);
  }
}
