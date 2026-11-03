import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveHubBinding, writeHubBinding, applyHubBinding } from '../src/hub-binding.mjs';

const cfg = {
  personaHub: {
    enabled: true,
    source: 'qq',
    connectorAccount: 'bot-1',
    selfId: '10001',
    agentId: 'dsh:qq-agent',
    dataDir: ''
  }
};

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bridge-hub-binding-'));
}

test('hub binding: private/group derivation and identity guards', () => {
  const priv = deriveHubBinding({ self_id: 10001, user_id: 20002, sender: { user_id: 20002, card: 'Alice' } }, cfg, 's1');
  assert.equal(priv.ok, true);
  assert.deepEqual(priv.binding, {
    agent_id: 'dsh:qq-agent', source: 'qq', connector_account: 'bot-1',
    context_key: 'private:20002', person_id: '20002'
  });

  const group = deriveHubBinding({ self_id: 10001, user_id: 20002, group_id: 30003, sender: { user_id: 20002 } }, cfg, 's2');
  assert.equal(group.ok, true);
  assert.equal(group.binding.context_key, 'group:30003');
  assert.equal(group.binding.person_id, '20002');

  assert.equal(deriveHubBinding({ self_id: 99999, user_id: 20002 }, cfg, 's3').ok, false);
  assert.equal(deriveHubBinding({ self_id: 10001, user_id: 1, sender: { user_id: 2 } }, cfg, 's4').ok, false);
  const changed = { self_id: 10001, user_id: 20002, sender: { user_id: 20002, card: 'Different', nickname: 'X' } };
  assert.deepEqual(deriveHubBinding(changed, cfg, 's1').binding, priv.binding);
  assert.equal(deriveHubBinding({ self_id: 10001, user_id: 20002 }, { personaHub: { ...cfg.personaHub, enabled: false } }, 's5').code, 'disabled');
  assert.equal(deriveHubBinding({ self_id: 10001 }, cfg, 's6').code, 'missing_or_conflicting_user_id');
});

test('hub binding: v1 map shape, preservation and fail-closed corruption', () => {
  const dir = tmp();
  const file = path.join(dir, 'bindings.json');
  try {
    const existing = { old: { agent_id: 'a', source: 'qq', connector_account: 'b', context_key: 'private:1', person_id: '1' } };
    fs.writeFileSync(file, JSON.stringify(existing));
    const out = writeHubBinding(dir, 'session-1', {
      agent_id: 'dsh:qq-agent', source: 'qq', connector_account: 'bot-1',
      context_key: 'private:20002', person_id: '20002'
    });
    assert.equal(out.ok, true);
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(map.old, existing.old);
    assert.deepEqual(map['session-1'], {
      agent_id: 'dsh:qq-agent', source: 'qq', connector_account: 'bot-1',
      context_key: 'private:20002', person_id: '20002'
    });
    assert.equal('principal_person_id' in map['session-1'], false);
    assert.equal('binding_revision' in map['session-1'], false);

    fs.writeFileSync(file, '{bad json');
    const bad = writeHubBinding(dir, 'session-2', {
      agent_id: 'a', source: 'qq', connector_account: 'b', context_key: 'private:1', person_id: '1'
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'corrupt_json');
    assert.equal(fs.readFileSync(file, 'utf8'), '{bad json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hub binding: valid v2 is read-updated and written as v1', () => {
  const dir = tmp();
  const file = path.join(dir, 'bindings.json');
  try {
    const old = { agent_id: 'a', source: 'qq', connector_account: 'b', context_key: 'private:1', person_id: '1' };
    fs.writeFileSync(file, JSON.stringify({ schema_version: 2, bindings: { old } }));
    const out = writeHubBinding(dir, 'session-2', {
      agent_id: 'dsh:qq-agent', source: 'qq', connector_account: 'bot-1',
      context_key: 'group:30003', person_id: '20002'
    });
    assert.equal(out.ok, true);
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(map.old, old);
    assert.equal(map['session-2'].context_key, 'group:30003');
    assert.equal('schema_version' in map, false);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hub binding: malformed v2/entry/schema cases fail closed or drop invalid entries', () => {
  const dir = tmp();
  const file = path.join(dir, 'bindings.json');
  const good = { agent_id: 'a', source: 'qq', connector_account: 'b', context_key: 'private:1', person_id: '1' };
  try {
    fs.writeFileSync(file, JSON.stringify({ schema_version: 2, bindings: [] }));
    assert.equal(writeHubBinding(dir, 's', good).code, 'corrupt_shape');

    fs.writeFileSync(file, JSON.stringify({ schema_version: 3, bindings: {} }));
    assert.equal(writeHubBinding(dir, 's', good).code, 'unsupported_schema');

    fs.writeFileSync(file, JSON.stringify([]));
    assert.equal(writeHubBinding(dir, 's', good).code, 'corrupt_shape');

    fs.writeFileSync(file, JSON.stringify({ old: good, bad: { agent_id: 'a' } }));
    const out = writeHubBinding(dir, 'session-3', good);
    assert.equal(out.ok, true);
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(map.old, good);
    assert.equal('bad' in map, false);
    assert.deepEqual(map['session-3'], good);

    assert.equal(writeHubBinding(dir, 's', { ...good, context_key: 'bogus' }).code, 'invalid_argument');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hub binding: apply requires enabled config and matching shared dataDir', () => {
  const dir = tmp();
  const prev = process.env.PERSONA_HUB_DATA;
  try {
    process.env.PERSONA_HUB_DATA = dir;
    const local = { personaHub: { ...cfg.personaHub, dataDir: dir } };
    const out = applyHubBinding({ self_id: 10001, user_id: 20002 }, local, 'session-1');
    assert.equal(out.ok, true);
    assert.equal(fs.existsSync(path.join(dir, 'bindings.json')), true);

    const absent = applyHubBinding({ self_id: 10001, user_id: 20002 }, { personaHub: { ...local.personaHub, dataDir: '' } }, 'session-2');
    assert.equal(absent.ok, false);

    const disabledDir = tmp();
    const disabled = applyHubBinding(
      { self_id: 10001, user_id: 20002 },
      { personaHub: { ...cfg.personaHub, dataDir: disabledDir, enabled: false } },
      'session-disabled'
    );
    assert.equal(disabled.code, 'disabled');
    assert.equal(fs.existsSync(path.join(disabledDir, 'bindings.json')), false);
    fs.rmSync(disabledDir, { recursive: true, force: true });

    const mismatchDir = tmp();
    const mismatch = applyHubBinding({ self_id: 10001, user_id: 20002 }, { personaHub: { ...local.personaHub, dataDir: mismatchDir } }, 'session-3');
    assert.equal(mismatch.code, 'data_dir_mismatch');
    assert.equal(fs.existsSync(path.join(mismatchDir, 'bindings.json')), false);
    fs.rmSync(mismatchDir, { recursive: true, force: true });
  } finally {
    if (prev === undefined) delete process.env.PERSONA_HUB_DATA;
    else process.env.PERSONA_HUB_DATA = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hub binding: Windows path comparison is case-insensitive', () => {
  if (process.platform !== 'win32') return;
  const dir = tmp();
  const prev = process.env.PERSONA_HUB_DATA;
  try {
    process.env.PERSONA_HUB_DATA = dir.toUpperCase();
    const local = { personaHub: { ...cfg.personaHub, dataDir: dir } };
    const out = applyHubBinding({ self_id: 10001, user_id: 20002 }, local, 'session-case');
    assert.equal(out.ok, true);
  } finally {
    if (prev === undefined) delete process.env.PERSONA_HUB_DATA;
    else process.env.PERSONA_HUB_DATA = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
