import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEngine } from './harness/load-engine.mjs';

const e = loadEngine();
const SOURCE = readFileSync(new URL('../assets/anmerkung.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../anmerkung.html', import.meta.url), 'utf8');

function clearProject() {
  e.localStorage.removeItem('anmerkung.project.v1');
}

test('project picker accepts WMF and persists it locally', () => {
  clearProject();
  assert.equal(e.projectId(), null);
  assert.equal(e.chooseProject('wmf'), true);
  assert.equal(e.localStorage.getItem('anmerkung.project.v1'), 'wmf');
  assert.equal(e.projectId(), 'wmf');
});

test('project picker rejects stale values and cannot overwrite a valid choice', () => {
  e.localStorage.setItem('anmerkung.project.v1', 'retired-project');
  assert.equal(e.projectId(), null);
  assert.equal(e.chooseProject('retired-project'), false);
  assert.equal(e.localStorage.getItem('anmerkung.project.v1'), 'retired-project');

  assert.equal(e.chooseProject('wmf'), true);
  assert.equal(e.chooseProject('unknown'), false);
  assert.equal(e.projectId(), 'wmf');
});

test('project picker uses a native accessible modal and opens during page initialization', () => {
  assert.match(PAGE, /<dialog id="dlgProject" class="project-dialog" aria-labelledby="dlgProjectTitle">/);
  assert.match(PAGE, /id="projectOptions" role="radiogroup" aria-label="Project"/);
  assert.match(PAGE, /Continue/);
  assert.match(SOURCE, /const PROJECTS=\[\{id:'wmf',label:'WMF'/);
  assert.match(SOURCE, /project-option\$\{project\.id===current\?' selected':''\}/);
  assert.match(SOURCE, /function openProjectDialogIfNeeded\(\)[\s\S]*?dialog\.showModal\(\)/);
  assert.match(SOURCE, /DOMContentLoaded[\s\S]*?openProjectDialogIfNeeded\(\)/);
  assert.match(SOURCE, /function projectKeydown\(event\)[\s\S]*?ArrowDown/);
});

test('project selection stays separate from forwarder selection', () => {
  assert.doesNotMatch(SOURCE.match(/function chooseProject\(id\)\{[^}]+\}/)?.[0] || '', /selectedFW/);
});

test('project picker exposes a persistent workspace switcher', () => {
  assert.match(PAGE, /id="projectSwitch"/);
  assert.match(PAGE, /id="projectSwitchLabel"/);
  assert.match(PAGE, /id="projectSwitchMeta"/);
  assert.match(PAGE, /onclick="openProjectDialog\(\)"/);
  assert.match(SOURCE, /function openProjectDialog\(\)/);
  assert.match(SOURCE, /function updateProjectSwitch\(id\)/);
  assert.match(SOURCE, /project-option-icon/);
  assert.match(SOURCE, /project-option-badge/);
});
