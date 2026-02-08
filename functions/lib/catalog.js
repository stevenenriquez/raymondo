import { listPublishedProjectsWithAssets } from './db';

function hasText(value) {
  return Boolean(String(value || '').trim());
}

function getProjectCoverAsset(project) {
  return project.assets.find((asset) => asset.id === project.coverAssetId) || project.assets[0] || null;
}

export function computeProjectReadiness(project) {
  const hardMissing = [];
  const softMissing = [];

  const coverAsset = getProjectCoverAsset(project);
  const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
  const modelAsset = project.assets.find((asset) => asset.kind === 'model3d');
  const posterAsset = project.assets.find((asset) => asset.kind === 'poster');

  if (!hasText(project.descriptionShort)) {
    hardMissing.push('Add a short description.');
  }

  if (!hasText(project.descriptionLong)) {
    hardMissing.push('Add a long description.');
  }

  if (!coverAsset) {
    hardMissing.push('Add at least one cover-ready asset.');
  }

  if (project.discipline === 'graphic') {
    if (imageAssets.length === 0) {
      hardMissing.push('Upload at least one image asset.');
    }

    if (!hasText(project.themeInspiration)) {
      hardMissing.push('Add Inspiration & Theme notes.');
    }

    if (!hasText(project.styleDirection)) {
      hardMissing.push('Add Design DNA notes.');
    }
  }

  if (project.discipline === '3d') {
    if (!modelAsset) {
      hardMissing.push('Upload at least one 3D model asset.');
    }

    if (!posterAsset && !coverAsset) {
      hardMissing.push('Add a poster or cover visual for 3D preview.');
    }
  }

  if (!project.year) {
    softMissing.push('Year is not set.');
  }

  if (!project.tags || project.tags.length === 0) {
    softMissing.push('Tags are empty.');
  }

  if (!project.palette || project.palette.length === 0) {
    softMissing.push('Palette is empty.');
  }

  if (!hasText(project.typographyNotes)) {
    softMissing.push('Typography notes are empty.');
  }

  if (!hasText(project.motifSummary)) {
    softMissing.push('Motif summary is empty.');
  }

  if (!hasText(project.toolingNotes)) {
    softMissing.push('Tooling notes are empty.');
  }

  if (!hasText(project.materialNotes)) {
    softMissing.push('Material notes are empty.');
  }

  return {
    canPublish: hardMissing.length === 0,
    hardMissing,
    softMissing,
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
