import { Injectable } from '@nestjs/common';
import { checkDatabaseConnection } from '@nook/database';

@Injectable()
export class DatabaseProbeService {
  async isReady(): Promise<boolean> {
    return checkDatabaseConnection();
  }
}
