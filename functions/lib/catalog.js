import { listPublishedProjectsWithAssets } from './db';

function hasRequiredGraphicFields(project, coverAsset, imageAssets) {
  return Boolean(
    coverAsset &&
      imageAssets.length > 0 &&
      project.descriptionLong &&
      project.themeInspiration &&
      project.styleDirection
  );
}

function hasRequired3dFields(project, coverAsset, modelAsset) {
  return Boolean(coverAsset && modelAsset && project.descriptionLong);
}

export async function buildPublishedCatalog(env) {
  const publicAssetBaseUrl = env.ASSET_PUBLIC_BASE_URL || '';
  const projects = await listPublishedProjectsWithAssets(env.PORTFOLIO_DB, publicAssetBaseUrl);

  const errors = [];
  const catalogProjects = [];

  for (const project of projects) {
    const coverAsset = project.assets.find((asset) => asset.id === project.coverAssetId) || project.assets[0];
    const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
    const modelAsset = project.assets.find((asset) => asset.kind === 'model3d');

    if (project.discipline === 'graphic') {
      if (!hasRequiredGraphicFields(project, coverAsset, imageAssets)) {
        errors.push(`Graphic project \"${project.title}\" is missing required content for publish.`);
      }
    }

    if (project.discipline === '3d') {
      if (!hasRequired3dFields(project, coverAsset, modelAsset)) {
        errors.push(`3D project \"${project.title}\" is missing required content for publish.`);
      }
    }

    catalogProjects.push({
      ...project,
      coverAssetId: coverAsset?.id || null,
      assets: project.assets
    });
  }

  return {
    errors,
    snapshot: {
      generatedAt: new Date().toISOString(),
      projects: catalogProjects
    }
  };
}
