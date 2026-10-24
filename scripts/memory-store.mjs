// An in-memory stand-in for the Supabase tables, used by scripts/mock-license.mjs and the tests.
// It implements the same store interface the edge functions use. Nothing here is for production.
export function memoryStore() {
  const licenses = []; const devices = []; const events = []; const ipHits = [];
  const teams = []; const members = []; const invites = []; const teamLeads = []; const teamEvents = []; const blocked = [];
  let n = 0;
  const id = () => `id-${++n}`;
  const stamp = () => new Date().toISOString();
  const present = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

  return {
    tables: { licenses, devices, events, ipHits, teams, members, invites, teamLeads, teamEvents, blocked },

    // ---------- licences ----------
    findLicense: async (hash) => licenses.find((l) => l.key_hash === hash) || null,
    findLicenseByOrder: async (ref) => licenses.find((l) => l.order_ref === ref) || null,
    createLicense: async (row) => { const l = { id: id(), created_at: stamp(), email_sent_at: null, ...row }; licenses.push(l); return l; },
    updateLicense: async (lid, patch) => Object.assign(licenses.find((l) => l.id === lid), patch),
    markEmailed: async (lid) => { licenses.find((l) => l.id === lid).email_sent_at = stamp(); },

    devices: async (lid) => devices.filter((d) => d.license_id === lid),
    upsertDevice: async (lid, d) => {
      const found = devices.find((x) => x.license_id === lid && x.device_hash === d.device_hash);
      if (found) Object.assign(found, d, { deactivated_at: null, last_seen_at: stamp() });
      else devices.push({ id: id(), license_id: lid, ...d, activated_at: stamp(), last_seen_at: stamp(), deactivated_at: null });
    },
    touchDevice: async (did, meta = {}) => Object.assign(devices.find((d) => d.id === did), present(meta), { last_seen_at: stamp() }),
    deactivateDevice: async (did) => { devices.find((d) => d.id === did).deactivated_at = stamp(); },
    logEvent: async (lid, type, meta = {}) => { events.push({ license_id: lid, type, meta, created_at: stamp() }); },
    countEvents: async (lid, type, since) => events.filter((e) => e.license_id === lid && e.type === type && e.created_at >= since).length,
    countIpActivations: async (ipHash, day) => ipHits.find((h) => h.ip_hash === ipHash && h.day === day)?.count ?? 0,
    addIpActivation: async (ipHash, day) => {
      const found = ipHits.find((h) => h.ip_hash === ipHash && h.day === day);
      if (found) found.count += 1;
      else ipHits.push({ ip_hash: ipHash, day, count: 1 });
    },

    // ---------- teams ----------
    team: async (tid) => teams.find((t) => t.id === tid) || null,
    createTeam: async (row) => { const t = { id: id(), created_at: stamp(), ...row }; teams.push(t); return t; },
    renameTeam: async (tid, name) => { teams.find((t) => t.id === tid).name = name; },

    findMemberByLicense: async (lid) => members.find((m) => m.license_id === lid && !m.removed_at) || null,
    findMember: async (mid) => members.find((m) => m.id === mid) || null,
    members: async (tid) => members.filter((m) => m.team_id === tid && !m.removed_at),
    addMember: async ({ licence_id, ...row }) => {
      const m = { id: id(), license_id: licence_id, joined_at: stamp(), last_seen_at: stamp(), removed_at: null, ...row };
      members.push(m);
      return m;
    },
    updateMember: async (mid, patch) => Object.assign(members.find((m) => m.id === mid), patch),

    createInvite: async (row) => { const i = { id: id(), created_at: stamp(), used_at: null, ...row }; invites.push(i); return i; },
    findInvite: async (hash) => invites.find((i) => i.code_hash === hash) || null,
    useInvite: async (iid, memberId) => Object.assign(invites.find((i) => i.id === iid), { used_at: stamp(), used_by: memberId }),

    upsertLeads: async (tid, rows) => {
      for (const row of rows) {
        const found = teamLeads.find((l) => l.team_id === tid && l.email === row.email);
        if (found) Object.assign(found, row);
        else teamLeads.push({ id: id(), created_at: stamp(), ...row });
      }
    },
    leadsByEmails: async (tid, emails) => teamLeads.filter((l) => l.team_id === tid && emails.includes(l.email)),
    leadsSince: async (tid, since, ownerId) => teamLeads
      .filter((l) => l.team_id === tid && l.updated_at > since && (!ownerId || l.owner_member_id === ownerId))
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)),

    insertEvents: async (rows) => {
      for (const row of rows) {
        if (!teamEvents.some((e) => e.team_id === row.team_id && e.event_ref === row.event_ref)) teamEvents.push(row);
      }
    },
    eventsSince: async (tid, since, memberId) => teamEvents
      .filter((e) => e.team_id === tid && e.at > since && (!memberId || e.member_id === memberId))
      .sort((a, b) => (a.at < b.at ? 1 : -1)),
    eventsForTotals: async (tid, since) => teamEvents.filter((e) => e.team_id === tid && e.at >= since),

    upsertBlocked: async (tid, rows) => {
      for (const row of rows) {
        const found = blocked.find((b) => b.team_id === tid && b.value === row.value);
        if (found) Object.assign(found, row);
        else blocked.push(row);
      }
    },
    blockedSince: async (tid, since) => blocked.filter((b) => b.team_id === tid && b.at > since),
  };
}
