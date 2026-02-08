import { listPublishedProjectsWithAssets } from './db';

function getProjectCoverAsset(project) {
  return project.assets.find((asset) => asset.id === project.coverAssetId) || project.assets[0] || null;
}

export function computeProjectReadiness(project) {
  const hardMissing = [];
  const coverAsset = getProjectCoverAsset(project);

  if (!coverAsset) {
    hardMissing.push('Add at least one asset so a cover is available.');
  }

  return {
    canPublish: hardMissing.length === 0,
    hardMissing,
    softMissing: [],
    discipline: project.discipline
  };
}

export async function buildPublishedCatalog(env) {
  const publicAssetBaseUrl = env.ASSET_PUBLIC_BASE_URL || '';
  const projects = await listPublishedProjectsWithAssets(env.PORTFOLIO_DB, publicAssetBaseUrl);

  const errors = [];
  const catalogProjects = [];
  const readinessByProject = [];

  for (const project of projects) {
    const coverAsset = getProjectCoverAsset(project);
    const readiness = computeProjectReadiness(project);

    readinessByProject.push({
      projectId: project.id,
      title: project.title,
      status: project.status,
      ...readiness
    });

    if (!readiness.canPublish) {
      errors.push(
        `${project.title}: ${readiness.hardMissing.join(' ')}`
      );
    }

    catalogProjects.push({
      ...project,
      coverAssetId: coverAsset?.id || null,
      assets: project.assets
    });
  }

  return {
    errors,
    readinessByProject,
    snapshot: {
      generatedAt: new Date().toISOString(),
      projects: catalogProjects
    }
  };
}
