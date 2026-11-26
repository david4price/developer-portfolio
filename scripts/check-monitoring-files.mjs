// Validates the Grafana dashboards and alert rules that the cluster (P9-05, P9-06) and the local
// stack (compose.observability.yaml, P9-08) provision from Git, so a broken file fails `pnpm check`
// instead of a Grafana start. Rules: infrastructure/monitoring/{dashboards,alerts}/README.md.
//   node scripts/check-monitoring-files.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The data sources both Grafanas provision, by uid. */
export const DATASOURCE_UIDS = new Set(['prometheus', 'loki']);
/** Grafana's server-side expressions (math, reduce, threshold) in alert rules. */
const EXPRESSION_UID = '__expr__';
const UID = /^[A-Za-z0-9_-]{1,40}$/;
const VARIABLE = /^\$\{?[A-Za-z0-9_]+\}?$/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses a file's text as JSON, or returns the reason it isn't. */
export function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return {
      error: `isn't valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/** Every `datasource.uid` anywhere in a dashboard (panels, targets, variables, annotations). */
function datasourceUids(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) datasourceUids(item, found);
  } else if (isObject(node)) {
    if (isObject(node.datasource) && typeof node.datasource.uid === 'string') {
      found.push(node.datasource.uid);
    }
    for (const value of Object.values(node)) datasourceUids(value, found);
  }
  return found;
}

/** Problems with one dashboard (an empty list when it's valid). */
export function dashboardProblems(dashboard) {
  if (!isObject(dashboard)) return ['must be a JSON object'];
  const problems = [];
  if (typeof dashboard.title !== 'string' || dashboard.title.trim() === '') {
    problems.push('needs a title');
  }
  if (typeof dashboard.uid !== 'string' || !UID.test(dashboard.uid)) {
    problems.push('needs a uid of 1–40 letters, digits, "-", or "_"');
  }
  if (dashboard.id !== undefined && dashboard.id !== null) {
    problems.push('must have no id (Grafana assigns its own)');
  }
  for (const uid of new Set(datasourceUids(dashboard))) {
    if (!DATASOURCE_UIDS.has(uid) && !VARIABLE.test(uid)) {
      problems.push(`uses data source "${uid}", which isn't provisioned`);
    }
  }
  return problems;
}

/** Problems with one alert rule file (Grafana's provisioning format). */
export function alertFileProblems(file) {
  if (!isObject(file)) return ['must be a JSON object'];
  const problems = [];
  if (file.apiVersion !== 1) problems.push('needs apiVersion 1');
  if (!Array.isArray(file.groups) || file.groups.length === 0) {
    return [...problems, 'needs a non-empty groups list'];
  }
  file.groups.forEach((group, index) => {
    const where = `group ${isObject(group) && group.name ? `"${group.name}"` : index + 1}`;
    if (!isObject(group)) {
      problems.push(`${where} must be an object`);
      return;
    }
    for (const key of ['name', 'folder', 'interval']) {
      if (typeof group[key] !== 'string' || group[key] === '')
        problems.push(`${where} needs a ${key}`);
    }
    if (!Array.isArray(group.rules) || group.rules.length === 0) {
      problems.push(`${where} needs at least one rule`);
      return;
    }
    for (const rule of group.rules) problems.push(...ruleProblems(rule, where));
  });
  return problems;
}

function ruleProblems(rule, where) {
  const name = isObject(rule) && typeof rule.uid === 'string' ? `rule "${rule.uid}"` : 'a rule';
  if (!isObject(rule)) return [`${where}: rules must be objects`];
  const problems = [];
  if (typeof rule.uid !== 'string' || !UID.test(rule.uid)) {
    problems.push(`${where}: ${name} needs a uid of 1–40 letters, digits, "-", or "_"`);
  }
  if (typeof rule.title !== 'string' || rule.title === '')
    problems.push(`${where}: ${name} needs a title`);
  const data = Array.isArray(rule.data) ? rule.data : [];
  if (data.length === 0) problems.push(`${where}: ${name} needs data queries`);
  const refIds = new Set(data.map((query) => (isObject(query) ? query.refId : undefined)));
  if (typeof rule.condition !== 'string' || !refIds.has(rule.condition)) {
    problems.push(`${where}: ${name}'s condition must name one of its data queries`);
  }
  for (const query of data) {
    const uid = isObject(query) ? query.datasourceUid : undefined;
    if (uid !== EXPRESSION_UID && !DATASOURCE_UIDS.has(uid)) {
      problems.push(`${where}: ${name} uses data source "${String(uid)}", which isn't provisioned`);
    }
  }
  return problems;
}

/**
 * Checks every .json file in the two directories: the problems found, by file, plus duplicate
 * uids across dashboards and across rules.
 */
export function checkMonitoringFiles({ dashboardsDir, alertsDir }) {
  const problems = [];
  const seen = { dashboard: new Map(), rule: new Map() };
  const remember = (kind, uid, file) => {
    if (typeof uid !== 'string') return;
    const first = seen[kind].get(uid);
    if (first) problems.push(`${file}: ${kind} uid "${uid}" is also used in ${first}`);
    else seen[kind].set(uid, file);
  };
  const jsonFiles = (dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();

  for (const name of jsonFiles(dashboardsDir)) {
    const file = join(dashboardsDir, name);
    const parsed = parseJson(readFileSync(file, 'utf8'));
    if (parsed.error) {
      problems.push(`${file}: ${parsed.error}`);
      continue;
    }
    problems.push(...dashboardProblems(parsed.value).map((problem) => `${file}: ${problem}`));
    if (isObject(parsed.value)) remember('dashboard', parsed.value.uid, file);
  }
  for (const name of jsonFiles(alertsDir)) {
    const file = join(alertsDir, name);
    const parsed = parseJson(readFileSync(file, 'utf8'));
    if (parsed.error) {
      problems.push(`${file}: ${parsed.error}`);
      continue;
    }
    problems.push(...alertFileProblems(parsed.value).map((problem) => `${file}: ${problem}`));
    const groups =
      isObject(parsed.value) && Array.isArray(parsed.value.groups) ? parsed.value.groups : [];
    for (const group of groups) {
      for (const rule of isObject(group) && Array.isArray(group.rules) ? group.rules : []) {
        if (isObject(rule)) remember('rule', rule.uid, file);
      }
    }
  }
  return { problems, dashboards: seen.dashboard.size, rules: seen.rule.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { problems, dashboards, rules } = checkMonitoringFiles({
    dashboardsDir: join(root, 'infrastructure/monitoring/dashboards'),
    alertsDir: join(root, 'infrastructure/monitoring/alerts'),
  });
  for (const problem of problems) console.error(`FAIL: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`monitoring files: ${dashboards} dashboard(s), ${rules} alert rule(s), all valid`);
}
