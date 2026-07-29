# Crypto

Application-level cryptographic envelopes and stable byte contracts shared by deployable services.

Customer notes use one random AES-256-GCM data-encryption key and nonce per write. The package never
owns cloud credentials, KMS clients, persistence, authorization, or logging; deployable applications
must supply an approved `CustomerNoteDataKeyWrapper` and fail closed when it is unavailable.

The canonical AAD format and envelope schema are compatibility contracts. Changes require an ADR,
test vectors, migration/rotation planning, and proof that plaintext, data keys, ciphertext, wrapped
keys, and KMS resource identifiers do not enter logs or client responses.
