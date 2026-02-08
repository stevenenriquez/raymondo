const state = {
  projects: [],
  activeId: null,
  activeProject: null
};

const els = {
  projectList: document.getElementById('projectList'),
  form: document.getElementById('projectForm'),
  feedback: document.getElementById('feedback'),
  uploadStatus: document.getElementById('uploadStatus'),
  assetList: document.getElementById('assetList'),
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  assetKind: document.getElementById('assetKind'),
  assetFeatured: document.getElementById('assetFeatured'),
  refreshBtn: document.getElementById('refreshBtn'),
  newGraphicBtn: document.getElementById('newGraphicBtn'),
  new3dBtn: document.getElementById('new3dBtn'),
  publishBtn: document.getElementById('publishBtn')
};

function setFeedback(type, text) {
  els.feedback.innerHTML = `<p class="feedback ${type}">${text}</p>`;
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

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function renderProjectList() {
  els.projectList.innerHTML = '';
  if (state.projects.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No projects yet.';
    els.projectList.appendChild(li);
    return;
  }

  for (const project of state.projects) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-row ${project.id === state.activeId ? 'active' : ''}`;
    button.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;">
        <strong style="font-family:var(--font-display);font-size:0.85rem;">${escapeHtml(project.title)}</strong>
        <span class="status-pill ${escapeHtml(project.status)}">${escapeHtml(project.status)}</span>
      </div>
      <div style="font-size:0.8rem;color:var(--muted);margin-top:0.2rem;">/${escapeHtml(project.slug)}</div>
    `;
    button.addEventListener('click', () => selectProject(project.id));
    li.appendChild(button);
    els.projectList.appendChild(li);
  }
}

function normalizeCommaList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function field(name) {
  return els.form.elements.namedItem(name);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function populateForm(project) {
  field('id').value = project.id || '';
  field('slug').value = project.slug || '';
  field('title').value = project.title || '';
  field('discipline').value = project.discipline || 'graphic';
  field('status').value = project.status || 'draft';
  field('year').value = project.year ?? '';
  field('sortOrder').value = project.sortOrder ?? 0;
  field('styleTemplate').value = project.styleTemplate || 'editorial';
  field('descriptionShort').value = project.descriptionShort || '';
  field('descriptionLong').value = project.descriptionLong || '';
  field('themeInspiration').value = project.themeInspiration || '';
  field('styleDirection').value = project.styleDirection || '';
  field('typographyNotes').value = project.typographyNotes || '';
  field('motifSummary').value = project.motifSummary || '';
  field('toolingNotes').value = project.toolingNotes || '';
  field('materialNotes').value = project.materialNotes || '';
  field('palette').value = (project.palette || []).join(',');
  field('tags').value = (project.tags || []).join(',');
}

function projectPayloadFromForm() {
  return {
    id: field('id').value || undefined,
    slug: field('slug').value.trim(),
    title: field('title').value.trim(),
    discipline: field('discipline').value,
    status: field('status').value,
    year: field('year').value ? Number(field('year').value) : null,
    sortOrder: Number(field('sortOrder').value || 0),
    styleTemplate: field('styleTemplate').value,
    descriptionShort: field('descriptionShort').value.trim(),
    descriptionLong: field('descriptionLong').value.trim(),
    themeInspiration: field('themeInspiration').value.trim(),
    styleDirection: field('styleDirection').value.trim(),
    typographyNotes: field('typographyNotes').value.trim(),
    motifSummary: field('motifSummary').value.trim(),
    toolingNotes: field('toolingNotes').value.trim(),
    materialNotes: field('materialNotes').value.trim(),
    palette: normalizeCommaList(field('palette').value),
    tags: normalizeCommaList(field('tags').value)
  };
}

async function loadProjects() {
  const payload = await api('/api/admin/projects');
  state.projects = payload.projects;
  renderProjectList();

  if (!state.activeId && state.projects.length > 0) {
    await selectProject(state.projects[0].id);
  }
}

async function selectProject(id) {
  const payload = await api(`/api/admin/projects/${id}`);
  state.activeId = id;
  state.activeProject = payload.project;
  populateForm(payload.project);
  renderAssetEditors(payload.project.assets || []);
  renderProjectList();
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
      descriptionShort: 'Add project summary',
      sortOrder: 0,
      palette: [],
      tags: []
    })
  });

  await loadProjects();
  await selectProject(payload.project.id);
  setFeedback('success', 'Project created. Fill in fields and click Save Project.');
}

async function saveProject(event) {
  event.preventDefault();
  clearFeedback();
  try {
    const payload = await api('/api/admin/projects', {
      method: 'POST',
      body: JSON.stringify(projectPayloadFromForm())
    });

    await loadProjects();
    await selectProject(payload.project.id);
    setFeedback('success', 'Project saved.');
  } catch (error) {
    setFeedback('error', error.message);
  }
}

function filesFromDrop(event) {
  event.preventDefault();
  els.dropzone.classList.remove('dragging');
  return Array.from(event.dataTransfer?.files || []);
}

async function uploadFiles(files) {
  if (!state.activeId) {
    setFeedback('error', 'Select or create a project first.');
    return;
  }

  if (files.length === 0) {
    return;
  }

  els.uploadStatus.textContent = `Uploading ${files.length} file(s)...`;
  let uploaded = 0;

  for (const file of files) {
    const mimeType = file.type || (file.name.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream');
    const kind = els.assetKind.value;
    const featured = els.assetFeatured.value === 'true';

    try {
      const signed = await api('/api/admin/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType,
          projectId: state.activeId
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
        throw new Error(`Upload failed for ${file.name}: ${text}`);
      }

      await api(`/api/admin/projects/${state.activeId}/assets`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          r2Key: signed.r2Key,
          mimeType,
          altText: file.name,
          caption: '',
          featured,
          sortOrder: 0
        })
      });

      uploaded += 1;
      els.uploadStatus.textContent = `Uploaded ${uploaded}/${files.length}`;
    } catch (error) {
      setFeedback('error', error.message);
      els.uploadStatus.textContent = 'Upload stopped due to error.';
      return;
    }
  }

  els.uploadStatus.textContent = `Uploaded ${uploaded} file(s).`;
  setFeedback('success', 'Assets uploaded and linked to project.');
  await selectProject(state.activeId);
}

function renderAssetEditors(assets) {
  els.assetList.innerHTML = '';

  if (!assets || assets.length === 0) {
    els.assetList.innerHTML = '<p class=\"notice\">No assets uploaded yet.</p>';
    return;
  }

  for (const asset of assets) {
    const wrapper = document.createElement('form');
    wrapper.className = 'asset-editor';
    wrapper.innerHTML = `
      <h4>${escapeHtml(asset.kind.toUpperCase())} • ${escapeHtml(asset.r2Key)}</h4>
      <div class=\"form-grid\">
        <label>Kind
          <select name=\"kind\">
            <option value=\"image\" ${asset.kind === 'image' ? 'selected' : ''}>Image</option>
            <option value=\"poster\" ${asset.kind === 'poster' ? 'selected' : ''}>Poster</option>
            <option value=\"model3d\" ${asset.kind === 'model3d' ? 'selected' : ''}>3D Model</option>
          </select>
        </label>
        <label>MIME Type
          <input type=\"text\" name=\"mimeType\" value=\"${escapeHtml(asset.mimeType)}\" />
        </label>
        <label>Sort Order
          <input type=\"number\" name=\"sortOrder\" value=\"${asset.sortOrder || 0}\" />
        </label>
        <label>Featured
          <select name=\"featured\">
            <option value=\"false\" ${asset.featured ? '' : 'selected'}>No</option>
            <option value=\"true\" ${asset.featured ? 'selected' : ''}>Yes</option>
          </select>
        </label>
      </div>
      <label>Title / Alt Text
        <input type=\"text\" name=\"altText\" value=\"${escapeHtml(asset.altText || '')}\" />
      </label>
      <label>Description / Caption
        <textarea name=\"caption\">${escapeHtml(asset.caption || '')}</textarea>
      </label>
      <div class=\"admin-actions\">
        <button type=\"submit\">Save Asset</button>
      </div>
    `;

    wrapper.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api(`/api/admin/assets/${asset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            kind: wrapper.elements.namedItem('kind').value,
            mimeType: wrapper.elements.namedItem('mimeType').value,
            sortOrder: Number(wrapper.elements.namedItem('sortOrder').value || 0),
            featured: wrapper.elements.namedItem('featured').value === 'true',
            altText: wrapper.elements.namedItem('altText').value,
            caption: wrapper.elements.namedItem('caption').value
          })
        });
        setFeedback('success', 'Asset updated.');
        await selectProject(state.activeId);
      } catch (error) {
        setFeedback('error', error.message);
      }
    });

    els.assetList.appendChild(wrapper);
  }
}

async function publishSnapshot() {
  clearFeedback();
  els.publishBtn.disabled = true;
  els.publishBtn.textContent = 'Publishing...';

  try {
    const payload = await api('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const warnings = payload.warnings?.length ? `<br/>Warnings: ${payload.warnings.join(' | ')}` : '';
    setFeedback(
      payload.deployTriggered ? 'success' : 'warn',
      `Published ${payload.projectCount} project(s). Snapshot: ${payload.snapshotKey}.${warnings}`
    );
  } catch (error) {
    setFeedback('error', error.message);
  } finally {
    els.publishBtn.disabled = false;
    els.publishBtn.textContent = 'Publish Snapshot';
  }
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
    uploadFiles(files);
  });

  els.fileInput.addEventListener('change', () => {
    uploadFiles(Array.from(els.fileInput.files || []));
    els.fileInput.value = '';
  });
}

function wireEvents() {
  els.form.addEventListener('submit', saveProject);
  els.refreshBtn.addEventListener('click', () => loadProjects().catch((error) => setFeedback('error', error.message)));
  els.newGraphicBtn.addEventListener('click', () => createProjectPreset('graphic').catch((error) => setFeedback('error', error.message)));
  els.new3dBtn.addEventListener('click', () => createProjectPreset('3d').catch((error) => setFeedback('error', error.message)));
  els.publishBtn.addEventListener('click', () => publishSnapshot());
  wireDropzone();
}

async function init() {
  try {
    wireEvents();
    await loadProjects();
  } catch (error) {
    setFeedback('error', error.message);
  }
}

init();
