/**
 * @typedef {'graphic'|'3d'} Discipline
 * @typedef {'draft'|'published'} ProjectStatus
 * @typedef {'image'|'poster'|'model3d'} AssetKind
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
 * @property {string} descriptionShort
 * @property {string} descriptionLong
 * @property {string} themeInspiration
 * @property {string} styleDirection
 * @property {'editorial'|'brutalist'|'minimal-grid'} styleTemplate
 * @property {string} typographyNotes
 * @property {string} motifSummary
 * @property {string} toolingNotes
 * @property {string} materialNotes
 * @property {string[]} tags
 * @property {string[]} palette
 * @property {string|null} coverAssetId
 * @property {Asset[]} assets
 * @property {string=} coverUrl
 * @property {string=} coverAltText
 */

const SAVE_DEBOUNCE_MS = 700;
const FEEDBACK_TIMEOUT_MS = 3600;
const MODEL_FILE_EXTENSIONS = ['.glb', '.gltf'];
const STYLE_TEMPLATE_OPTIONS = ['editorial', 'brutalist', 'minimal-grid'];
const EDITABLE_FIELDS = [
  'title',
  'descriptionLong',
  'themeInspiration',
  'styleDirection',
  'typographyNotes',
  'motifSummary',
  'toolingNotes',
  'materialNotes'
];

const state = {
  /** @type {AdminProject[]} */
  projects: [],
  filter: 'all',
  galleryView: 'cards',
  reorderMode: false,
  dragProjectId: null,
  mode: 'gallery',
  activeId: null,
  /** @type {AdminProject|null} */
  activeProject: null,
  routeToken: 0,
  save: {
    timer: null,
    inFlight: false,
    queued: false,
    /** @type {Record<string, string>} */
    pendingPatch: {},
    /** @type {Record<string, string>} */
    lastSaved: {}
  },
  upload: {
    busy: false
  },
  ui: {
    feedbackTimer: null,
    activeAssetId: null,
    dragImageAssetId: null,
    armedPaletteDeleteColor: null
  }
};

const els = {
  root: document.getElementById('adminV2Root'),
  filterBar: document.getElementById('adminv2FilterBar'),
  reorderToggle: document.getElementById('adminv2ReorderToggle'),
  viewCardsBtn: document.getElementById('adminv2ViewCardsBtn'),
  viewListBtn: document.getElementById('adminv2ViewListBtn'),
  addNewBtn: document.getElementById('adminv2AddNewBtn'),
  syncBtn: document.getElementById('adminv2SyncBtn'),
  galleryGrid: document.getElementById('adminv2GalleryGrid'),
  feedback: document.getElementById('adminv2Feedback'),
  detailFeedback: document.getElementById('adminv2DetailFeedback'),
  detailView: document.getElementById('adminv2DetailView'),
  detailMount: document.getElementById('adminv2DetailMount'),
  coverDialog: document.getElementById('adminv2CoverDialog'),
  coverCloseBtn: document.getElementById('adminv2CloseCoverBtn'),
  coverAssetList: document.getElementById('adminv2CoverAssetList'),
  assetDialog: document.getElementById('adminv2AssetDialog'),
  assetCloseBtn: document.getElementById('adminv2CloseAssetBtn'),
  assetTitleInput: document.getElementById('adminv2AssetTitleInput'),
  assetAltInput: document.getElementById('adminv2AssetAltInput'),
  assetKindSelect: document.getElementById('adminv2AssetKindSelect'),
  assetSaveBtn: document.getElementById('adminv2SaveAssetBtn'),
  assetDeleteBtn: document.getElementById('adminv2DeleteAssetBtn'),
  tagDialog: document.getElementById('adminv2TagDialog'),
  tagCloseBtn: document.getElementById('adminv2CloseTagBtn'),
  tagDialogList: document.getElementById('adminv2TagDialogList'),
  tagDialogInput: document.getElementById('adminv2TagDialogInput'),
  tagAddBtn: document.getElementById('adminv2AddTagBtn'),
  paletteDialog: document.getElementById('adminv2PaletteDialog'),
  paletteCloseBtn: document.getElementById('adminv2ClosePaletteBtn'),
  paletteDialogList: document.getElementById('adminv2PaletteDialogList'),
  paletteDialogPicker: document.getElementById('adminv2PaletteDialogPicker'),
  paletteAddBtn: document.getElementById('adminv2AddPaletteBtn'),
  fileInput: document.getElementById('adminv2FileInput'),
  saveChip: document.getElementById('adminv2SaveChip')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeString(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
}

function splitCommaTokens(value) {
  return String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueTokens(tokens, options = {}) {
  const { caseInsensitive = false } = options;
  const seen = new Set();
  const out = [];

  for (const token of tokens) {
    const normalized = String(token || '').trim();
    if (!normalized) continue;
    const key = caseInsensitive ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function sanitizeSwatchColor(value) {
  const token = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(token)) return token;
  if (/^(rgb|rgba|hsl|hsla)\([^)]{1,40}\)$/.test(token)) return token;
  if (/^[a-zA-Z]{3,20}$/.test(token)) return token;
  return null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function projectSortOrder(project) {
  return toNumber(project?.sortOrder, 0);
}

function compareProjects(a, b) {
  const orderDelta = projectSortOrder(a) - projectSortOrder(b);
  if (orderDelta !== 0) return orderDelta;

  const titleDelta = String(a?.title || '').localeCompare(String(b?.title || ''));
  if (titleDelta !== 0) return titleDelta;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function getSortedProjects() {
  return [...state.projects].sort(compareProjects);
}

function shouldShowProject(project) {
  if (state.filter === 'all') return true;
  return String(project.discipline || '').toLowerCase() === state.filter;
}

function getVisibleProjects() {
  return getSortedProjects().filter((project) => shouldShowProject(project));
}

function getProjectSummaryText(project) {
  const short = normalizeString(project?.descriptionShort || '');
  if (short) return short;
  return normalizeString(project?.descriptionLong || '');
}

function getStatusClass(status) {
  return status === 'published' ? 'published' : 'draft';
}

function setSaveState(stateName, textOverride = '') {
  if (!els.saveChip) return;
  const copy =
    textOverride ||
    {
      saved: 'All changes saved',
      saving: 'Saving...',
      unsaved: 'Unsaved changes',
      error: 'Save failed'
    }[stateName] || 'All changes saved';

  els.saveChip.textContent = copy;
  els.saveChip.classList.remove('saved', 'saving', 'unsaved', 'error');
  els.saveChip.classList.add(stateName);
}

function clearFeedback() {
  clearTimeout(state.ui.feedbackTimer);
  [els.feedback, els.detailFeedback].forEach((node) => {
    if (!node) return;
    node.textContent = '';
    node.classList.remove('is-error', 'is-warn', 'is-success');
  });
}

function setFeedback(message, options = {}) {
  const {
    type = 'success',
    scope = state.mode === 'detail' ? 'detail' : 'gallery',
    timeout = FEEDBACK_TIMEOUT_MS
  } = options;

  const target = scope === 'detail' ? els.detailFeedback : els.feedback;
  if (!target) return;

  clearTimeout(state.ui.feedbackTimer);
  target.textContent = String(message || '');
  target.classList.remove('is-error', 'is-warn', 'is-success');
  if (type === 'error') target.classList.add('is-error');
  if (type === 'warn') target.classList.add('is-warn');
  if (type === 'success') target.classList.add('is-success');

  if (timeout > 0) {
    state.ui.feedbackTimer = setTimeout(() => {
      clearFeedback();
    }, timeout);
  }
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
    const message = payload && typeof payload === 'object' ? payload.error : null;
    if (message) {
      if (Array.isArray(payload.errors) && payload.errors.length) {
        throw new Error(`${message} ${payload.errors.join(' | ')}`);
      }
      throw new Error(message);
    }

    if (text.trim().startsWith('<')) {
      throw new Error(
        `Expected JSON from ${path}, but received HTML (status ${response.status}). If running locally, use "npm run dev:cloudflare".`
      );
    }

    throw new Error(`Request failed with status ${response.status}.`);
  }

  return payload;
}

function normalizeProject(project) {
  return {
    ...project,
    title: normalizeString(project.title),
    slug: normalizeString(project.slug),
    discipline: project.discipline === '3d' ? '3d' : 'graphic',
    status: project.status === 'published' ? 'published' : 'draft',
    sortOrder: projectSortOrder(project),
    year: project.year === null || project.year === undefined ? null : toNumber(project.year, null),
    descriptionShort: String(project.descriptionShort || ''),
    descriptionLong: String(project.descriptionLong || ''),
    themeInspiration: String(project.themeInspiration || ''),
    styleDirection: String(project.styleDirection || ''),
    styleTemplate: STYLE_TEMPLATE_OPTIONS.includes(project.styleTemplate) ? project.styleTemplate : 'editorial',
    typographyNotes: String(project.typographyNotes || ''),
    motifSummary: String(project.motifSummary || ''),
    toolingNotes: String(project.toolingNotes || ''),
    materialNotes: String(project.materialNotes || ''),
    tags: normalizeArray(project.tags),
    palette: normalizeArray(project.palette),
    coverAssetId: project.coverAssetId || null,
    assets: Array.isArray(project.assets)
      ? project.assets.map((asset) => ({
          ...asset,
          sortOrder: toNumber(asset.sortOrder, 0),
          featured: Boolean(asset.featured)
        }))
      : []
  };
}

function normalizeProjectCollection(projects) {
  return (Array.isArray(projects) ? projects : []).map((project) => normalizeProject(project));
}

function updateProjectSummary(project) {
  if (!project?.id) return;
  const index = state.projects.findIndex((item) => item.id === project.id);
  if (index === -1) return;

  state.projects[index] = {
    ...state.projects[index],
    ...project,
    tags: normalizeArray(project.tags ?? state.projects[index].tags),
    sortOrder: projectSortOrder(project),
    coverAssetId: project.coverAssetId ?? state.projects[index].coverAssetId,
    coverUrl: project.coverUrl ?? state.projects[index].coverUrl,
    coverAltText: project.coverAltText ?? state.projects[index].coverAltText
  };
}

function readRoutePostId() {
  const url = new URL(window.location.href);
  const postId = normalizeString(url.searchParams.get('post') || '');
  return postId || null;
}

function writeRoutePostId(postId, options = {}) {
  const { replace = false } = options;
  const url = new URL(window.location.href);

  if (postId) {
    url.searchParams.set('post', postId);
  } else {
    url.searchParams.delete('post');
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replace) {
    window.history.replaceState({}, '', next);
  } else {
    window.history.pushState({}, '', next);
  }
}

function applyModeToView() {
  const isDetail = state.mode === 'detail';
  if (els.root) {
    els.root.dataset.mode = state.mode;
  }

  document.querySelectorAll('[data-adminv2-view]').forEach((node) => {
    const view = node.getAttribute('data-adminv2-view');
    const shouldShow = (isDetail && view === 'detail') || (!isDetail && view === 'gallery');
    if (shouldShow) {
      node.removeAttribute('hidden');
    } else {
      node.setAttribute('hidden', '');
    }
  });

  if (els.saveChip) {
    els.saveChip.classList.toggle('is-hidden', !isDetail);
  }
}

function renderFilterState() {
  if (!els.filterBar) return;

  els.filterBar.querySelectorAll('[data-filter]').forEach((chip) => {
    const chipFilter = chip.dataset.filter || 'all';
    chip.setAttribute('aria-pressed', chipFilter === state.filter ? 'true' : 'false');
  });
}

function canReorder() {
  return state.reorderMode && state.filter === 'all';
}

function renderReorderToggle() {
  if (!els.reorderToggle) return;

  const enabled = state.filter === 'all';
  els.reorderToggle.disabled = !enabled;
  els.reorderToggle.setAttribute('aria-pressed', canReorder() ? 'true' : 'false');
  els.reorderToggle.textContent = canReorder() ? 'Done Reordering' : 'Reorder';
}

function cardImageMarkup(project) {
  if (project.coverUrl) {
    const alt = normalizeString(project.coverAltText || `${project.title} cover`);
    return `<img src="${escapeHtml(project.coverUrl)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  }

  return '<div class="card-empty">No cover yet</div>';
}

function cardTagsMarkup(project) {
  const discipline = project.discipline === '3d' ? '3D' : 'Graphic';
  const base = [];

  if (project.status === 'draft') {
    base.push('<span class="tag adminv2-tag-draft">Draft</span>');
  }

  base.push(`<span class="tag">${discipline}</span>`);

  for (const tag of project.tags.slice(0, 3)) {
    base.push(`<span class="tag">${escapeHtml(tag)}</span>`);
  }

  return base.join('');
}

function statusTagMarkup(project) {
  const isPublished = project.status === 'published';
  const label = isPublished ? 'Published' : 'Draft';
  const className = isPublished ? 'adminv2-tag-published' : 'adminv2-tag-draft';
  return `<span class="tag ${className}">${label}</span>`;
}

function galleryCardMarkup(project) {
  const draggable = canReorder() ? 'true' : 'false';
  const statusClass = getStatusClass(project.status);
  const isDraft = project.status === 'draft';

  return `
    <article
      class="card adminv2-card ${isDraft ? 'is-draft' : ''}"
      data-project-id="${escapeHtml(project.id)}"
      data-discipline="${escapeHtml(project.discipline)}"
      data-status="${escapeHtml(statusClass)}"
      draggable="${draggable}"
    >
      <button type="button" class="adminv2-card-hit" data-action="open" data-project-id="${escapeHtml(project.id)}">
        <div class="card-media">
          ${cardImageMarkup(project)}
          ${isDraft ? '<span class="adminv2-draft-badge">Draft</span>' : ''}
          <div class="card-overlay">
            <p class="card-title">${escapeHtml(project.title || 'Untitled post')}</p>
            <p class="card-meta">${escapeHtml(getProjectSummaryText(project) || 'No summary yet.')}</p>
            <div class="tag-row">${cardTagsMarkup(project)}</div>
          </div>
        </div>
      </button>
    </article>
  `;
}

function galleryListRowMarkup(project) {
  const draggable = canReorder() ? 'true' : 'false';
  const statusClass = getStatusClass(project.status);
  const isDraft = project.status === 'draft';
  const title = escapeHtml(project.title || 'Untitled post');
  const thumb =
    project.coverUrl && normalizeString(project.coverUrl)
      ? `<img src="${escapeHtml(project.coverUrl)}" alt="${escapeHtml(normalizeString(project.coverAltText || project.title || 'Thumbnail'))}" loading="lazy" />`
      : '<span class="adminv2-row-thumb-empty">No image</span>';

  return `
    <article
      class="adminv2-card adminv2-list-row ${isDraft ? 'is-draft' : ''}"
      data-project-id="${escapeHtml(project.id)}"
      data-discipline="${escapeHtml(project.discipline)}"
      data-status="${escapeHtml(statusClass)}"
      draggable="${draggable}"
    >
      <button type="button" class="adminv2-card-hit adminv2-list-hit" data-action="open" data-project-id="${escapeHtml(project.id)}">
        <span class="adminv2-row-thumb">${thumb}</span>
        <span class="adminv2-row-title">${title}</span>
        <span class="adminv2-row-status">${statusTagMarkup(project)}</span>
      </button>
    </article>
  `;
}

function renderGalleryViewToggle() {
  const isCards = state.galleryView === 'cards';
  if (els.viewCardsBtn) {
    els.viewCardsBtn.setAttribute('aria-pressed', isCards ? 'true' : 'false');
  }
  if (els.viewListBtn) {
    els.viewListBtn.setAttribute('aria-pressed', isCards ? 'false' : 'true');
  }
}

function renderGallery() {
  renderFilterState();
  renderReorderToggle();
  renderGalleryViewToggle();

  if (!els.galleryGrid) return;
  els.galleryGrid.classList.toggle('is-list', state.galleryView === 'list');
  els.galleryGrid.classList.toggle('is-cards', state.galleryView !== 'list');

  const visible = getVisibleProjects();
  if (!visible.length) {
    els.galleryGrid.innerHTML = '<p class="notice">No posts match this filter.</p>';
    return;
  }

  const markup =
    state.galleryView === 'list'
      ? visible.map((project) => galleryListRowMarkup(project)).join('')
      : visible.map((project) => galleryCardMarkup(project)).join('');
  els.galleryGrid.innerHTML = markup;
}

function clearDragState() {
  state.dragProjectId = null;
  if (!els.galleryGrid) return;

  els.galleryGrid
    .querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after')
    .forEach((node) => node.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
}

async function persistProjectOrder(orderedProjects) {
  const updates = orderedProjects.map((project, index) => ({
    id: project.id,
    sortOrder: (index + 1) * 100
  }));

  const sortMap = new Map(updates.map((entry) => [entry.id, entry.sortOrder]));
  state.projects = state.projects.map((project) =>
    sortMap.has(project.id)
      ? {
          ...project,
          sortOrder: sortMap.get(project.id)
        }
      : project
  );

  renderGallery();

  try {
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

    setFeedback('Post order updated.', { type: 'success', scope: 'gallery' });
  } catch (error) {
    setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
    await loadProjects();
    renderGallery();
  }
}

async function handleProjectDrop(overNode, clientY) {
  if (!canReorder()) return;
  if (!state.dragProjectId || !overNode) return;

  const ordered = getSortedProjects();
  const draggedId = state.dragProjectId;
  const overId = overNode.dataset.projectId || '';

  if (!overId || draggedId === overId) return;

  const sourceIndex = ordered.findIndex((project) => project.id === draggedId);
  const overIndex = ordered.findIndex((project) => project.id === overId);
  if (sourceIndex === -1 || overIndex === -1) return;

  const rect = overNode.getBoundingClientRect();
  const isAfter = clientY >= rect.top + rect.height / 2;
  let targetIndex = overIndex + (isAfter ? 1 : 0);

  if (sourceIndex < targetIndex) {
    targetIndex -= 1;
  }

  if (targetIndex === sourceIndex) return;

  const reordered = [...ordered];
  const [moving] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moving);

  await persistProjectOrder(reordered);
}

function getEditableSnapshot(project) {
  const snapshot = {};
  for (const field of EDITABLE_FIELDS) {
    snapshot[field] = String(project?.[field] ?? '');
  }
  return snapshot;
}

function clearSaveTimer() {
  if (state.save.timer) {
    window.clearTimeout(state.save.timer);
    state.save.timer = null;
  }
}

function getNextDraftSortOrder() {
  const drafts = state.projects.filter((project) => project.status === 'draft');
  if (!drafts.length) return 100;
  const maxOrder = drafts.reduce((max, project) => Math.max(max, projectSortOrder(project)), 0);
  return maxOrder + 100;
}

function readEditableText(node) {
  if (!node) return '';
  return normalizeString(String(node.textContent || ''));
}

function applyEditableDisplay(node, value, fallback) {
  const normalized = normalizeString(value);
  if (normalized) {
    node.textContent = normalized;
    node.classList.remove('is-fallback');
    node.dataset.empty = 'false';
    return;
  }

  node.textContent = String(fallback || '');
  node.classList.add('is-fallback');
  node.dataset.empty = 'true';
}

function hydrateEditableFields(container) {
  if (!container) return;

  container.querySelectorAll('.adminv2-editable[data-field]').forEach((node) => {
    const value = String(node.dataset.value || '');
    const fallback = String(node.dataset.fallback || '');
    applyEditableDisplay(node, value, fallback);
  });
}

function renderDetailTitle(project) {
  return `
    <h1
      class="adminv2-editable"
      contenteditable="true"
      spellcheck="true"
      data-field="title"
      data-value="${escapeHtml(project.title || '')}"
      data-fallback="Untitled Project"
    ></h1>
  `;
}

function renderStyleTemplateControl() {
  return `
    <div class="adminv2-template-toolbar">
      <label for="adminv2DetailStyleTemplateSelect" class="adminv2-template-toolbar-label">Style Template</label>
      <select
        class="adminv2-meta-select adminv2-template-toolbar-select"
        data-role="style-template-select"
        id="adminv2DetailStyleTemplateSelect"
      >
        <option value="editorial">Editorial</option>
        <option value="brutalist">Brutalist</option>
        <option value="minimal-grid">Minimal Grid</option>
      </select>
    </div>
  `;
}

function renderEditableParagraph(field, value, fallback = '') {
  return `
    <p
      class="adminv2-editable"
      contenteditable="true"
      spellcheck="true"
      data-field="${escapeHtml(field)}"
      data-value="${escapeHtml(value || '')}"
      data-fallback="${escapeHtml(fallback || '')}"
    ></p>
  `;
}

function getAssetSortOrder(asset) {
  return toNumber(asset?.sortOrder, 0);
}

function compareAssets(a, b) {
  const orderDelta = getAssetSortOrder(a) - getAssetSortOrder(b);
  if (orderDelta !== 0) return orderDelta;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function sortedAssets(project) {
  return [...(project?.assets || [])].sort(compareAssets);
}

function getCoverAsset(project) {
  const assets = sortedAssets(project);
  if (!assets.length) return null;

  if (project.coverAssetId) {
    const byId = assets.find((asset) => asset.id === project.coverAssetId);
    if (byId) return byId;
  }

  return assets.find((asset) => asset.featured) || assets[0] || null;
}

function getAssetGroup(project, kind) {
  return sortedAssets(project).filter((asset) => asset.kind === kind);
}

function getAssetById(project, assetId) {
  if (!project || !assetId) return null;
  return (project.assets || []).find((asset) => asset.id === assetId) || null;
}

function getSortedImageAssets(project) {
  return sortedAssets(project).filter((asset) => asset.kind === 'image');
}

function getCoverSelectableAssets(project) {
  return sortedAssets(project).filter((asset) => asset.kind === 'image' || asset.kind === 'poster');
}

function renderHeroCoverActions() {
  return `
    <div class="adminv2-cover-actions">
      <button type="button" class="btn secondary adminv2-cover-action-btn" data-action="open-cover-picker">
        Choose Cover
      </button>
      <button type="button" class="btn secondary adminv2-cover-action-btn" data-action="add-cover-photo">
        Add Photo
      </button>
    </div>
  `;
}

function renderHeroMedia(project, cover, hasModelHero, modelAsset, posterAsset) {
  if (hasModelHero && modelAsset) {
    const posterAttr = posterAsset?.url ? ` poster="${escapeHtml(posterAsset.url)}"` : '';
    return `
      <div class="adminv2-hero-media-wrap">
        <model-viewer
          src="${escapeHtml(modelAsset.url)}"
          ${posterAttr}
          alt="${escapeHtml(modelAsset.altText || project.title)}"
          camera-controls
          shadow-intensity="1"
          interaction-prompt="auto"
        ></model-viewer>
        <button
          type="button"
          class="adminv2-asset-delete-btn adminv2-hero-asset-delete"
          data-action="delete-asset"
          data-asset-id="${escapeHtml(modelAsset.id)}"
          aria-label="Delete model asset"
          title="Delete asset"
        >
          ×
        </button>
        ${renderHeroCoverActions()}
      </div>
    `;
  }

  if (cover?.url) {
    return `
      <div class="adminv2-hero-media-wrap">
        <button
          type="button"
          class="adminv2-hero-asset-open"
          data-action="open-asset-editor"
          data-asset-id="${escapeHtml(cover.id)}"
          aria-label="Edit cover asset"
          title="Edit asset"
        >
          <img src="${escapeHtml(cover.url)}" alt="${escapeHtml(cover.altText || project.title)}" />
        </button>
        <button
          type="button"
          class="adminv2-asset-delete-btn adminv2-hero-asset-delete"
          data-action="delete-asset"
          data-asset-id="${escapeHtml(cover.id)}"
          aria-label="Delete cover asset"
          title="Delete asset"
        >
          ×
        </button>
        ${renderHeroCoverActions()}
      </div>
    `;
  }

  return `
    <button
      type="button"
      class="adminv2-media-plus"
      data-action="add-asset"
      ${state.upload.busy ? 'disabled' : ''}
      aria-label="Add asset"
    >
      <span>+</span>
      <small>Add Asset</small>
    </button>
  `;
}

function renderMoodboard(project, moodboard) {
  if (!Array.isArray(moodboard) || moodboard.length === 0) {
    return '';
  }

  const figures = moodboard
    .map(
      (asset) => `
      <figure class="adminv2-asset-figure" data-asset-id="${escapeHtml(asset.id)}" data-asset-kind="image" draggable="true">
        <button
          type="button"
          class="adminv2-asset-open"
          data-action="open-asset-editor"
          draggable="true"
          data-asset-id="${escapeHtml(asset.id)}"
          aria-label="Edit asset"
          title="Edit asset"
        >
          <img
            src="${escapeHtml(asset.url)}"
            alt="${escapeHtml(asset.altText || `${project.title} supporting visual`)}"
            loading="lazy"
            draggable="false"
          />
        </button>
        <button
          type="button"
          class="adminv2-asset-delete-btn"
          data-action="delete-asset"
          data-asset-id="${escapeHtml(asset.id)}"
          aria-label="Delete asset"
          title="Delete asset"
        >
          ×
        </button>
      </figure>
    `
    )
    .join('');

  return `
    <section>
      <h2 style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.08em;text-transform:uppercase;margin:1.2rem 0 0.7rem;">
        Moodboard / Supporting Frames
      </h2>
      <div class="moodboard adminv2-moodboard">
        ${figures}
      </div>
    </section>
  `;
}

function clearImageDragState() {
  state.ui.dragImageAssetId = null;
  if (!els.detailMount) return;

  els.detailMount
    .querySelectorAll(
      '.adminv2-asset-figure.is-dragging, .adminv2-asset-figure.is-drop-target, .adminv2-asset-figure.is-drop-before, .adminv2-asset-figure.is-drop-after'
    )
    .forEach((node) =>
      node.classList.remove('is-dragging', 'is-drop-target', 'is-drop-before', 'is-drop-after')
    );
}

function applyImageDropIndicator(overFigure, clientX) {
  if (!overFigure || !els.detailMount) return;

  els.detailMount
    .querySelectorAll('.adminv2-asset-figure.is-drop-target, .adminv2-asset-figure.is-drop-before, .adminv2-asset-figure.is-drop-after')
    .forEach((node) => node.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after'));

  const rect = overFigure.getBoundingClientRect();
  const isAfter = clientX >= rect.left + rect.width / 2;
  overFigure.classList.add('is-drop-target');
  overFigure.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
}

async function persistImageAssetOrder(orderedImages) {
  const project = state.activeProject;
  if (!project) return;

  const updates = orderedImages.map((asset, index) => ({
    id: asset.id,
    sortOrder: (index + 1) * 100
  }));

  const currentSortMap = new Map((project.assets || []).map((asset) => [asset.id, Number(asset.sortOrder || 0)]));
  const changed = updates.filter((update) => currentSortMap.get(update.id) !== update.sortOrder);
  if (!changed.length) return;

  const changedMap = new Map(changed.map((update) => [update.id, update.sortOrder]));
  state.activeProject = {
    ...project,
    assets: (project.assets || []).map((asset) =>
      changedMap.has(asset.id)
        ? {
            ...asset,
            sortOrder: changedMap.get(asset.id)
          }
        : asset
    )
  };
  renderDetail();

  try {
    for (const update of changed) {
      await api(`/api/admin/assets/${encodeURIComponent(update.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sortOrder: update.sortOrder
        })
      });
    }

    await refreshActiveProject();
    setFeedback('Image order updated.', { type: 'success', scope: 'detail' });
  } catch (error) {
    await refreshActiveProject();
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    throw error;
  }
}

async function handleImageAssetDrop(overFigure, clientX) {
  const draggingId = state.ui.dragImageAssetId;
  const project = state.activeProject;
  if (!draggingId || !project || !overFigure) return;

  const overId = String(overFigure.dataset.assetId || '');
  if (!overId || overId === draggingId) return;

  const images = getSortedImageAssets(project);
  const sourceIndex = images.findIndex((asset) => asset.id === draggingId);
  const overIndex = images.findIndex((asset) => asset.id === overId);
  if (sourceIndex === -1 || overIndex === -1) return;

  const rect = overFigure.getBoundingClientRect();
  const isAfter = clientX >= rect.left + rect.width / 2;
  let targetIndex = overIndex + (isAfter ? 1 : 0);

  if (sourceIndex < targetIndex) {
    targetIndex -= 1;
  }
  if (targetIndex === sourceIndex) return;

  const reordered = [...images];
  const [moving] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moving);

  await persistImageAssetOrder(reordered);
}

function syncStyleTemplateSelect() {
  const select = els.detailMount?.querySelector('[data-role="style-template-select"]');
  if (!(select instanceof HTMLSelectElement)) return;
  if (!state.activeProject) {
    select.value = 'editorial';
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.value = STYLE_TEMPLATE_OPTIONS.includes(state.activeProject.styleTemplate)
    ? state.activeProject.styleTemplate
    : 'editorial';
}

function renderDetailTagEditor(project) {
  const tagMarkup = (project.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  return `
    <span class="adminv2-post-tag-editor">
      ${tagMarkup}
      <button type="button" class="adminv2-meta-edit-btn" data-action="open-tag-dialog" title="Edit tags" aria-label="Edit tags">
        &#9998;
      </button>
    </span>
  `;
}

function renderDetailPaletteEditor(project) {
  const palette = Array.isArray(project.palette) ? project.palette : [];
  const swatchMarkup =
    palette.length > 0
      ? palette
          .map(
            (color) => `
      <span class="swatch adminv2-meta-swatch" style="background:${escapeHtml(color)}" title="${escapeHtml(color)}"></span>
    `
          )
          .join('')
      : '<span class="notice">No palette colors yet.</span>';

  return `
    <div class="adminv2-palette-editor">
      <div class="adminv2-palette-list">${swatchMarkup}</div>
      <button type="button" class="adminv2-meta-edit-btn" data-action="open-palette-dialog" title="Edit palette" aria-label="Edit palette">
        &#9998;
      </button>
    </div>
  `;
}

function renderStatusTag(project) {
  const isPublished = project.status === 'published';
  const label = isPublished ? 'Published' : 'Draft';
  const variantClass = isPublished ? 'adminv2-tag-published' : 'adminv2-tag-draft';
  const actionLabel = isPublished ? 'Unpublish post' : 'Publish post';

  return `
    <button
      type="button"
      class="tag adminv2-status-pill ${variantClass}"
      data-action="toggle-status"
      title="${actionLabel}"
      aria-label="${actionLabel}"
    >
      ${label}
    </button>
  `;
}

function renderDetail() {
  if (!els.detailMount) return;

  const project = state.activeProject;
  if (!project) {
    els.detailMount.innerHTML = '<p class="notice">Select a post to edit.</p>';
    syncStyleTemplateSelect();
    return;
  }

  const cover = getCoverAsset(project);
  const imageAssets = getAssetGroup(project, 'image');
  const modelAsset = getAssetGroup(project, 'model3d')[0] || null;
  const posterAsset = getAssetGroup(project, 'poster')[0] || cover;
  const moodboard = imageAssets.filter((asset) => !cover || asset.id !== cover.id);
  const hasModelHero = project.discipline === '3d' && Boolean(modelAsset);
  const activeTemplate = STYLE_TEMPLATE_OPTIONS.includes(project.styleTemplate)
    ? project.styleTemplate
    : 'editorial';
  const templateClass = `template-${activeTemplate}`;
  const disciplineLabel = project.discipline === '3d' ? '3D Project' : 'Graphic Project';
  const yearTag = project.year ? `<span class="tag">${escapeHtml(project.year)}</span>` : '';
  const statusTag = renderStatusTag(project);

  const descriptionFallback = project.descriptionShort || 'No description yet.';

  els.detailMount.innerHTML = `
    <main class="project-shell ${escapeHtml(templateClass)} adminv2-project-shell">
      <section class="project-hero">
        <p class="tag-row adminv2-post-tag-row">
          ${statusTag}
          <span class="tag">${disciplineLabel}</span>
          ${yearTag}
          ${renderDetailTagEditor(project)}
        </p>
        <div class="adminv2-hero-head">
          ${renderDetailTitle(project)}
          ${renderStyleTemplateControl()}
        </div>
        ${renderEditableParagraph('descriptionLong', project.descriptionLong || '', descriptionFallback)}
      </section>

      <section class="project-layout">
        <article class="project-main">
          <div class="media-stage">
            ${renderHeroMedia(project, cover, hasModelHero, modelAsset, posterAsset)}
          </div>
        </article>

        <aside class="project-panel">
          <div class="panel-block">
            <h3>Inspiration & Theme</h3>
            ${renderEditableParagraph(
              'themeInspiration',
              project.themeInspiration,
              'Add inspiration details in admin to enrich this section.'
            )}
          </div>

          <div class="panel-block">
            <h3>Design DNA</h3>
            ${renderEditableParagraph('styleDirection', project.styleDirection, 'No style direction notes yet.')}
          </div>

          <div class="panel-block">
            <h3>Typography Notes</h3>
            ${renderEditableParagraph('typographyNotes', project.typographyNotes, 'No typography notes yet.')}
          </div>

          <div class="panel-block">
            <h3>Motif Summary</h3>
            ${renderEditableParagraph('motifSummary', project.motifSummary, 'No motif notes yet.')}
          </div>

          <div class="panel-block">
            <h3>Palette</h3>
            ${renderDetailPaletteEditor(project)}
          </div>

          ${
            project.discipline === '3d'
              ? `
            <div class="panel-block">
              <h3>Tooling</h3>
              ${renderEditableParagraph('toolingNotes', project.toolingNotes, 'No tooling details yet.')}
            </div>
            <div class="panel-block">
              <h3>Material Notes</h3>
              ${renderEditableParagraph('materialNotes', project.materialNotes, 'No material notes yet.')}
            </div>
          `
              : ''
          }
        </aside>
      </section>

      ${renderMoodboard(project, moodboard)}
    </main>
  `;

  hydrateEditableFields(els.detailMount);
  syncStyleTemplateSelect();
}

function syncSummaryFromActive(field, value) {
  if (!state.activeProject?.id) return;

  const idx = state.projects.findIndex((project) => project.id === state.activeProject.id);
  if (idx === -1) return;

  if (field === 'title') {
    state.projects[idx] = {
      ...state.projects[idx],
      title: value
    };
    return;
  }

  if (field === 'descriptionLong') {
    state.projects[idx] = {
      ...state.projects[idx],
      descriptionLong: value
    };
  }
}

function queueFieldPatch(field, value, immediate = false) {
  const normalizedValue = String(value || '');
  const lastSaved = String(state.save.lastSaved[field] ?? '');

  if (normalizedValue === lastSaved) {
    delete state.save.pendingPatch[field];
  } else {
    state.save.pendingPatch[field] = normalizedValue;
  }

  const hasPending = Object.keys(state.save.pendingPatch).length > 0;
  if (hasPending) {
    setSaveState('unsaved');
  } else if (!state.save.inFlight) {
    setSaveState('saved');
  }

  if (!hasPending) {
    clearSaveTimer();
    return;
  }

  if (immediate) {
    clearSaveTimer();
    flushPendingPatch().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
    return;
  }

  clearSaveTimer();
  state.save.timer = window.setTimeout(() => {
    flushPendingPatch().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
  }, SAVE_DEBOUNCE_MS);
}

async function flushPendingPatch() {
  const activeId = state.activeProject?.id;
  if (!activeId) return;

  const patchKeys = Object.keys(state.save.pendingPatch);
  if (!patchKeys.length) return;

  if (state.save.inFlight) {
    state.save.queued = true;
    return;
  }

  const patch = { ...state.save.pendingPatch };
  state.save.pendingPatch = {};
  state.save.inFlight = true;
  state.save.queued = false;
  setSaveState('saving');

  try {
    const response = await api('/api/admin/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: activeId,
        ...patch,
        autosave: true
      })
    });

    if (response.project) {
      state.activeProject = normalizeProject({
        ...state.activeProject,
        ...response.project
      });
      updateProjectSummary(state.activeProject);
    }

    for (const key of Object.keys(patch)) {
      state.save.lastSaved[key] = String(state.activeProject?.[key] ?? patch[key] ?? '');
    }

    if (Object.keys(state.save.pendingPatch).length > 0) {
      setSaveState('unsaved');
    } else {
      setSaveState('saved');
    }
  } catch (error) {
    state.save.pendingPatch = { ...patch, ...state.save.pendingPatch };
    setSaveState('error');
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    throw error;
  } finally {
    state.save.inFlight = false;

    if (state.save.queued || Object.keys(state.save.pendingPatch).length > 0) {
      state.save.queued = false;
      state.save.timer = window.setTimeout(() => {
        flushPendingPatch().catch((error) => {
          setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
        });
      }, 0);
    }
  }
}

async function flushBeforeNavigation() {
  clearSaveTimer();

  if (state.save.inFlight) {
    state.save.queued = true;
    return;
  }

  if (Object.keys(state.save.pendingPatch).length === 0) return;

  try {
    await flushPendingPatch();
  } catch {
    // Keep current behavior: errors are surfaced by flushPendingPatch.
  }
}

async function waitForSaveIdle(maxWaitMs = 12000) {
  const startedAt = Date.now();
  while (state.save.inFlight) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error('Timed out while waiting for current save to complete.');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
}

async function saveImmediateProjectPatch(patch, options = {}) {
  const { rerender = true, successMessage = '' } = options;
  const activeId = state.activeProject?.id;
  if (!activeId) return;

  clearSaveTimer();

  if (Object.keys(state.save.pendingPatch).length > 0) {
    await flushPendingPatch();
  }

  await waitForSaveIdle();
  setSaveState('saving');

  try {
    const response = await api('/api/admin/projects', {
      method: 'POST',
      body: JSON.stringify({
        id: activeId,
        ...patch,
        autosave: true
      })
    });

    if (!response.project) {
      throw new Error('Save response is missing project data.');
    }

    updateActiveProject(response.project);
    if (rerender) {
      renderDetail();
    }

    if (successMessage) {
      setFeedback(successMessage, { type: 'success', scope: 'detail' });
    }
  } catch (error) {
    setSaveState('error');
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    throw error;
  }
}

function renderCoverAssetPicker() {
  const project = state.activeProject;
  if (!els.coverAssetList) return;

  if (!project) {
    els.coverAssetList.innerHTML = '<p class="notice">Select a post first.</p>';
    return;
  }

  const assets = getCoverSelectableAssets(project);
  if (!assets.length) {
    els.coverAssetList.innerHTML = `
      <p class="notice">No image/poster assets yet.</p>
      <button type="button" class="btn secondary" data-action="add-cover-photo">Add Photo</button>
    `;
    return;
  }

  const currentCoverId = getCoverAsset(project)?.id || '';
  els.coverAssetList.innerHTML = assets
    .map((asset) => {
      const isCurrent = asset.id === currentCoverId;
      const kindLabel = asset.kind === 'poster' ? 'Poster' : 'Image';
      const label = normalizeString(asset.caption || asset.altText || asset.r2Key || 'Untitled asset');
      return `
        <button
          type="button"
          class="adminv2-cover-item ${isCurrent ? 'is-active' : ''}"
          data-action="choose-cover-asset"
          data-asset-id="${escapeHtml(asset.id)}"
          aria-label="Set ${escapeHtml(label)} as cover"
          title="${escapeHtml(label)}"
        >
          <span class="adminv2-cover-thumb">
            <img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.altText || label)}" loading="lazy" />
          </span>
          <span class="adminv2-cover-meta">
            <strong>${kindLabel}</strong>
            <span>${escapeHtml(label)}</span>
            ${isCurrent ? '<em>Current cover</em>' : ''}
          </span>
        </button>
      `;
    })
    .join('');
}

function openCoverDialog() {
  if (!state.activeProject) {
    setFeedback('Select a post first.', { type: 'warn', scope: 'detail' });
    return;
  }

  renderCoverAssetPicker();
  const dialog = els.coverDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) {
    dialog.showModal();
  }
}

function closeCoverDialog() {
  const dialog = els.coverDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.open) {
    dialog.close();
  }
}

async function setCoverAsset(assetId) {
  const nextAssetId = String(assetId || '').trim();
  const projectId = state.activeProject?.id;
  if (!nextAssetId || !projectId) return;

  await flushBeforeNavigation();
  setSaveState('saving', 'Updating cover...');

  try {
    await api(`/api/admin/assets/${encodeURIComponent(nextAssetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        featured: true
      })
    });

    const refreshed = await loadProjectDetail(projectId);
    updateActiveProject(refreshed);
    renderDetail();
    renderCoverAssetPicker();
    closeCoverDialog();
    setFeedback('Cover updated.', { type: 'success', scope: 'detail' });
  } catch (error) {
    setSaveState('error');
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    throw error;
  }
}

function openAssetDialog(assetId) {
  closeCoverDialog();
  const project = state.activeProject;
  const asset = getAssetById(project, assetId);
  if (!asset) {
    setFeedback('Asset not found.', { type: 'error', scope: 'detail' });
    return;
  }

  state.ui.activeAssetId = asset.id;

  if (els.assetTitleInput instanceof HTMLInputElement) {
    els.assetTitleInput.value = String(asset.caption || '');
  }
  if (els.assetAltInput instanceof HTMLInputElement) {
    els.assetAltInput.value = String(asset.altText || '');
  }
  if (els.assetKindSelect instanceof HTMLSelectElement) {
    els.assetKindSelect.value = ['image', 'poster', 'model3d'].includes(asset.kind) ? asset.kind : 'image';
  }

  const dialog = els.assetDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) {
    dialog.showModal();
  }
}

function closeAssetDialog() {
  const dialog = els.assetDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.open) {
    dialog.close();
  }
  state.ui.activeAssetId = null;
}

async function refreshActiveProject() {
  const projectId = state.activeProject?.id;
  if (!projectId) return;
  const refreshed = await loadProjectDetail(projectId);
  updateActiveProject(refreshed);
  renderDetail();
}

async function saveAssetFromDialog() {
  const project = state.activeProject;
  const assetId = state.ui.activeAssetId;
  const asset = getAssetById(project, assetId);
  if (!asset || !assetId) {
    setFeedback('Select an asset first.', { type: 'error', scope: 'detail' });
    return;
  }

  const caption = els.assetTitleInput instanceof HTMLInputElement ? els.assetTitleInput.value : '';
  const altText = els.assetAltInput instanceof HTMLInputElement ? els.assetAltInput.value : '';
  const kind =
    els.assetKindSelect instanceof HTMLSelectElement && ['image', 'poster', 'model3d'].includes(els.assetKindSelect.value)
      ? els.assetKindSelect.value
      : asset.kind;

  try {
    await api(`/api/admin/assets/${encodeURIComponent(assetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        caption,
        altText,
        kind
      })
    });

    await refreshActiveProject();
    renderCoverAssetPicker();
    closeAssetDialog();
    setFeedback('Asset updated.', { type: 'success', scope: 'detail' });
  } catch (error) {
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    throw error;
  }
}

async function deleteAssetById(assetId, options = {}) {
  const { confirmDelete = true } = options;
  const nextAssetId = String(assetId || '').trim();
  if (!nextAssetId || !state.activeProject?.id) return;

  if (confirmDelete) {
    const confirmed = window.confirm('Delete this asset? This cannot be undone.');
    if (!confirmed) return;
  }

  try {
    const payload = await api(`/api/admin/assets/${encodeURIComponent(nextAssetId)}`, {
      method: 'DELETE',
      body: JSON.stringify({})
    });

    await refreshActiveProject();
    renderCoverAssetPicker();
    if (payload.warning) {
      setFeedback(`Asset deleted. R2 warning: ${payload.warning}`, { type: 'warn', scope: 'detail', timeout: 7000 });
    } else {
      setFeedback('Asset deleted.', { type: 'success', scope: 'detail' });
    }
  } catch (error) {
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    throw error;
  }
}

function updateDetailLocalField(node) {
  if (!state.activeProject) return;

  const field = String(node.dataset.field || '');
  if (!field || !EDITABLE_FIELDS.includes(field)) return;

  const value = readEditableText(node);
  state.activeProject[field] = value;
  syncSummaryFromActive(field, value);
  queueFieldPatch(field, value, false);
}

function handleEditableFocusIn(event) {
  const editable = event.target.closest('.adminv2-editable[data-field]');
  if (!editable) return;

  if (editable.dataset.empty === 'true' && editable.classList.contains('is-fallback')) {
    editable.textContent = '';
    editable.classList.remove('is-fallback');
    editable.dataset.empty = 'false';
  }
}

function handleEditableInput(event) {
  const editable = event.target.closest('.adminv2-editable[data-field]');
  if (!editable) return;

  editable.classList.remove('is-fallback');
  editable.dataset.empty = readEditableText(editable) ? 'false' : 'true';
  updateDetailLocalField(editable);
}

function handleEditableBlur(event) {
  const editable = event.target.closest('.adminv2-editable[data-field]');
  if (!editable) return;

  const field = String(editable.dataset.field || '');
  if (!field || !EDITABLE_FIELDS.includes(field)) return;

  const value = readEditableText(editable);
  const fallback = String(editable.dataset.fallback || '');

  if (!value && fallback) {
    applyEditableDisplay(editable, '', fallback);
  } else {
    editable.classList.remove('is-fallback');
    editable.dataset.empty = value ? 'false' : 'true';
  }

  if (state.activeProject) {
    state.activeProject[field] = value;
  }

  syncSummaryFromActive(field, value);
  queueFieldPatch(field, value, true);
}

function updateActiveProject(project) {
  state.activeProject = normalizeProject(project);
  state.activeId = state.activeProject.id;
  state.save.lastSaved = getEditableSnapshot(state.activeProject);
  state.save.pendingPatch = {};
  state.save.queued = false;
  clearSaveTimer();
  setSaveState('saved');
  updateProjectSummary(state.activeProject);
  if (state.ui.activeAssetId && !getAssetById(state.activeProject, state.ui.activeAssetId)) {
    state.ui.activeAssetId = null;
  }
  syncStyleTemplateSelect();
  renderCoverAssetPicker();
}

async function loadProjects() {
  const payload = await api('/api/admin/projects');
  state.projects = normalizeProjectCollection(payload.projects || []);
}

async function loadProjectDetail(projectId) {
  const payload = await api(`/api/admin/projects/${encodeURIComponent(projectId)}`);
  if (!payload.project) {
    throw new Error('Project detail response missing project data.');
  }
  return normalizeProject(payload.project);
}

async function createNewProject() {
  const now = Date.now();
  const response = await api('/api/admin/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: 'New Post',
      slug: `new-post-${now}`,
      discipline: 'graphic',
      status: 'draft',
      year: new Date().getFullYear(),
      descriptionShort: '',
      descriptionLong: '',
      sortOrder: getNextDraftSortOrder(),
      palette: [],
      tags: []
    })
  });

  if (!response.project?.id) {
    throw new Error('Create response missing project data.');
  }

  await loadProjects();
  await goToDetail(response.project.id);
  setFeedback('Draft created. Start editing fields in this view.', { type: 'success', scope: 'detail' });
}

async function syncSite() {
  const confirmed = window.confirm(
    'Sync site now? This will trigger deployment and publish all pending ordering/content/status changes.'
  );
  if (!confirmed) return;

  if (els.syncBtn) {
    els.syncBtn.disabled = true;
    els.syncBtn.textContent = 'Syncing...';
  }

  try {
    const dryRun = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true })
    });

    if (!dryRun.ok) {
      const details = Array.isArray(dryRun.errors) && dryRun.errors.length ? ` ${dryRun.errors.join(' | ')}` : '';
      throw new Error(`Cannot sync yet.${details}`);
    }

    const publishPayload = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const warningText =
      Array.isArray(publishPayload.warnings) && publishPayload.warnings.length
        ? ` Warnings: ${publishPayload.warnings.join(' | ')}`
        : '';

    setFeedback(`Site synced.${warningText}`.trim(), {
      type: warningText ? 'warn' : 'success',
      scope: state.mode === 'detail' ? 'detail' : 'gallery',
      timeout: warningText ? 9000 : FEEDBACK_TIMEOUT_MS
    });
  } finally {
    if (els.syncBtn) {
      els.syncBtn.disabled = false;
      els.syncBtn.textContent = 'Sync';
    }
  }
}

async function goToGallery(options = {}) {
  const { pushHistory = true, replaceHistory = false } = options;

  await flushBeforeNavigation();
  closeTagDialog();
  closePaletteDialog();
  closeCoverDialog();
  closeAssetDialog();

  state.mode = 'gallery';
  applyModeToView();
  renderGallery();

  if (pushHistory) {
    writeRoutePostId(null, { replace: replaceHistory });
  }
}

async function goToDetail(projectId, options = {}) {
  const { pushHistory = true, replaceHistory = false } = options;
  const targetId = normalizeString(projectId || '');

  if (!targetId) {
    await goToGallery({ pushHistory, replaceHistory });
    return;
  }

  const exists = state.projects.some((project) => project.id === targetId);
  if (!exists) {
    setFeedback('Post not found.', { type: 'error', scope: 'gallery', timeout: 7000 });
    await goToGallery({ pushHistory: true, replaceHistory: true });
    return;
  }

  if (state.activeId && state.activeId !== targetId) {
    await flushBeforeNavigation();
  }

  closeTagDialog();
  closePaletteDialog();

  const token = ++state.routeToken;
  state.mode = 'detail';
  applyModeToView();
  setSaveState('saving', 'Loading...');

  if (pushHistory) {
    writeRoutePostId(targetId, { replace: replaceHistory });
  }

  try {
    const project = await loadProjectDetail(targetId);
    if (token !== state.routeToken) return;

    updateActiveProject(project);
    renderDetail();
    clearFeedback();
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch (error) {
    if (token !== state.routeToken) return;

    setSaveState('error', 'Load failed');
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    await goToGallery({ pushHistory: true, replaceHistory: true });
  }
}

function isModelFile(file) {
  const lowerName = String(file?.name || '').toLowerCase();
  if (MODEL_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
  return String(file?.type || '').startsWith('model/');
}

function inferMimeType(file) {
  if (file.type) return file.type;

  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.avif')) return 'image/avif';
  if (name.endsWith('.glb')) return 'model/gltf-binary';
  if (name.endsWith('.gltf')) return 'model/gltf+json';
  return 'application/octet-stream';
}

function inferAssetKind(file, discipline, existingAssets, queuedKinds = []) {
  if (isModelFile(file)) return 'model3d';

  if (discipline === '3d') {
    const hasPoster =
      existingAssets.some((asset) => asset.kind === 'poster') || queuedKinds.includes('poster');
    if (!hasPoster) return 'poster';
  }

  return 'image';
}

function nextAssetSortOrder(assets, offset) {
  if (!assets || !assets.length) return (offset + 1) * 100;
  const max = assets.reduce((highest, item) => Math.max(highest, getAssetSortOrder(item)), 0);
  return max + (offset + 1) * 100;
}

function humanizeFilename(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function openAssetPicker() {
  if (!els.fileInput) return;
  if (!state.activeProject?.id) {
    setFeedback('Select a post first.', { type: 'error', scope: 'detail' });
    return;
  }

  if (state.upload.busy) {
    setFeedback('Upload already in progress.', { type: 'warn', scope: 'detail' });
    return;
  }

  els.fileInput.value = '';
  els.fileInput.click();
}

async function uploadSingleFile(file, context) {
  const mimeType = inferMimeType(file);

  const signed = await api('/api/admin/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      mimeType,
      projectId: context.projectId
    })
  });

  const uploadResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': mimeType
    },
    body: file
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(text || `Upload failed (${uploadResponse.status}).`);
  }

  await api(`/api/admin/projects/${encodeURIComponent(context.projectId)}/assets`, {
    method: 'POST',
    body: JSON.stringify({
      kind: context.kind,
      r2Key: signed.r2Key,
      mimeType,
      width: null,
      height: null,
      altText: humanizeFilename(file.name),
      caption: '',
      featured: false,
      sortOrder: context.sortOrder
    })
  });
}

async function uploadFiles(files) {
  if (!state.activeProject?.id || !files.length) return;

  await flushBeforeNavigation();

  state.upload.busy = true;
  renderDetail();
  setFeedback(`Uploading ${files.length} file(s)...`, { type: 'warn', scope: 'detail', timeout: 0 });

  const workingAssets = sortedAssets(state.activeProject);
  const queuedKinds = [];
  let uploaded = 0;
  const failures = [];

  for (const [index, file] of files.entries()) {
    const kind = inferAssetKind(file, state.activeProject.discipline, workingAssets, queuedKinds);
    queuedKinds.push(kind);

    const context = {
      projectId: state.activeProject.id,
      kind,
      sortOrder: nextAssetSortOrder(workingAssets, index)
    };

    try {
      await uploadSingleFile(file, context);
      uploaded += 1;
      workingAssets.push({
        id: crypto.randomUUID(),
        kind,
        sortOrder: context.sortOrder
      });
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }

  if (uploaded > 0 && state.activeProject?.id) {
    const refreshed = await loadProjectDetail(state.activeProject.id);
    updateActiveProject(refreshed);
    renderDetail();
  }

  state.upload.busy = false;
  renderDetail();

  if (uploaded > 0 && failures.length === 0) {
    setFeedback(`Uploaded ${uploaded} file(s).`, { type: 'success', scope: 'detail' });
    return;
  }

  if (uploaded > 0 && failures.length > 0) {
    setFeedback(`Uploaded ${uploaded} file(s), ${failures.length} failed.`, {
      type: 'warn',
      scope: 'detail',
      timeout: 7000
    });
    return;
  }

  setFeedback(`All uploads failed. ${failures[0] || ''}`.trim(), {
    type: 'error',
    scope: 'detail',
    timeout: 7000
  });
}

async function updateStyleTemplate(value) {
  const nextTemplate = String(value || '').trim();
  if (!STYLE_TEMPLATE_OPTIONS.includes(nextTemplate)) {
    setFeedback('Invalid style template.', { type: 'error', scope: 'detail' });
    return;
  }

  if (!state.activeProject || state.activeProject.styleTemplate === nextTemplate) return;
  state.activeProject.styleTemplate = nextTemplate;
  await saveImmediateProjectPatch({ styleTemplate: nextTemplate }, { rerender: true, successMessage: 'Template updated.' });
}

async function toggleProjectStatus() {
  if (!state.activeProject) return;

  const nextStatus = state.activeProject.status === 'published' ? 'draft' : 'published';
  const confirmation = window.confirm(
    nextStatus === 'published'
      ? 'Publish this post now?'
      : 'Unpublish this post and move it back to draft?'
  );
  if (!confirmation) return;

  state.activeProject.status = nextStatus;
  await saveImmediateProjectPatch(
    { status: nextStatus },
    { rerender: true, successMessage: nextStatus === 'published' ? 'Post published.' : 'Post moved back to draft.' }
  );
}

function renderTagDialog() {
  if (!els.tagDialogList) return;
  if (!state.activeProject) {
    els.tagDialogList.innerHTML = '<p class="notice">Select a post first.</p>';
    return;
  }

  const tags = Array.isArray(state.activeProject.tags) ? state.activeProject.tags : [];
  if (!tags.length) {
    els.tagDialogList.innerHTML = '<p class="notice">No tags yet.</p>';
    return;
  }

  els.tagDialogList.innerHTML = tags
    .map(
      (tag) => `
      <button type="button" class="adminv2-token-chip" data-action="remove-tag" data-tag="${escapeHtml(tag)}" title="Remove ${escapeHtml(tag)}">
        <span>${escapeHtml(tag)}</span>
        <span aria-hidden="true">×</span>
      </button>
    `
    )
    .join('');
}

function openTagDialog() {
  if (!state.activeProject) {
    setFeedback('Select a post first.', { type: 'warn', scope: 'detail' });
    return;
  }
  renderTagDialog();
  const dialog = els.tagDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) {
    dialog.showModal();
  }
  window.setTimeout(() => {
    if (els.tagDialogInput instanceof HTMLInputElement) {
      els.tagDialogInput.focus();
    }
  }, 0);
}

function closeTagDialog() {
  const dialog = els.tagDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.open) {
    dialog.close();
  }
}

async function addTagsFromDialogInput() {
  if (!state.activeProject) return;
  if (!(els.tagDialogInput instanceof HTMLInputElement)) return;

  const incoming = splitCommaTokens(els.tagDialogInput.value);
  if (!incoming.length) {
    els.tagDialogInput.value = '';
    return;
  }

  const nextTags = uniqueTokens([...(state.activeProject.tags || []), ...incoming], {
    caseInsensitive: true
  });

  if (nextTags.length === state.activeProject.tags.length) {
    els.tagDialogInput.value = '';
    setFeedback('No new tags to add.', { type: 'warn', scope: 'detail' });
    return;
  }

  state.activeProject.tags = nextTags;
  els.tagDialogInput.value = '';
  await saveImmediateProjectPatch({ tags: nextTags }, { rerender: true, successMessage: 'Tags updated.' });
  renderTagDialog();
}

async function removeTag(tag) {
  if (!state.activeProject) return;
  const removing = String(tag || '').trim().toLowerCase();
  if (!removing) return;

  const currentTags = state.activeProject.tags || [];
  const nextTags = currentTags.filter((item) => String(item || '').toLowerCase() !== removing);
  if (nextTags.length === currentTags.length) return;

  state.activeProject.tags = nextTags;
  await saveImmediateProjectPatch({ tags: nextTags }, { rerender: true, successMessage: 'Tags updated.' });
  renderTagDialog();
}

function renderPaletteDialog() {
  if (!els.paletteDialogList) return;
  if (!state.activeProject) {
    els.paletteDialogList.innerHTML = '<p class="notice">Select a post first.</p>';
    return;
  }

  const palette = Array.isArray(state.activeProject.palette) ? state.activeProject.palette : [];
  if (!palette.length) {
    els.paletteDialogList.innerHTML = '<p class="notice">No palette colors yet.</p>';
    return;
  }

  els.paletteDialogList.innerHTML = palette
    .map((color) => {
      const isArmed = String(state.ui.armedPaletteDeleteColor || '').toLowerCase() === String(color).toLowerCase();
      return `
      <button
        type="button"
        class="adminv2-palette-remove ${isArmed ? 'is-armed' : ''}"
        data-action="toggle-palette-delete"
        data-color="${escapeHtml(color)}"
        title="${isArmed ? `Click again to delete ${escapeHtml(color)}` : `Select ${escapeHtml(color)} for delete`}"
        aria-label="${isArmed ? `Click again to delete color ${escapeHtml(color)}` : `Select color ${escapeHtml(color)} for delete`}"
      >
        <span class="swatch adminv2-meta-swatch" style="background:${escapeHtml(color)}"></span>
        <span class="adminv2-palette-remove-icon" aria-hidden="true">×</span>
      </button>
    `;
    })
    .join('');
}

function openPaletteDialog() {
  if (!state.activeProject) {
    setFeedback('Select a post first.', { type: 'warn', scope: 'detail' });
    return;
  }
  state.ui.armedPaletteDeleteColor = null;
  renderPaletteDialog();
  const dialog = els.paletteDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) {
    dialog.showModal();
  }
  window.setTimeout(() => {
    if (els.paletteDialogPicker instanceof HTMLInputElement) {
      els.paletteDialogPicker.focus();
    }
  }, 0);
}

function closePaletteDialog() {
  state.ui.armedPaletteDeleteColor = null;
  const dialog = els.paletteDialog;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (dialog.open) {
    dialog.close();
  }
}

async function addPaletteColorFromDialogPicker() {
  if (!state.activeProject) return;
  if (!(els.paletteDialogPicker instanceof HTMLInputElement)) return;

  const picked = sanitizeSwatchColor(els.paletteDialogPicker.value || '');
  if (!picked) {
    setFeedback('Pick a valid color.', { type: 'warn', scope: 'detail' });
    return;
  }

  const nextPalette = uniqueTokens([...(state.activeProject.palette || []), picked], { caseInsensitive: true });

  if (nextPalette.length === state.activeProject.palette.length) {
    setFeedback('Color already in palette.', { type: 'warn', scope: 'detail' });
    return;
  }

  state.activeProject.palette = nextPalette;
  state.ui.armedPaletteDeleteColor = null;
  await saveImmediateProjectPatch({ palette: nextPalette }, { rerender: true, successMessage: 'Palette updated.' });
  renderPaletteDialog();
}

async function removePaletteColor(color) {
  if (!state.activeProject) return;
  const removing = String(color || '').trim().toLowerCase();
  if (!removing) return;

  const currentPalette = state.activeProject.palette || [];
  const nextPalette = currentPalette.filter((item) => String(item || '').toLowerCase() !== removing);
  if (nextPalette.length === currentPalette.length) return;

  state.activeProject.palette = nextPalette;
  state.ui.armedPaletteDeleteColor = null;
  await saveImmediateProjectPatch({ palette: nextPalette }, { rerender: true, successMessage: 'Palette updated.' });
  renderPaletteDialog();
}

function onFilterChipClick(event) {
  const chip = event.target.closest('[data-filter]');
  if (!chip) return;

  const nextFilter = String(chip.dataset.filter || 'all').toLowerCase();
  state.filter = nextFilter;

  if (state.filter !== 'all') {
    state.reorderMode = false;
  }

  renderGallery();
}

function onGalleryClick(event) {
  const actionNode = event.target.closest('[data-action][data-project-id]');
  if (!actionNode) return;

  const action = actionNode.dataset.action;
  const projectId = actionNode.dataset.projectId;
  if (!projectId || action !== 'open') return;

  if (canReorder()) return;

  goToDetail(projectId).catch((error) => {
    setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
  });
}

function onGalleryDragStart(event) {
  if (!canReorder()) return;

  const card = event.target.closest('.adminv2-card[data-project-id]');
  if (!card) return;

  state.dragProjectId = card.dataset.projectId || null;
  if (!state.dragProjectId) return;

  card.classList.add('is-dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', state.dragProjectId);
  }
}

function onGalleryDragOver(event) {
  if (!canReorder()) return;
  if (!state.dragProjectId) return;

  const overCard = event.target.closest('.adminv2-card[data-project-id]');
  if (!overCard) return;
  if (overCard.dataset.projectId === state.dragProjectId) return;

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  els.galleryGrid
    ?.querySelectorAll('.is-drop-before, .is-drop-after')
    .forEach((node) => node.classList.remove('is-drop-before', 'is-drop-after'));

  const rect = overCard.getBoundingClientRect();
  const isAfter = event.clientY >= rect.top + rect.height / 2;
  overCard.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
}

function onGalleryDrop(event) {
  if (!canReorder()) return;
  if (!state.dragProjectId) return;

  event.preventDefault();

  const overCard = event.target.closest('.adminv2-card[data-project-id]');
  if (!overCard) {
    clearDragState();
    return;
  }

  handleProjectDrop(overCard, event.clientY)
    .catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
    })
    .finally(() => {
      clearDragState();
    });
}

function onGalleryDragEnd() {
  clearDragState();
}

function onDetailClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  const action = String(actionNode.dataset.action || '');
  if (action === 'toggle-status') {
    event.preventDefault();
    toggleProjectStatus().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
    return;
  }

  if (action === 'open-asset-editor') {
    event.preventDefault();
    openAssetDialog(actionNode.dataset.assetId || '');
    return;
  }

  if (action === 'delete-asset') {
    event.preventDefault();
    deleteAssetById(actionNode.dataset.assetId || '', { confirmDelete: true }).catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
    return;
  }

  if (action === 'open-cover-picker') {
    event.preventDefault();
    openCoverDialog();
    return;
  }

  if (action === 'add-cover-photo') {
    event.preventDefault();
    openAssetPicker();
    return;
  }

  if (action === 'open-tag-dialog') {
    event.preventDefault();
    openTagDialog();
    return;
  }

  if (action === 'open-palette-dialog') {
    event.preventDefault();
    openPaletteDialog();
    return;
  }

  if (action === 'add-asset') {
    event.preventDefault();
    openAssetPicker();
  }
}

function onDetailDragStart(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const figure = target.closest('.adminv2-asset-figure[data-asset-id][data-asset-kind]');
  if (!figure) return;
  if (figure.dataset.assetKind !== 'image') return;

  const assetId = String(figure.dataset.assetId || '');
  if (!assetId) return;

  state.ui.dragImageAssetId = assetId;
  figure.classList.add('is-dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', assetId);

    const previewImage = figure.querySelector('img');
    if (previewImage instanceof HTMLImageElement) {
      const rect = previewImage.getBoundingClientRect();
      const ghost = previewImage.cloneNode(true);
      ghost.classList.add('adminv2-drag-ghost');
      ghost.style.width = `${Math.max(40, Math.round(rect.width))}px`;
      ghost.style.height = `${Math.max(40, Math.round(rect.height))}px`;
      ghost.style.position = 'fixed';
      ghost.style.top = '-9999px';
      ghost.style.left = '-9999px';
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, Math.round(rect.width / 2), Math.round(rect.height / 2));
      window.setTimeout(() => {
        ghost.remove();
      }, 0);
    }
  }
}

function onDetailDragOver(event) {
  if (!state.ui.dragImageAssetId) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const overFigure = target.closest('.adminv2-asset-figure[data-asset-id][data-asset-kind]');
  if (!overFigure) return;
  if (overFigure.dataset.assetKind !== 'image') return;
  if (String(overFigure.dataset.assetId || '') === state.ui.dragImageAssetId) return;

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  applyImageDropIndicator(overFigure, event.clientX);
}

function onDetailDrop(event) {
  if (!state.ui.dragImageAssetId) return;
  event.preventDefault();
  const target = event.target;
  if (!(target instanceof Element)) {
    clearImageDragState();
    return;
  }
  const overFigure = target.closest('.adminv2-asset-figure[data-asset-id][data-asset-kind]');
  if (!overFigure || overFigure.dataset.assetKind !== 'image') {
    clearImageDragState();
    return;
  }

  handleImageAssetDrop(overFigure, event.clientX)
    .catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    })
    .finally(() => {
      clearImageDragState();
    });
}

function onDetailDragEnd() {
  clearImageDragState();
}

function onRootClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  const action = String(actionNode.dataset.action || '');
  if (action !== 'back-to-gallery-main') return;

  event.preventDefault();
  goToGallery().catch((error) => {
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
  });
}

function onTagDialogClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  const action = String(actionNode.dataset.action || '');
  if (action === 'remove-tag') {
    event.preventDefault();
    removeTag(actionNode.dataset.tag || '').catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
  }
}

function onTagDialogKeyDown(event) {
  if (event.key !== 'Enter') return;
  if (event.target !== els.tagDialogInput) return;

  event.preventDefault();
  addTagsFromDialogInput().catch((error) => {
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
  });
}

function onPaletteDialogClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  const action = String(actionNode.dataset.action || '');
  if (action === 'toggle-palette-delete') {
    event.preventDefault();
    const color = String(actionNode.dataset.color || '').trim();
    if (!color) return;

    const armed = String(state.ui.armedPaletteDeleteColor || '').toLowerCase();
    if (armed === color.toLowerCase()) {
      removePaletteColor(color).catch((error) => {
        setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
      });
      return;
    }

    state.ui.armedPaletteDeleteColor = color;
    renderPaletteDialog();
  }
}

function onPaletteDialogKeyDown(event) {
  if (event.key !== 'Enter') return;
  if (event.target !== els.paletteDialogPicker) return;

  event.preventDefault();
  addPaletteColorFromDialogPicker().catch((error) => {
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
  });
}

function onDetailChange(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const role = target.getAttribute('data-role');
  if (role !== 'style-template-select') return;

  const value = target instanceof HTMLSelectElement ? target.value : '';
  updateStyleTemplate(value).catch((error) => {
    setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
  });
}

function onCoverDialogClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  const action = String(actionNode.dataset.action || '');
  if (action === 'choose-cover-asset') {
    event.preventDefault();
    setCoverAsset(actionNode.dataset.assetId || '').catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
    return;
  }

  if (action === 'add-cover-photo') {
    event.preventDefault();
    closeCoverDialog();
    openAssetPicker();
  }
}

function onRoutePopState() {
  const postId = readRoutePostId();
  if (postId) {
    goToDetail(postId, { pushHistory: false }).catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
    });
    return;
  }

  goToGallery({ pushHistory: false }).catch((error) => {
    setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
  });
}

function wireEvents() {
  els.filterBar?.addEventListener('click', onFilterChipClick);
  els.root?.addEventListener('click', onRootClick);

  els.reorderToggle?.addEventListener('click', () => {
    if (state.filter !== 'all') {
      setFeedback('Switch to All view to reorder posts.', { type: 'warn', scope: 'gallery' });
      return;
    }

    state.reorderMode = !state.reorderMode;
    renderGallery();
  });

  els.viewCardsBtn?.addEventListener('click', () => {
    if (state.galleryView === 'cards') return;
    state.galleryView = 'cards';
    renderGallery();
  });

  els.viewListBtn?.addEventListener('click', () => {
    if (state.galleryView === 'list') return;
    state.galleryView = 'list';
    renderGallery();
  });

  els.addNewBtn?.addEventListener('click', () => {
    createNewProject().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
    });
  });

  els.syncBtn?.addEventListener('click', () => {
    syncSite().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: state.mode === 'detail' ? 'detail' : 'gallery', timeout: 9000 });
    });
  });

  els.galleryGrid?.addEventListener('click', onGalleryClick);
  els.galleryGrid?.addEventListener('dragstart', onGalleryDragStart);
  els.galleryGrid?.addEventListener('dragover', onGalleryDragOver);
  els.galleryGrid?.addEventListener('drop', onGalleryDrop);
  els.galleryGrid?.addEventListener('dragend', onGalleryDragEnd);

  els.detailMount?.addEventListener('click', onDetailClick);
  els.detailMount?.addEventListener('dragstart', onDetailDragStart);
  els.detailMount?.addEventListener('dragover', onDetailDragOver);
  els.detailMount?.addEventListener('drop', onDetailDrop);
  els.detailMount?.addEventListener('dragend', onDetailDragEnd);
  els.detailMount?.addEventListener('focusin', handleEditableFocusIn);
  els.detailMount?.addEventListener('input', handleEditableInput);
  els.detailMount?.addEventListener('change', onDetailChange);
  els.detailMount?.addEventListener('focusout', handleEditableBlur, true);

  els.coverCloseBtn?.addEventListener('click', () => {
    closeCoverDialog();
  });

  els.coverDialog?.addEventListener('click', (event) => {
    if (event.target === els.coverDialog) {
      closeCoverDialog();
    }
  });

  els.coverDialog?.addEventListener('click', onCoverDialogClick);

  els.assetCloseBtn?.addEventListener('click', () => {
    closeAssetDialog();
  });

  els.assetSaveBtn?.addEventListener('click', () => {
    saveAssetFromDialog().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
  });

  els.assetDeleteBtn?.addEventListener('click', () => {
    if (!state.ui.activeAssetId) return;
    deleteAssetById(state.ui.activeAssetId, { confirmDelete: true })
      .then(() => {
        closeAssetDialog();
      })
      .catch((error) => {
        setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
      });
  });

  els.assetDialog?.addEventListener('click', (event) => {
    if (event.target === els.assetDialog) {
      closeAssetDialog();
    }
  });

  els.tagCloseBtn?.addEventListener('click', () => {
    closeTagDialog();
  });

  els.tagAddBtn?.addEventListener('click', () => {
    addTagsFromDialogInput().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
  });

  els.tagDialog?.addEventListener('click', (event) => {
    if (event.target === els.tagDialog) {
      closeTagDialog();
      return;
    }
    onTagDialogClick(event);
  });

  els.tagDialog?.addEventListener('keydown', onTagDialogKeyDown);

  els.paletteCloseBtn?.addEventListener('click', () => {
    closePaletteDialog();
  });

  els.paletteAddBtn?.addEventListener('click', () => {
    addPaletteColorFromDialogPicker().catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
    });
  });

  els.paletteDialog?.addEventListener('click', (event) => {
    if (event.target === els.paletteDialog) {
      closePaletteDialog();
      return;
    }
    onPaletteDialogClick(event);
  });
  els.paletteDialog?.addEventListener('keydown', onPaletteDialogKeyDown);

  els.fileInput?.addEventListener('change', () => {
    const files = Array.from(els.fileInput?.files || []);
    if (!files.length) return;

    uploadFiles(files).catch((error) => {
      setFeedback(error.message, { type: 'error', scope: 'detail', timeout: 7000 });
      state.upload.busy = false;
      renderDetail();
    });

    if (els.fileInput) {
      els.fileInput.value = '';
    }
  });

  window.addEventListener('popstate', onRoutePopState);
}

async function init() {
  try {
    const routePostId = readRoutePostId();
    state.mode = routePostId ? 'detail' : 'gallery';
    applyModeToView();
    wireEvents();

    await loadProjects();
    if (routePostId) {
      await goToDetail(routePostId, { pushHistory: false, replaceHistory: true });
      return;
    }

    renderGallery();
    await goToGallery({ pushHistory: false, replaceHistory: true });
  } catch (error) {
    setFeedback(error.message, { type: 'error', scope: 'gallery', timeout: 7000 });
  }
}

init();
