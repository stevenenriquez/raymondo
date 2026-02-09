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
  postsState: {
    /** @type {AdminProject[]} */
    projects: [],
    scope: 'all',
    search: '',
    reorderMode: false,
    dragProjectId: null,
    dragProjectStatus: null
  },
  editorState: {
    activeId: null,
    /** @type {AdminProject|null} */
    activeProject: null,
    isSaving: false,
    queuedSave: null,
    isPopulating: false,
    hasDirtyChanges: false,
    lastSavedFingerprint: '',
    saveState: 'saved',
    autosaveTimer: null
  },
  mediaState: {
    selectedAssetId: null,
    dragAssetId: null,
    /** @type {Map<string, object>} */
    assetDrafts: new Map(),
    uploadQueue: []
  },
  uiState: {
    mobileTab: 'posts',
    feedbackTimer: null,
    pendingLiveChanges: false
  }
};

const els = {
  root: document.getElementById('adminV3Root'),
  feedback: document.getElementById('feedback'),
  mobileTabBar: document.getElementById('mobileTabBar'),
  newPostBtn: document.getElementById('newPostBtn'),
  reorderToggleBtn: document.getElementById('reorderToggleBtn'),
  postSearchInput: document.getElementById('postSearchInput'),
  postScopeBar: document.getElementById('postScopeBar'),
  draftsCount: document.getElementById('draftsCount'),
  publishedCount: document.getElementById('publishedCount'),
  draftPostList: document.getElementById('draftPostList'),
  publishedPostList: document.getElementById('publishedPostList'),
  form: document.getElementById('projectForm'),
  activeProjectLabel: document.getElementById('activeProjectLabel'),
  projectStatusBadge: document.getElementById('projectStatusBadge'),
  saveStateChip: document.getElementById('saveStateChip'),
  livePendingChip: document.getElementById('livePendingChip'),
  saveNowBtn: document.getElementById('saveNowBtn'),
  previewBtn: document.getElementById('previewBtn'),
  republishSiteBtn: document.getElementById('republishSiteBtn'),
  publishToggleBtn: document.getElementById('publishToggleBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  tagsField: document.getElementById('tagsField'),
  tagEditorInput: document.getElementById('tagEditorInput'),
  tagAddBtn: document.getElementById('tagAddBtn'),
  tagChipList: document.getElementById('tagChipList'),
  paletteField: document.getElementById('paletteField'),
  paletteTextInput: document.getElementById('paletteTextInput'),
  paletteApplyBtn: document.getElementById('paletteApplyBtn'),
  paletteColorPicker: document.getElementById('paletteColorPicker'),
  paletteAddColorBtn: document.getElementById('paletteAddColorBtn'),
  paletteChipList: document.getElementById('paletteChipList'),
  palettePreview: document.getElementById('palettePreview'),
  assetsSection: document.getElementById('assetsSection'),
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  uploadStatus: document.getElementById('uploadStatus'),
  assetList: document.getElementById('assetList'),
  mobileSaveBtn: document.getElementById('mobileSaveBtn'),
  mobilePreviewBtn: document.getElementById('mobilePreviewBtn'),
  mobileRepublishBtn: document.getElementById('mobileRepublishBtn'),
  mobilePublishBtn: document.getElementById('mobilePublishBtn'),
  mobileDeleteBtn: document.getElementById('mobileDeleteBtn'),
  blockerDialog: document.getElementById('blockerDialog'),
  blockerIntro: document.getElementById('blockerIntro'),
  blockerList: document.getElementById('blockerList'),
  blockerCloseBtn: document.getElementById('blockerCloseBtn'),
  previewDialog: document.getElementById('previewDialog'),
  previewDialogIntro: document.getElementById('previewDialogIntro'),
  previewDialogContent: document.getElementById('previewDialogContent'),
  previewCloseBtn: document.getElementById('previewCloseBtn'),
  previewOpenRouteBtn: document.getElementById('previewOpenRouteBtn')
};

const MODEL_FILE_EXTENSIONS = ['.glb', '.gltf'];
const CURRENT_YEAR = new Date().getFullYear();

function setFeedback(type, text, options = {}) {
  const { timeout = type === 'error' ? 7000 : 3500 } = options;
  if (!els.feedback) return;

  clearTimeout(state.uiState.feedbackTimer);
  els.feedback.innerHTML = `<p class="feedback ${type}">${escapeHtml(text)}</p>`;

  if (timeout > 0) {
    state.uiState.feedbackTimer = setTimeout(() => {
      clearFeedback();
    }, timeout);
  }
}

function clearFeedback() {
  if (!els.feedback) return;
  clearTimeout(state.uiState.feedbackTimer);
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
        `Expected JSON from ${path}, but received HTML (status ${response.status}). If running locally, start with "npm run dev:cloudflare".`
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
  return els.form?.elements.namedItem(name);
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
  state.editorState.saveState = nextState;

  const copy =
    textOverride ||
    {
      saved: 'All changes saved',
      saving: 'Saving changes...',
      unsaved: 'Unsaved changes',
      error: 'Needs attention'
    }[nextState] || 'All changes saved';

  if (els.saveStateChip) {
    els.saveStateChip.textContent = copy;
    els.saveStateChip.classList.remove('saved', 'saving', 'unsaved', 'error');
    els.saveStateChip.classList.add(nextState);
  }
}

function renderLivePendingState() {
  const pending = state.uiState.pendingLiveChanges;

  if (els.livePendingChip) {
    els.livePendingChip.textContent = pending ? 'Live changes pending republish' : 'Live is up to date';
    els.livePendingChip.classList.remove('pending', 'clean');
    els.livePendingChip.classList.add(pending ? 'pending' : 'clean');
  }

  if (els.republishSiteBtn) {
    els.republishSiteBtn.disabled = !pending;
  }

  if (els.mobileRepublishBtn) {
    els.mobileRepublishBtn.disabled = !pending;
  }
}

function markLiveChangesPending() {
  if (!state.uiState.pendingLiveChanges) {
    state.uiState.pendingLiveChanges = true;
  }
  renderLivePendingState();
}

function clearLiveChangesPending() {
  if (state.uiState.pendingLiveChanges) {
    state.uiState.pendingLiveChanges = false;
  }
  renderLivePendingState();
}

function projectPayloadFromForm(statusOverride, sortOrderOverride) {
  const activeProject = state.editorState.activeProject;

  return {
    id: readField('id') || undefined,
    slug: normalizeSpaces(readField('slug')),
    title: normalizeSpaces(readField('title')),
    discipline: readField('discipline') || 'graphic',
    status: statusOverride || activeProject?.status || 'draft',
    year: parseOptionalNumber(readField('year')),
    sortOrder:
      sortOrderOverride === undefined
        ? Number(activeProject?.sortOrder ?? 0)
        : Number(sortOrderOverride || 0),
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

function payloadFingerprint(payload) {
  return JSON.stringify(payload);
}

function markDirty() {
  if (!state.editorState.activeProject || state.editorState.isPopulating) return;
  state.editorState.hasDirtyChanges = true;
  setSaveState('unsaved');
}

function scheduleAutosave(delay = 800) {
  if (!state.editorState.activeProject || state.editorState.isPopulating) return;

  clearTimeout(state.editorState.autosaveTimer);
  state.editorState.autosaveTimer = setTimeout(() => {
    saveProject({ autosave: true }).catch((error) => setFeedback('error', error.message));
  }, delay);
}

function clearAutosaveTimer() {
  clearTimeout(state.editorState.autosaveTimer);
  state.editorState.autosaveTimer = null;
}

function syncThreeDFields() {
  const is3d = readField('discipline') === '3d';
  document.querySelectorAll('.three-d-only').forEach((node) => {
    node.hidden = !is3d;
  });
}

function getTagsFromField() {
  return uniqueTokens(
    normalizeCommaList(readField('tags'))
      .map((token) => normalizeSpaces(token))
      .filter(Boolean),
    { caseInsensitive: true }
  );
}

function renderTagChipList(tags = getTagsFromField()) {
  if (!els.tagChipList) return;

  if (!tags.length) {
    els.tagChipList.innerHTML = '<span class="admin-v3-chip-empty notice">No tags added.</span>';
    return;
  }

  els.tagChipList.innerHTML = tags
    .map(
      (tag) => `
        <span class="admin-v3-chip">
          <span>${escapeHtml(tag)}</span>
          <button type="button" class="admin-v3-chip-remove" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove tag ${escapeHtml(tag)}">×</button>
        </span>
      `
    )
    .join('');
}

function setTagsToField(tags, options = {}) {
  const { mark = false } = options;
  const normalized = uniqueTokens(
    (tags || [])
      .map((token) => normalizeSpaces(token))
      .filter(Boolean),
    { caseInsensitive: true }
  );

  writeField('tags', normalized.join(','));
  renderTagChipList(normalized);

  if (mark) {
    markDirty();
    scheduleAutosave(250);
  }
}

function consumeTagInput(options = {}) {
  if (!els.tagEditorInput) return;
  const { replace = false } = options;

  const raw = String(els.tagEditorInput.value || '').trim();
  if (!raw) return;

  const incoming = uniqueTokens(
    normalizeCommaList(raw)
      .map((token) => normalizeSpaces(token))
      .filter(Boolean),
    { caseInsensitive: true }
  );

  if (!incoming.length) return;

  const next = replace ? incoming : [...getTagsFromField(), ...incoming];
  setTagsToField(next, { mark: true });
  els.tagEditorInput.value = '';
}

function getPaletteFromField() {
  return uniqueTokens(
    normalizeCommaList(readField('palette'))
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

function normalizePaletteToken(token) {
  const next = String(token || '').trim();
  if (!next) return null;
  return sanitizeSwatchColor(next) ? next : null;
}

function renderPaletteChipList(colors = getPaletteFromField()) {
  if (!els.paletteChipList) return;

  if (!colors.length) {
    els.paletteChipList.innerHTML = '<span class="admin-v3-chip-empty notice">No colors added.</span>';
    return;
  }

  els.paletteChipList.innerHTML = colors
    .map((color) => {
      const safeColor = sanitizeSwatchColor(color) || '#000000';
      return `
        <span class="admin-v3-chip admin-v3-color-chip">
          <span class="admin-v3-color-chip-swatch" style="background:${escapeHtml(safeColor)}" aria-hidden="true"></span>
          <span>${escapeHtml(color)}</span>
          <button type="button" class="admin-v3-chip-remove" data-remove-color="${escapeHtml(color)}" aria-label="Remove color ${escapeHtml(color)}">×</button>
        </span>
      `;
    })
    .join('');
}

function setPaletteToField(colors, options = {}) {
  const { mark = false, syncTextInput = true } = options;
  const normalized = uniqueTokens(
    (colors || [])
      .map((token) => normalizePaletteToken(token))
      .filter(Boolean)
  );

  writeField('palette', normalized.join(','));

  if (syncTextInput && els.paletteTextInput) {
    els.paletteTextInput.value = normalized.join(',');
  }

  renderPaletteChipList(normalized);
  renderPalettePreview();

  if (mark) {
    markDirty();
    scheduleAutosave(250);
  }
}

function applyPaletteTextInput() {
  if (!els.paletteTextInput) return;

  const raw = String(els.paletteTextInput.value || '').trim();
  const tokens = normalizeCommaList(raw);
  if (!tokens.length) {
    setPaletteToField([], { mark: true });
    return;
  }

  const valid = [];
  const invalid = [];
  for (const token of tokens) {
    const next = normalizePaletteToken(token);
    if (next) {
      valid.push(next);
    } else {
      invalid.push(token);
    }
  }

  setPaletteToField(valid, { mark: true });

  if (invalid.length) {
    setFeedback('warn', `Skipped invalid color value(s): ${invalid.join(', ')}`);
  }
}

function addPaletteColorFromPicker() {
  if (!els.paletteColorPicker) return;
  const token = normalizePaletteToken(els.paletteColorPicker.value);
  if (!token) return;
  setPaletteToField([...getPaletteFromField(), token], { mark: true });
}

function syncTagAndPaletteEditors() {
  renderTagChipList();
  renderPaletteChipList();

  if (els.paletteTextInput) {
    els.paletteTextInput.value = readField('palette');
  }

  if (els.tagEditorInput) {
    els.tagEditorInput.value = '';
  }

  renderPalettePreview();
}

function renderPalettePreview() {
  if (!els.palettePreview) return;

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

function getSortedProjects(projects = state.postsState.projects) {
  return [...projects].sort(compareProjectsByOrder);
}

function isScopeMatch(project) {
  const scope = state.postsState.scope;
  if (scope === 'all') return true;
  if (scope === 'draft') return project.status === 'draft';
  if (scope === 'published') return project.status === 'published';
  return true;
}

function isSearchMatch(project) {
  const query = state.postsState.search.trim().toLowerCase();
  if (!query) return true;
  const haystack = `${project.title || ''} ${project.slug || ''}`.toLowerCase();
  return haystack.includes(query);
}

function getVisibleProjects() {
  return getSortedProjects().filter((project) => isScopeMatch(project) && isSearchMatch(project));
}

function getStatusBadge(project) {
  const tone = getStatusClass(project.status);
  return `<span class="status-pill ${tone}">${escapeHtml(project.status)}</span>`;
}

function getDisciplineBadge(project) {
  const label = project.discipline === '3d' ? '3D' : 'Graphic';
  return `<span class="status-pill admin-v3-discipline-pill">${escapeHtml(label)}</span>`;
}

function getScopeCount(scope) {
  return state.postsState.projects.filter((project) => scope === 'all' || project.status === scope).length;
}

function renderScopeBar() {
  if (!els.postScopeBar) return;
  els.postScopeBar.querySelectorAll('[data-scope]').forEach((button) => {
    const nextScope = button.dataset.scope || 'all';
    const isActive = nextScope === state.postsState.scope;
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');

    const countEl = button.querySelector('.admin-v3-scope-count');
    if (!countEl) return;

    const count = nextScope === 'all' ? getScopeCount('all') : getScopeCount(nextScope);
    countEl.textContent = String(count);
  });
}

function canReorderPosts() {
  return state.postsState.reorderMode && state.postsState.scope === 'all' && !state.postsState.search.trim();
}

function renderReorderToggle() {
  if (!els.reorderToggleBtn) return;

  const canEnable = state.postsState.scope === 'all' && !state.postsState.search.trim();
  els.reorderToggleBtn.disabled = !canEnable;
  els.reorderToggleBtn.setAttribute('aria-pressed', state.postsState.reorderMode ? 'true' : 'false');
  els.reorderToggleBtn.textContent = state.postsState.reorderMode ? 'Done Reordering' : 'Reorder';
}

function projectItemMarkup(project, collection, index) {
  const isActive = project.id === state.editorState.activeId;
  const reorderEnabled = canReorderPosts();
  const isFirst = index === 0;
  const isLast = index === collection.length - 1;
  const isDeleteDisabled = project.status === 'published';
  const deleteTitle = isDeleteDisabled ? 'Only draft posts can be deleted' : 'Delete draft';

  return `
    <li
      class="admin-v3-post-item ${isActive ? 'active' : ''}"
      data-project-id="${escapeHtml(project.id)}"
      data-project-status="${escapeHtml(project.status)}"
      draggable="${reorderEnabled ? 'true' : 'false'}"
    >
      <div class="admin-v3-post-row ${reorderEnabled ? 'is-reorder' : ''}">
        ${
          reorderEnabled
            ? `
          <div class="admin-v3-reorder-controls" aria-label="Reorder controls">
            <button type="button" class="admin-v3-reorder-btn" data-action="move-up" data-project-id="${escapeHtml(project.id)}" ${isFirst ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button type="button" class="admin-v3-reorder-btn" data-action="move-down" data-project-id="${escapeHtml(project.id)}" ${isLast ? 'disabled' : ''} aria-label="Move down">↓</button>
          </div>
        `
            : ''
        }
        <div class="admin-v3-post-main">
          <div class="admin-v3-post-top">
            <button type="button" class="admin-v3-post-open" data-action="open-post" data-project-id="${escapeHtml(project.id)}">
              <span class="admin-v3-post-title">${escapeHtml(project.title || 'Untitled post')}</span>
              <span class="admin-v3-post-meta">/${escapeHtml(project.slug || 'no-slug')}</span>
              <span class="admin-v3-post-pills">${getStatusBadge(project)} ${getDisciplineBadge(project)}</span>
            </button>
            <button
              type="button"
              class="admin-v3-delete-icon-btn"
              data-action="delete"
              data-project-id="${escapeHtml(project.id)}"
              ${isDeleteDisabled ? 'disabled' : ''}
              aria-label="${deleteTitle}"
              title="${deleteTitle}"
            >🗑</button>
          </div>
        </div>
      </div>
    </li>
  `;
}

function renderPostGroups() {
  renderScopeBar();
  renderReorderToggle();

  const visible = getVisibleProjects();
  const draftPosts = visible.filter((project) => project.status === 'draft');
  const publishedPosts = visible.filter((project) => project.status === 'published');

  if (els.draftsCount) {
    els.draftsCount.textContent = `${draftPosts.length}`;
  }

  if (els.publishedCount) {
    els.publishedCount.textContent = `${publishedPosts.length}`;
  }

  if (els.draftPostList) {
    els.draftPostList.innerHTML = draftPosts.length
      ? draftPosts.map((project, index) => projectItemMarkup(project, draftPosts, index)).join('')
      : '<li class="admin-v3-empty">No draft posts in this filter.</li>';
  }

  if (els.publishedPostList) {
    els.publishedPostList.innerHTML = publishedPosts.length
      ? publishedPosts.map((project, index) => projectItemMarkup(project, publishedPosts, index)).join('')
      : '<li class="admin-v3-empty">No published posts in this filter.</li>';
  }

  updateToolbarState();
}

function updateToolbarState() {
  const project = state.editorState.activeProject;
  const publishLabel = project?.status === 'published' ? 'Unpublish' : 'Publish';
  renderLivePendingState();

  if (!project) {
    if (els.activeProjectLabel) els.activeProjectLabel.textContent = 'No post selected';
    if (els.projectStatusBadge) {
      els.projectStatusBadge.textContent = 'draft';
      els.projectStatusBadge.classList.remove('published');
      els.projectStatusBadge.classList.add('draft');
    }

    [els.saveNowBtn, els.previewBtn, els.publishToggleBtn, els.deleteBtn, els.mobileSaveBtn, els.mobilePreviewBtn, els.mobilePublishBtn, els.mobileDeleteBtn].forEach((node) => {
      if (node) node.disabled = true;
    });

    return;
  }

  if (els.activeProjectLabel) {
    els.activeProjectLabel.textContent = `${project.title || 'Untitled post'} (${project.slug || 'no-slug'})`;
  }

  if (els.projectStatusBadge) {
    els.projectStatusBadge.textContent = project.status;
    els.projectStatusBadge.classList.remove('draft', 'published');
    els.projectStatusBadge.classList.add(getStatusClass(project.status));
  }

  if (els.publishToggleBtn) {
    els.publishToggleBtn.textContent = publishLabel;
    els.publishToggleBtn.disabled = false;
  }

  if (els.mobilePublishBtn) {
    els.mobilePublishBtn.textContent = publishLabel;
    els.mobilePublishBtn.disabled = false;
  }

  if (els.deleteBtn) {
    els.deleteBtn.disabled = project.status !== 'draft';
  }

  if (els.mobileDeleteBtn) {
    els.mobileDeleteBtn.disabled = project.status !== 'draft';
  }

  [els.saveNowBtn, els.previewBtn, els.mobileSaveBtn, els.mobilePreviewBtn].forEach((node) => {
    if (node) node.disabled = false;
  });
}

function getActiveProject() {
  return state.editorState.activeProject;
}

function populateForm(project) {
  state.editorState.isPopulating = true;

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
  syncTagAndPaletteEditors();
  updateToolbarState();

  const payload = projectPayloadFromForm();
  state.editorState.lastSavedFingerprint = payloadFingerprint(payload);
  state.editorState.hasDirtyChanges = false;
  setSaveState('saved');

  state.editorState.isPopulating = false;
}

function clearEditor() {
  state.editorState.activeId = null;
  state.editorState.activeProject = null;
  state.mediaState.selectedAssetId = null;
  state.mediaState.dragAssetId = null;
  state.mediaState.assetDrafts = new Map();

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

  syncTagAndPaletteEditors();
  syncThreeDFields();
  renderAssetEditors([]);
  clearUploadQueue();
  updateToolbarState();
  setSaveState('saved');
}

function syncActiveSummary() {
  const activeProject = getActiveProject();
  if (!activeProject) return;

  const index = state.postsState.projects.findIndex((item) => item.id === activeProject.id);
  if (index === -1) return;

  state.postsState.projects[index] = {
    ...state.postsState.projects[index],
    id: activeProject.id,
    slug: activeProject.slug,
    title: activeProject.title,
    discipline: activeProject.discipline,
    status: activeProject.status,
    sortOrder: activeProject.sortOrder,
    descriptionShort: activeProject.descriptionShort,
    tags: activeProject.tags,
    coverAssetId: activeProject.coverAssetId,
    readiness: activeProject.readiness
  };
}

function focusPrimaryTitleField() {
  const titleField = field('title');
  if (titleField && typeof titleField.focus === 'function') {
    titleField.focus();
    titleField.select?.();
  }
}

async function loadProjects(preferredId = null) {
  const payload = await api('/api/admin/projects');
  state.postsState.projects = payload.projects || [];

  if (!state.postsState.projects.length) {
    renderPostGroups();
    clearEditor();
    return;
  }

  const activeId = state.editorState.activeId;
  const preferredExists = preferredId && state.postsState.projects.some((project) => project.id === preferredId);
  const activeExists = activeId && state.postsState.projects.some((project) => project.id === activeId);
  const nextId = preferredExists ? preferredId : activeExists ? activeId : getSortedProjects()[0].id;

  renderPostGroups();
  await openProject(nextId, { skipListRender: true, switchToEditOnMobile: false });
}

async function openProject(id, options = {}) {
  if (!id) return;

  clearAutosaveTimer();

  const payload = await api(`/api/admin/projects/${id}`);
  state.editorState.activeId = id;
  state.editorState.activeProject = payload.project;

  state.mediaState.selectedAssetId = null;
  state.mediaState.dragAssetId = null;
  state.mediaState.assetDrafts = new Map();

  populateForm(payload.project);
  renderAssetEditors(payload.project.assets || []);
  syncActiveSummary();

  if (!options.skipListRender) {
    renderPostGroups();
  }

  if (options.switchToEditOnMobile !== false) {
    setMobileTab('edit');
  }
}

function getNextDraftSortOrder() {
  const drafts = state.postsState.projects.filter((project) => project.status === 'draft');
  if (!drafts.length) return 100;
  const maxOrder = drafts.reduce((max, project) => Math.max(max, getProjectSortOrder(project)), 0);
  return maxOrder + 100;
}

function getNextPublishedSortOrder() {
  const published = state.postsState.projects.filter((project) => project.status === 'published');
  if (!published.length) return 100100;
  const maxOrder = published.reduce((max, project) => Math.max(max, getProjectSortOrder(project)), 100000);
  return maxOrder + 100;
}

async function saveProject(options = {}) {
  const activeProject = getActiveProject();
  if (!activeProject) return null;
  const wasPublishedBeforeSave = activeProject.status === 'published';

  const { autosave = false, statusOverride, silent = false, sortOrderOverride } = options;
  const payload = projectPayloadFromForm(statusOverride, sortOrderOverride);

  if (!payload.slug) {
    state.editorState.hasDirtyChanges = true;

    if (autosave) {
      setSaveState('unsaved', 'Slug is required');
      return activeProject;
    }

    setSaveState('error');
    if (!silent) setFeedback('error', 'Slug is required.');
    throw new Error('Slug is required.');
  }

  const nextFingerprint = payloadFingerprint(payload);
  if (
    autosave &&
    !state.editorState.hasDirtyChanges &&
    nextFingerprint === state.editorState.lastSavedFingerprint
  ) {
    return activeProject;
  }

  if (state.editorState.isSaving) {
    state.editorState.queuedSave = options;
    return null;
  }

  state.editorState.isSaving = true;
  setSaveState('saving');

  try {
    const response = await api('/api/admin/projects', {
      method: 'POST',
      body: JSON.stringify({ ...payload, autosave })
    });

    if (!response.project) {
      throw new Error('Project save response is missing project data.');
    }

    state.editorState.activeProject = response.project;
    state.editorState.activeId = response.project.id;

    if (wasPublishedBeforeSave || response.project.status === 'published') {
      markLiveChangesPending();
    }

    populateForm(response.project);
    renderAssetEditors(response.project.assets || []);
    syncActiveSummary();
    renderPostGroups();

    if (!autosave && !silent) {
      setFeedback('success', 'Post saved.');
    }

    return response.project;
  } catch (error) {
    state.editorState.hasDirtyChanges = true;
    setSaveState('error');

    if (!silent || !autosave) {
      setFeedback('error', error.message);
    }

    throw error;
  } finally {
    state.editorState.isSaving = false;

    if (state.editorState.queuedSave) {
      const queued = state.editorState.queuedSave;
      state.editorState.queuedSave = null;
      setTimeout(() => {
        saveProject(queued).catch((error) => setFeedback('error', error.message));
      }, 0);
    }
  }
}

async function createNewPost() {
  clearFeedback();

  const now = Date.now();
  const response = await api('/api/admin/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: 'New Post',
      slug: `new-post-${now}`,
      discipline: 'graphic',
      status: 'draft',
      year: CURRENT_YEAR,
      descriptionShort: '',
      descriptionLong: '',
      sortOrder: getNextDraftSortOrder(),
      palette: [],
      tags: []
    })
  });

  await loadProjects(response.project.id);
  await openProject(response.project.id, { skipListRender: false, switchToEditOnMobile: true });
  focusPrimaryTitleField();
  setFeedback('success', 'Draft created. Fill in the essentials to get started.');
}

function openBlockerDialog(blockers, headingText) {
  if (!els.blockerDialog || !els.blockerIntro || !els.blockerList) return;

  els.blockerIntro.textContent = headingText || 'Fix the items below before publishing.';
  els.blockerList.innerHTML = '';

  for (const blocker of blockers) {
    const li = document.createElement('li');
    li.textContent = blocker;
    els.blockerList.appendChild(li);
  }

  if (!blockers.length) {
    const li = document.createElement('li');
    li.className = 'is-clear';
    li.textContent = 'No blockers found.';
    els.blockerList.appendChild(li);
  }

  if (typeof els.blockerDialog.showModal === 'function') {
    if (!els.blockerDialog.open) els.blockerDialog.showModal();
  } else {
    els.blockerDialog.setAttribute('open', '');
  }
}

function closeBlockerDialog() {
  if (!els.blockerDialog) return;

  if (typeof els.blockerDialog.close === 'function') {
    if (els.blockerDialog.open) els.blockerDialog.close();
  } else {
    els.blockerDialog.removeAttribute('open');
  }
}

function getDryRunBlockers(dryRunPayload) {
  const blockers = [];

  if (Array.isArray(dryRunPayload?.errors)) {
    blockers.push(...dryRunPayload.errors);
  }

  const globalBlocked = (dryRunPayload?.readiness || []).filter((entry) => !entry.canPublish);
  for (const entry of globalBlocked) {
    const firstIssue = entry.hardMissing?.[0] || 'Missing required fields';
    blockers.push(`Published post "${entry.title}": ${firstIssue}`);
  }

  return [...new Set(blockers)];
}

async function setProjectStatusOnly(projectId, nextStatus) {
  const project = state.postsState.projects.find((item) => item.id === projectId);
  if (!project) {
    setFeedback('error', 'Post not found.');
    return;
  }

  if (state.editorState.activeId === projectId && state.editorState.hasDirtyChanges) {
    await saveProject({ autosave: false, silent: true });
    await openProject(projectId, { switchToEditOnMobile: false });
  }

  clearFeedback();

  const sortOrder = nextStatus === 'published' ? getNextPublishedSortOrder() : getNextDraftSortOrder();

  await api('/api/admin/projects', {
    method: 'POST',
    body: JSON.stringify({
      id: projectId,
      status: nextStatus,
      sortOrder,
      autosave: true
    })
  });

  markLiveChangesPending();
  if (nextStatus === 'published') {
    setFeedback('success', 'Marked as published. Click "Republish Site" to deploy all pending changes.');
  } else {
    setFeedback('success', 'Moved to draft. Click "Republish Site" to update the live site.');
  }

  await loadProjects(projectId);
  await openProject(projectId, { switchToEditOnMobile: false });
}

async function publishPost(projectId) {
  await setProjectStatusOnly(projectId, 'published');
}

async function unpublishPost(projectId) {
  const project = state.postsState.projects.find((item) => item.id === projectId);
  if (!project) {
    setFeedback('error', 'Post not found.');
    return;
  }

  const confirmed = window.confirm(
    `Move "${project.title || 'Untitled post'}" back to draft? This change will go live after you click "Republish Site".`
  );
  if (!confirmed) return;

  await setProjectStatusOnly(projectId, 'draft');
}

async function togglePublishPost(projectId) {
  const project = state.postsState.projects.find((item) => item.id === projectId);
  if (!project) return;

  if (project.status === 'published') {
    await unpublishPost(projectId);
    return;
  }

  await publishPost(projectId);
}

async function republishSite() {
  const confirmed = window.confirm(
    'Republish site now? This will trigger a new deployment and publish all pending new or updated posts and ordering changes.'
  );
  if (!confirmed) return;

  if (els.republishSiteBtn) {
    els.republishSiteBtn.disabled = true;
    els.republishSiteBtn.textContent = 'Republishing...';
  }
  if (els.mobileRepublishBtn) {
    els.mobileRepublishBtn.disabled = true;
    els.mobileRepublishBtn.textContent = 'Republishing...';
  }

  try {
    if (state.editorState.hasDirtyChanges && state.editorState.activeId) {
      await saveProject({ autosave: false, silent: true });
      await openProject(state.editorState.activeId, { switchToEditOnMobile: false });
    }

    const dryRun = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true })
    });

    const blockers = getDryRunBlockers(dryRun);
    if (blockers.length > 0) {
      openBlockerDialog(blockers, 'Republish is blocked until these issues are fixed.');
      return;
    }

    const publishPayload = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const warningText = publishPayload.warnings?.length
      ? ` Warnings: ${publishPayload.warnings.join(' | ')}`
      : '';

    clearLiveChangesPending();
    setFeedback('success', `Republished. Snapshot: ${publishPayload.snapshotKey}.${warningText}`);

    await loadProjects(state.editorState.activeId);
  } finally {
    if (els.republishSiteBtn) {
      els.republishSiteBtn.textContent = 'Republish Site';
    }
    if (els.mobileRepublishBtn) {
      els.mobileRepublishBtn.textContent = 'Republish';
    }
    renderLivePendingState();
  }
}

async function deleteDraftPost(projectId) {
  const project = state.postsState.projects.find((item) => item.id === projectId);
  if (!project) {
    setFeedback('error', 'Post not found.');
    return;
  }

  if (project.status !== 'draft') {
    setFeedback('error', 'Only draft posts can be deleted.');
    return;
  }

  const confirmed = window.confirm(
    `Delete draft "${project.title || 'Untitled post'}"? This removes all attached assets and cannot be undone.`
  );
  if (!confirmed) return;

  const sorted = getSortedProjects();
  const index = sorted.findIndex((item) => item.id === projectId);
  const fallbackId = sorted[index + 1]?.id || sorted[index - 1]?.id || null;

  clearFeedback();

  const payload = await api(`/api/admin/projects/${projectId}`, {
    method: 'DELETE',
    body: JSON.stringify({})
  });

  if (payload.warning) {
    setFeedback('warn', `Draft deleted. R2 warning: ${payload.warning}`);
  } else {
    setFeedback('success', 'Draft deleted.');
  }

  if (state.editorState.activeId === projectId) {
    state.editorState.activeId = null;
    state.editorState.activeProject = null;
  }

  await loadProjects(fallbackId);
  if (!fallbackId && state.postsState.projects.length === 0) {
    clearEditor();
  }
}

function applySortUpdates(sortMap) {
  if (!sortMap?.size) return;

  state.postsState.projects = state.postsState.projects.map((project) =>
    sortMap.has(project.id) ? { ...project, sortOrder: sortMap.get(project.id) } : project
  );

  if (state.editorState.activeProject && sortMap.has(state.editorState.activeProject.id)) {
    state.editorState.activeProject = {
      ...state.editorState.activeProject,
      sortOrder: sortMap.get(state.editorState.activeProject.id)
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

function getStatusCollection(status) {
  return getSortedProjects().filter((project) => project.status === status);
}

function buildStatusSortUpdates(status, orderedProjects) {
  const base = status === 'published' ? 100000 : 100;
  return orderedProjects.map((project, index) => ({
    id: project.id,
    sortOrder: base + (index + 1) * 100
  }));
}

async function reorderStatusCollection(status, orderedProjects) {
  const updates = buildStatusSortUpdates(status, orderedProjects);
  const sortMap = new Map(updates.map((item) => [item.id, item.sortOrder]));
  applySortUpdates(sortMap);
  renderPostGroups();
  setSaveState('saving', 'Saving order...');

  try {
    await persistProjectSortUpdates(updates);
    if (status === 'published') {
      markLiveChangesPending();
    }
    setSaveState('saved');
    setFeedback('success', 'Post order updated.');
  } catch (error) {
    setSaveState('error');
    setFeedback('error', error.message);
    await loadProjects(state.editorState.activeId);
  }
}

async function movePostByStep(projectId, direction) {
  const project = state.postsState.projects.find((item) => item.id === projectId);
  if (!project) return;

  const group = getStatusCollection(project.status);
  const index = group.findIndex((item) => item.id === projectId);
  if (index === -1) return;

  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= group.length) return;

  const reordered = [...group];
  const [moving] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moving);

  await reorderStatusCollection(project.status, reordered);
}

function clearPostDragState() {
  state.postsState.dragProjectId = null;
  state.postsState.dragProjectStatus = null;

  [els.draftPostList, els.publishedPostList].forEach((list) => {
    if (!list) return;
    list
      .querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after')
      .forEach((node) => node.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
  });
}

async function handlePostDrop(status, draggedId, overId, pointerY) {
  const group = getStatusCollection(status);
  const sourceIndex = group.findIndex((item) => item.id === draggedId);
  const overIndex = group.findIndex((item) => item.id === overId);

  if (sourceIndex === -1 || overIndex === -1) return;

  const overNode = document.querySelector(`li[data-project-id="${overId}"]`);
  if (!overNode) return;

  const rect = overNode.getBoundingClientRect();
  const isAfter = pointerY >= rect.top + rect.height / 2;
  let targetIndex = overIndex + (isAfter ? 1 : 0);

  if (sourceIndex < targetIndex) targetIndex -= 1;
  if (targetIndex === sourceIndex) return;

  const reordered = [...group];
  const [moving] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moving);

  await reorderStatusCollection(status, reordered);
}

function handlePostInput(event) {
  const target = event.target;
  if (!target || !('name' in target) || !target.name) return;
  if (target.closest('.admin-v2-asset-card')) return;

  markDirty();

  if (target.name === 'discipline') {
    syncThreeDFields();
  }

  if (target.name === 'palette' || target.name === 'tags') {
    syncTagAndPaletteEditors();
  }

  scheduleAutosave();
}

function handlePostBlur(event) {
  const target = event.target;
  if (!target || !('name' in target) || !target.name) return;
  if (target.closest('.admin-v2-asset-card')) return;

  markDirty();
  scheduleAutosave(0);
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
  state.mediaState.uploadQueue = [];
  if (els.uploadStatus) {
    els.uploadStatus.textContent = '';
  }
}

function nextAssetSortOrder(baseAssets, offset) {
  if (!baseAssets || baseAssets.length === 0) return offset + 1;
  const max = baseAssets.reduce((highest, item) => Math.max(highest, Number(item.sortOrder || 0)), 0);
  return max + offset + 1;
}

async function uploadSingleQueueItem(item) {
  const activeProject = getActiveProject();
  if (!activeProject?.id) {
    throw new Error('Select or create a post first.');
  }

  item.status = 'signing';
  const mimeType = inferMimeType(item.file);

  const signed = await api('/api/admin/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      filename: item.file.name,
      mimeType,
      projectId: activeProject.id
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

  await api(`/api/admin/projects/${activeProject.id}/assets`, {
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
  const wasPublishedBeforeUpload = getActiveProject()?.status === 'published';
  let uploaded = 0;

  for (const item of items) {
    try {
      await uploadSingleQueueItem(item);
      uploaded += 1;
      if (els.uploadStatus) {
        els.uploadStatus.textContent = `Uploaded ${uploaded}/${items.length} file(s).`;
      }
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

  if (wasPublishedBeforeUpload && uploaded > 0) {
    markLiveChangesPending();
  }

  state.mediaState.uploadQueue = [];
  if (state.editorState.activeId) {
    await openProject(state.editorState.activeId, { switchToEditOnMobile: false });
  }
}

async function enqueueUploads(files) {
  const activeProject = getActiveProject();
  if (!activeProject?.id) {
    setFeedback('error', 'Select or create a post first.');
    return;
  }

  if (!files.length) return;

  const queuedKinds = [];
  const newItems = files.map((file, idx) => {
    const kind = inferAssetKind(file, activeProject.discipline, activeProject.assets || [], queuedKinds);
    queuedKinds.push(kind);

    return {
      id: crypto.randomUUID(),
      file,
      kind,
      status: 'queued',
      error: '',
      sortOrder: nextAssetSortOrder(activeProject.assets || [], idx)
    };
  });

  state.mediaState.uploadQueue = [...newItems];

  if (els.uploadStatus) {
    els.uploadStatus.textContent = `Uploading ${newItems.length} file(s)...`;
  }

  await processUploadQueue(newItems);
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
  const activeProject = getActiveProject();
  if (!assetId || !activeProject) return null;
  return activeProject.assets.find((asset) => asset.id === assetId) || null;
}

function getResolvedAsset(asset) {
  return {
    ...asset,
    ...(state.mediaState.assetDrafts.get(asset.id) || {})
  };
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
  state.mediaState.dragAssetId = null;
  if (!els.assetList) return;

  els.assetList
    .querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after')
    .forEach((node) => node.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
}

function patchActiveAssetSortOrders(sortMap) {
  const activeProject = getActiveProject();
  if (!activeProject || !sortMap || sortMap.size === 0) return;

  state.editorState.activeProject = {
    ...activeProject,
    assets: activeProject.assets.map((asset) =>
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
  const activeProject = getActiveProject();
  if (!activeProject) return;
  const isPublishedProject = activeProject.status === 'published';

  const sorted = getSortedAssets(activeProject.assets || []);
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
    if (isPublishedProject) {
      markLiveChangesPending();
    }
    renderAssetEditors(state.editorState.activeProject?.assets || []);
    setFeedback('success', 'Asset order updated.');
  } catch (error) {
    setFeedback('error', error.message);
    if (state.editorState.activeId) {
      await openProject(state.editorState.activeId, { switchToEditOnMobile: false });
    }
  }
}

function resolveAssetDropTargetIndex(overItem, pointerY) {
  const ordered = getSortedAssets(state.editorState.activeProject?.assets || []);
  const sourceIndex = ordered.findIndex((asset) => asset.id === state.mediaState.dragAssetId);
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
  if (!els.assetList) return;

  els.assetList.innerHTML = '';

  if (!assets || assets.length === 0) {
    state.mediaState.selectedAssetId = null;
    state.mediaState.assetDrafts = new Map();
    els.assetList.innerHTML = '<p class="notice">No assets uploaded yet.</p>';
    return;
  }

  const sortedAssets = getSortedAssets(assets);
  const hasSelected =
    state.mediaState.selectedAssetId &&
    sortedAssets.some((asset) => asset.id === state.mediaState.selectedAssetId);

  state.mediaState.selectedAssetId = hasSelected ? state.mediaState.selectedAssetId : sortedAssets[0].id;

  const selectedAsset = sortedAssets.find((asset) => asset.id === state.mediaState.selectedAssetId);
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
            const active = asset.id === state.mediaState.selectedAssetId ? 'active' : '';
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
  state.mediaState.assetDrafts.set(assetId, draft);
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

  if (getActiveProject()?.status === 'published') {
    markLiveChangesPending();
  }

  card.classList.remove('is-dirty');
  state.mediaState.assetDrafts.delete(assetId);

  if (!silent) {
    setFeedback('success', setCover ? 'Cover updated.' : 'Asset saved.');
  }
}

async function deleteAssetCard(card) {
  if (!card || !card.dataset.assetId || !state.editorState.activeId) return;

  const assetId = card.dataset.assetId;
  const confirmed = window.confirm('Delete this asset? This cannot be undone.');
  if (!confirmed) return;
  const isPublishedProject = getActiveProject()?.status === 'published';

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

  if (isPublishedProject) {
    markLiveChangesPending();
  }

  await openProject(state.editorState.activeId, { switchToEditOnMobile: false });
}

function getDraftPreviewProject() {
  const activeProject = getActiveProject();
  if (!activeProject) return null;

  const payload = projectPayloadFromForm();
  const assets = [...(activeProject.assets || [])]
    .map((asset) => ({
      ...asset,
      ...(state.mediaState.assetDrafts.get(asset.id) || {})
    }))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));

  return {
    ...activeProject,
    ...payload,
    assets
  };
}

function getPreviewCoverAsset(project) {
  const byId = project.coverAssetId
    ? project.assets.find((asset) => asset.id === project.coverAssetId)
    : null;

  if (byId) return byId;
  return project.assets.find((asset) => asset.featured) || project.assets[0] || null;
}

function buildProjectPreviewMarkup(project) {
  const cover = getPreviewCoverAsset(project);
  const imageAssets = (project.assets || []).filter((asset) => asset.kind === 'image');
  const modelAsset = (project.assets || []).find((asset) => asset.kind === 'model3d');
  const posterAsset = (project.assets || []).find((asset) => asset.kind === 'poster') || cover;
  const moodboard = imageAssets.filter((asset) => !cover || asset.id !== cover.id);
  const templateClass = `template-${project.styleTemplate || 'editorial'}`;
  const description = project.descriptionLong || project.descriptionShort || 'No description yet.';

  const tagsMarkup = (project.tags || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');

  const yearMarkup = project.year ? `<span class="tag">${escapeHtml(project.year)}</span>` : '';
  const disciplineLabel = project.discipline === '3d' ? '3D Project' : 'Graphic Project';

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

  const paletteMarkup = (project.palette || [])
    .map((token) => sanitizeSwatchColor(token))
    .filter(Boolean)
    .map((color) => `<span class="swatch" style="background:${escapeHtml(color)}" title="${escapeHtml(color)}"></span>`)
    .join('');

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
    <main class="project-shell ${escapeHtml(templateClass)}">
      <header class="site-header">
        <h1 class="brand"><a href="/" style="text-decoration:none;">Raymondo</a></h1>
        <nav class="site-nav">
          <a href="/">Back to Work</a>
          <a href="mailto:hello@raymondo.design">Contact</a>
        </nav>
      </header>

      <section class="project-hero">
        <p class="tag-row">
          <span class="tag">${disciplineLabel}</span>
          ${yearMarkup}
          ${tagsMarkup}
        </p>
        <h1>${escapeHtml(project.title || 'Untitled Project')}</h1>
        <p>${escapeHtml(description)}</p>
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
            <p>${escapeHtml(project.themeInspiration || 'Add inspiration details in admin to enrich this section.')}</p>
          </div>

          <div class="panel-block">
            <h3>Design DNA</h3>
            <p>${escapeHtml(project.styleDirection || 'No style direction notes yet.')}</p>
          </div>

          <div class="panel-block">
            <h3>Typography Notes</h3>
            <p>${escapeHtml(project.typographyNotes || 'No typography notes yet.')}</p>
          </div>

          <div class="panel-block">
            <h3>Motif Summary</h3>
            <p>${escapeHtml(project.motifSummary || 'No motif notes yet.')}</p>
          </div>

          ${
            project.discipline === '3d'
              ? `
            <div class="panel-block">
              <h3>Tooling</h3>
              <p>${escapeHtml(project.toolingNotes || 'No tooling details yet.')}</p>
            </div>
            <div class="panel-block">
              <h3>Material Notes</h3>
              <p>${escapeHtml(project.materialNotes || 'No material notes yet.')}</p>
            </div>
          `
              : ''
          }

          <div class="panel-block">
            <h3>Palette</h3>
            <div class="palette">
              ${paletteMarkup || '<p>No palette colors set.</p>'}
            </div>
          </div>
        </aside>
      </section>

      ${moodboardMarkup}
    </main>
  `;
}

function openPreviewDialog() {
  if (!els.previewDialog) return;
  if (typeof els.previewDialog.showModal === 'function') {
    if (!els.previewDialog.open) els.previewDialog.showModal();
  } else {
    els.previewDialog.setAttribute('open', '');
  }
}

function closePreviewDialog() {
  if (!els.previewDialog) return;
  if (typeof els.previewDialog.close === 'function') {
    if (els.previewDialog.open) els.previewDialog.close();
  } else {
    els.previewDialog.removeAttribute('open');
  }
}

function renderDraftPreview() {
  const project = getDraftPreviewProject();
  if (!project) {
    setFeedback('error', 'Select a post first.');
    return;
  }

  if (els.previewDialogIntro) {
    els.previewDialogIntro.textContent = 'Using the same project page layout with current editor values.';
  }

  if (els.previewDialogContent) {
    els.previewDialogContent.innerHTML = buildProjectPreviewMarkup(project);
  }

  if (els.previewOpenRouteBtn) {
    if (project.slug) {
      els.previewOpenRouteBtn.href = `/projects/${encodeURIComponent(project.slug)}/`;
      els.previewOpenRouteBtn.classList.remove('is-disabled');
      els.previewOpenRouteBtn.removeAttribute('aria-disabled');
    } else {
      els.previewOpenRouteBtn.href = '#';
      els.previewOpenRouteBtn.classList.add('is-disabled');
      els.previewOpenRouteBtn.setAttribute('aria-disabled', 'true');
    }
  }

  openPreviewDialog();
}

function setMobileTab(nextTab) {
  const next = ['posts', 'edit', 'media'].includes(nextTab) ? nextTab : 'posts';
  state.uiState.mobileTab = next;

  if (els.root) {
    els.root.dataset.mobileTab = next;
  }

  if (els.mobileTabBar) {
    els.mobileTabBar.querySelectorAll('[data-mobile-tab]').forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.mobileTab === next ? 'true' : 'false');
    });
  }
}

function handlePostListAction(action, projectId) {
  if (!action || !projectId) return Promise.resolve();

  if (action === 'open-post') {
    return openProject(projectId);
  }

  if (action === 'delete') {
    return deleteDraftPost(projectId);
  }

  if (action === 'move-up') {
    return movePostByStep(projectId, -1);
  }

  if (action === 'move-down') {
    return movePostByStep(projectId, 1);
  }

  return Promise.resolve();
}

function wirePostList(listEl) {
  if (!listEl) return;

  listEl.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action][data-project-id]');
    if (!trigger) return;

    const action = trigger.dataset.action;
    const projectId = trigger.dataset.projectId;

    handlePostListAction(action, projectId).catch((error) => {
      setFeedback('error', error.message);
    });
  });

  listEl.addEventListener('dragstart', (event) => {
    if (!canReorderPosts()) return;

    const item = event.target.closest('li[data-project-id][data-project-status]');
    if (!item) return;

    state.postsState.dragProjectId = item.dataset.projectId || null;
    state.postsState.dragProjectStatus = item.dataset.projectStatus || null;

    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.postsState.dragProjectId || '');
    }
  });

  listEl.addEventListener('dragover', (event) => {
    if (!canReorderPosts()) return;
    if (!state.postsState.dragProjectId || !state.postsState.dragProjectStatus) return;

    const overItem = event.target.closest('li[data-project-id][data-project-status]');
    if (!overItem) return;

    if (overItem.dataset.projectStatus !== state.postsState.dragProjectStatus) return;
    if (overItem.dataset.projectId === state.postsState.dragProjectId) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    listEl
      .querySelectorAll('.is-drop-before, .is-drop-after')
      .forEach((node) => node.classList.remove('is-drop-before', 'is-drop-after'));

    const rect = overItem.getBoundingClientRect();
    const isAfter = event.clientY >= rect.top + rect.height / 2;
    overItem.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
  });

  listEl.addEventListener('drop', (event) => {
    if (!canReorderPosts()) return;
    if (!state.postsState.dragProjectId || !state.postsState.dragProjectStatus) return;

    event.preventDefault();
    const overItem = event.target.closest('li[data-project-id][data-project-status]');
    if (!overItem) return;

    if (overItem.dataset.projectStatus !== state.postsState.dragProjectStatus) {
      clearPostDragState();
      return;
    }

    handlePostDrop(
      state.postsState.dragProjectStatus,
      state.postsState.dragProjectId,
      overItem.dataset.projectId || '',
      event.clientY
    )
      .catch((error) => setFeedback('error', error.message))
      .finally(() => clearPostDragState());
  });

  listEl.addEventListener('dragend', () => {
    clearPostDragState();
  });

  listEl.addEventListener('keydown', (event) => {
    if (!canReorderPosts()) return;

    const item = event.target.closest('li[data-project-id]');
    if (!item) return;

    const projectId = item.dataset.projectId;
    if (!projectId) return;

    const isMoveUp = event.altKey && event.key === 'ArrowUp';
    const isMoveDown = event.altKey && event.key === 'ArrowDown';

    if (!isMoveUp && !isMoveDown) return;

    event.preventDefault();
    movePostByStep(projectId, isMoveUp ? -1 : 1).catch((error) => {
      setFeedback('error', error.message);
    });
  });
}

function wireTagPaletteEditors() {
  if (els.tagAddBtn) {
    els.tagAddBtn.addEventListener('click', () => consumeTagInput());
  }

  if (els.tagEditorInput) {
    els.tagEditorInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        consumeTagInput();
      }
    });

    els.tagEditorInput.addEventListener('blur', () => {
      consumeTagInput();
    });
  }

  if (els.tagChipList) {
    els.tagChipList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-tag]');
      if (!button) return;

      const removing = String(button.dataset.removeTag || '');
      const next = getTagsFromField().filter((tag) => tag.toLowerCase() !== removing.toLowerCase());
      setTagsToField(next, { mark: true });
    });
  }

  if (els.paletteApplyBtn) {
    els.paletteApplyBtn.addEventListener('click', () => {
      applyPaletteTextInput();
    });
  }

  if (els.paletteTextInput) {
    els.paletteTextInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyPaletteTextInput();
      }
    });

    els.paletteTextInput.addEventListener('blur', () => {
      if (!els.paletteTextInput.value.trim()) return;
      applyPaletteTextInput();
    });
  }

  if (els.paletteAddColorBtn) {
    els.paletteAddColorBtn.addEventListener('click', () => {
      addPaletteColorFromPicker();
    });
  }

  if (els.paletteChipList) {
    els.paletteChipList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-color]');
      if (!button) return;

      const removing = String(button.dataset.removeColor || '');
      const next = getPaletteFromField().filter((color) => color !== removing);
      setPaletteToField(next, { mark: true });
    });
  }
}

function wireAssetEvents() {
  if (!els.assetList) return;

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

    state.mediaState.dragAssetId = item.dataset.assetId || null;
    if (!state.mediaState.dragAssetId) return;

    item.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.mediaState.dragAssetId);
    }
  });

  els.assetList.addEventListener('dragover', (event) => {
    if (!state.mediaState.dragAssetId) return;

    const overItem = event.target.closest('.admin-v2-asset-sort-item');
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    if (!overItem) return;
    if (overItem.dataset.assetId === state.mediaState.dragAssetId) return;

    els.assetList
      .querySelectorAll('.is-drop-before, .is-drop-after')
      .forEach((node) => node.classList.remove('is-drop-before', 'is-drop-after'));

    const rect = overItem.getBoundingClientRect();
    const isAfter = event.clientY >= rect.top + rect.height / 2;
    overItem.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
  });

  els.assetList.addEventListener('drop', (event) => {
    if (!state.mediaState.dragAssetId) return;
    event.preventDefault();

    const draggedId = state.mediaState.dragAssetId;
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
      state.mediaState.selectedAssetId = selectBtn.dataset.assetSelect || null;
      renderAssetEditors(state.editorState.activeProject?.assets || []);
      return;
    }

    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;

    const card = actionBtn.closest('.admin-v2-asset-detail');
    if (!card) return;

    if (actionBtn.dataset.action === 'save-asset') {
      saveAssetCard(card)
        .then(() => openProject(state.editorState.activeId, { switchToEditOnMobile: false }))
        .catch((error) => setFeedback('error', error.message));
      return;
    }

    if (actionBtn.dataset.action === 'set-cover') {
      const assetId = card.dataset.assetId;
      saveAssetCard(card, { setCover: true, silent: true })
        .then(async () => {
          if (assetId) {
            await reorderAssetByDrop(assetId, 0);
            state.mediaState.selectedAssetId = assetId;
          }
          await openProject(state.editorState.activeId, { switchToEditOnMobile: false });
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

function wireDropzone() {
  if (!els.dropzone || !els.fileInput) return;

  els.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropzone.classList.add('dragging');
  });

  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragging');
  });

  els.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('dragging');
    const files = Array.from(event.dataTransfer?.files || []);
    enqueueUploads(files).catch((error) => setFeedback('error', error.message));
  });

  els.fileInput.addEventListener('change', () => {
    const files = Array.from(els.fileInput.files || []);
    enqueueUploads(files).catch((error) => setFeedback('error', error.message));
    els.fileInput.value = '';
  });
}

function wireDialogEvents() {
  if (els.blockerCloseBtn) {
    els.blockerCloseBtn.addEventListener('click', () => closeBlockerDialog());
  }

  if (els.blockerDialog) {
    els.blockerDialog.addEventListener('click', (event) => {
      const rect = els.blockerDialog.getBoundingClientRect();
      const inDialog =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!inDialog) {
        closeBlockerDialog();
      }
    });
  }

  if (els.previewCloseBtn) {
    els.previewCloseBtn.addEventListener('click', () => closePreviewDialog());
  }

  if (els.previewOpenRouteBtn) {
    els.previewOpenRouteBtn.addEventListener('click', (event) => {
      if (els.previewOpenRouteBtn.classList.contains('is-disabled')) {
        event.preventDefault();
      }
    });
  }

  if (els.previewDialog) {
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
}

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
    if (!isSaveShortcut) return;

    event.preventDefault();
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });
}

function wireEvents() {
  if (!els.form) return;

  if (els.mobileTabBar) {
    els.mobileTabBar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mobile-tab]');
      if (!button) return;
      setMobileTab(button.dataset.mobileTab || 'posts');
    });
  }

  if (els.newPostBtn) {
    els.newPostBtn.addEventListener('click', () => {
      createNewPost().catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.reorderToggleBtn) {
    els.reorderToggleBtn.addEventListener('click', () => {
      const canEnable = state.postsState.scope === 'all' && !state.postsState.search.trim();
      if (!canEnable) {
        setFeedback('warn', 'Clear search and set scope to All to reorder posts.');
        return;
      }

      state.postsState.reorderMode = !state.postsState.reorderMode;
      renderPostGroups();
    });
  }

  if (els.postSearchInput) {
    els.postSearchInput.addEventListener('input', (event) => {
      state.postsState.search = event.target.value || '';
      if (!state.postsState.search.trim()) {
        renderPostGroups();
        return;
      }

      state.postsState.reorderMode = false;
      renderPostGroups();
    });
  }

  if (els.postScopeBar) {
    els.postScopeBar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-scope]');
      if (!button) return;

      state.postsState.scope = button.dataset.scope || 'all';
      if (state.postsState.scope !== 'all') {
        state.postsState.reorderMode = false;
      }
      renderPostGroups();
    });
  }

  wirePostList(els.draftPostList);
  wirePostList(els.publishedPostList);

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });

  els.form.addEventListener('input', handlePostInput);
  els.form.addEventListener('change', handlePostInput);
  els.form.addEventListener('focusout', handlePostBlur, true);
  wireTagPaletteEditors();

  if (els.saveNowBtn) {
    els.saveNowBtn.addEventListener('click', () => {
      saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.previewBtn) {
    els.previewBtn.addEventListener('click', () => renderDraftPreview());
  }

  if (els.republishSiteBtn) {
    els.republishSiteBtn.addEventListener('click', () => {
      republishSite().catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.publishToggleBtn) {
    els.publishToggleBtn.addEventListener('click', () => {
      if (!state.editorState.activeId) return;
      togglePublishPost(state.editorState.activeId).catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.deleteBtn) {
    els.deleteBtn.addEventListener('click', () => {
      if (!state.editorState.activeId) return;
      deleteDraftPost(state.editorState.activeId).catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.mobileSaveBtn) {
    els.mobileSaveBtn.addEventListener('click', () => {
      saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.mobilePreviewBtn) {
    els.mobilePreviewBtn.addEventListener('click', () => renderDraftPreview());
  }

  if (els.mobileRepublishBtn) {
    els.mobileRepublishBtn.addEventListener('click', () => {
      republishSite().catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.mobilePublishBtn) {
    els.mobilePublishBtn.addEventListener('click', () => {
      if (!state.editorState.activeId) return;
      togglePublishPost(state.editorState.activeId).catch((error) => setFeedback('error', error.message));
    });
  }

  if (els.mobileDeleteBtn) {
    els.mobileDeleteBtn.addEventListener('click', () => {
      if (!state.editorState.activeId) return;
      deleteDraftPost(state.editorState.activeId).catch((error) => setFeedback('error', error.message));
    });
  }

  wireDropzone();
  wireAssetEvents();
  wireDialogEvents();
  wireKeyboardShortcuts();
}

async function init() {
  try {
    wireEvents();
    setMobileTab('posts');
    clearEditor();
    await loadProjects();
  } catch (error) {
    setFeedback('error', error.message);
  }
}

init();
