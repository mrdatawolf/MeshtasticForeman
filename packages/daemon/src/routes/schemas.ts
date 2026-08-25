import { z } from "zod";

import type { FastifyReply } from "fastify";

export const deviceIdSchema = z.string().uuid();

export function nodeIdSchema({
  sign = "positive",
}: { sign?: "any" | "nonnegative" | "positive" } = {}) {
  const schema = z.coerce.number().int().finite();
  if (sign === "any") return schema;
  return sign === "nonnegative" ? schema.min(0) : schema.positive();
}

export function limitSchema(max: number, defaultValue: number) {
  return z.coerce.number().int().min(1).max(max).default(defaultValue);
}

export function offsetSchema(max: number, defaultValue = 0) {
  return z.coerce.number().int().min(0).max(max).default(defaultValue);
}

export interface ValidationErrorBody {
  error: {
    fieldErrors: Record<string, string[]>;
    formErrors: string[];
  };
}

export function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  const flattened = error.flatten();
  const body: ValidationErrorBody = {
    error: {
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
      formErrors: flattened.formErrors,
    },
  };
  return reply.status(400).send(body);
}
