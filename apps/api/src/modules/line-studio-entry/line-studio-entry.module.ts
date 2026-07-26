import { Module } from '@nestjs/common';

import { PlatformCoreModule } from '../../platform/platform-core.module';
import { LineStudioEntryApplicationService } from './line-studio-entry-application.service';
import { LineStudioEntryController } from './line-studio-entry.controller';

@Module({
  imports: [PlatformCoreModule],
  controllers: [LineStudioEntryController],
  providers: [LineStudioEntryApplicationService],
})
export class LineStudioEntryModule {}
