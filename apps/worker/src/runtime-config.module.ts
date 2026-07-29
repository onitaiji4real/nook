import { Global, Module } from '@nestjs/common';

import { runtimeConfig } from './runtime-config';
import { RUNTIME_CONFIG } from './runtime-config.token';

@Global()
@Module({
  providers: [{ provide: RUNTIME_CONFIG, useValue: runtimeConfig }],
  exports: [RUNTIME_CONFIG],
})
export class RuntimeConfigModule {}
