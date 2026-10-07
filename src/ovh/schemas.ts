import { z } from "zod";

// Only the fields this app reads are declared; zod drops everything else, so OVH can add
// fields freely. Full shape of the catalog for reference: scripts/dataset.types.ts.
//
// "Critical" schemas cover the data monitoring decisions depend on (plan codes, orderability,
// datacenters, stock): a mismatch there means this version can no longer work.
// "Display" schemas cover specs and prices: a mismatch there only blanks the value.

export const catalogRootSchema = z.object({
  locale: z.object({
    currencyCode: z.string(),
    taxRate: z.number(),
  }),
  plans: z.array(z.unknown()),
  products: z.array(z.unknown()),
});

export const planCriticalSchema = z.object({
  planCode: z.string(),
  // Display only: a missing name falls back to the plan code, a missing product to no specs.
  invoiceName: z.string().optional().catch(undefined),
  product: z.string().optional().catch(undefined),
  configurations: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.string()).nullable(),
    }),
  ),
  blobs: z
    .object({ tags: z.array(z.string()).optional() })
    .nullable()
    .optional(),
});

export const planPricingsSchema = z.array(
  z.object({
    mode: z.string(),
    capacities: z.array(z.string()),
    interval: z.number(),
    price: z.number(),
    tax: z.number(),
  }),
);

export const productSchema = z.object({
  name: z.string(),
  blobs: z
    .object({
      technical: z
        .object({
          cpu: z.object({ cores: z.number() }).optional(),
          memory: z.object({ size: z.number() }).optional(),
          storage: z.object({ disks: z.array(z.object({ capacity: z.number() })) }).optional(),
        })
        .optional(),
      meta: z
        .object({
          configurations: z.array(
            z.object({
              name: z.string(),
              values: z.array(
                z.object({
                  value: z.string(),
                  blobs: z.object({
                    technical: z.object({
                      datacenter: z.object({ city: z.string(), country: z.string() }).optional(),
                    }),
                  }),
                }),
              ),
            }),
          ),
        })
        .optional(),
    })
    .nullable()
    .optional(),
});

export const availabilitySchema = z.object({
  datacenters: z.array(
    z.object({
      datacenter: z.string(),
      // Kept as plain strings: unknown values are only a problem for the OS being monitored.
      linuxStatus: z.string(),
      windowsStatus: z.string(),
    }),
  ),
});

export type AvailabilityResponse = z.infer<typeof availabilitySchema>;
