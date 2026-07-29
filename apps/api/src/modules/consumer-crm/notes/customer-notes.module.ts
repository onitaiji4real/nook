import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import { getPrismaClient, PrismaCustomerNoteRepository } from '@nook/database';

import { RUNTIME_CONFIG } from '../../../platform/config/runtime-config.token';
import { PlatformCoreModule } from '../../../platform/platform-core.module';
import { DisabledCustomerNoteDataKeyWrapper } from './customer-note-key-wrapper';
import { CustomerNotesApplicationService } from './customer-notes-application.service';
import { CustomerNotesNoStoreMiddleware } from './customer-notes-no-store.middleware';
import { CustomerNotesController } from './customer-notes.controller';
import { CUSTOMER_NOTE_KEY_WRAPPER, CUSTOMER_NOTE_REPOSITORY } from './customer-notes.tokens';
import { GoogleKmsCustomerNoteDataKeyWrapper } from './google-kms-customer-note-key-wrapper';

@Module({
  imports: [PlatformCoreModule],
  controllers: [CustomerNotesController],
  providers: [
    CustomerNotesApplicationService,
    CustomerNotesNoStoreMiddleware,
    {
      provide: CUSTOMER_NOTE_REPOSITORY,
      useFactory: () => new PrismaCustomerNoteRepository(getPrismaClient()),
    },
    {
      provide: CUSTOMER_NOTE_KEY_WRAPPER,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) => {
        if (config.crmNotesMode === 'disabled') {
          return new DisabledCustomerNoteDataKeyWrapper();
        }
        if (config.crmNotesKmsKeyResource === undefined) {
          throw new Error('CRM_NOTES_KMS_KEY_RESOURCE is required when CRM_NOTES_MODE=active.');
        }
        return new GoogleKmsCustomerNoteDataKeyWrapper(config.crmNotesKmsKeyResource);
      },
    },
  ],
  exports: [CustomerNotesApplicationService],
})
export class CustomerNotesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CustomerNotesNoStoreMiddleware).forRoutes(CustomerNotesController);
  }
}
