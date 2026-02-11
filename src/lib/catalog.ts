import type { Catalog, Project, Asset, SiteContent } from './types';
import catalogData from '../data/catalog.generated.json';

const catalog = catalogData as Catalog;
const defaultSiteContent: SiteContent = {
  heroTitle: 'Graphic Design and 3D Worlds',
  heroSubtitle:
    'Raymondo builds identities, editorial systems, and 3D forms with a tactile visual language. Each project page includes theme inspiration, design DNA, and process cues.',
  footerText: 'Available for identity, visual systems, and 3D direction work.\nraymondartguy@gmail.com'
};

function sortAssets(assets: Asset[]) {
  return [...assets].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getCatalog(): Catalog {
  const site = {
    heroTitle: String(catalog?.site?.heroTitle || defaultSiteContent.heroTitle),
    heroSubtitle: String(catalog?.site?.heroSubtitle || defaultSiteContent.heroSubtitle),
    footerText: String(catalog?.site?.footerText || defaultSiteContent.footerText)
  };

  return {
    ...catalog,
    site,
    projects: catalog.projects
      .map((project) => ({ ...project, assets: sortAssets(project.assets) }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  };
}

export function getSiteContent(): SiteContent {
  return getCatalog().site;
}

export function getPublishedProjects(): Project[] {
  return getCatalog().projects.filter((project) => project.status === 'published');
}

export function getProjectBySlug(slug: string): Project | undefined {
  return getPublishedProjects().find((project) => project.slug === slug);
}

export function getCoverAsset(project: Project): Asset | undefined {
  const byId = project.coverAssetId
    ? project.assets.find((asset) => asset.id === project.coverAssetId)
    : undefined;
  if (byId) return byId;
  return project.assets.find((asset) => asset.featured) ?? project.assets[0];
}

export function getAssetGroup(project: Project, kind: Asset['kind']): Asset[] {
  return project.assets.filter((asset) => asset.kind === kind);
}
