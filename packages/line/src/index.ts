export interface LineIdentityVerifier {
  verify(rawToken: string, expectedNonce?: string): Promise<{ readonly subject: string }>;
}
