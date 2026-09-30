import { z } from 'zod';

const pointIdentifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  message: 'must contain only lowercase ASCII letters, digits, and hyphens',
});

const pointSchema = z
  .object({
    id: pointIdentifier,
    name: z.string().trim().min(1, { message: 'must be a non-empty name' }),
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
  })
  .strict();

const trackSourceSchema = z
  .string()
  .refine(
    (source) =>
      source.trim().length > 0 &&
      !source.includes('\0') &&
      !/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(source) &&
      /\.(?:gpx|geojson|json)$/i.test(source),
    { message: 'must be a relative local .gpx, .geojson, or .json path' },
  );

const privacySchema = z
  .object({
    trim_start_meters: z.number().finite().nonnegative().default(0),
    trim_end_meters: z.number().finite().nonnegative().default(0),
  })
  .strict();

const trackSchema = z
  .object({
    source: trackSourceSchema,
    privacy: privacySchema.prefault({}),
    simplify_tolerance_meters: z.number().finite().min(0).max(10000).default(5),
    playback: z.boolean().default(true),
  })
  .strict();

/**
 * Validates raw map Front Matter. Longitude and latitude are GCJ-02 values and are never converted or jittered.
 */
export const postMapSchema = z
  .object({
    representative: pointIdentifier.optional(),
    points: z.array(pointSchema).min(1, { message: 'must contain at least one point' }),
    route: z
      .array(pointIdentifier)
      .min(2, { message: 'must contain at least two point identifiers' })
      .optional(),
    zoom: z.number().finite().optional(),
    track: trackSchema.optional(),
  })
  .strict()
  .superRefine((map, context) => {
    const identifiers = new Set<string>();

    map.points.forEach((point, index) => {
      if (identifiers.has(point.id)) {
        context.addIssue({
          code: 'custom',
          path: ['points', index, 'id'],
          message: 'point identifier must be unique within the post',
        });
      }
      identifiers.add(point.id);
    });

    if (map.points.length > 1 && map.representative === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['representative'],
        message: 'is required when map.points contains multiple points',
      });
    }

    if (map.representative !== undefined && !identifiers.has(map.representative)) {
      context.addIssue({
        code: 'custom',
        path: ['representative'],
        message: `point "${map.representative}" does not exist in map.points`,
      });
    }

    map.route?.forEach((identifier, index) => {
      if (!identifiers.has(identifier)) {
        context.addIssue({
          code: 'custom',
          path: ['route', index],
          message: `point "${identifier}" does not exist in map.points`,
        });
      }
    });
  });

export type ParsedPostMap = z.output<typeof postMapSchema>;
