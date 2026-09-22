import { z } from 'zod'
import { requiredFieldSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

/** Wraps a single-resource ITSM API response body: `{ data: T }`. */
function itsmSingleResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({ data: dataSchema })
}

const itsmProvisionOrganizationBodySchema = z.object({
  customerId: requiredFieldSchema('customerId is required').max(128),
  /** The same email the person registered with in ITSM — Sim does not synthesize one. */
  email: requiredFieldSchema('email is required').email('email must be a valid email address'),
  /** ITSM sends the tenant's first name here; Sim uses it as the organization display name. */
  organizationName: requiredFieldSchema('organizationName is required').max(120),
  webhookUrl: z.string().url('webhookUrl must be a valid URL').max(2048).optional(),
  webhookSigningSecret: z
    .string()
    .min(32, 'webhookSigningSecret must be at least 32 characters')
    .max(512)
    .optional(),
})
export type ItsmProvisionOrganizationBody = z.input<typeof itsmProvisionOrganizationBodySchema>

const itsmProvisionOrganizationResponseSchema = itsmSingleResponseSchema(
  z.object({
    organizationId: z.string(),
    simUserId: z.string(),
    customerId: z.string(),
    /**
     * Personal Sim API key for `simUserId`, returned on every call including
     * idempotent replays — not shown again anywhere else. Scoped to the
     * tenant's whole organization; use it to call Sim's public execution API
     * (`/api/workflows/{id}/execute`, `/paused`, resume) directly.
     */
    simApiKey: z.string(),
    /** False when this call found an existing link and returned it unchanged. */
    created: z.boolean(),
  })
)

export const itsmProvisionOrganizationContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/itsm/provisioning',
  body: itsmProvisionOrganizationBodySchema,
  response: { mode: 'json', schema: itsmProvisionOrganizationResponseSchema },
})
export type ItsmProvisionOrganizationResponse = ContractJsonResponse<
  typeof itsmProvisionOrganizationContract
>

const itsmMintLoginTokenBodySchema = z.object({
  customerId: requiredFieldSchema('customerId is required').max(128),
})
export type ItsmMintLoginTokenBody = z.input<typeof itsmMintLoginTokenBodySchema>

const itsmMintLoginTokenResponseSchema = itsmSingleResponseSchema(
  z.object({
    token: z.string(),
    expiresAt: z.string(),
  })
)

export const itsmMintLoginTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/itsm/auth/login-token',
  body: itsmMintLoginTokenBodySchema,
  response: { mode: 'json', schema: itsmMintLoginTokenResponseSchema },
})
export type ItsmMintLoginTokenResponse = ContractJsonResponse<typeof itsmMintLoginTokenContract>

const itsmListWorkflowsQuerySchema = z.object({
  customerId: requiredFieldSchema('customerId is required').max(128),
})
export type ItsmListWorkflowsQuery = z.input<typeof itsmListWorkflowsQuerySchema>

const itsmListWorkflowsResponseSchema = itsmSingleResponseSchema(
  z.object({
    workflows: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        workspaceId: z.string().nullable(),
      })
    ),
  })
)

/**
 * Lists every workflow the tenant's headless owner user can see — across all
 * of their organization's workspaces — so ITSM can offer a picker for
 * mapping a Sim workflow to a process type (change request, service
 * request, ...). Read-only; reuses the same query Sim's own workflow list
 * uses internally, just resolved by `customerId` instead of a session.
 */
export const itsmListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/itsm/workflows',
  query: itsmListWorkflowsQuerySchema,
  response: { mode: 'json', schema: itsmListWorkflowsResponseSchema },
})
export type ItsmListWorkflowsResponse = ContractJsonResponse<typeof itsmListWorkflowsContract>
