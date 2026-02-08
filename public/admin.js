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
  saveNowBtn: document.getElementById('saveNowBtn'),
  publishBtn: document.getElementById('publishBtn'),
  unpublishBtn: document.getElementById('unpublishBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  activeProjectLabel: document.getElementById('activeProjectLabel'),
  projectStatusBadge: document.getElementById('projectStatusBadge'),
  saveStateChip: document.getElementById('saveStateChip'),
  palettePreview: document.getElementById('palettePreview'),
  hardMissingList: document.getElementById('hardMissingList'),
  softMissingList: document.getElementById('softMissingList'),
  preflightBtn: document.getElementById('preflightBtn'),
  preflightSummary: document.getElementById('preflightSummary'),
  preflightDialog: document.getElementById('preflightDialog'),
  preflightDialogIntro: document.getElementById('preflightDialogIntro'),
  preflightConfirmBtn: document.getElementById('preflightConfirmBtn'),
  preflightCancelBtn: document.getElementById('preflightCancelBtn'),
  modalHardList: document.getElementById('modalHardList'),
  modalGlobalList: document.getElementById('modalGlobalList'),
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  uploadStatus: document.getElementById('uploadStatus'),
  uploadQueue: document.getElementById('uploadQueue'),
  assetList: document.getElementById('assetList'),
  saveAllAssetsBtn: document.getElementById('saveAllAssetsBtn'),
  assetsSection: document.getElementById('assetsSection'),
  mobileSaveBtn: document.getElementById('mobileSaveBtn'),
  mobilePublishBtn: document.getElementById('mobilePublishBtn'),
  mobileAssetsBtn: document.getElementById('mobileAssetsBtn')
};

const MODEL_FILE_EXTENSIONS = ['.glb', '.gltf'];
const PREVIEW_STATES = {
  queued: 5,
  signing: 20,
  uploading: 65,
  attaching: 90,
  done: 100,
  failed: 0
};

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
    sortOrder: Number(readField('sortOrder') || 0),
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

function renderProjectList() {
  els.projectList.innerHTML = '';

  const visible = state.projects.filter((project) => matchesProjectFilter(project) && matchesProjectSearch(project));

  if (visible.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No projects match this filter.';
    els.projectList.appendChild(li);
    return;
  }

  for (const project of visible) {
    const li = document.createElement('li');
    const rowTone = projectReadinessClass(project);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-row ${project.id === state.activeId ? 'active' : ''}`;
    button.innerHTML = `
      <div class="admin-v2-row-head">
        <strong>${escapeHtml(project.title)}</strong>
        <span class="status-pill ${escapeHtml(getStatusClass(project.status))}">${escapeHtml(project.status)}</span>
      </div>
      <div class="admin-v2-row-foot">
        <span>/${escapeHtml(project.slug)}</span>
        <span class="admin-v2-readiness-pill ${rowTone}">${rowTone}</span>
      </div>
    `;

    button.addEventListener('click', () => {
      selectProject(project.id).catch((error) => setFeedback('error', error.message));
    });

    li.appendChild(button);
    els.projectList.appendChild(li);
  }
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
  writeField('year', project.year ?? '');
  writeField('sortOrder', project.sortOrder ?? 0);
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
  state.assetDrafts = new Map();

  writeField('id', '');
  writeField('slug', '');
  writeField('title', '');
  writeField('discipline', 'graphic');
  writeField('year', '');
  writeField('sortOrder', 0);
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

  if (!payload.slug || !payload.title) {
    setSaveState('unsaved', 'Needs title and slug');
    return null;
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
      descriptionShort: '',
      descriptionLong: '',
      sortOrder: 0,
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
  for (const item of state.uploadQueue) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
  state.uploadQueue = [];
  els.uploadQueue.innerHTML = '';
  els.uploadStatus.textContent = '';
}

function renderUploadQueue() {
  els.uploadQueue.innerHTML = '';

  if (!state.uploadQueue.length) return;

  for (const item of state.uploadQueue) {
    const card = document.createElement('article');
    card.className = `upload-preview-item admin-v2-upload-card ${item.status}`;
    card.dataset.queueId = item.id;

    const progress = PREVIEW_STATES[item.status] ?? 0;
    const errorRow = item.status === 'failed' ? `<p class="admin-v2-upload-error">${escapeHtml(item.error || 'Upload failed.')}</p>` : '';
    const retryBtn =
      item.status === 'failed'
        ? '<button type="button" class="btn secondary" data-action="retry-upload">Retry</button>'
        : '';

    const mediaMarkup = item.previewUrl
      ? `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.file.name)}" loading="lazy" />`
      : '<div class="upload-preview-placeholder">File</div>';

    card.innerHTML = `
      ${mediaMarkup}
      <div class="upload-preview-meta">
        <strong>${escapeHtml(item.file.name)}</strong>
        <span>${escapeHtml(item.kind)} • ${escapeHtml(item.status)}</span>
        <div class="admin-v2-progress"><span style="width:${progress}%"></span></div>
        ${errorRow}
        ${retryBtn}
      </div>
    `;

    els.uploadQueue.appendChild(card);
  }
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
  renderUploadQueue();

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
  renderUploadQueue();

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
  renderUploadQueue();

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
  renderUploadQueue();
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
      renderUploadQueue();
    }
  }

  const failed = items.filter((item) => item.status === 'failed').length;

  if (failed > 0) {
    setFeedback('warn', `${uploaded} uploaded, ${failed} failed. Retry failed files from the queue.`);
  } else {
    setFeedback('success', `Uploaded ${uploaded} file(s).`);
  }

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
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
    const kind = inferAssetKind(file, state.activeProject.discipline, state.activeProject.assets || [], queuedKinds);
    queuedKinds.push(kind);

    return {
      id: crypto.randomUUID(),
      file,
      kind,
      status: 'queued',
      error: '',
      previewUrl,
      sortOrder: nextSortOrder(state.activeProject.assets || [], idx)
    };
  });

  state.uploadQueue.push(...newItems);
  renderUploadQueue();

  els.uploadStatus.textContent = `Uploading ${newItems.length} file(s)...`;
  await processUploadQueue(newItems);
}

async function retryUpload(queueId) {
  const item = state.uploadQueue.find((entry) => entry.id === queueId);
  if (!item) return;

  item.status = 'queued';
  item.error = '';
  renderUploadQueue();

  await processUploadQueue([item]);
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

function renderAssetEditors(assets) {
  state.assetDrafts = new Map();
  els.assetList.innerHTML = '';

  if (!assets || assets.length === 0) {
    els.assetList.innerHTML = '<p class="notice">No assets uploaded yet.</p>';
    return;
  }

  for (const asset of assets) {
    const wrapper = document.createElement('article');
    wrapper.className = 'asset-editor admin-v2-asset-card';
    wrapper.dataset.assetId = asset.id;

    wrapper.innerHTML = `
      <div class="asset-editor-preview">${assetPreviewMarkup(asset, assets)}</div>
      <div class="asset-editor-content">
        <h4>${escapeHtml(asset.kind.toUpperCase())} • ${escapeHtml(asset.r2Key)}</h4>

        <div class="form-grid admin-v2-asset-grid">
          <label>Kind
            <select name="kind">
              <option value="image" ${asset.kind === 'image' ? 'selected' : ''}>Image</option>
              <option value="poster" ${asset.kind === 'poster' ? 'selected' : ''}>Poster</option>
              <option value="model3d" ${asset.kind === 'model3d' ? 'selected' : ''}>3D Model</option>
            </select>
          </label>
          <label>Sort Order
            <input type="number" name="sortOrder" value="${Number(asset.sortOrder || 0)}" />
          </label>
        </div>

        <label>Alt Text
          <input type="text" name="altText" value="${escapeHtml(asset.altText || '')}" />
        </label>

        <label>Caption
          <textarea name="caption">${escapeHtml(asset.caption || '')}</textarea>
        </label>

        <div class="admin-actions">
          <a class="btn ghost" href="${escapeHtml(asset.url)}" target="_blank" rel="noopener noreferrer">Open File</a>
          <button type="button" data-action="set-cover" class="btn secondary">Set as Cover</button>
          <button type="button" data-action="save-asset">Save</button>
        </div>
      </div>
    `;

    els.assetList.appendChild(wrapper);
  }
}

function readAssetCardPayload(card) {
  return {
    kind: card.querySelector('[name="kind"]').value,
    sortOrder: Number(card.querySelector('[name="sortOrder"]').value || 0),
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

async function saveAllAssetDrafts() {
  const dirtyCards = Array.from(els.assetList.querySelectorAll('.admin-v2-asset-card.is-dirty'));
  if (dirtyCards.length === 0) {
    setFeedback('warn', 'No unsaved asset edits found.');
    return;
  }

  let saved = 0;

  for (const card of dirtyCards) {
    try {
      await saveAssetCard(card, { silent: true });
      saved += 1;
    } catch (error) {
      setFeedback('error', `Failed while saving assets: ${error.message}`);
      await selectProject(state.activeId);
      return;
    }
  }

  await selectProject(state.activeId);
  setFeedback('success', `Saved ${saved} asset edit(s).`);
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

  els.uploadQueue.addEventListener('click', (event) => {
    const retryBtn = event.target.closest('[data-action="retry-upload"]');
    if (!retryBtn) return;

    const card = retryBtn.closest('[data-queue-id]');
    if (!card) return;

    retryUpload(card.dataset.queueId).catch((error) => setFeedback('error', error.message));
  });
}

function wireAssetEvents() {
  els.assetList.addEventListener('input', (event) => {
    const card = event.target.closest('.admin-v2-asset-card');
    if (!card) return;
    markAssetCardDirty(card);
  });

  els.assetList.addEventListener('change', (event) => {
    const card = event.target.closest('.admin-v2-asset-card');
    if (!card) return;
    markAssetCardDirty(card);
  });

  els.assetList.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;

    const card = actionBtn.closest('.admin-v2-asset-card');
    if (!card) return;

    if (actionBtn.dataset.action === 'save-asset') {
      saveAssetCard(card)
        .then(() => selectProject(state.activeId))
        .catch((error) => setFeedback('error', error.message));
      return;
    }

    if (actionBtn.dataset.action === 'set-cover') {
      saveAssetCard(card, { setCover: true })
        .then(() => selectProject(state.activeId))
        .catch((error) => setFeedback('error', error.message));
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

  els.saveNowBtn.addEventListener('click', () => {
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
  });

  els.publishBtn.addEventListener('click', () => {
    runPreflight({ openModal: true }).catch((error) => setFeedback('error', error.message));
  });

  els.preflightBtn.addEventListener('click', () => {
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

  els.saveAllAssetsBtn.addEventListener('click', () => {
    saveAllAssetDrafts().catch((error) => setFeedback('error', error.message));
  });

  els.mobileSaveBtn.addEventListener('click', () => {
    saveProject({ autosave: false }).catch((error) => setFeedback('error', error.message));
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
