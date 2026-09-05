/**
 * Local web application for the text-to-video pipeline.
 *
 * Serves the control panel, exposes the pipeline over a small JSON API,
 * streams progress with Server-Sent Events, and serves the finished MP4 for
 * both inline preview and download.
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PATHS } from '../engine/io/paths.mjs';
import { log } from '../engine/io/log.mjs';
import { STYLES } from '../engine/analysis/lexicon.mjs';
import { analyseStory } from '../engine/analysis/heuristic.mjs';
import { compilePlan } from '../engine/plan/compile.mjs';
import { planExists, loadPlan } from '../engine/plan/store.mjs';
import { GenerationJob, summarisePlan, DEFAULT_OUTPUT } from './pipeline.js';

const app = express();
const PORT = Number(process.env.PORT) || 5178;
const job = new GenerationJob();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(PATHS.server, 'webapp'), { extensions: ['html'] }));

const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
};

/* ----------------------------------------------------------------- options -- */

app.get('/api/options', (req, res) => {
  let samples = [];
  try {
    samples = fs.readdirSync(path.join(PATHS.root, 'stories'))
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({
        id: f.replace(/\.txt$/, ''),
        name: f.replace(/\.txt$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      }));
  } catch { /* no samples directory is fine */ }

  res.json({
    styles: Object.values(STYLES).map((s) => ({
      id: s.id, label: s.label, description: s.description, presentation: s.presentation,
    })),
    aspects: Object.keys(ASPECTS),
    durations: [15, 30, 45, 60, 90],
    samples,
  });
});

app.get('/api/sample/:id', (req, res) => {
  const file = path.join(PATHS.root, 'stories', `${path.basename(req.params.id)}.txt`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No such sample story' });
  res.json({ id: req.params.id, text: fs.readFileSync(file, 'utf8') });
});

/* ---------------------------------------------------------------- analysis -- */

/**
 * Analyse a story without building anything. The browser calls this as soon as
 * a story is pasted, so the user sees what was understood before committing to
 * a render.
 */
app.post('/api/analyse', (req, res) => {
  const { text, duration, style, title, aspect, voice, music } = req.body ?? {};
  if (!String(text ?? '').trim()) return res.status(400).json({ error: 'The story is empty' });

  try {
    const story = analyseStory(text, { targetSeconds: duration ?? null });
    const plan = compilePlan(story, {
      targetSeconds: duration ?? null,
      styleId: style ?? null,
      title: title || null,
      resolution: ASPECTS[aspect] ?? ASPECTS['16:9'],
      voiceStyle: voice ?? 'balanced',
      music: music !== false,
    });
    res.json({ plan: summarisePlan(plan) });
  } catch (err) {
    res.status(400).json({ error: err.message, hint: err.hint ?? null });
  }
});

/* ------------------------------------------------------------------ status -- */

app.get('/api/status', (req, res) => {
  const output = fs.existsSync(DEFAULT_OUTPUT) ? fs.statSync(DEFAULT_OUTPUT) : null;

  let plan = null;
  if (planExists()) {
    try { plan = summarisePlan(loadPlan()); } catch { plan = null; }
  }

  res.json({
    plan,
    output: output
      ? { exists: true, bytes: output.size, modified: output.mtimeMs, url: `/api/video?v=${output.mtimeMs}` }
      : { exists: false },
    job: {
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      result: job.result,
    },
  });
});

/* ---------------------------------------------------------------- generate -- */

app.post('/api/generate', (req, res) => {
  if (job.running) return res.status(409).json({ error: 'A generation is already running' });

  const { text, duration, style, title, aspect, voice, music, forceAssets, offline } = req.body ?? {};
  if (!String(text ?? '').trim()) return res.status(400).json({ error: 'The story is empty' });

  // Respond immediately; the browser follows progress on /api/progress.
  res.json({ started: true });

  job.run(text, {
    targetSeconds: duration ?? null,
    styleId: style ?? null,
    title: title || null,
    resolution: ASPECTS[aspect] ?? ASPECTS['16:9'],
    voiceStyle: voice ?? 'balanced',
    music: music !== false,
    forceAssets: !!forceAssets,
    offline: !!offline,
  }).catch(() => { /* the job records and emits its own error */ });
});

app.get('/api/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const unsubscribe = job.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

/* ------------------------------------------------------------------- video -- */

app.get('/api/video', (req, res) => {
  if (!fs.existsSync(DEFAULT_OUTPUT)) {
    return res.status(404).json({ error: 'No rendered video yet. Generate one first.' });
  }
  res.sendFile(DEFAULT_OUTPUT);
});

app.get('/api/download', (req, res) => {
  if (!fs.existsSync(DEFAULT_OUTPUT)) {
    return res.status(404).json({ error: 'No rendered video yet. Generate one first.' });
  }
  let name = 'story.mp4';
  try {
    if (planExists()) name = `${loadPlan().meta.id || 'story'}.mp4`;
  } catch { /* fall back to the default name */ }
  res.download(DEFAULT_OUTPUT, name);
});

app.use((err, req, res, _next) => {
  log.error(`${req.method} ${req.url} — ${err.message}`);
  res.status(500).json({ error: err.message, hint: err.hint ?? null });
});

const server = app.listen(PORT, () => {
  log.banner('Text to Video Studio');
  log.ok(`web application running at http://localhost:${PORT}`);
  log.info(`output directory: ${PATHS.output}`);
  log.info('press Ctrl+C to stop');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`port ${PORT} is already in use`);
    log.info('set a different port, e.g. PORT=5179 npm start');
    process.exit(1);
  }
  throw err;
});

export { app, server };
