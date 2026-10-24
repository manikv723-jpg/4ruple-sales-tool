// The storage the team rules need (see team-core.js), backed by the tables in supabase/migrations.
// Service role client, so it bypasses row level security.
export function supabaseTeamStore(sb) {
  const run = async (query) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };
  const stamp = () => new Date().toISOString();

  return {
    team: (id) => run(sb.from('teams').select('*').eq('id', id).single()),
    createTeam: (row) => run(sb.from('teams').insert(row).select().single()),
    renameTeam: (id, name) => run(sb.from('teams').update({ name }).eq('id', id)),

    findMemberByLicense: (licenseId) => run(sb.from('team_members').select('*').eq('license_id', licenseId).is('removed_at', null).maybeSingle()),
    findMember: (id) => run(sb.from('team_members').select('*').eq('id', id).maybeSingle()),
    members: (teamId) => run(sb.from('team_members').select('*').eq('team_id', teamId).is('removed_at', null).order('joined_at')),
    addMember: ({ licence_id, ...row }) => run(sb.from('team_members').insert({ ...row, license_id: licence_id }).select().single()),
    updateMember: (id, patch) => run(sb.from('team_members').update(patch).eq('id', id)),

    createInvite: (row) => run(sb.from('team_invites').insert(row).select().single()),
    findInvite: (hash) => run(sb.from('team_invites').select('*').eq('code_hash', hash).maybeSingle()),
    useInvite: (id, memberId) => run(sb.from('team_invites').update({ used_at: stamp(), used_by: memberId }).eq('id', id)),

    upsertLeads: (teamId, rows) => run(sb.from('team_leads').upsert(rows, { onConflict: 'team_id,email' })),
    leadsByEmails: (teamId, emails) => run(sb.from('team_leads').select('*').eq('team_id', teamId).in('email', emails)),
    leadsSince: (teamId, sinceIso, ownerMemberId) => {
      let q = sb.from('team_leads').select('*').eq('team_id', teamId).gt('updated_at', sinceIso).order('updated_at').limit(2000);
      if (ownerMemberId) q = q.eq('owner_member_id', ownerMemberId);
      return run(q);
    },

    // A repeated sync sends the same event refs again; ignoring duplicates keeps the day's counts honest.
    insertEvents: (rows) => run(sb.from('team_events').upsert(rows, { onConflict: 'team_id,event_ref', ignoreDuplicates: true })),
    eventsSince: (teamId, sinceIso, memberId) => {
      let q = sb.from('team_events').select('*').eq('team_id', teamId).gt('at', sinceIso).order('at', { ascending: false }).limit(1000);
      if (memberId) q = q.eq('member_id', memberId);
      return run(q);
    },
    eventsForTotals: (teamId, sinceIso) => run(sb.from('team_events').select('member_id, type, at').eq('team_id', teamId).gte('at', sinceIso).limit(5000)),

    upsertBlocked: (teamId, rows) => run(sb.from('team_blocklist').upsert(rows, { onConflict: 'team_id,value' })),
    blockedSince: (teamId, sinceIso) => run(sb.from('team_blocklist').select('*').eq('team_id', teamId).gt('at', sinceIso).limit(2000)),
  };
}
