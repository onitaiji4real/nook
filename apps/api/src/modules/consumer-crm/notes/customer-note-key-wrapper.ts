import { CustomerNoteEncryptionError, type CustomerNoteDataKeyWrapper } from '@nook/crypto';

export class DisabledCustomerNoteDataKeyWrapper implements CustomerNoteDataKeyWrapper {
  wrapDataKey(): Promise<never> {
    return Promise.reject(new CustomerNoteEncryptionError('key_unavailable'));
  }

  unwrapDataKey(): Promise<never> {
    return Promise.reject(new CustomerNoteEncryptionError('key_unavailable'));
  }
}
