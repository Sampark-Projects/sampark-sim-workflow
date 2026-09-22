import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

/**
 * Encrypts the ITSM sync webhook's HMAC signing secret for storage in
 * `itsm_organization_link.webhook_signing_secret_encrypted`. Wraps the shared
 * AES-256-GCM helper, mirroring `@/lib/data-drains/encryption`.
 */
export async function encryptItsmWebhookSecret(secret: string): Promise<string> {
  const { encrypted } = await encryptSecret(secret)
  return encrypted
}

/** Decrypts the inverse of {@link encryptItsmWebhookSecret}. */
export async function decryptItsmWebhookSecret(ciphertext: string): Promise<string> {
  const { decrypted } = await decryptSecret(ciphertext)
  return decrypted
}
