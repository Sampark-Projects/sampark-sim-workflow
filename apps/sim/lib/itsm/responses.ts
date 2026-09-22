/**
 * ITSM Integration API Response Helpers
 *
 * Consistent response formatting for all `/api/v1/itsm/**` endpoints, mirroring
 * the shape used by `@/app/api/v1/admin/responses` for the admin API.
 */

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { getValidationErrorMessage, serializeZodIssues } from '@/lib/api/server'

interface ItsmErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export function singleResponse<T>(data: T): NextResponse<{ data: T }> {
  return NextResponse.json({ data })
}

export function itsmErrorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown
): NextResponse<ItsmErrorBody> {
  const body: ItsmErrorBody = { error: { code, message } }
  if (details !== undefined) {
    body.error.details = details
  }
  return NextResponse.json(body, { status })
}

export function itsmUnauthorizedResponse(message = 'Authentication required'): NextResponse {
  return itsmErrorResponse('UNAUTHORIZED', message, 401)
}

export function itsmBadRequestResponse(message: string, details?: unknown): NextResponse {
  return itsmErrorResponse('BAD_REQUEST', message, 400, details)
}

/** The request is well-formed but conflicts with the resource's current state. */
export function itsmConflictResponse(message: string, details?: unknown): NextResponse {
  return itsmErrorResponse('CONFLICT', message, 409, details)
}

export function itsmValidationErrorResponse(error: z.ZodError): NextResponse {
  return itsmBadRequestResponse(
    getValidationErrorMessage(error, 'Invalid request body'),
    serializeZodIssues(error)
  )
}

export function itsmInvalidJsonResponse(): NextResponse {
  return itsmBadRequestResponse('Request body must be valid JSON')
}

export function itsmInternalErrorResponse(message = 'Internal server error'): NextResponse {
  return itsmErrorResponse('INTERNAL_ERROR', message, 500)
}

export function itsmNotConfiguredResponse(): NextResponse {
  return itsmErrorResponse(
    'NOT_CONFIGURED',
    'ITSM integration API is not configured. Set ITSM_API_KEY environment variable.',
    503
  )
}
