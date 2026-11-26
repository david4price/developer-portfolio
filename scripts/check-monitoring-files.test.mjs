// Unit tests for the dashboard and alert rule validator (P9-08).
// Run: node --test scripts/check-monitoring-files.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  alertFileProblems,
  checkMonitoringFiles,
  dashboardProblems,
  parseJson,
} from './check-monitoring-files.mjs';

const dashboard = (overrides = {}) => ({
  uid: 'api-overview',
  title: 'API overview',
  panels: [{ datasource: { type: 'prometheus', uid: 'prometheus' }, targets: [] }],
  ...overrides,
});

const rule = (overrides = {}) => ({
  uid: 'api-down',
  title: 'API down',
  condition: 'C',
  data: [
    { refId: 'A', datasourceUid: 'prometheus', model: { expr: 'up{job="portfolio-api"}' } },
    { refId: 'C', datasourceUid: '__expr__', model: { type: 'threshold' } },
  ],
  ...overrides,
});

const alertFile = (rules = [rule()]) => ({
  apiVersion: 1,
  groups: [{ name: 'api', folder: 'Portfolio', interval: '1m', rules }],
});

describe('dashboards', () => {
  it('accepts a dashboard on the provisioned data sources and template variables', () => {
    assert.deepEqual(dashboardProblems(dashboard()), []);
    assert.deepEqual(
      dashboardProblems(
        dashboard({ id: null, templating: { list: [{ datasource: { uid: '${datasource}' } }] } }),
      ),
      [],
    );
  });

  it('rejects a missing title or uid, an exported id, and unknown data sources', () => {
    assert.deepEqual(dashboardProblems(dashboard({ title: ' ', uid: 'has spaces', id: 7 })), [
      'needs a title',
      'needs a uid of 1–40 letters, digits, "-", or "_"',
      'must have no id (Grafana assigns its own)',
    ]);
    const nested = dashboard({
      panels: [{ panels: [{ targets: [{ datasource: { uid: 'P1809F7CD0C75ACF3' } }] }] }],
    });
    assert.deepEqual(dashboardProblems(nested), [
      'uses data source "P1809F7CD0C75ACF3", which isn\'t provisioned',
    ]);
    assert.deepEqual(dashboardProblems([]), ['must be a JSON object']);
  });
});

describe('alert rules', () => {
  it('accepts a group whose condition names one of its queries', () => {
    assert.deepEqual(alertFileProblems(alertFile()), []);
  });

  it('rejects a wrong apiVersion, empty groups, and incomplete groups', () => {
    assert.deepEqual(alertFileProblems({ apiVersion: 2, groups: [] }), [
      'needs apiVersion 1',
      'needs a non-empty groups list',
    ]);
    assert.deepEqual(alertFileProblems({ apiVersion: 1, groups: [{ name: 'api', rules: [] }] }), [
      'group "api" needs a folder',
      'group "api" needs a interval',
      'group "api" needs at least one rule',
    ]);
  });

  it('rejects a dangling condition, an unknown data source, and a missing uid or title', () => {
    assert.deepEqual(
      alertFileProblems(
        alertFile([
          rule({
            uid: '',
            title: '',
            condition: 'Z',
            data: [{ refId: 'A', datasourceUid: 'elsewhere' }],
          }),
        ]),
      ),
      [
        'group "api": rule "" needs a uid of 1–40 letters, digits, "-", or "_"',
        'group "api": rule "" needs a title',
        'group "api": rule ""\'s condition must name one of its data queries',
        'group "api": rule "" uses data source "elsewhere", which isn\'t provisioned',
      ],
    );
  });
});

describe('checkMonitoringFiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'monitoring-files-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const dirs = (name) => {
    const dashboardsDir = join(root, name, 'dashboards');
    const alertsDir = join(root, name, 'alerts');
    mkdirSync(dashboardsDir, { recursive: true });
    mkdirSync(alertsDir, { recursive: true });
    return { dashboardsDir, alertsDir };
  };

  it('passes empty directories and skips files that are not JSON', () => {
    const { dashboardsDir, alertsDir } = dirs('empty');
    writeFileSync(join(dashboardsDir, 'README.md'), '# not a dashboard');
    assert.deepEqual(checkMonitoringFiles({ dashboardsDir, alertsDir }), {
      problems: [],
      dashboards: 0,
      rules: 0,
    });
  });

  it('counts valid files and reports invalid JSON and duplicate uids by file', () => {
    const { dashboardsDir, alertsDir } = dirs('mixed');
    writeFileSync(join(dashboardsDir, 'a.json'), JSON.stringify(dashboard()));
    writeFileSync(join(dashboardsDir, 'b.json'), JSON.stringify(dashboard({ title: 'Copy' })));
    writeFileSync(join(dashboardsDir, 'c.json'), '{ not json');
    writeFileSync(join(alertsDir, 'api.json'), JSON.stringify(alertFile([rule(), rule()])));
    const { problems, dashboards, rules } = checkMonitoringFiles({ dashboardsDir, alertsDir });
    assert.equal(dashboards, 1);
    assert.equal(rules, 1);
    assert.equal(problems.length, 3);
    assert.match(problems[0], /b\.json: dashboard uid "api-overview" is also used in .*a\.json$/);
    assert.match(problems[1], /c\.json: isn't valid JSON/);
    assert.match(problems[2], /api\.json: rule uid "api-down" is also used in .*api\.json$/);
  });

  it('explains a parse failure', () => {
    assert.match(parseJson('[').error ?? '', /^isn't valid JSON \(/);
  });
});
