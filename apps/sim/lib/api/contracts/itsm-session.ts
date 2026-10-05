import { z } from 'zod'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const itsmSignOutResponseSchema = z.object({
  /** False when the browser held no ITSM-embedded session, so there was nothing to end. */
  signedOut: z.boolean(),
})

/**
 * Ends the ITSM-embedded Sim session in the calling browser. Takes no input: the
 * session is identified by its cookie. ITSM calls it when its user logs out.
 */
export const itsmSignOutContract = defineRouteContract({
  method: 'POST',
  path: '/api/itsm/sign-out',
  response: {
    mode: 'json',
    schema: itsmSignOutResponseSchema,
  },
})

export type ItsmSignOutResponse = ContractJsonResponse<typeof itsmSignOutContract>
