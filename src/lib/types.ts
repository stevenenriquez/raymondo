export type Discipline = 'graphic' | '3d';
export type ProjectStatus = 'draft' | 'published';
export type AssetKind = 'image' | 'model3d' | 'poster';
export type StyleTemplate = 'editorial' | 'brutalist' | 'minimal-grid';

export interface Asset {
  id: string;
  projectId: string;
  kind: AssetKind;
  r2Key: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string;
  caption: string;
  featured: boolean;
  sortOrder: number;
  url: string;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  discipline: Discipline;
  coverAssetId: string | null;
  descriptionShort: string;
  descriptionLong: string;
  themeInspiration: string;
  styleDirection: string;
  styleTemplate: StyleTemplate;
  typographyNotes: string;
  motifSummary: string;
  toolingNotes: string;
  materialNotes: string;
  palette: string[];
  tags: string[];
  status: ProjectStatus;
  publishedAt: string | null;
  sortOrder: number;
  year: number | null;
  assets: Asset[];
}

export interface SiteContent {
  heroTitle: string;
  heroSubtitle: string;
  footerText: string;
}

export interface Catalog {
  generatedAt: string;
  site: SiteContent;
  projects: Project[];
}

export interface PublishReadiness {
  canPublish: boolean;
  hardMissing: string[];
  softMissing: string[];
  discipline: Discipline;
}

export interface AdminProjectSummary {
  id: string;
  slug: string;
  title: string;
  discipline: Discipline;
  status: ProjectStatus;
  sortOrder: number;
  readiness: PublishReadiness;
}

export interface AdminProject extends Project {
  readiness: PublishReadiness;
}
