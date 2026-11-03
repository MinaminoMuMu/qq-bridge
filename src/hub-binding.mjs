import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /^\d+$/;
const SAFE_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;

function fail(code) {
  return { ok: false, code };
}

function stableUserId(event) {
  const a = event?.user_id != null ? String(event.user_id) : '';
  const b = event?.sender?.user_id != null ? String(event.sender.user_id) : '';
  if (a && b && a !== b) return null;
  const id = a || b;
  return ID_RE.test(id) ? id : null;
}

export function deriveHubBinding(event, cfg = {}, sessionId = '') {
  if (!sessionId || typeof sessionId !== 'string') return fail('missing_session_id');
  const ph = cfg.personaHub ?? {};
  if (ph.enabled !== true) return fail('disabled');

  const source = String(ph.source ?? '');
  const connectorAccount = String(ph.connectorAccount ?? '');
  const configuredSelfId = String(ph.selfId ?? '');
  const agentId = String(ph.agentId ?? '');
  if (!SAFE_RE.test(source)) return fail('invalid_source');
  if (!SAFE_RE.test(connectorAccount)) return fail('invalid_connector_account');
  if (!ID_RE.test(configuredSelfId)) return fail('invalid_self_id');
  if (!agentId) return fail('invalid_agent_id');

  const eventSelfId = String(event?.self_id ?? '');
  if (!eventSelfId || eventSelfId !== configuredSelfId) return fail('self_id_mismatch');

  const externalUserId = stableUserId(event);
  if (!externalUserId) return fail('missing_or_conflicting_user_id');

  const kind = event.group_id != null ? 'group' : 'private';
  let contextKey;
  if (kind === 'group') {
    const groupId = String(event.group_id ?? '');
    if (!ID_RE.test(groupId)) return fail('invalid_group_id');
    contextKey = `group:${groupId}`;
  } else {
    contextKey = `private:${externalUserId}`;
  }

  return {
    ok: true,
    binding: {
      agent_id: agentId,
      source,
      connector_account: connectorAccount,
      context_key: contextKey,
      person_id: externalUserId
    }
  };
}

function parseExisting(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { ok: true, map: {} };
    return { ok: false, code: 'read_failed' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'corrupt_json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'corrupt_shape' };
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'schema_version')) {
    return { ok: false, code: 'unsupported_schema' };
  }
  return { ok: true, map: parsed };
}

export function writeHubBinding(dataDir, sessionId, binding) {
  if (!dataDir || !sessionId || !binding) return { ok: false, code: 'invalid_argument' };
  const dir = path.resolve(dataDir);
  if (!path.isAbsolute(dir)) return { ok: false, code: 'invalid_data_dir' };
  const file = path.join(dir, 'bindings.json');
  const existing = parseExisting(file);
  if (!existing.ok) return existing;
  const map = { ...existing.map, [sessionId]: binding };
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { ok: true, code: 'written', path: file };
}

export function applyHubBinding(event, cfg, sessionId) {
  const derived = deriveHubBinding(event, cfg, sessionId);
  if (!derived.ok) return derived;
  const dataDir = String(cfg?.personaHub?.dataDir ?? '');
  const pluginDataDir = String(process.env.PERSONA_HUB_DATA ?? '');
  if (!dataDir || !path.isAbsolute(dataDir)) return fail('missing_or_invalid_data_dir');

  if (!pluginDataDir || path.resolve(dataDir) !== path.resolve(pluginDataDir)) {
    return fail('data_dir_mismatch');
  }
  return writeHubBinding(dataDir, sessionId, derived.binding);
}
