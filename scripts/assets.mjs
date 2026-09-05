#!/usr/bin/env node
/** Builds every asset the current render plan needs. */
import { buildAssets } from '../engine/pipeline.mjs';
import { log, reportError } from '../engine/io/log.mjs';

log.banner('Building assets');
buildAssets({
  force: process.argv.includes('--force'),
  offline: process.argv.includes('--offline'),
})
  .then((report) => {
    log.banner('Summary');
    report.stages.forEach((s) => log[s.ok ? 'ok' : 'error'](`${s.id.padEnd(10)} ${s.summary}`));
    if (report.warnings.length) { log.blank(); report.warnings.forEach((w) => log.warn(w)); }
  })
  .catch((err) => { reportError(err); process.exit(1); });
