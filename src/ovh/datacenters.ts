export type Datacenter = {
  code: string;
  city: string;
  countryCode: string;
  localZone: boolean;
};

const COUNTRY_CODES: Record<string, string> = {
  Australia: "AU",
  Belgium: "BE",
  Canada: "CA",
  France: "FR",
  Germany: "DE",
  India: "IN",
  Italy: "IT",
  Netherlands: "NL",
  Poland: "PL",
  Singapore: "SG",
  Spain: "ES",
  "United Kingdom": "GB",
  "United States": "US",
};

// Local Zones are missing from the catalog metadata. The code ends with an airport-like city code.
const LOCAL_ZONES: Record<string, { city: string; countryCode: string }> = {
  AMS: { city: "Amsterdam", countryCode: "NL" },
  BRU: { city: "Brussels", countryCode: "BE" },
  MAD: { city: "Madrid", countryCode: "ES" },
  MRS: { city: "Marseille", countryCode: "FR" },
  PRG: { city: "Prague", countryCode: "CZ" },
  VIE: { city: "Vienna", countryCode: "AT" },
  ZRH: { city: "Zurich", countryCode: "CH" },
  ATL: { city: "Atlanta", countryCode: "US" },
  DAL: { city: "Dallas", countryCode: "US" },
  DEN: { city: "Denver", countryCode: "US" },
  LAX: { city: "Los Angeles", countryCode: "US" },
  MIA: { city: "Miami", countryCode: "US" },
  NYC: { city: "New York", countryCode: "US" },
  PAO: { city: "Palo Alto", countryCode: "US" },
  SEA: { city: "Seattle", countryCode: "US" },
};

/** Builds a datacenter from the catalog metadata, or from the code alone when there's none. */
export function resolveDatacenter(code: string, meta?: { city: string; country: string }): Datacenter {
  const localZone = /-LZ-/.test(code);
  if (meta) {
    return { code, city: meta.city, countryCode: COUNTRY_CODES[meta.country] ?? meta.country, localZone };
  }
  const known = localZone ? LOCAL_ZONES[code.split("-").at(-1)!] : undefined;
  return { code, city: known?.city ?? code, countryCode: known?.countryCode ?? "??", localZone };
}

export function datacenterLabel(dc: Datacenter): string {
  if (dc.city === dc.code) return dc.code;
  return `${dc.city}${dc.localZone ? " LZ" : ""} (${dc.countryCode})`;
}
