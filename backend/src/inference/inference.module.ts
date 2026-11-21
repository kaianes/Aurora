import { Global, Module } from '@nestjs/common';
import { InferenceService } from './inference.service';

// Global module: InferenceService does not need to be imported explicitly
// by each consuming module (matching, brand-safety, content-workflow).
// Registered in AppModule.imports (section 2.1 of the E10 architecture doc).
@Global()
@Module({
  providers: [InferenceService],
  exports: [InferenceService],
})
export class InferenceModule {}
