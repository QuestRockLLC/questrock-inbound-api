function hubSupabaseConfig() {
  return {
    url: (process.env.HUB_SUPABASE_URL || '').trim(),
    anonKey: (process.env.HUB_SUPABASE_ANON_KEY || '').trim(),
  };
}

export async function fetchHubUserFromToken(accessToken) {
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = hubSupabaseConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: 'misconfigured' };
  }

  let userRes;
  try {
    userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
    });
  } catch {
    return { error: 'auth' };
  }

  if (!userRes.ok) {
    return { error: 'auth' };
  }

  const user = await userRes.json().catch(() => null);
  if (!user?.email) {
    return { error: 'auth' };
  }

  let displayName = user.user_metadata?.full_name;
  if (!displayName) {
    try {
      const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/users?select=full_name&email=eq.${encodeURIComponent(user.email)}`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (profileRes.ok) {
        const rows = await profileRes.json();
        if (rows[0]?.full_name) displayName = rows[0].full_name;
      }
    } catch {
      /* optional profile lookup */
    }
  }

  if (!displayName) {
    displayName = user.email.split('@')[0];
  }

  return { email: user.email, displayName };
}

export async function signInWithPassword(email, password) {
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = hubSupabaseConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: 'Auth is not configured on this deployment.' };
  }

  let sbRes;
  try {
    sbRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: 'Could not reach auth service.' };
  }

  const sbData = await sbRes.json().catch(() => ({}));
  if (!sbRes.ok || sbData.error) {
    return {
      error: sbData.error_description || sbData.error || 'Invalid email or password.',
    };
  }

  const userEmail = sbData.user?.email || email;
  let displayName = sbData.user?.user_metadata?.full_name;

  if (!displayName && sbData.access_token) {
    const profile = await fetchHubUserFromToken(sbData.access_token);
    if (profile.displayName) displayName = profile.displayName;
  }

  return { email: userEmail, displayName: displayName || userEmail.split('@')[0] };
}

export { hubSupabaseConfig };
