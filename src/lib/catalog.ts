import type { Catalog, Project, Asset } from './types';
import catalogData from '../data/catalog.generated.json';

const catalog = catalogData as Catalog;

function sortAssets(assets: Asset[]) {
  return [...assets].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getCatalog(): Catalog {
  return {
    ...catalog,
    projects: catalog.projects
      .map((project) => ({ ...project, assets: sortAssets(project.assets) }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  };
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
