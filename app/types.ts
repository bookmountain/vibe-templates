export interface InventoryRow {
  template: string;
  variant: string;
  page: string;
  archive: string | null;
}

export interface TemplateMetadata {
  demo: string;
  media: { webp: string };
}

export type FeatureFlags = Record<'oauth' | 'membership' | 'payments' | 'pro', boolean>;

export interface CatalogProvider {
  features: FeatureFlags;
  source: string;
  demo: string;
  label: string;
}

export interface Variant {
  id: string;
  archiveAvailable: boolean;
  origin: string | null;
}

export type Library = Record<string, Variant[]>;
