export type Subsidiary = {
  code: string;
  name: string;
  /** API host: each one only accepts its own subsidiaries. */
  apiHost: string;
  /** VPS page of the subsidiary's website, linked from notifications. */
  orderUrl: string;
};

const EU = "eu.api.ovh.com";
const CA = "ca.api.ovh.com";
const US = "api.us.ovhcloud.com";
const site = (locale: string) => `https://www.ovhcloud.com/${locale}/vps/`;

// Verified one by one against the catalog API and the website.
// CZ, FI and LT are accepted by the API but silently answer with the IE catalog, so they're left out.
export const SUBSIDIARIES: readonly Subsidiary[] = [
  { code: "IT", name: "Italy", apiHost: EU, orderUrl: site("it") },
  { code: "FR", name: "France", apiHost: EU, orderUrl: site("fr") },
  { code: "DE", name: "Germany", apiHost: EU, orderUrl: site("de") },
  { code: "ES", name: "Spain", apiHost: EU, orderUrl: site("es-es") },
  { code: "GB", name: "United Kingdom", apiHost: EU, orderUrl: site("en-gb") },
  { code: "IE", name: "Ireland", apiHost: EU, orderUrl: site("en-ie") },
  { code: "NL", name: "Netherlands", apiHost: EU, orderUrl: site("nl") },
  { code: "PL", name: "Poland", apiHost: EU, orderUrl: site("pl") },
  { code: "PT", name: "Portugal", apiHost: EU, orderUrl: site("pt") },
  { code: "MA", name: "Morocco", apiHost: EU, orderUrl: site("fr-ma") },
  { code: "SN", name: "Senegal", apiHost: EU, orderUrl: site("fr-sn") },
  { code: "TN", name: "Tunisia", apiHost: EU, orderUrl: site("fr-tn") },
  { code: "CA", name: "Canada (English)", apiHost: CA, orderUrl: site("en-ca") },
  { code: "QC", name: "Canada (Québec)", apiHost: CA, orderUrl: site("fr-ca") },
  { code: "AU", name: "Australia", apiHost: CA, orderUrl: site("en-au") },
  { code: "SG", name: "Singapore", apiHost: CA, orderUrl: site("en-sg") },
  { code: "IN", name: "India", apiHost: CA, orderUrl: site("en-in") },
  { code: "ASIA", name: "Asia", apiHost: CA, orderUrl: site("asia") },
  { code: "WE", name: "World (English)", apiHost: CA, orderUrl: site("en") },
  { code: "WS", name: "World (Spanish)", apiHost: CA, orderUrl: site("es") },
  { code: "US", name: "United States", apiHost: US, orderUrl: "https://us.ovhcloud.com/vps/" },
];

export function getSubsidiary(code: string): Subsidiary {
  const subsidiary = SUBSIDIARIES.find((s) => s.code === code);
  if (!subsidiary) throw new Error(`Unknown subsidiary "${code}"`);
  return subsidiary;
}
