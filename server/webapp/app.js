/* Control panel for the text-to-video pipeline. */

const $ = (id) => document.getElementById(id);

const el = {
  story: $('story'), wordCount: $('word-count'), samples: $('samples'),
  duration: $('duration'), style: $('style'), aspect: $('aspect'), voice: $('voice'), title: $('title'),
  optMusic: $('opt-music'), optOffline: $('opt-offline'), optForce: $('opt-force'),
  generate: $('generate'), analyse: $('analyse'), download: $('download'),
  mastheadMeta: $('masthead-meta'), statusChip: $('status-chip'),
  planEmpty: $('plan-empty'), plan: $('plan'), planStats: $('plan-stats'),
  characters: $('characters'), timeline: $('timeline'),
  progressBlock: $('progress-block'), progressStage: $('progress-stage'), progressPct: $('progress-pct'),
  barFill: $('bar-fill'), stages: $('stages'), log: $('log'),
  errorBlock: $('error-block'), errorMessage: $('error-message'), errorHint: $('error-hint'),
  playerEmpty: $('player-empty'), video: $('video'),
  checks: $('checks'), checksList: $('checks-list'),
};

const STAGES = [
  { id: 'analyse', label: 'Analyse' },
  { id: 'assets', label: 'Assets' },
  { id: 'render', label: 'Render' },
  { id: 'verify', label: 'Verify' },
];

let running = false;
let analyseTimer = null;
let eventSource = null;

/* ------------------------------------------------------------------ utils -- */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function logLine(text, kind = '') {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const span = kind ? `<span class="${kind}">${esc(text)}</span>` : esc(text);
  el.log.insertAdjacentHTML('beforeend', `${time}  ${span}\n`);
  el.log.scrollTop = el.log.scrollHeight;
}

function settings() {
  return {
    text: el.story.value,
    duration: el.duration.value ? Number(el.duration.value) : null,
    style: el.style.value || null,
    title: el.title.value.trim() || null,
    aspect: el.aspect.value,
    voice: el.voice.value,
    music: el.optMusic.checked,
    offline: el.optOffline.checked,
    forceAssets: el.optForce.checked,
  };
}

/* ------------------------------------------------------------------- boot -- */

async function loadOptions() {
  const res = await fetch('/api/options');
  if (!res.ok) return;
  const options = await res.json();

  for (const seconds of options.durations) {
    el.duration.insertAdjacentHTML('beforeend', `<option value="${seconds}">${seconds} seconds</option>`);
  }
  for (const style of options.styles) {
    el.style.insertAdjacentHTML('beforeend',
      `<option value="${esc(style.id)}" title="${esc(style.description)}">${esc(style.label)}</option>`);
  }
  for (const aspect of options.aspects) {
    el.aspect.insertAdjacentHTML('beforeend', `<option value="${esc(aspect)}">${esc(aspect)}</option>`);
  }
  el.samples.innerHTML = options.samples
    .map((s) => `<button class="sample" data-id="${esc(s.id)}">${esc(s.name)}</button>`)
    .join('');

  el.samples.addEventListener('click', async (event) => {
    const button = event.target.closest('.sample');
    if (!button) return;
    const res2 = await fetch(`/api/sample/${button.dataset.id}`);
    if (!res2.ok) return;
    const { text } = await res2.json();
    el.story.value = text.trim();
    onStoryChanged();
  });
}

/* --------------------------------------------------------------- analysis -- */

function onStoryChanged() {
  const words = el.story.value.trim().split(/\s+/).filter(Boolean).length;
  el.wordCount.textContent = `${words} word${words === 1 ? '' : 's'}`;
  clearTimeout(analyseTimer);
  // An empty box on first load keeps whatever plan is already on disk.
  if (words === 0) return;
  if (words < 4) { showPlan(null); return; }
  analyseTimer = setTimeout(() => analyse({ quiet: true }), 500);
}

async function analyse({ quiet = false } = {}) {
  const body = settings();
  if (!body.text.trim()) return;

  if (!quiet) el.statusChip.textContent = 'Analysing…';
  const res = await fetch('/api/analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showPlan(null);
    el.statusChip.textContent = 'Cannot read story';
    el.statusChip.className = 'chip warn';
    if (!quiet) logLine(`✗ ${err.error ?? res.statusText}`, 'err');
    return;
  }

  const { plan } = await res.json();
  showPlan(plan);
  if (!running) {
    el.statusChip.textContent = 'Plan ready';
    el.statusChip.className = 'chip';
  }
}

function showPlan(plan) {
  if (!plan) {
    el.plan.hidden = true;
    el.planEmpty.hidden = false;
    el.mastheadMeta.innerHTML = '';
    return;
  }
  el.plan.hidden = false;
  el.planEmpty.hidden = true;

  const targetNote = plan.targetSeconds && plan.targetMet === false
    ? ` <span class="warn-inline">(${plan.targetSeconds}s requested — the story needs longer)</span>`
    : '';

  el.planStats.innerHTML = [
    ['Characters', plan.totals.characters],
    ['Scenes', plan.totals.scenes],
    ['Spoken lines', plan.totals.spokenLines],
    ['Duration', `${plan.seconds}s`],
  ].map(([label, value]) => `
    <div class="stat">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>
    </div>`).join('');

  el.mastheadMeta.innerHTML = `
    <span class="chip muted">${esc(plan.style.label)}</span>
    <span class="chip muted">${esc(plan.resolution)}</span>
    <span class="chip muted">${esc(plan.seconds)}s${targetNote}</span>`;

  el.characters.innerHTML = plan.characters.map((c) => `
    <div class="character">
      <div class="avatar" style="background:linear-gradient(150deg, ${esc(c.accent)}, ${esc(c.accent)}99); border:1px solid ${esc(c.accent)}88">${esc(c.initials)}</div>
      <div class="character-body">
        <div class="character-name">${esc(c.name)}</div>
        <div class="character-meta">${esc(c.role)} · ${esc(c.gender)} · scenes ${c.scenes.join(', ') || '—'}</div>
      </div>
      <div class="character-voice">${esc(c.voice.replace('en-US-', '').replace('en-GB-', ''))}</div>
    </div>`).join('') + `
    <div class="character narrator">
      <div class="avatar dim">NA</div>
      <div class="character-body">
        <div class="character-name">${esc(plan.narrator.name)}</div>
        <div class="character-meta">Narration for anything nobody says aloud</div>
      </div>
      <div class="character-voice">${esc(plan.narrator.voice.replace('en-US-', ''))}</div>
    </div>`;

  const byId = Object.fromEntries(plan.characters.map((c) => [c.id, c]));
  const transitions = plan.transitions;

  el.timeline.innerHTML = plan.scenes.map((scene, i) => {
    const cast = scene.characters.map((id) => byId[id]?.name).filter(Boolean);
    const beats = scene.beats.map((b) => {
      const who = b.speakerId && byId[b.speakerId] ? byId[b.speakerId].name : (b.kind === 'narration' ? 'Narrator' : '');
      return `<li class="${esc(b.kind)}">${who ? `<b>${esc(who)}</b> ` : ''}${esc(b.text)}</li>`;
    }).join('');
    const transition = transitions[i]
      ? `<li class="segment transition"><span class="segment-title">${esc(transition_label(transitions[i]))}</span>
           <span class="segment-time">${transitions[i].seconds}s</span></li>`
      : '';
    return `
      <li class="segment${scene.isFinale ? ' finale' : ''}">
        <div class="segment-head">
          <span class="segment-title">${scene.number}. ${esc(scene.title)}</span>
          <span class="segment-time">${scene.seconds}s</span>
        </div>
        <div class="segment-meta">${esc(scene.location.name)}${cast.length ? ` · ${esc(cast.join(', '))}` : ''}</div>
        ${beats ? `<ul class="segment-lines">${beats}</ul>` : ''}
      </li>${transition}`;
  }).join('');
}

const transition_label = (t) => `${t.type} — ${t.caption}`;

/* -------------------------------------------------------------- generation -- */

function renderStagePills(active, done) {
  el.stages.innerHTML = STAGES.map((s) => {
    const cls = done.has(s.id) ? 'done' : s.id === active ? 'active' : '';
    return `<span class="stage-pill ${cls}">${s.label}</span>`;
  }).join('');
}

function setProgress(fraction, label) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  el.barFill.style.width = `${pct}%`;
  el.progressPct.textContent = `${pct}%`;
  if (label) el.progressStage.textContent = label;
}

function showVideo(url) {
  el.video.src = url;
  el.video.hidden = false;
  el.playerEmpty.hidden = true;
}

function showChecks(checks) {
  if (!checks?.length) { el.checks.hidden = true; return; }
  el.checks.hidden = false;
  el.checksList.innerHTML = checks.map((c) => `
    <li class="${c.pass ? 'pass' : 'fail'}">
      <span class="mark">${c.pass ? '✓' : '✗'}</span>
      <span>${esc(c.name)}</span>
      <span class="detail">${esc(c.detail ?? '')}</span>
    </li>`).join('');
}

function connectProgress() {
  eventSource?.close();
  eventSource = new EventSource('/api/progress');
  const doneStages = new Set();

  eventSource.onmessage = (msg) => {
    const event = JSON.parse(msg.data);

    switch (event.type) {
      case 'start': logLine(event.message); break;

      case 'stage':
        renderStagePills(event.stage, doneStages);
        logLine(`▸ ${event.message}`);
        setProgress(event.overall ?? 0, event.message);
        break;

      case 'plan':
        showPlan(event.plan);
        logLine(`· ${event.message}`);
        break;

      case 'progress':
        setProgress(event.overall ?? 0, event.message);
        break;

      case 'stage-done':
        doneStages.add(event.stage);
        renderStagePills(null, doneStages);
        logLine(`✓ ${event.message}`, 'ok');
        setProgress(event.overall ?? 0, event.message);
        break;

      case 'warning': logLine(`! ${event.message}`, 'warn'); break;

      case 'done': {
        running = false;
        el.generate.disabled = false;
        el.generate.textContent = 'Regenerate video';
        el.download.disabled = false;
        el.statusChip.textContent = 'Video ready';
        el.statusChip.className = 'chip ok';
        setProgress(1, 'Complete');
        renderStagePills(null, new Set(STAGES.map((s) => s.id)));
        const r = event.result;
        logLine(`✓ ${r.seconds.toFixed(2)}s · ${r.frames} frames · ${(r.bytes / 1e6).toFixed(2)} MB`, 'ok');
        showChecks(r.checks);
        showVideo(r.videoUrl);
        break;
      }

      case 'error':
        running = false;
        el.generate.disabled = false;
        el.generate.textContent = 'Try again';
        el.statusChip.textContent = 'Failed';
        el.statusChip.className = 'chip danger';
        el.errorBlock.hidden = false;
        el.errorMessage.textContent = event.error?.message ?? event.message;
        el.errorHint.textContent = [
          event.error?.stage ? `stage: ${event.error.stage}` : '',
          event.error?.hint ? `hint:  ${event.error.hint}` : '',
          event.error?.cause ? `cause: ${event.error.cause}` : '',
        ].filter(Boolean).join('\n');
        logLine(`✗ ${event.message}`, 'err');
        break;
    }
  };

  eventSource.onerror = () => {
    if (running) logLine('· progress stream interrupted, reconnecting…', 'warn');
  };
}

/* ----------------------------------------------------------------- events -- */

el.story.addEventListener('input', onStoryChanged);
for (const control of [el.duration, el.style, el.aspect, el.voice]) {
  control.addEventListener('change', () => analyse({ quiet: true }));
}
el.analyse.addEventListener('click', () => analyse());

el.generate.addEventListener('click', async () => {
  if (running) return;
  const body = settings();
  if (!body.text.trim()) { el.story.focus(); return; }

  running = true;
  el.generate.disabled = true;
  el.generate.textContent = 'Generating…';
  el.statusChip.textContent = 'Generating…';
  el.statusChip.className = 'chip';
  el.errorBlock.hidden = true;
  el.checks.hidden = true;
  el.progressBlock.hidden = false;
  el.log.textContent = '';
  setProgress(0, 'Starting…');
  renderStagePills('analyse', new Set());
  connectProgress();

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    running = false;
    el.generate.disabled = false;
    el.generate.textContent = 'Generate video';
    logLine(`✗ ${err.error ?? res.statusText}`, 'err');
  }
});

el.download.addEventListener('click', () => { window.location.href = '/api/download'; });

/* ------------------------------------------------------------------- init -- */

(async function init() {
  await loadOptions();
  const res = await fetch('/api/status');
  if (res.ok) {
    const status = await res.json();
    if (status.output.exists) {
      showVideo(status.output.url);
      el.download.disabled = false;
    }
    if (status.plan) {
      showPlan(status.plan);
      el.statusChip.textContent = status.output.exists ? 'Video ready' : 'Plan ready';
      el.statusChip.className = status.output.exists ? 'chip ok' : 'chip';
    }
  }
  onStoryChanged();
})();
