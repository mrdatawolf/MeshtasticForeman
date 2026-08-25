import { z } from "zod";

export interface AdaptedNodeInfo {
  num: number;
  lastHeard?: number;
  snr?: number;
  hopsAway?: number;
  user?: {
    longName?: string;
    shortName?: string;
    macaddr?: Uint8Array;
    hwModel?: number;
    publicKey?: Uint8Array;
  };
}

export interface AdaptedPosition {
  from: number;
  rxTime?: Date;
  data: {
    latitudeI: number;
    longitudeI: number;
    altitude?: number;
    groundSpeed?: number;
    groundTrack?: number;
    satsInView?: number;
  };
}

export interface AdaptedTelemetry {
  from?: number;
  data: {
    variant?: {
      case?: string;
      value?: { batteryLevel?: number };
    };
  };
}

const byteArraySchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

const nodeInfoSchema = z.object({
  num: z.number(),
  lastHeard: z.number().optional(),
  snr: z.number().optional(),
  hopsAway: z.number().optional(),
  user: z
    .object({
      longName: z.string().optional(),
      shortName: z.string().optional(),
      macaddr: byteArraySchema.optional(),
      hwModel: z.number().optional(),
      publicKey: byteArraySchema.optional(),
    })
    .optional(),
});

const positionSchema = z.object({
  from: z.number(),
  rxTime: z.preprocess(
    (value) => (value instanceof Date ? value : undefined),
    z.instanceof(Date).optional(),
  ),
  data: z.object({
    latitudeI: z.number(),
    longitudeI: z.number(),
    altitude: z.number().optional(),
    groundSpeed: z.number().optional(),
    groundTrack: z.number().optional(),
    satsInView: z.number().optional(),
  }),
});

const telemetrySchema = z.object({
  from: z.number().optional(),
  data: z.object({
    variant: z
      .object({
        case: z.string().optional(),
        value: z
          .object({
            batteryLevel: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

function adapt<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  raw: unknown,
): z.output<TSchema> | null {
  try {
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function adaptNodeInfo(raw: unknown): AdaptedNodeInfo | null {
  return adapt(nodeInfoSchema, raw);
}

export function adaptPosition(raw: unknown): AdaptedPosition | null {
  return adapt(positionSchema, raw);
}

export function adaptTelemetry(raw: unknown): AdaptedTelemetry | null {
  return adapt(telemetrySchema, raw);
}
