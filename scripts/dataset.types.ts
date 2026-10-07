/**
 * Full shape of the OVHcloud VPS public catalog (scripts/dataset.json), for reference.
 * The app only validates the fields it uses: see src/ovh/schemas.ts.
 *
 * Notes:
 * - Prices (`price`, `tax`, `discount.value`, ...) are integers in 1e-8 currency units:
 *   299000000 => 2.99.
 * - Fields marked `?` are missing from some of the elements in the dataset.
 */
export type OvhCatalog = {
  catalogId: number;
  locale: {
    currencyCode: string; // "EUR"
    subsidiary: string; // "IT"
    taxRate: number; // 22
  };

  plans: {
    planCode: string;
    invoiceName: string;
    addonFamilies: {
      name: string; // "os" | "additionalDisk" | "cpanel" | "plesk" | "automatedBackup" | "snapshot" | "ftpbackup" | "storage"
      exclusive: boolean;
      mandatory: boolean;
      addons: string[]; // planCode of `addons[]`
      default: string | null;
    }[];
    product: string; // name of `products[]`
    pricingType: "rental";
    consumptionConfiguration: null;
    pricings: OvhCatalog["addons"][number]["pricings"];
    configurations: {
      name: string; // "vps_datacenter" | "vps_os" | "infrastructure" | "region" | "vps_install_rtm"
      isCustom: boolean;
      isMandatory: boolean;
      values: string[];
    }[];
    family: string | null;
    blobs: {
      commercial: {
        features: { name: string; value: string }[];
        line: string;
        range: string;
        brick?: string;
        brickSubtype?: string;
      };
      tags?: string[];
    } | null;
  }[];

  products: {
    name: string;
    description: string;
    blobs: {
      technical: {
        storage?: {
          disks: {
            capacity: number; // GB
            interface?: "NVMe" | "SATA";
            technology?: "SSD";
          }[];
        };
        license?: {
          edition: string;
          nbOfAccount?: number;
        };
        cpu?: {
          type: "vCore";
          brand: string; // "Intel" | "AMD" | " "
          cores: number;
          model: string; // "Xeon" | "EPYC" | " "
        };
        memory?: {
          size: number; // GB
        };
        bandwidth?: {
          level: number; // Mbps
          unlimited: boolean;
        };
        virtualization?: {
          hypervisor: string; // "KVM OpenStack"
        };
      };
      meta?: {
        configurations: {
          name: "vps_os" | "vps_datacenter";
          values: {
            value: string;
            blobs: {
              commercial?: {
                brick: string;
                brickSubtype: string;
                name: string;
              };
              tags?: string[];
              technical: {
                os?: {
                  family: string;
                  version?: string;
                  edition?: string;
                  distribution?: string;
                };
                datacenter?: {
                  city: string;
                  country: string;
                };
              };
            };
          }[];
        }[];
      };
    } | null;
    configurations: {
      name: string; // "ip" | "vps_backup_id" | "vps_backup_region" | "vps_password_hash"
      isCustom: boolean;
      isMandatory: boolean;
      values: string[] | null;
    }[];
  }[];

  addons: {
    planCode: string;
    invoiceName: string;
    addonFamilies: {
      name: string; // "domain" | "antivirus" | "languages-pack"
      exclusive: boolean;
      mandatory: boolean;
      addons: string[];
      default: string | null;
    }[];
    product: string;
    pricingType: "rental";
    consumptionConfiguration: null;
    pricings: {
      phase: number;
      capacities: ("installation" | "renew" | "upgrade")[];
      commitment: number; // months: 0 | 6 | 12 | 24
      description: string;
      interval: number;
      intervalUnit: "month" | "none";
      quantity: { min: number; max: number | null };
      repeat: { min: number; max: number | null };
      price: number;
      formattedPrice: string; // "€ 2.99"
      tax: number;
      mode: "default" | "upfront6" | "upfront12" | "upfront24" | "degressivity12" | "degressivity24";
      strategy: "tiered";
      mustBeCompleted: boolean;
      type: "rental";
      promotions: {
        name: string;
        description: string;
        type: string; // "percentage"
        value: number;
        context: string;
        discount: { value: number; formattedValue: string; tax: number };
        total: { value: number; formattedValue: string; tax: number };
        formattedValue: string;
        duration: number | null;
        minimumDuration: number;
        startDate: string; // ISO 8601
        endDate: string | null;
        quantity: number | null;
        globalQuantity: number | null;
        isGlobalQuantityLimited: boolean;
        isForTestingPurpose: boolean;
        customFieldValues: unknown[];
        tags: string[] | null;
      }[];
      engagementConfiguration: {
        defaultEndAction: string; // "REACTIVATE_ENGAGEMENT"
        duration: string; // ISO 8601: "P6M" | "P12M" | "P24M"
        type: "upfront" | "periodic";
      } | null;
    }[];
    configurations: {
      name: string; // "region"
      isCustom: boolean;
      isMandatory: boolean;
      values: string[];
    }[];
    family: string | null;
    blobs: {
      commercial: {
        brick: string;
        brickSubtype: string;
        name: string;
      };
      tags?: string[];
      technical?: {
        license: {
          images: string[];
          edition?: string;
        };
      };
    } | null;
  }[];

  planFamilies: {
    name: string;
  }[];
};
