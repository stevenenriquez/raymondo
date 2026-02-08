/**
 * @typedef {'graphic'|'3d'} Discipline
 * @typedef {'draft'|'published'} ProjectStatus
 * @typedef {'image'|'poster'|'model3d'} AssetKind
 *
 * @typedef {Object} PublishReadiness
 * @property {boolean} canPublish
 * @property {string[]} hardMissing
 * @property {string[]} softMissing
 * @property {Discipline} discipline
 *
 * @typedef {Object} Asset
 * @property {string} id
 * @property {string} projectId
 * @property {AssetKind} kind
 * @property {string} r2Key
 * @property {string} mimeType
 * @property {number|null} width
 * @property {number|null} height
 * @property {string} altText
 * @property {string} caption
 * @property {boolean} featured
 * @property {number} sortOrder
 * @property {string} url
 *
 * @typedef {Object} AdminProject
 * @property {string} id
 * @property {string} slug
 * @property {string} title
 * @property {Discipline} discipline
 * @property {ProjectStatus} status
 * @property {number} sortOrder
 * @property {number|null} year
 * @property {string[]} tags
 * @property {string[]} palette
 * @property {string} styleTemplate
 * @property {string} descriptionShort
 * @property {string} descriptionLong
 * @property {string} themeInspiration
 * @property {string} styleDirection
 * @property {string} typographyNotes
 * @property {string} motifSummary
 * @property {string} toolingNotes
 * @property {string} materialNotes
 * @property {string|null} coverAssetId
 * @property {Asset[]} assets
 * @property {PublishReadiness} readiness
 */

const state = {
  /** @type {AdminProject[]} */
  projects: [],
  activeId: null,
  /** @type {AdminProject|null} */
  activeProject: null,
  projectFilter: 'all',
  projectSearch: '',
  saveState: 'saved',
  saveStateText: 'Saved',
  isSaving: false,
  autosaveTimer: null,
  queuedSave: null,
  isPopulating: false,
  hasDirtyChanges: false,
  lastSavedFingerprint: '',
  dragProjectId: null,
  selectedProjectIds: new Set(),
  selectedAssetId: null,
  dragAssetId: null,
  /** @type {Map<string, object>} */
  assetDrafts: new Map(),
  uploadQueue: [],
  lastPreflight: null
};

const els = {
  projectList: document.getElementById('projectList'),
  projectSearch: document.getElementById('projectSearch'),
  filterBar: document.getElementById('projectFilterBar'),
  form: document.getElementById('projectForm'),
  feedback: document.getElementById('feedback'),
  newGraphicBtn: document.getElementById('newGraphicBtn'),
  new3dBtn: document.getElementById('new3dBtn'),
  bulkPublishBtn: document.getElementById('bulkPublishBtn'),
  saveNowBtn: document.getElementById('saveNowBtn'),
  previewBtn: document.getElementById('previewBtn'),
  publishBtn: document.getElementById('publishBtn'),
  unpublishBtn: document.getElementById('unpublishBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  activeProjectLabel: document.getElementById('activeProjectLabel'),
  projectStatusBadge: document.getElementById('projectStatusBadge'),
  saveStateChip: document.getElementById('saveStateChip'),
  palettePreview: document.getElementById('palettePreview'),
  hardMissingList: document.getElementById('hardMissingList'),
  softMissingList: document.getElementById('softMissingList'),
  preflightSummary: document.getElementById('preflightSummary'),
  preflightDialog: document.getElementById('preflightDialog'),
  preflightDialogIntro: document.getElementById('preflightDialogIntro'),
  preflightConfirmBtn: document.getElementById('preflightConfirmBtn'),
  preflightCancelBtn: document.getElementById('preflightCancelBtn'),
  modalHardList: document.getElementById('modalHardList'),
  modalGlobalList: document.getElementById('modalGlobalList'),
  previewDialog: document.getElementById('previewDialog'),
  previewDialogIntro: document.getElementById('previewDialogIntro'),
  previewDialogContent: document.getElementById('previewDialogContent'),
  previewCloseBtn: document.getElementById('previewCloseBtn'),
  previewOpenRouteBtn: document.getElementById('previewOpenRouteBtn'),
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  uploadStatus: document.getElementById('uploadStatus'),
  assetList: document.getElementById('assetList'),
  assetsSection: document.getElementById('assetsSection'),
  mobileSaveBtn: document.getElementById('mobileSaveBtn'),
  mobilePreviewBtn: document.getElementById('mobilePreviewBtn'),
  mobilePublishBtn: document.getElementById('mobilePublishBtn'),
  mobileAssetsBtn: document.getElementById('mobileAssetsBtn')
};

const MODEL_FILE_EXTENSIONS = ['.glb', '.gltf'];
const CURRENT_YEAR = new Date().getFullYear();

function setFeedback(type, text) {
  els.feedback.innerHTML = `<p class="feedback ${type}">${escapeHtml(text)}</p>`;
}

function clearFeedback() {
  els.feedback.innerHTML = '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let payload = {};

  if (text) {
    const looksLikeJson = contentType.includes('application/json') || text.trim().startsWith('{');

    if (looksLikeJson) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from ${path} (status ${response.status}).`);
      }
    }
  }

  if (!response.ok) {
    const apiMessage = payload && typeof payload === 'object' ? payload.error : null;
    if (apiMessage) {
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(`${apiMessage} ${payload.errors.join(' | ')}`);
      }
      throw new Error(apiMessage);
    }

    if (text.trim().startsWith('<')) {
      throw new Error(
        `Expected JSON from ${path}, but received HTML (status ${response.status}). If running locally, start with "npm run dev:cloudflare" instead of Astro-only dev.`
      );
    }

    throw new Error(`Request failed with status ${response.status}.`);
  }

  if (!contentType.includes('application/json') && text.trim().startsWith('<')) {
    throw new Error(
      `Expected JSON from ${path}, but received HTML. If running locally, use "npm run dev:cloudflare" to run Cloudflare Pages Functions.`
    );
  }

  return payload;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeCommaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseOptionalNumber(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function resolveYearValue(value) {
  if (value === null || value === undefined || value === '') return CURRENT_YEAR;
  const num = Number(value);
  return Number.isFinite(num) ? num : CURRENT_YEAR;
}

function field(name) {
  return els.form.elements.namedItem(name);
}

function readField(name) {
  const entry = field(name);
  return entry && 'value' in entry ? String(entry.value) : '';
}

function writeField(name, value) {
  const entry = field(name);
  if (entry && 'value' in entry) {
    entry.value = value ?? '';
  }
}

function sanitizeSwatchColor(value) {
  const token = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(token)) return token;
  if (/^(rgb|rgba|hsl|hsla)\([^)]{1,40}\)$/.test(token)) return token;
  if (/^[a-zA-Z]{3,20}$/.test(token)) return token;
  return null;
}

function getStatusClass(status) {
  return status === 'published' ? 'published' : 'draft';
}

function setSaveState(nextState, textOverride) {
  state.saveState = nextState;

  const copy =
    textOverride ||
    {
      saved: 'Saved',
      saving: 'Saving...',
      unsaved: 'Unsaved changes',
      error: 'Save failed'
    }[nextState] || 'Saved';

  state.saveStateText = copy;
  els.saveStateChip.textContent = copy;
  els.saveStateChip.classList.remove('saved', 'saving', 'unsaved', 'error');
  els.saveStateChip.classList.add(nextState);
}

function projectPayloadFromForm(statusOverride) {
  return {
    id: readField('id') || undefined,
    slug: normalizeSpaces(readField('slug')),
    title: normalizeSpaces(readField('title')),
    discipline: readField('discipline') || 'graphic',
    status: statusOverride || state.activeProject?.status || 'draft',
    year: parseOptionalNumber(readField('year')),
    sortOrder: Number(state.activeProject?.sortOrder ?? 0),
    styleTemplate: readField('styleTemplate') || 'editorial',
    descriptionShort: String(readField('descriptionShort') || '').trim(),
    descriptionLong: String(readField('descriptionLong') || '').trim(),
    themeInspiration: String(readField('themeInspiration') || '').trim(),
    styleDirection: String(readField('styleDirection') || '').trim(),
    typographyNotes: String(readField('typographyNotes') || '').trim(),
    motifSummary: String(readField('motifSummary') || '').trim(),
    toolingNotes: String(readField('toolingNotes') || '').trim(),
    materialNotes: String(readField('materialNotes') || '').trim(),
    palette: normalizeCommaList(readField('palette')),
    tags: normalizeCommaList(readField('tags'))
  };
}

function getPreviewAssets(project) {
  return [...(project.assets || [])]
    .map((asset) => ({
      ...asset,
      ...(state.assetDrafts.get(asset.id) || {})
    }))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function getPreviewCoverAsset(project) {
  const byId = project.coverAssetId
    ? project.assets.find((asset) => asset.id === project.coverAssetId)
    : null;

  if (byId) return byId;
  return project.assets.find((asset) => asset.featured) || project.assets[0] || null;
}

function getDraftPreviewProject() {
  if (!state.activeProject) return null;

  const payload = projectPayloadFromForm();
  const assets = getPreviewAssets(state.activeProject);

  return {
    ...state.activeProject,
    ...payload,
    assets
  };
}

function previewText(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function renderPreviewPalette(colors) {
  const safeColors = (colors || [])
    .map((token) => sanitizeSwatchColor(token))
    .filter(Boolean);

  if (safeColors.length === 0) {
    return '<p>No palette colors set.</p>';
  }

  return safeColors
    .map((color) => `<span class="swatch" style="background:${escapeHtml(color)}" title="${escapeHtml(color)}"></span>`)
    .join('');
}

function buildProjectPreviewMarkup(project) {
  const cover = getPreviewCoverAsset(project);
  const imageAssets = project.assets.filter((asset) => asset.kind === 'image');
  const modelAsset = project.assets.find((asset) => asset.kind === 'model3d');
  const posterAsset = project.assets.find((asset) => asset.kind === 'poster') || cover;
  const moodboard = imageAssets.filter((asset) => !cover || asset.id !== cover.id);
  const templateClass = `template-${project.styleTemplate || 'editorial'}`;
  const tags = (project.tags || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
  const yearTag = project.year ? `<span class="tag">${escapeHtml(project.year)}</span>` : '';

  let mediaMarkup = '<div style="height:100%;display:grid;place-items:center;min-height:420px;">No media published yet.</div>';

  if (project.discipline === '3d' && modelAsset) {
    const posterAttr = posterAsset ? ` poster="${escapeHtml(posterAsset.url)}"` : '';
    mediaMarkup = `
      <model-viewer
        src="${escapeHtml(modelAsset.url)}"
        ${posterAttr}
        alt="${escapeHtml(modelAsset.altText || project.title)}"
        camera-controls
        auto-rotate
        shadow-intensity="1"
        interaction-prompt="auto"
        style="width:100%;height:100%;min-height:420px;background:#111"
      ></model-viewer>
    `;
  } else if (cover) {
    mediaMarkup = `<img src="${escapeHtml(cover.url)}" alt="${escapeHtml(cover.altText || project.title)}" />`;
  }

  const moodboardMarkup =
    moodboard.length > 0
      ? `
      <section>
        <h2 style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.08em;text-transform:uppercase;margin:1.2rem 0 0.7rem;">
          Moodboard / Supporting Frames
        </h2>
        <div class="moodboard">
          ${moodboard
            .map(
              (asset) => `
            <figure>
              <img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.altText || `${project.title} supporting visual`)}" loading="lazy" />
              ${asset.caption ? `<figcaption>${escapeHtml(asset.caption)}</figcaption>` : ''}
            </figure>
          `
            )
            .join('')}
        </div>
      </section>
    `
      : '';

  return `
    <main class="project-shell ${templateClass}">
      <header class="site-header">
        <h1 class="brand"><a href="#" style="text-decoration:none;">Raymondo</a></h1>
        <nav class="site-nav">
          <a href="#">Back to Work</a>
          <a href="#">Contact</a>
        </nav>
      </header>

      <section class="project-hero">
        <p class="tag-row">
          <span class="tag">${project.discipline === '3d' ? '3D Project' : 'Graphic Project'}</span>
          ${yearTag}
          ${tags}
        </p>
        <h1>${escapeHtml(project.title || 'Untitled Project')}</h1>
        <p>${escapeHtml(previewText(project.descriptionLong, project.descriptionShort || 'No description yet.'))}</p>
      </section>

      <section class="project-layout">
        <article class="project-main">
          <div class="media-stage">
            ${mediaMarkup}
          </div>
        </article>

        <aside class="project-panel">
          <div class="panel-block">
            <h3>Inspiration & Theme</h3>
            <p>${escapeHtml(previewText(project.themeInspiration, 'Add inspiration details in admin to enrich this section.'))}</p>
          </div>

          <div class="panel-block">
            <h3>Design DNA</h3>
            <p>${escapeHtml(previewText(project.styleDirection, 'No style direction notes yet.'))}</p>
          </div>

          <div class="panel-block">
            <h3>Typography Notes</h3>
            <p>${escapeHtml(previewText(project.typographyNotes, 'No typography notes yet.'))}</p>
          </div>

          <div class="panel-block">
            <h3>Motif Summary</h3>
            <p>${escapeHtml(previewText(project.motifSummary, 'No motif notes yet.'))}</p>
          </div>

          ${
            project.discipline === '3d'
              ? `
            <div class="panel-block">
              <h3>Tooling</h3>
              <p>${escapeHtml(previewText(project.toolingNotes, 'No tooling details yet.'))}</p>
            </div>
            <div class="panel-block">
              <h3>Material Notes</h3>
              <p>${escapeHtml(previewText(project.materialNotes, 'No material notes yet.'))}</p>
            </div>
          `
              : ''
          }

          <div class="panel-block">
            <h3>Palette</h3>
            <div class="palette">
              ${renderPreviewPalette(project.palette)}
            </div>
          </div>
        </aside>
      </section>

      ${moodboardMarkup}
    </main>
  `;
}

function payloadFingerprint(payload) {
  return JSON.stringify(payload);
}

function markDirty() {
  if (!state.activeProject || state.isPopulating) return;
  state.hasDirtyChanges = true;
  setSaveState('unsaved');
}

function scheduleAutosave(delay = 800) {
  if (!state.activeProject || state.isPopulating) return;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => {
    saveProject({ autosave: true }).catch((error) => {
      setFeedback('error', error.message);
    });
  }, delay);
}

function clearAutosaveTimer() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = null;
}

function syncThreeDFields() {
  const is3d = readField('discipline') === '3d';
  document.querySelectorAll('.three-d-only').forEach((node) => {
    node.hidden = !is3d;
  });
}

function renderPalettePreview() {
  const colors = normalizeCommaList(readField('palette'));
  els.palettePreview.innerHTML = '';

  if (colors.length === 0) {
    els.palettePreview.innerHTML = '<p class="notice">No palette colors set.</p>';
    return;
  }

  for (const token of colors) {
    const safeColor = sanitizeSwatchColor(token);
    if (!safeColor) continue;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = safeColor;
    swatch.title = safeColor;
    els.palettePreview.appendChild(swatch);
  }

  if (!els.palettePreview.children.length) {
    els.palettePreview.innerHTML = '<p class="notice">Use valid CSS colors for swatches.</p>';
  }
}

function setStatusBadge(status) {
  const resolved = getStatusClass(status);
  els.projectStatusBadge.textContent = resolved;
  els.projectStatusBadge.classList.remove('draft', 'published');
  els.projectStatusBadge.classList.add(resolved);
}

function updateToolbarState() {
  const project = state.activeProject;

  if (!project) {
    els.activeProjectLabel.textContent = 'No project selected';
    setStatusBadge('draft');
    els.deleteBtn.disabled = true;
    els.unpublishBtn.disabled = true;
    return;
  }

  els.activeProjectLabel.textContent = `${project.title || 'Untitled project'} (${project.slug || 'no-slug'})`;
  setStatusBadge(project.status);
  els.deleteBtn.disabled = project.status !== 'draft';
  els.unpublishBtn.disabled = project.status !== 'published';
}

function renderChecklist(listEl, items, emptyCopy) {
  listEl.innerHTML = '';

  if (!items || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'is-clear';
    li.textContent = emptyCopy;
    listEl.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    listEl.appendChild(li);
  }
}

function renderReadinessPanel() {
  const readiness = state.activeProject?.readiness;

  if (!readiness) {
    renderChecklist(els.hardMissingList, [], 'Select a project to see requirements.');
    renderChecklist(els.softMissingList, [], 'No quality warnings.');
    els.preflightSummary.textContent = '';
    return;
  }

  renderChecklist(els.hardMissingList, readiness.hardMissing, 'All hard requirements are complete.');
  renderChecklist(els.softMissingList, readiness.softMissing, 'No quality warnings.');

  if (readiness.canPublish) {
    els.preflightSummary.textContent = 'Current project is publish-ready.';
  } else {
    els.preflightSummary.textContent = `Current project has ${readiness.hardMissing.length} publish blocker(s).`;
  }
}

function projectReadinessClass(project) {
  if (!project.readiness) return 'blocked';
  return project.readiness.canPublish ? 'ready' : 'blocked';
}

function matchesProjectFilter(project) {
  const filter = state.projectFilter;

  if (filter === 'all') return true;
  if (filter === 'draft') return project.status === 'draft';
  if (filter === 'published') return project.status === 'published';
  if (filter === 'ready') return Boolean(project.readiness?.canPublish);
  if (filter === 'blocked') return !project.readiness?.canPublish;
  return true;
}

function matchesProjectSearch(project) {
  const query = state.projectSearch.trim().toLowerCase();
  if (!query) return true;

  const haystack = `${project.title} ${project.slug}`.toLowerCase();
  return haystack.includes(query);
}

function getSelectedDraftProjects() {
  return state.projects.filter((project) => project.status === 'draft' && state.selectedProjectIds.has(project.id));
}

function syncBulkPublishButton() {
  const selectedCount = getSelectedDraftProjects().length;
  els.bulkPublishBtn.textContent = `Publish Selected (${selectedCount})`;
  els.bulkPublishBtn.disabled = selectedCount === 0;
}

function pruneSelectedProjects() {
  const draftIds = new Set(state.projects.filter((project) => project.status === 'draft').map((project) => project.id));
  state.selectedProjectIds = new Set([...state.selectedProjectIds].filter((id) => draftIds.has(id)));
  syncBulkPublishButton();
}

function getProjectSortOrder(project) {
  const value = Number(project?.sortOrder ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function compareProjectsByOrder(a, b) {
  const orderDelta = getProjectSortOrder(a) - getProjectSortOrder(b);
  if (orderDelta !== 0) return orderDelta;

  const titleDelta = String(a?.title || '').localeCompare(String(b?.title || ''));
  if (titleDelta !== 0) return titleDelta;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function getSortedProjects(projects = state.projects) {
  return [...projects].sort(compareProjectsByOrder);
}

function canDragSortProjects() {
  return state.projectFilter === 'all' && !state.projectSearch.trim();
}

function getNextProjectSortOrder() {
  const sorted = getSortedProjects();
  if (sorted.length === 0) return 100;
  return getProjectSortOrder(sorted[sorted.length - 1]) + 100;
}

function clearProjectListDragState() {
  state.dragProjectId = null;
  els.projectList
    .querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after')
    .forEach((node) => node.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
}

function patchProjectSortOrders(sortMap) {
  if (!sortMap || sortMap.size === 0) return;

  state.projects = state.projects.map((project) =>
    sortMap.has(project.id)
      ? {
          ...project,
          sortOrder: sortMap.get(project.id)
        }
      : project
  );

  if (state.activeProject && sortMap.has(state.activeProject.id)) {
    state.activeProject = {
      ...state.activeProject,
      sortOrder: sortMap.get(state.activeProject.id)
    };
  }
}

async function persistProjectSortUpdates(updates) {
  for (const update of updates) {
    await api('/api/admin/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: update.id,
        sortOrder: update.sortOrder,
        autosave: true
      })
    });
  }
}

function getRebalancedProjectOrder(sortedProjects) {
  return sortedProjects.map((project, index) => ({
    id: project.id,
    sortOrder: (index + 1) * 100
  }));
}

async function reorderProjectByDrop(projectId, targetIndex) {
  const sorted = getSortedProjects();
  const moving = sorted.find((project) => project.id === projectId);
  if (!moving) return;

  const withoutMoving = sorted.filter((project) => project.id !== projectId);
  const boundedTargetIndex = Math.max(0, Math.min(targetIndex, withoutMoving.length));
  const prev = withoutMoving[boundedTargetIndex - 1] || null;
  const next = withoutMoving[boundedTargetIndex] || null;

  const reordered = [...withoutMoving];
  reordered.splice(boundedTargetIndex, 0, moving);

  let updates = [];
  if (!prev && !next) {
    updates = [{ id: projectId, sortOrder: 100 }];
  } else if (!prev) {
    updates = [{ id: projectId, sortOrder: getProjectSortOrder(next) - 100 }];
  } else if (!next) {
    updates = [{ id: projectId, sortOrder: getProjectSortOrder(prev) + 100 }];
  } else {
    const prevOrder = getProjectSortOrder(prev);
    const nextOrder = getProjectSortOrder(next);
    const gap = nextOrder - prevOrder;

    if (gap > 0.000001) {
      updates = [{ id: projectId, sortOrder: prevOrder + gap / 2 }];
    } else {
      updates = getRebalancedProjectOrder(reordered);
    }
  }

  if (updates.length === 0) return;

  setSaveState('saving', 'Reordering...');

  try {
    await persistProjectSortUpdates(updates);
    patchProjectSortOrders(new Map(updates.map((item) => [item.id, item.sortOrder])));
    renderProjectList();
    setSaveState('saved');
  } catch (error) {
    setSaveState('error');
    setFeedback('error', error.message);
    await loadProjects();
  }
}

function resolveDropTargetIndex(overItem, pointerY) {
  const ordered = getSortedProjects().filter((project) => matchesProjectFilter(project) && matchesProjectSearch(project));
  const draggedId = state.dragProjectId;
  const sourceIndex = ordered.findIndex((project) => project.id === draggedId);
  if (sourceIndex === -1) return { ordered, targetIndex: -1 };

  if (!overItem) {
    return { ordered, targetIndex: ordered.length - 1 };
  }

  const overId = overItem.dataset.projectId;
  const overIndex = ordered.findIndex((project) => project.id === overId);
  if (overIndex === -1) return { ordered, targetIndex: -1 };

  const rect = overItem.getBoundingClientRect();
  const isAfter = pointerY >= rect.top + rect.height / 2;
  let targetIndex = overIndex + (isAfter ? 1 : 0);

  if (sourceIndex < targetIndex && overItem) {
    targetIndex -= 1;
  }

  return { ordered, targetIndex };
}

function renderProjectList() {
  els.projectList.innerHTML = '';
  pruneSelectedProjects();

  const draggable = canDragSortProjects();
  const visible = getSortedProjects().filter((project) => matchesProjectFilter(project) && matchesProjectSearch(project));

  if (visible.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No projects match this filter.';
    els.projectList.appendChild(li);
    return;
  }

  for (const project of visible) {
    const li = document.createElement('li');
    li.dataset.projectId = project.id;
    li.className = 'admin-v2-project-item';
    li.draggable = draggable;
    if (draggable) {
      li.classList.add('is-draggable');
    }

    const rowTone = projectReadinessClass(project);
    const dragHandle = draggable ? '<span class="admin-v2-drag-handle" aria-hidden="true">::</span>' : '';
    const entry = document.createElement('div');
    entry.className = 'admin-v2-project-entry';

    const selectWrap = document.createElement('label');
    selectWrap.className = 'admin-v2-project-select-wrap';
    const selectInput = document.createElement('input');
    selectInput.type = 'checkbox';
    selectInput.className = 'admin-v2-project-select';
    selectInput.title = 'Select draft for bulk publish';
    selectInput.setAttribute('aria-label', `Select ${project.title || project.slug || 'project'} for bulk publish`);
    selectInput.disabled = project.status !== 'draft';
    selectInput.checked = project.status === 'draft' && state.selectedProjectIds.has(project.id);
    selectInput.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    selectInput.addEventListener('change', () => {
      if (selectInput.checked) {
        state.selectedProjectIds.add(project.id);
      } else {
        state.selectedProjectIds.delete(project.id);
      }
      syncBulkPublishButton();
    });
    selectWrap.appendChild(selectInput);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-row ${project.id === state.activeId ? 'active' : ''}`;
    button.innerHTML = `
      <div class="admin-v2-row-head">
        <strong>${escapeHtml(project.title)}</strong>
        <span class="status-pill ${escapeHtml(getStatusClass(project.status))}">${escapeHtml(project.status)}</span>
      </div>
      <div class="admin-v2-row-foot">
        <span>${dragHandle}/${escapeHtml(project.slug)}</span>
        <span class="admin-v2-readiness-pill ${rowTone}">${rowTone}</span>
      </div>
    `;

    button.addEventListener('click', () => {
      selectProject(project.id).catch((error) => setFeedback('error', error.message));
    });

    entry.appendChild(selectWrap);
    entry.appendChild(button);
    li.appendChild(entry);
    els.projectList.appendChild(li);
  }

  syncBulkPublishButton();
}

function updateFilterButtons() {
  const chips = Array.from(els.filterBar.querySelectorAll('button[data-filter]'));
  chips.forEach((chip) => {
    chip.setAttribute('aria-pressed', chip.dataset.filter === state.projectFilter ? 'true' : 'false');
  });
}

function populateForm(project) {
  state.isPopulating = true;

  writeField('id', project.id || '');
  writeField('slug', project.slug || '');
  writeField('title', project.title || '');
  writeField('discipline', project.discipline || 'graphic');
  writeField('year', resolveYearValue(project.year));
  writeField('styleTemplate', project.styleTemplate || 'editorial');
  writeField('descriptionShort', project.descriptionShort || '');
  writeField('descriptionLong', project.descriptionLong || '');
  writeField('themeInspiration', project.themeInspiration || '');
  writeField('styleDirection', project.styleDirection || '');
  writeField('typographyNotes', project.typographyNotes || '');
  writeField('motifSummary', project.motifSummary || '');
  writeField('toolingNotes', project.toolingNotes || '');
  writeField('materialNotes', project.materialNotes || '');
  writeField('palette', (project.palette || []).join(','));
  writeField('tags', (project.tags || []).join(','));

  syncThreeDFields();
  renderPalettePreview();
  updateToolbarState();
  renderReadinessPanel();

  const payload = projectPayloadFromForm();
  state.lastSavedFingerprint = payloadFingerprint(payload);
  state.hasDirtyChanges = false;
  setSaveState('saved');

  state.isPopulating = false;
}

function clearEditor() {
  state.activeId = null;
  state.activeProject = null;
  state.selectedAssetId = null;
  state.dragAssetId = null;
  state.assetDrafts = new Map();

  writeField('id', '');
  writeField('slug', '');
  writeField('title', '');
  writeField('discipline', 'graphic');
  writeField('year', CURRENT_YEAR);
  writeField('styleTemplate', 'editorial');
  writeField('descriptionShort', '');
  writeField('descriptionLong', '');
  writeField('themeInspiration', '');
  writeField('styleDirection', '');
  writeField('typographyNotes', '');
  writeField('motifSummary', '');
  writeField('toolingNotes', '');
  writeField('materialNotes', '');
  writeField('palette', '');
  writeField('tags', '');

  renderPalettePreview();
  syncThreeDFields();
  renderAssetEditors([]);
  clearUploadQueue();
  updateToolbarState();
  renderReadinessPanel();
  setSaveState('saved');
}

function syncActiveSummary() {
  if (!state.activeProject) return;
  const idx = state.projects.findIndex((item) => item.id === state.activeProject.id);
  if (idx === -1) return;

  state.projects[idx] = {
    ...state.projects[idx],
    id: state.activeProject.id,
    slug: state.activeProject.slug,
    title: state.activeProject.title,
    discipline: state.activeProject.discipline,
    status: state.activeProject.status,
    sortOrder: state.activeProject.sortOrder,
    readiness: state.activeProject.readiness
  };
}

async function loadProjects() {
  const payload = await api('/api/admin/projects');
  state.projects = payload.projects || [];

  if (state.projects.length === 0) {
    renderProjectList();
    clearEditor();
    return;
  }

  const currentExists = state.activeId && state.projects.some((project) => project.id === state.activeId);
  const nextId = currentExists ? state.activeId : state.projects[0].id;

  renderProjectList();
  await selectProject(nextId);
}

async function selectProject(id, options = {}) {
  clearAutosaveTimer();

  const payload = await api(`/api/admin/projects/${id}`);
  state.activeId = id;
  state.activeProject = payload.project;
  state.assetDrafts = new Map();

  populateForm(payload.project);
  renderAssetEditors(payload.project.assets || []);
  syncActiveSummary();

  if (!options.skipListRender) {
    renderProjectList();
  }
}

async function saveProject(options = {}) {
  if (!state.activeProject) return null;

  const { autosave = false, statusOverride, silent = false } = options;
  const payload = projectPayloadFromForm(statusOverride);
  if (!payload.slug) {
    state.hasDirtyChanges = true;
    if (autosave) {
      setSaveState('unsaved', 'Slug required');
      return state.activeProject;
    }
    setSaveState('error');
    if (!silent) {
      setFeedback('error', 'Slug is required.');
    }
    throw new Error('Slug is required.');
  }

  const nextFingerprint = payloadFingerprint(payload);
  if (autosave && !state.hasDirtyChanges && nextFingerprint === state.lastSavedFingerprint) {
    return state.activeProject;
  }

  if (state.isSaving) {
    state.queuedSave = options;
    return null;
  }

  state.isSaving = true;
  setSaveState('saving');

  try {
    const response = await api('/api/admin/projects', {
      method: 'POST',
      body: JSON.stringify({ ...payload, autosave })
    });

    if (!response.project) {
      throw new Error('Project save response is missing project data.');
    }

    state.activeProject = response.project;
    state.activeId = response.project.id;

    populateForm(response.project);
    renderAssetEditors(response.project.assets || []);
    syncActiveSummary();
    renderProjectList();

    if (!autosave && !silent) {
      setFeedback('success', 'Project saved.');
    }

    return response.project;
  } catch (error) {
    state.hasDirtyChanges = true;
    setSaveState('error');

    if (!silent || !autosave) {
      setFeedback('error', error.message);
    }

    throw error;
  } finally {
    state.isSaving = false;

    if (state.queuedSave) {
      const queued = state.queuedSave;
      state.queuedSave = null;
      setTimeout(() => {
        saveProject(queued).catch((error) => {
          setFeedback('error', error.message);
        });
      }, 0);
    }
  }
}

async function createProjectPreset(discipline) {
  clearFeedback();

  const now = Date.now();
  const suffix = discipline === '3d' ? '3d' : 'graphic';
  const payload = await api('/api/admin/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: discipline === '3d' ? 'New 3D Project' : 'New Graphic Project',
      slug: `new-${suffix}-${now}`,
      discipline,
      status: 'draft',
      year: CURRENT_YEAR,
      descriptionShort: '',
      descriptionLong: '',
      sortOrder: getNextProjectSortOrder(),
      palette: [],
      tags: []
    })
  });

  await loadProjects();
  await selectProject(payload.project.id);
  setFeedback('success', 'Project created. Start typing to autosave.');
}

async function deleteActiveDraftProject() {
  if (!state.activeProject || !state.activeId) {
    setFeedback('error', 'Select a project first.');
    return;
  }

  if (state.activeProject.status !== 'draft') {
    setFeedback('error', 'Only draft projects can be deleted.');
    return;
  }

  const confirmed = window.confirm(
    `Delete draft project "${state.activeProject.title}"? This removes associated assets and cannot be undone.`
  );

  if (!confirmed) return;

  clearFeedback();

  try {
    const payload = await api(`/api/admin/projects/${state.activeId}`, {
      method: 'DELETE',
      body: JSON.stringify({})
    });

    state.activeId = null;
    state.activeProject = null;

    await loadProjects();

    if (payload.warning) {
      setFeedback('warn', `Draft deleted. R2 warning: ${payload.warning}`);
    } else {
      setFeedback('success', 'Draft deleted.');
    }
  } catch (error) {
    setFeedback('error', error.message);
  }
}

function isModelFile(file) {
  const lowerName = String(file.name || '').toLowerCase();
  if (MODEL_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
  return String(file.type || '').startsWith('model/');
}

function inferAssetKind(file, discipline, existingAssets, queuedKinds = []) {
  if (isModelFile(file)) return 'model3d';

  if (discipline === '3d') {
    const hasPosterAlready = existingAssets.some((asset) => asset.kind === 'poster') || queuedKinds.includes('poster');
    if (!hasPosterAlready) return 'poster';
  }

  return 'image';
}

function inferMimeType(file) {
  if (file.type) return file.type;

  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.glb')) return 'model/gltf-binary';
  if (name.endsWith('.gltf')) return 'model/gltf+json';
  return 'application/octet-stream';
}

function humanizeFilename(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function clearUploadQueue() {
  state.uploadQueue = [];
  els.uploadStatus.textContent = '';
}

function renderUploadQueue() {
  // Upload queue cards were removed; assets appear only in "Manage Uploaded Assets".
}

function nextSortOrder(baseAssets, offset) {
  if (!baseAssets || baseAssets.length === 0) return offset + 1;
  const max = baseAssets.reduce((highest, item) => Math.max(highest, Number(item.sortOrder || 0)), 0);
  return max + offset + 1;
}

async function uploadSingleQueueItem(item) {
  if (!state.activeId) {
    throw new Error('Select or create a project first.');
  }

  item.status = 'signing';

  const mimeType = inferMimeType(item.file);
  const signed = await api('/api/admin/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      filename: item.file.name,
      mimeType,
      projectId: state.activeId
    })
  });

  item.status = 'uploading';

  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: item.file
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`Upload failed for ${item.file.name}: ${text || uploadResponse.status}`);
  }

  item.status = 'attaching';

  await api(`/api/admin/projects/${state.activeId}/assets`, {
    method: 'POST',
    body: JSON.stringify({
      kind: item.kind,
      r2Key: signed.r2Key,
      mimeType,
      altText: humanizeFilename(item.file.name),
      caption: '',
      featured: false,
      sortOrder: item.sortOrder
    })
  });

  item.status = 'done';
}

async function processUploadQueue(items) {
  let uploaded = 0;

  for (const item of items) {
    try {
      await uploadSingleQueueItem(item);
      uploaded += 1;
      els.uploadStatus.textContent = `Uploaded ${uploaded}/${items.length} file(s).`;
    } catch (error) {
      item.status = 'failed';
      item.error = error.message;
    }
  }

  const failed = items.filter((item) => item.status === 'failed').length;

  if (failed > 0) {
    setFeedback('warn', `${uploaded} uploaded, ${failed} failed. Re-upload failed files from your device.`);
  } else {
    setFeedback('success', `Uploaded ${uploaded} file(s).`);
  }

  state.uploadQueue = [];
  await selectProject(state.activeId);
}

async function enqueueUploads(files) {
  if (!state.activeProject || !state.activeId) {
    setFeedback('error', 'Select or create a project first.');
    return;
  }

  if (!files.length) return;

  clearFeedback();

  const queuedKinds = [];
  const newItems = files.map((file, idx) => {
    const kind = inferAssetKind(file, state.activeProject.discipline, state.activeProject.assets || [], queuedKinds);
    queuedKinds.push(kind);

    return {
      id: crypto.randomUUID(),
      file,
      kind,
      status: 'queued',
      error: '',
      sortOrder: nextSortOrder(state.activeProject.assets || [], idx)
    };
  });

  state.uploadQueue = [...newItems];
  renderUploadQueue();

  els.uploadStatus.textContent = `Uploading ${newItems.length} file(s)...`;
  await processUploadQueue(newItems);
}

function assetPreviewMarkup(asset, allAssets) {
  if (asset.kind === 'model3d') {
    const posterAsset = allAssets.find((item) => item.kind === 'poster');
    const poster = posterAsset ? ` poster="${escapeHtml(posterAsset.url)}"` : '';

    return `
      <model-viewer
        src="${escapeHtml(asset.url)}"
        ${poster}
        alt="${escapeHtml(asset.altText || asset.r2Key)}"
        camera-controls
        shadow-intensity="1"
        interaction-prompt="auto"
      ></model-viewer>
    `;
  }

  return `<img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.altText || asset.r2Key)}" loading="lazy" />`;
}

function getAssetSortOrder(asset) {
  const value = Number(asset?.sortOrder ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function compareAssetsByOrder(a, b) {
  const orderDelta = getAssetSortOrder(a) - getAssetSortOrder(b);
  if (orderDelta !== 0) return orderDelta;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function getSortedAssets(assets = []) {
  return [...assets].sort(compareAssetsByOrder);
}

function getAssetById(assetId) {
  if (!assetId || !state.activeProject) return null;
  return state.activeProject.assets.find((asset) => asset.id === assetId) || null;
}

function getResolvedAsset(asset) {
  return {
    ...asset,
    ...(state.assetDrafts.get(asset.id) || {})
  };
}

function getAssetThumbMarkup(asset, allAssets) {
  if (asset.kind === 'model3d') {
    const posterAsset = allAssets.find((item) => item.kind === 'poster');
    if (posterAsset) {
      return `<img src="${escapeHtml(posterAsset.url)}" alt="${escapeHtml(asset.altText || asset.r2Key)}" loading="lazy" />`;
    }

    return '<div class="admin-v2-asset-thumb-empty">3D</div>';
  }

  return `<img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.altText || asset.r2Key)}" loading="lazy" />`;
}

function clearAssetDragState() {
  state.dragAssetId = null;
  els.assetList
    .querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after')
    .forEach((node) => node.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
}

function patchActiveAssetSortOrders(sortMap) {
  if (!state.activeProject || !sortMap || sortMap.size === 0) return;

  state.activeProject = {
    ...state.activeProject,
    assets: state.activeProject.assets.map((asset) =>
      sortMap.has(asset.id)
        ? {
            ...asset,
            sortOrder: sortMap.get(asset.id)
          }
        : asset
    )
  };
}

async function persistAssetSortUpdates(updates) {
  for (const update of updates) {
    await api(`/api/admin/assets/${update.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ sortOrder: update.sortOrder })
    });
  }
}

function getRebalancedAssetOrder(sortedAssets) {
  return sortedAssets.map((asset, index) => ({
    id: asset.id,
    sortOrder: (index + 1) * 100
  }));
}

async function reorderAssetByDrop(assetId, targetIndex) {
  if (!state.activeProject) return;

  const sorted = getSortedAssets(state.activeProject.assets || []);
  const moving = sorted.find((asset) => asset.id === assetId);
  if (!moving) return;

  const withoutMoving = sorted.filter((asset) => asset.id !== assetId);
  const boundedTargetIndex = Math.max(0, Math.min(targetIndex, withoutMoving.length));
  const prev = withoutMoving[boundedTargetIndex - 1] || null;
  const next = withoutMoving[boundedTargetIndex] || null;
  const reordered = [...withoutMoving];
  reordered.splice(boundedTargetIndex, 0, moving);

  let updates = [];
  if (!prev && !next) {
    updates = [{ id: assetId, sortOrder: 100 }];
  } else if (!prev) {
    updates = [{ id: assetId, sortOrder: getAssetSortOrder(next) - 100 }];
  } else if (!next) {
    updates = [{ id: assetId, sortOrder: getAssetSortOrder(prev) + 100 }];
  } else {
    const prevOrder = getAssetSortOrder(prev);
    const nextOrder = getAssetSortOrder(next);
    const gap = nextOrder - prevOrder;

    if (gap > 0.000001) {
      updates = [{ id: assetId, sortOrder: prevOrder + gap / 2 }];
    } else {
      updates = getRebalancedAssetOrder(reordered);
    }
  }

  if (!updates.length) return;

  try {
    await persistAssetSortUpdates(updates);
    patchActiveAssetSortOrders(new Map(updates.map((item) => [item.id, item.sortOrder])));
    renderAssetEditors(state.activeProject.assets || []);
    setFeedback('success', 'Asset order updated.');
  } catch (error) {
    setFeedback('error', error.message);
    await selectProject(state.activeId);
  }
}

function resolveAssetDropTargetIndex(overItem, pointerY) {
  const ordered = getSortedAssets(state.activeProject?.assets || []);
  const sourceIndex = ordered.findIndex((asset) => asset.id === state.dragAssetId);
  if (sourceIndex === -1) return { ordered, targetIndex: -1 };

  if (!overItem) {
    return { ordered, targetIndex: ordered.length - 1 };
  }

  const overId = overItem.dataset.assetId;
  const overIndex = ordered.findIndex((asset) => asset.id === overId);
  if (overIndex === -1) return { ordered, targetIndex: -1 };

  const rect = overItem.getBoundingClientRect();
  const isAfter = pointerY >= rect.top + rect.height / 2;
  let targetIndex = overIndex + (isAfter ? 1 : 0);

  if (sourceIndex < targetIndex && overItem) {
    targetIndex -= 1;
  }

  return { ordered, targetIndex };
}

function renderAssetEditors(assets) {
  els.assetList.innerHTML = '';

  if (!assets || assets.length === 0) {
    state.selectedAssetId = null;
    state.assetDrafts = new Map();
    els.assetList.innerHTML = '<p class="notice">No assets uploaded yet.</p>';
    return;
  }

  const sortedAssets = getSortedAssets(assets);
  const hasSelected = state.selectedAssetId && sortedAssets.some((asset) => asset.id === state.selectedAssetId);
  state.selectedAssetId = hasSelected ? state.selectedAssetId : sortedAssets[0].id;

  const selectedAsset = sortedAssets.find((asset) => asset.id === state.selectedAssetId);
  if (!selectedAsset) {
    els.assetList.innerHTML = '<p class="notice">Select an asset to edit metadata.</p>';
    return;
  }

  const resolved = getResolvedAsset(selectedAsset);
  const leadAssetId = sortedAssets[0]?.id || null;
  const selectedIsCover = selectedAsset.id === leadAssetId;

  els.assetList.innerHTML = `
    <div class="admin-v2-asset-browser">
      <ul class="admin-v2-asset-sort-list" aria-label="Asset order">
        ${sortedAssets
          .map((asset) => {
            const active = asset.id === state.selectedAssetId ? 'active' : '';
            const isCover = asset.id === leadAssetId;
            return `
              <li class="admin-v2-asset-sort-item ${active}" data-asset-id="${escapeHtml(asset.id)}" draggable="true">
                <button type="button" class="admin-v2-asset-sort-btn" data-asset-select="${escapeHtml(asset.id)}">
                  <span class="admin-v2-asset-thumb">${getAssetThumbMarkup(asset, sortedAssets)}</span>
                  <span class="admin-v2-asset-sort-meta">
                    <span class="admin-v2-asset-sort-head">
                      <strong>${escapeHtml(asset.kind.toUpperCase())}</strong>
                      ${isCover ? '<span class="admin-v2-cover-chip">Cover</span>' : ''}
                    </span>
                    <span>${escapeHtml(asset.r2Key)}</span>
                  </span>
                  <span class="admin-v2-drag-handle" aria-hidden="true">::</span>
                </button>
              </li>
            `;
          })
          .join('')}
      </ul>

      <article class="asset-editor admin-v2-asset-card admin-v2-asset-detail" data-asset-id="${escapeHtml(selectedAsset.id)}">
        <div class="asset-editor-preview">${assetPreviewMarkup(selectedAsset, sortedAssets)}</div>
        <div class="asset-editor-content">
          <h4>
            ${escapeHtml(selectedAsset.kind.toUpperCase())} • ${escapeHtml(selectedAsset.r2Key)}
            ${selectedIsCover ? '<span class="admin-v2-cover-chip">Cover</span>' : ''}
          </h4>

          <div class="form-grid admin-v2-asset-grid">
            <label>Kind
              <select name="kind">
                <option value="image" ${resolved.kind === 'image' ? 'selected' : ''}>Image</option>
                <option value="poster" ${resolved.kind === 'poster' ? 'selected' : ''}>Poster</option>
                <option value="model3d" ${resolved.kind === 'model3d' ? 'selected' : ''}>3D Model</option>
              </select>
            </label>
          </div>

          <label>Alt Text
            <input type="text" name="altText" value="${escapeHtml(resolved.altText || '')}" />
          </label>

          <label>Caption
            <textarea name="caption">${escapeHtml(resolved.caption || '')}</textarea>
          </label>

          <div class="admin-actions">
            <a class="btn ghost" href="${escapeHtml(selectedAsset.url)}" target="_blank" rel="noopener noreferrer">Open File</a>
            <button type="button" data-action="set-cover" class="btn secondary">Set as Cover</button>
            <button type="button" data-action="save-asset">Save</button>
            <button type="button" data-action="delete-asset" class="btn danger">Delete</button>
          </div>
        </div>
      </article>
    </div>
  `;
}

function readAssetCardPayload(card) {
  const assetId = card?.dataset?.assetId;
  const currentAsset = getAssetById(assetId);

  return {
    kind: card.querySelector('[name="kind"]').value,
    sortOrder: getAssetSortOrder(currentAsset),
    altText: card.querySelector('[name="altText"]').value,
    caption: card.querySelector('[name="caption"]').value
  };
}

function markAssetCardDirty(card) {
  if (!card || !card.dataset.assetId) return;

  const assetId = card.dataset.assetId;
  const draft = readAssetCardPayload(card);
  state.assetDrafts.set(assetId, draft);
  card.classList.add('is-dirty');
}

async function saveAssetCard(card, options = {}) {
  if (!card || !card.dataset.assetId) return;

  const { setCover = false, silent = false } = options;
  const assetId = card.dataset.assetId;
  const payload = readAssetCardPayload(card);

  if (setCover) {
    payload.featured = true;
  }

  await api(`/api/admin/assets/${assetId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  card.classList.remove('is-dirty');
  state.assetDrafts.delete(assetId);

  if (!silent) {
    setFeedback('success', setCover ? 'Cover updated.' : 'Asset saved.');
  }
}

async function deleteAssetCard(card) {
  if (!card || !card.dataset.assetId || !state.activeId) return;

  const assetId = card.dataset.assetId;
  const confirmed = window.confirm('Delete this asset? This cannot be undone.');
  if (!confirmed) return;

  clearFeedback();

  const payload = await api(`/api/admin/assets/${assetId}`, {
    method: 'DELETE',
    body: JSON.stringify({})
  });

  if (payload.warning) {
    setFeedback('warn', `Asset deleted. R2 warning: ${payload.warning}`);
  } else {
    setFeedback('success', 'Asset deleted.');
  }

  await selectProject(state.activeId);
}

function renderPreflightDialog(data) {
  renderChecklist(
    els.modalHardList,
    data.currentHardMissing,
    'Current project has no blockers and is ready for publish.'
  );

  const globalItems = data.globalBlockedProjects.map((entry) => `${entry.title}: ${entry.hardMissing.join(' ')}`);
  renderChecklist(els.modalGlobalList, globalItems, 'No blocking issues found in currently published projects.');

  if (data.canProceed) {
    els.preflightDialogIntro.textContent = 'Preflight passed. Publishing will update snapshot and trigger deploy hook if configured.';
  } else {
    els.preflightDialogIntro.textContent = 'Fix blockers below before publishing.';
  }

  els.preflightConfirmBtn.disabled = !data.canProceed;
}

function openPreflightDialog() {
  if (typeof els.preflightDialog.showModal === 'function') {
    if (!els.preflightDialog.open) {
      els.preflightDialog.showModal();
    }
    return;
  }

  els.preflightDialog.setAttribute('open', '');
}

function closePreflightDialog() {
  if (typeof els.preflightDialog.close === 'function') {
    if (els.preflightDialog.open) {
      els.preflightDialog.close();
    }
    return;
  }

  els.preflightDialog.removeAttribute('open');
}

function openPreviewDialog() {
  if (typeof els.previewDialog.showModal === 'function') {
    if (!els.previewDialog.open) {
      els.previewDialog.showModal();
    }
    return;
  }

  els.previewDialog.setAttribute('open', '');
}

function closePreviewDialog() {
  if (typeof els.previewDialog.close === 'function') {
    if (els.previewDialog.open) {
      els.previewDialog.close();
    }
    return;
  }

  els.previewDialog.removeAttribute('open');
}

function renderDraftPreview() {
  const project = getDraftPreviewProject();
  if (!project) {
    setFeedback('error', 'Select a project first.');
    return;
  }

  els.previewDialogIntro.textContent = `Previewing draft using template: ${project.styleTemplate || 'editorial'}.`;
  els.previewDialogContent.innerHTML = buildProjectPreviewMarkup(project);

  if (project.slug) {
    els.previewOpenRouteBtn.href = `/projects/${encodeURIComponent(project.slug)}/`;
    els.previewOpenRouteBtn.classList.remove('is-disabled');
    els.previewOpenRouteBtn.removeAttribute('aria-disabled');
  } else {
    els.previewOpenRouteBtn.href = '#';
    els.previewOpenRouteBtn.classList.add('is-disabled');
    els.previewOpenRouteBtn.setAttribute('aria-disabled', 'true');
  }

  openPreviewDialog();
}

async function runPreflight(options = {}) {
  const { openModal = true } = options;

  if (!state.activeProject || !state.activeId) {
    setFeedback('error', 'Select a project first.');
    return null;
  }

  clearFeedback();

  if (state.hasDirtyChanges) {
    await saveProject({ autosave: false, silent: true });
  }

  await selectProject(state.activeId);

  const payload = await api('/api/admin/publish', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true })
  });

  const currentHardMissing = state.activeProject?.readiness?.hardMissing || [];
  const globalBlockedProjects = (payload.readiness || []).filter((entry) => !entry.canPublish);

  const data = {
    currentHardMissing,
    globalBlockedProjects,
    canProceed: currentHardMissing.length === 0 && globalBlockedProjects.length === 0
  };

  state.lastPreflight = data;

  if (data.canProceed) {
    els.preflightSummary.textContent = 'Preflight passed. Safe to publish.';
  } else {
    els.preflightSummary.textContent = `Preflight found ${currentHardMissing.length + globalBlockedProjects.length} blocking item(s).`;
  }

  if (openModal) {
    renderPreflightDialog(data);
    openPreflightDialog();
  }

  return data;
}

async function publishSnapshot() {
  if (!state.activeProject || !state.activeId) {
    setFeedback('error', 'Select a project first.');
    return;
  }

  let preflight = state.lastPreflight;
  if (!preflight) {
    preflight = await runPreflight({ openModal: false });
  }

  if (!preflight || !preflight.canProceed) {
    setFeedback('error', 'Cannot publish until preflight blockers are resolved.');
    return;
  }

  clearFeedback();

  els.publishBtn.disabled = true;
  els.publishBtn.textContent = 'Publishing...';
  els.mobilePublishBtn.disabled = true;
  els.preflightConfirmBtn.disabled = true;

  try {
    if (state.activeProject.status !== 'published') {
      await saveProject({ autosave: false, statusOverride: 'published', silent: true });
    }

    const payload = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const warnings = payload.warnings?.length ? ` Warnings: ${payload.warnings.join(' | ')}` : '';
    setFeedback('success', `Published ${payload.projectCount} project(s). Snapshot: ${payload.snapshotKey}.${warnings}`);

    await loadProjects();
    if (state.activeId) {
      await selectProject(state.activeId);
    }

    state.lastPreflight = null;
    closePreflightDialog();
  } catch (error) {
    setFeedback('error', error.message);
  } finally {
    els.publishBtn.disabled = false;
    els.publishBtn.textContent = 'Publish Snapshot';
    els.mobilePublishBtn.disabled = false;
  }
}

async function publishSelectedDraftProjects() {
  let selectedDrafts = getSelectedDraftProjects();
  if (selectedDrafts.length === 0) {
    setFeedback('error', 'Select at least one draft project to publish.');
    return;
  }

  clearFeedback();

  if (state.hasDirtyChanges && state.activeId && state.selectedProjectIds.has(state.activeId)) {
    await saveProject({ autosave: false, silent: true });
    await selectProject(state.activeId);
    selectedDrafts = getSelectedDraftProjects();
  }

  const blockedSelected = selectedDrafts.filter((project) => !project.readiness?.canPublish);
  if (blockedSelected.length > 0) {
    const names = blockedSelected.map((project) => project.title || project.slug || project.id).join(', ');
    setFeedback('error', `Selected drafts have publish blockers: ${names}`);
    return;
  }

  const dryRun = await api('/api/admin/publish', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true })
  });
  const existingBlocked = (dryRun.readiness || []).filter((entry) => !entry.canPublish);
  if (existingBlocked.length > 0) {
    setFeedback('error', 'Cannot bulk publish while existing published projects have blockers.');
    return;
  }

  const originalBulkLabel = els.bulkPublishBtn.textContent;
  els.bulkPublishBtn.disabled = true;
  els.bulkPublishBtn.textContent = 'Publishing...';
  els.publishBtn.disabled = true;
  els.mobilePublishBtn.disabled = true;

  try {
    for (const project of selectedDrafts) {
      await api('/api/admin/projects', {
        method: 'POST',
        body: JSON.stringify({
          id: project.id,
          status: 'published',
          autosave: true
        })
      });
    }

    const payload = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const warnings = payload.warnings?.length ? ` Warnings: ${payload.warnings.join(' | ')}` : '';
    setFeedback(
      'success',
      `Published ${selectedDrafts.length} selected draft(s). Snapshot: ${payload.snapshotKey}.${warnings}`
    );

    state.selectedProjectIds.clear();
    await loadProjects();
    if (state.activeId) {
      await selectProject(state.activeId);
    }
  } catch (error) {
    setFeedback('error', error.message);
  } finally {
    els.bulkPublishBtn.textContent = originalBulkLabel;
    els.publishBtn.disabled = false;
    els.mobilePublishBtn.disabled = false;
    syncBulkPublishButton();
  }
}

async function unpublishActiveProject() {
  if (!state.activeProject || !state.activeId) {
    setFeedback('error', 'Select a project first.');
    return;
  }

  if (state.activeProject.status !== 'published') {
    setFeedback('error', 'Only published projects can be unpublished.');
    return;
  }

  const confirmed = window.confirm(
    `Unpublish "${state.activeProject.title}" and republish the snapshot without it?`
  );

  if (!confirmed) return;

  clearFeedback();

  try {
    await saveProject({ autosave: false, statusOverride: 'draft', silent: true });

    const payload = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const warnings = payload.warnings?.length ? ` Warnings: ${payload.warnings.join(' | ')}` : '';
    setFeedback('success', `Project moved to draft and snapshot republished.${warnings}`);

    await loadProjects();
    if (state.activeId) {
      await selectProject(state.activeId);
    }

    state.lastPreflight = null;
  } catch (error) {
    setFeedback('error', error.message);
  }
}

function handleProjectInput(event) {
  const target = event.target;
  if (!target || !('name' in target) || !target.name) return;
  if (target.closest('.admin-v2-asset-card')) return;

  markDirty();

  if (['discipline', 'palette'].includes(target.name)) {
    syncThreeDFields();
    renderPalettePreview();
  }

  scheduleAutosave();
}

function handleProjectBlur(event) {
  const target = event.target;
  if (!target || !('name' in target) || !target.name) return;
  if (target.closest('.admin-v2-asset-card')) return;

  markDirty();
  scheduleAutosave(0);
}

function handleProjectFilterClick(event) {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;

  state.projectFilter = button.dataset.filter || 'all';
  updateFilterButtons();
  renderProjectList();
}

function handleProjectDragStart(event) {
  if (!canDragSortProjects()) return;
  if (event.target.closest('.admin-v2-project-select-wrap')) return;
  const item = event.target.closest('li[data-project-id]');
  if (!item) return;

  state.dragProjectId = item.dataset.projectId || null;
  if (!state.dragProjectId) return;

  item.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', state.dragProjectId);
  }
}

function handleProjectDragOver(event) {
  if (!state.dragProjectId || !canDragSortProjects()) return;

  const overItem = event.target.closest('li[data-project-id]');
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  if (!overItem) return;
  if (overItem.dataset.projectId === state.dragProjectId) return;

  els.projectList
    .querySelectorAll('.is-drop-before, .is-drop-after')
    .forEach((node) => node.classList.remove('is-drop-before', 'is-drop-after'));

  const rect = overItem.getBoundingClientRect();
  const isAfter = event.clientY >= rect.top + rect.height / 2;
  overItem.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
}

function handleProjectDrop(event) {
  if (!state.dragProjectId || !canDragSortProjects()) return;
  event.preventDefault();

  const draggedId = state.dragProjectId;
  const overItem = event.target.closest('li[data-project-id]');
  const { ordered, targetIndex } = resolveDropTargetIndex(overItem, event.clientY);
  const sourceIndex = ordered.findIndex((project) => project.id === draggedId);

  clearProjectListDragState();

  if (targetIndex < 0 || sourceIndex < 0 || targetIndex === sourceIndex) {
    return;
  }

  reorderProjectByDrop(draggedId, targetIndex).catch((error) => {
    setFeedback('error', error.message);
  });
}

function handleProjectDragEnd() {
  clearProjectListDragState();
}

function filesFromDrop(event) {
  event.preventDefault();
  els.dropzone.classList.remove('dragging');
  return Array.from(event.dataTransfer?.files || []);
}

function wireDropzone() {
  const dz = els.dropzone;

  dz.addEventListener('dragover', (event) => {
    event.preventDefault();
    dz.classList.add('dragging');
  });

  dz.addEventListener('dragleave', () => {
    dz.classList.remove('dragging');
  });

  dz.addEventListener('drop', (event) => {
    const files = filesFromDrop(event);
    enqueueUploads(files).catch((error) => setFeedback('error', error.message));
  });

  els.fileInput.addEventListener('change', () => {
    const files = Array.from(els.fileInput.files || []);
    enqueueUploads(files).catch((error) => setFeedback('error', error.message));
    els.fileInput.value = '';
  });
}

function wireAssetEvents() {
  els.assetList.addEventListener('input', (event) => {
    const card = event.target.closest('.admin-v2-asset-detail');
    if (!card) return;
    markAssetCardDirty(card);
  });

  els.assetList.addEventListener('change', (event) => {
    const card = event.target.closest('.admin-v2-asset-detail');
    if (!card) return;
    markAssetCardDirty(card);
  });

  els.assetList.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.admin-v2-asset-sort-item');
    if (!item) return;

    state.dragAssetId = item.dataset.assetId || null;
    if (!state.dragAssetId) return;

    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.dragAssetId);
    }
  });

  els.assetList.addEventListener('dragover', (event) => {
    if (!state.dragAssetId) return;

    const overItem = event.target.closest('.admin-v2-asset-sort-item');
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    if (!overItem) return;
    if (overItem.dataset.assetId === state.dragAssetId) return;

    els.assetList
      .querySelectorAll('.is-drop-before, .is-drop-after')
      .forEach((node) => node.classList.remove('is-drop-before', 'is-drop-after'));

    const rect = overItem.getBoundingClientRect();
    const isAfter = event.clientY >= rect.top + rect.height / 2;
    overItem.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
  });

  els.assetList.addEventListener('drop', (event) => {
    if (!state.dragAssetId) return;
    event.preventDefault();

    const draggedId = state.dragAssetId;
    const overItem = event.target.closest('.admin-v2-asset-sort-item');
    const { ordered, targetIndex } = resolveAssetDropTargetIndex(overItem, event.clientY);
    const sourceIndex = ordered.findIndex((asset) => asset.id === draggedId);

    clearAssetDragState();
    if (targetIndex < 0 || sourceIndex < 0 || targetIndex === sourceIndex) return;

    reorderAssetByDrop(draggedId, targetIndex).catch((error) => setFeedback('error', error.message));
  });

  els.assetList.addEventListener('dragend', () => {
    clearAssetDragState();
  });

  els.assetList.addEventListener('click', (event) => {
    const selectBtn = event.target.closest('[data-asset-select]');
    if (selectBtn) {
      state.selectedAssetId = selectBtn.dataset.assetSelect || null;
      renderAssetEditors(state.activeProject?.assets || []);
      return;
    }

    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;

    const card = actionBtn.closest('.admin-v2-asset-detail');
    if (!card) return;

    if (actionBtn.dataset.action === 'save-asset') {
      saveAssetCard(card)
        .then(() => selectProject(state.activeId))
        .catch((error) => setFeedback('error', error.message));
      return;
    }

    if (actionBtn.dataset.action === 'set-cover') {
      const assetId = card.dataset.assetId;
      saveAssetCard(card, { setCover: true, silent: true })
        .then(async () => {
          if (assetId) {
            await reorderAssetByDrop(assetId, 0);
            state.selectedAssetId = assetId;
          }
          await selectProject(state.activeId);
          setFeedback('success', 'Cover updated.');
        })
        .catch((error) => setFeedback('error', error.message));
      return;
    }

    if (actionBtn.dataset.action === 'delete-asset') {
      deleteAssetCard(card).catch((error) => setFeedback('error', error.message));
    }
  });
}

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
    if (!isSaveShortcut) return;

    event.preventDefault();
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });
}

function wireDialogEvents() {
  els.preflightCancelBtn.addEventListener('click', () => {
    closePreflightDialog();
  });

  els.preflightConfirmBtn.addEventListener('click', () => {
    publishSnapshot().catch((error) => setFeedback('error', error.message));
  });

  els.preflightDialog.addEventListener('click', (event) => {
    const rect = els.preflightDialog.getBoundingClientRect();
    const inDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!inDialog) {
      closePreflightDialog();
    }
  });

  els.previewCloseBtn.addEventListener('click', () => {
    closePreviewDialog();
  });

  els.previewOpenRouteBtn.addEventListener('click', (event) => {
    if (els.previewOpenRouteBtn.classList.contains('is-disabled')) {
      event.preventDefault();
    }
  });

  els.previewDialog.addEventListener('click', (event) => {
    const rect = els.previewDialog.getBoundingClientRect();
    const inDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!inDialog) {
      closePreviewDialog();
    }
  });
}

function wireEvents() {
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });

  els.form.addEventListener('input', handleProjectInput);
  els.form.addEventListener('change', handleProjectInput);
  els.form.addEventListener('focusout', handleProjectBlur, true);

  els.newGraphicBtn.addEventListener('click', () => {
    createProjectPreset('graphic').catch((error) => setFeedback('error', error.message));
  });

  els.new3dBtn.addEventListener('click', () => {
    createProjectPreset('3d').catch((error) => setFeedback('error', error.message));
  });

  els.bulkPublishBtn.addEventListener('click', () => {
    publishSelectedDraftProjects().catch((error) => setFeedback('error', error.message));
  });

  els.saveNowBtn.addEventListener('click', () => {
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });

  els.previewBtn.addEventListener('click', () => {
    renderDraftPreview();
  });

  els.publishBtn.addEventListener('click', () => {
    runPreflight({ openModal: true }).catch((error) => setFeedback('error', error.message));
  });

  els.unpublishBtn.addEventListener('click', () => {
    unpublishActiveProject().catch((error) => setFeedback('error', error.message));
  });

  els.deleteBtn.addEventListener('click', () => {
    deleteActiveDraftProject().catch((error) => setFeedback('error', error.message));
  });

  els.projectSearch.addEventListener('input', (event) => {
    state.projectSearch = event.target.value || '';
    renderProjectList();
  });

  els.filterBar.addEventListener('click', handleProjectFilterClick);
  els.projectList.addEventListener('dragstart', handleProjectDragStart);
  els.projectList.addEventListener('dragover', handleProjectDragOver);
  els.projectList.addEventListener('drop', handleProjectDrop);
  els.projectList.addEventListener('dragend', handleProjectDragEnd);

  els.mobileSaveBtn.addEventListener('click', () => {
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });

  els.mobilePreviewBtn.addEventListener('click', () => {
    renderDraftPreview();
  });

  els.mobilePublishBtn.addEventListener('click', () => {
    runPreflight({ openModal: true }).catch((error) => setFeedback('error', error.message));
  });

  els.mobileAssetsBtn.addEventListener('click', () => {
    els.assetsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.fileInput.click();
  });

  wireDropzone();
  wireAssetEvents();
  wireKeyboardShortcuts();
  wireDialogEvents();
}

async function init() {
  try {
    wireEvents();
    updateFilterButtons();
    clearEditor();
    await loadProjects();
  } catch (error) {
    setFeedback('error', error.message);
  }
}

init();
