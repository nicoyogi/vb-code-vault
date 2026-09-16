import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../lib/agents.mjs';

test('parses the key set the real agent files use', () => {
  const fm = parseFrontmatter([
    '---',
    'name: coder',
    'description: "Use to implement an approved plan or fix: write the minimal correct change."',
    'tools: read_file, read_directory, grep, glob, edit_file, write_file, shell_command',
    'model: deepseek/deepseek-v4.1-flash',
    'reasoningEffort: high',
    'maxTurns: 100',
    'showOutput: true',
    '---',
    '',
    'You are the Coder in a multi-agent engineering workflow.',
  ].join('\n'));

  assert.equal(fm.name, 'coder');
  assert.equal(fm.model, 'deepseek/deepseek-v4.1-flash');
  assert.equal(fm.reasoningEffort, 'high');
  assert.equal(fm.maxTurns, '100');
});

test('a description containing a colon keeps everything after the first colon', () => {
  const fm = parseFrontmatter('---\nname: x\ndescription: "Does this: and that"\n---\n');
  assert.equal(fm.description, '"Does this: and that"');
});

test('an empty description is simply absent, not an error', () => {
  const fm = parseFrontmatter('---\nname: bare\n---\nbody\n');
  assert.equal(fm.name, 'bare');
  assert.equal(fm.description, undefined);
});

test('a file with no frontmatter yields nothing rather than throwing', () => {
  assert.deepEqual(parseFrontmatter('just a body, no fences'), {});
  assert.deepEqual(parseFrontmatter(''), {});
});

test('the continuation marker never leaks into the parsed keys', () => {
  const fm = parseFrontmatter('---\nname: a\n  wrapped\n---\n');
  assert.equal(fm.__last, undefined);
  assert.equal(fm.name, 'a');
});
