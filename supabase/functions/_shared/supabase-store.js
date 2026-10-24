// The storage the license rules need (see license-core.js), backed by the Supabase tables in
// supabase/migrations. Uses the service role client, so it bypasses row level security.
export function supabaseStore(sb) {
  const run = async (query) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };
  const stamp = () => new Date().toISOString();
  const present = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

  return {
    findLicense: (keyHash) => run(sb.from('licenses').select('*').eq('key_hash', keyHash).maybeSingle()),
    findLicenseByOrder: (orderRef) => run(sb.from('licenses').select('*').eq('order_ref', orderRef).maybeSingle()),
    createLicense: (row) => run(sb.from('licenses').insert(row).select().single()),
    updateLicense: (id, patch) => run(sb.from('licenses').update(patch).eq('id', id).select().single()),
    markEmailed: (id) => run(sb.from('licenses').update({ email_sent_at: stamp() }).eq('id', id)),

    devices: (licenseId) => run(sb.from('license_devices').select('*').eq('license_id', licenseId).order('activated_at')),
    upsertDevice: (licenseId, device) =>
      run(sb.from('license_devices').upsert(
        { license_id: licenseId, ...device, activated_at: stamp(), last_seen_at: stamp(), deactivated_at: null },
        { onConflict: 'license_id,device_hash' },
      )),
    touchDevice: (id, meta) => run(sb.from('license_devices').update({ ...present(meta), last_seen_at: stamp() }).eq('id', id)),
    deactivateDevice: (id) => run(sb.from('license_devices').update({ deactivated_at: stamp() }).eq('id', id)),

    countIpActivations: async (ipHash, day) => {
      const { data, error } = await sb.from('license_ip_hits').select('count').eq('ip_hash', ipHash).eq('day', day).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.count ?? 0;
    },
    addIpActivation: async (ipHash, day) => {
      const { data } = await sb.from('license_ip_hits').select('count').eq('ip_hash', ipHash).eq('day', day).maybeSingle();
      return run(sb.from('license_ip_hits').upsert({ ip_hash: ipHash, day, count: (data?.count ?? 0) + 1 }, { onConflict: 'ip_hash,day' }));
    },

    logEvent: (licenseId, type, meta = {}) => run(sb.from('license_events').insert({ license_id: licenseId, type, meta })),
    countEvents: async (licenseId, type, sinceIso) => {
      const { count, error } = await sb
        .from('license_events')
        .select('id', { count: 'exact', head: true })
        .eq('license_id', licenseId)
        .eq('type', type)
        .gte('created_at', sinceIso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  };
}
