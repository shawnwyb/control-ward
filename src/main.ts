import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { Database } from './database.types';
import './style.css';

type Site = Database['public']['Tables']['sites']['Row'];
type HazardType = Database['public']['Enums']['hazard_type'];
type Report = Omit<Database['public']['Tables']['hazard_reports']['Row'], 'location'> & {
  latitude: number; longitude: number; is_active: boolean;
};
type MutationResult = { outcome: 'created' | 'merged' | 'confirmed' | 'resolved'; report: Report };
type Photo = Database['public']['Tables']['hazard_photos']['Row'];

const root = document.querySelector<HTMLDivElement>('#app')!;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  root.innerHTML = '<main class="setup"><h1>Start your local crew workspace</h1><p>Run <code>npm run local:start</code> and <code>npm run local:reset</code>, then restart the development server.</p></main>';
  throw new Error('Missing Supabase configuration');
}
const supabase = createClient<Database>(url, key);
const localDemo = import.meta.env.VITE_LOCAL_DEMO === 'true';
const labels: Record<HazardType, string> = { debris: 'Debris', wildlife: 'Wildlife', downed_line: 'Downed line', washout: 'Washout', other: 'Other' };
const glyphs: Record<HazardType, string> = { debris: '▧', wildlife: '♧', downed_line: 'ϟ', washout: '≈', other: '◇' };
let sites: Site[] = [];
let reports: Report[] = [];
let selectedSite: Site | undefined;
let channel: RealtimeChannel | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshVersion = 0;
let pendingSubmission: { requestId: string; signature: string; photo?: Photo; file?: File; uploaded: boolean } | undefined;
const pendingCheckins = new Map<string, string>();
let busy = false;

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
}
function timeAgo(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}
function announce(message: string, error = false): void {
  const node = document.querySelector<HTMLElement>('#notice')!;
  node.textContent = message;
  node.className = `notice ${error ? 'error' : 'success'}`;
}
function setBusy(value: boolean): void {
  busy = value;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#report-form button, #report-form input, #site, #signout, .checkin')
    .forEach(node => { node.disabled = value; });
  document.querySelector<HTMLButtonElement>('#submit-report')!.textContent = value ? 'Saving report…' : 'Submit hazard report ↗';
}

function shell(): void {
  root.innerHTML = `
    <header class="topbar"><a class="brand" href="/" aria-label="PlanIT home"><span class="brand-icon">P<span>↗</span></span>PlanIT<span class="brand-light">Control</span></a><div class="top-right"><span class="environment">${localDemo ? 'LOCAL DEMO' : 'CREW WORKSPACE'}</span><span id="identity"></span><button id="signout" class="quiet" hidden>Sign out</button></div></header>
    <main>
      <section class="page-heading"><div><p class="eyebrow">FIELD OPERATIONS / CREW REPORTING</p><h1>Eyes on the ground.</h1><p class="subhead">Report what you see. Keep your crew a step ahead.</p></div><div id="site-control" hidden><label for="site">YOUR SITE</label><select id="site"></select></div></section>
      <div id="notice" class="notice" role="status" aria-live="polite"></div>
      <section id="login" class="panel login"><div><p class="eyebrow">CREW ACCESS</p><h2>Sign in to your site</h2><p>Reports and photos are shared with your assigned team.</p></div><form id="login-form"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${localDemo ? 'crew@planit.local' : ''}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required value="${localDemo ? 'CrewDemo123!' : ''}"><button class="primary" id="signin" type="submit">Sign in →</button></form>${localDemo ? '<div class="demo-note"><strong>Local test accounts</strong><p>North crew: crew@planit.local<br>South crew: other@planit.local<br>Both sites: supervisor@planit.local<br>No access: outsider@planit.local</p><p>All use <code>CrewDemo123!</code>. Demo sites and reports are fictional.</p></div>' : ''}</section>
      <section id="workspace" hidden>
        <div id="no-sites" class="panel" hidden><h2>No sites assigned</h2><p>Your account has no site access. Ask your supervisor to assign your crew.</p></div>
        <div id="site-workspace">
          <section class="metrics" aria-label="Site crew metrics"><div><span class="metric-label">ACTIVE NEARBY</span><strong id="metric-count">—</strong><small>open crew hazards</small></div><div><span class="metric-label">CREW RISK CONTRIBUTION</span><strong id="metric-risk">—</strong><small>out of 2 maximum</small></div><div><span class="metric-label">WILDLIFE SUBSCORE</span><strong id="metric-wildlife">—</strong><small>out of 10 · age adjusted</small></div><div class="live-metric"><span id="connection" class="connection">Connecting…</span><small>Shared with your site team</small></div></section>
          <div class="workspace-grid">
            <section class="panel report-panel"><div class="panel-heading"><span class="step">01</span><div><h2>Report a hazard</h2><p>A quick update makes a safer site.</p></div></div>
              <form id="report-form">
                <fieldset><legend>What did you spot?</legend><div class="type-options">${Object.entries(labels).map(([type, label], index) => `<label class="type-option"><input type="radio" name="type" value="${type}" ${index === 0 ? 'checked' : ''}><span class="type-tile"><span class="type-glyph" aria-hidden="true">${glyphs[type as HazardType]}</span>${label}</span></label>`).join('')}</div></fieldset>
                <fieldset><legend>How severe is it?</legend><div class="severity-options"><label><input type="radio" name="severity" value="1"><span><b>1</b> Low</span></label><label><input type="radio" name="severity" value="2" checked><span><b>2</b> Moderate</span></label><label><input type="radio" name="severity" value="3"><span><b>3</b> High</span></label></div></fieldset>
                <fieldset><legend>Pin the location</legend><p class="field-help">Tap the site map, use arrow keys on the map, or enter coordinates.</p><div class="coordinate-fields"><label for="latitude">Latitude<input id="latitude" name="latitude" type="number" step="any" min="-90" max="90" required></label><label for="longitude">Longitude<input id="longitude" name="longitude" type="number" step="any" min="-180" max="180" required></label></div><button type="button" id="locate" class="text-button">⌖ Use my location</button></fieldset>
                <fieldset><legend>Add a photo <span class="optional">optional</span></legend><label class="upload" for="photo"><span class="upload-icon" aria-hidden="true">↥</span><strong id="photo-name">Choose a photo</strong><span>JPEG, PNG or WebP · up to 5 MB</span><input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label></fieldset>
                <div class="submission-note"><span aria-hidden="true">↔</span><p>Same hazard nearby? We’ll merge your report and add a confirmation.</p></div>
                <button type="submit" id="submit-report" class="primary">Submit hazard report ↗</button>
              </form>
            </section>
            <div class="right-column"><section class="panel map-panel"><div class="map-heading"><div><p class="eyebrow">SITE OVERVIEW</p><h2 id="map-title">Your site</h2></div><span class="map-badge">1200 m × 800 m</span></div><svg id="pin-map" viewBox="0 0 600 400" role="application" tabindex="0" aria-label="Site pin map. Click to place a pin, or use arrow keys to move it."></svg><div class="map-caption"><span><i class="dot selected"></i>Your pin</span><span><i class="dot hazard"></i>Active hazard</span><span>Local coordinate map · no basemap</span></div></section>
              <section class="panel feed-panel"><div class="feed-heading"><div><p class="eyebrow">SHARED SITUATIONAL AWARENESS</p><h2>Site reports <span id="feed-count" class="count-badge">0</span></h2></div><label class="filter"><input id="show-resolved" type="checkbox"> Show resolved</label></div><div id="reminders"></div><div id="reports" aria-live="polite"></div></section>
            </div>
          </div>
        </div>
      </section>
      <footer>PLANIT CONTROL <span>Field observations inform your site’s risk. Follow your team’s safety procedures.</span></footer>
    </main>`;
  document.querySelector('#login-form')!.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.querySelector<HTMLButtonElement>('#signin')!;
    button.disabled = true; button.textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({ email: document.querySelector<HTMLInputElement>('#email')!.value.trim(), password: document.querySelector<HTMLInputElement>('#password')!.value });
    button.disabled = false; button.textContent = 'Sign in →';
    if (error) announce(error.message, true);
  });
  document.querySelector('#signout')!.addEventListener('click', async () => {
    if (busy) return;
    await discardPhoto();
    const { error } = await supabase.auth.signOut();
    if (error) announce(error.message, true);
  });
  document.querySelector('#site')!.addEventListener('change', async event => {
    if (busy) return;
    await discardPhoto();
    await selectSite((event.target as HTMLSelectElement).value);
  });
  document.querySelector('#report-form')!.addEventListener('submit', event => { event.preventDefault(); void submitReport(); });
  document.querySelector('#show-resolved')!.addEventListener('change', renderReports);
  for (const id of ['latitude', 'longitude']) document.getElementById(id)!.addEventListener('input', renderMap);
  document.querySelector('#photo')!.addEventListener('change', () => {
    document.querySelector('#photo-name')!.textContent = document.querySelector<HTMLInputElement>('#photo')!.files?.[0]?.name ?? 'Choose a photo';
  });
  document.querySelector('#locate')!.addEventListener('click', () => {
    if (!navigator.geolocation) return announce('Location is unavailable. Select a pin on the map.', true);
    navigator.geolocation.getCurrentPosition(position => setPin(position.coords.latitude, position.coords.longitude),
      () => announce('Could not access your location. Select a pin on the map or enter coordinates.', true), { timeout: 10000 });
  });
  const map = document.querySelector<SVGSVGElement>('#pin-map')!;
  map.addEventListener('click', event => {
    if (!selectedSite || busy) return;
    const point = map.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(map.getScreenCTM()!.inverse());
    const scale = longitudeScale();
    setPin(selectedSite.latitude + (200 - transformed.y) * 2 / 111320, selectedSite.longitude + (transformed.x - 300) * 2 / scale);
  });
  map.addEventListener('keydown', event => {
    if (!selectedSite || busy || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const [latitude, longitude] = getPin(); const distance = event.shiftKey ? 100 : 10;
    setPin(latitude + (event.key === 'ArrowUp' ? distance : event.key === 'ArrowDown' ? -distance : 0) / 111320,
      longitude + (event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0) / longitudeScale());
  });
  document.querySelector('#reports')!.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-report]');
    if (!button || busy) return;
    if (button.dataset.action === 'history') return void showHistory(button);
    const id = button.dataset.report!; const stillThere = button.dataset.action === 'confirm'; const signature = `${id}:${stillThere}`;
    const requestId = pendingCheckins.get(signature) ?? crypto.randomUUID();
    pendingCheckins.set(signature, requestId); setBusy(true);
    try {
      const { error } = await supabase.rpc('checkin_hazard_report', { p_request_id: requestId, p_report_id: id, p_still_there: stillThere });
      if (error) throw error;
      pendingCheckins.delete(signature);
      announce(stillThere ? 'Confirmed. Your team has the latest update.' : 'Marked resolved. Your team has been updated.');
      await refresh();
    } catch (error) { announce(errorMessage(error), true); }
    finally { setBusy(false); }
  });
}

function longitudeScale(): number { return 111320 * Math.cos((selectedSite?.latitude ?? 0) * Math.PI / 180); }
function getPin(): [number, number] {
  return [Number(document.querySelector<HTMLInputElement>('#latitude')!.value), Number(document.querySelector<HTMLInputElement>('#longitude')!.value)];
}
function setPin(latitude: number, longitude: number): void {
  document.querySelector<HTMLInputElement>('#latitude')!.value = latitude.toFixed(6);
  document.querySelector<HTMLInputElement>('#longitude')!.value = longitude.toFixed(6);
  renderMap();
}
function renderMap(): void {
  if (!selectedSite) return;
  const [latitude, longitude] = getPin(); const scale = longitudeScale();
  const x = (lon: number) => 300 + (lon - selectedSite!.longitude) * scale / 2;
  const y = (lat: number) => 200 - (lat - selectedSite!.latitude) * 111320 / 2;
  const inside = (lat: number, lon: number) => x(lon) >= 0 && x(lon) <= 600 && y(lat) >= 0 && y(lat) <= 400;
  const pin = inside(latitude, longitude)
    ? `<g transform="translate(${x(longitude)},${y(latitude)})"><circle r="19" fill="#1c6955" opacity=".13"/><circle r="8" fill="#1c6955" stroke="white" stroke-width="3"/></g>`
    : '<text x="300" y="375" text-anchor="middle" fill="#875a1f" font-size="12">Selected pin is outside this map view</text>';
  document.querySelector('#pin-map')!.innerHTML = `<defs><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#dbe4dc" stroke-width="1"/></pattern></defs><rect width="600" height="400" fill="#f0f4ee"/><rect width="600" height="400" fill="url(#grid)"/><circle cx="300" cy="200" r="150" fill="none" stroke="#cbd7cc" stroke-dasharray="5 6"/><path d="M300 0V400M0 200H600" stroke="#c5d1c6" stroke-width="1"/><rect x="286" y="186" width="28" height="28" rx="4" fill="#526e60" stroke="white" stroke-width="2"/><text x="300" y="235" text-anchor="middle" fill="#52675b" font-size="10" font-weight="600">SITE CENTER</text><text x="562" y="28" fill="#52675b" font-size="11">N ↑</text><path d="M25 365H75M25 360V370M75 360V370" stroke="#52675b"/><text x="25" y="388" fill="#52675b" font-size="10">100 m</text>${reports.filter(r => r.is_active && inside(r.latitude, r.longitude)).map(r => `<g><circle cx="${x(r.longitude)}" cy="${y(r.latitude)}" r="${5 + r.severity * 2}" fill="${r.severity === 3 ? '#bf6748' : '#d9a54d'}" opacity=".8" stroke="white" stroke-width="2"><title>${escape(labels[r.type])} · severity ${r.severity}</title></circle></g>`).join('')}${pin}`;
}

async function selectSite(id: string): Promise<void> {
  selectedSite = sites.find(site => site.id === id);
  reports = []; refreshVersion++;
  if (channel) await supabase.removeChannel(channel);
  if (!selectedSite) return;
  document.querySelector('#map-title')!.textContent = selectedSite.name;
  setPin(selectedSite.latitude, selectedSite.longitude);
  await refresh();
  channel = supabase.channel(`site-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hazard_reports', filter: `site_id=eq.${id}` }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hazard_checkin_tasks' }, scheduleRefresh)
    .subscribe(status => {
      document.querySelector('#connection')!.textContent = status === 'SUBSCRIBED' ? '● Live updates' : '○ Reconnecting · refreshes every minute';
    });
}
function scheduleRefresh(): void {
  clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refresh().catch(error => announce(errorMessage(error), true)); }, 150);
}
async function refresh(): Promise<void> {
  if (!selectedSite) return;
  const id = selectedSite.id; const version = ++refreshVersion;
  const [feed, metrics, tasks] = await Promise.all([
    supabase.from('crew_hazard_feed').select('*').eq('site_id', id).order('last_confirmed_at', { ascending: false }),
    supabase.rpc('get_site_crew_metrics', { p_site_id: id }),
    supabase.from('hazard_checkin_tasks').select('id, report_id').is('completed_at', null),
  ]);
  if (selectedSite?.id !== id || version !== refreshVersion) return;
  for (const result of [feed, metrics, tasks]) if (result.error) throw result.error;
  reports = (feed.data ?? []) as Report[];
  const metric = metrics.data?.[0];
  document.querySelector('#metric-count')!.textContent = String(metric?.open_report_count ?? 0);
  document.querySelector('#metric-risk')!.textContent = Number(metric?.crew_risk_term ?? 0).toFixed(2);
  document.querySelector('#metric-wildlife')!.textContent = Number(metric?.wildlife_subscore ?? 0).toFixed(1);
  const reminders = (tasks.data ?? []).filter(task => reports.some(report => report.id === task.report_id && report.is_active));
  const reminderCount = new Set(reminders.map(task => task.report_id)).size;
  document.querySelector('#reminders')!.innerHTML = reminderCount ? `<div class="reminder">↻ Your crew has ${reminderCount} hazard${reminderCount === 1 ? '' : 's'} to check. Use “Still there” or “Gone” below.</div>` : '';
  renderReports(); renderMap();
}

function renderReports(): void {
  const showResolved = document.querySelector<HTMLInputElement>('#show-resolved')!.checked;
  const visible = reports.filter(report => showResolved || report.is_active);
  document.querySelector('#feed-count')!.textContent = String(visible.length);
  document.querySelector('#reports')!.innerHTML = visible.length ? visible.map(report => `
    <article class="report-card" data-report-id="${report.id}"><div class="report-icon severity-${report.severity}" aria-hidden="true">${glyphs[report.type]}</div><div class="report-content"><div class="report-title"><h3>${escape(labels[report.type])}</h3><span class="severity-tag severity-${report.severity}">${report.is_active ? ['','Low','Moderate','High'][report.severity] : report.status === 'resolved' ? 'Resolved' : 'Expired'}</span></div><p>${report.confirmations} confirmation${report.confirmations === 1 ? '' : 's'} <span>·</span> ${timeAgo(report.last_confirmed_at)} <span>·</span> ${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}</p><div class="report-actions">${report.is_active ? `<button class="checkin" data-report="${report.id}" data-action="confirm">✓ Still there</button><button class="checkin" data-report="${report.id}" data-action="resolve">Gone</button>` : ''}<button class="history" data-report="${report.id}" data-action="history">History & photos</button></div><div id="history-${report.id}" class="history-content" hidden></div></div></article>`).join('') : '<div class="empty"><span>✓</span><h3>No active hazards reported</h3><p>Keep your team informed when conditions change.</p></div>';
}

async function showHistory(button: HTMLButtonElement): Promise<void> {
  const reportId = button.dataset.report!; const target = document.getElementById(`history-${reportId}`)!;
  if (!target.hidden) { target.hidden = true; return; }
  target.hidden = false; target.textContent = 'Loading history…'; button.disabled = true;
  try {
    const observations = await supabase.from('hazard_observations').select('*').eq('report_id', reportId).order('created_at', { ascending: false });
    if (observations.error) throw observations.error;
    const photos = observations.data.length ? await supabase.from('hazard_photos').select('*').in('observation_id', observations.data.map(o => o.id)) : { data: [], error: null };
    if (photos.error) throw photos.error;
    const images = await Promise.all(photos.data.map(async photo => {
      const signed = await supabase.storage.from('hazard-photos').createSignedUrl(photo.object_path, 300);
      if (signed.error) throw signed.error;
      return `<a href="${escape(signed.data.signedUrl)}" target="_blank" rel="noopener"><img src="${escape(signed.data.signedUrl)}" alt="Crew hazard photo" loading="lazy"></a>`;
    }));
    target.innerHTML = `<ul>${observations.data.map(o => `<li>${escape(o.action)} · severity ${o.severity} · ${escape(new Date(o.created_at).toLocaleString())}</li>`).join('')}</ul><div class="photo-gallery">${images.join('')}</div>`;
  } catch (error) { target.textContent = errorMessage(error); }
  finally { button.disabled = false; }
}

async function discardPhoto(): Promise<void> {
  if (pendingSubmission?.photo) {
    // Storage delete policy permits only this user's unattached objects.
    await supabase.storage.from('hazard-photos').remove([pendingSubmission.photo.object_path]);
  }
  pendingSubmission = undefined;
}
async function submitReport(): Promise<void> {
  if (!selectedSite || busy) return;
  const form = document.querySelector<HTMLFormElement>('#report-form')!;
  if (!form.reportValidity()) return;
  const fields = new FormData(form); const [latitude, longitude] = getPin();
  const file = document.querySelector<HTMLInputElement>('#photo')!.files?.[0];
  if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880)) {
    return announce('Choose a JPEG, PNG or WebP photo smaller than 5 MB.', true);
  }
  const input = { p_site_id: selectedSite.id, p_type: fields.get('type') as HazardType, p_severity: Number(fields.get('severity')), p_lat: latitude, p_lon: longitude };
  const signature = JSON.stringify(input);
  setBusy(true);
  try {
    if (!pendingSubmission || pendingSubmission.signature !== signature || pendingSubmission.file !== file) {
      await discardPhoto();
      pendingSubmission = { requestId: crypto.randomUUID(), signature, file, uploaded: false };
    }
    const pending = pendingSubmission;
    if (file && !pending.photo) {
      const reservation = await supabase.rpc('reserve_hazard_photo', { p_photo_id: crypto.randomUUID(), p_site_id: selectedSite.id, p_content_type: file.type });
      if (reservation.error) throw reservation.error;
      pending.photo = reservation.data;
    }
    if (file && pending.photo && !pending.uploaded) {
      const upload = await supabase.storage.from('hazard-photos').upload(pending.photo.object_path, file, { contentType: file.type, upsert: false });
      // A timeout can occur after upload succeeded. Existing own reserved objects are safe to reuse.
      if (upload.error && String(upload.error.statusCode) !== '409') throw upload.error;
      pending.uploaded = true;
    }
    const result = await supabase.rpc('submit_hazard_report', { ...input, p_request_id: pending.requestId, p_photo_id: pending.photo?.id });
    if (result.error) throw result.error;
    const response = result.data as unknown as MutationResult;
    pendingSubmission = undefined;
    document.querySelector<HTMLInputElement>('#photo')!.value = '';
    document.querySelector('#photo-name')!.textContent = 'Choose a photo';
    announce(response.outcome === 'merged' ? `Merged with a nearby hazard. ${response.report.confirmations} confirmations recorded.` : 'Hazard reported. Your site team can now see it.');
    await refresh();
  } catch (error) { announce(`${errorMessage(error)} Your input is preserved; you can retry.`, true); }
  finally { setBusy(false); }
}

shell();
let currentUser: string | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
  // Keep async database calls outside the Auth callback's session lock.
  setTimeout(() => { void applySession(session?.user.id, session?.user.email); }, 0);
});
async function applySession(userId?: string, email?: string): Promise<void> {
  if (currentUser === userId) return;
  currentUser = userId; refreshVersion++;
  document.querySelector<HTMLElement>('#login')!.hidden = Boolean(userId);
  document.querySelector<HTMLElement>('#workspace')!.hidden = !userId;
  document.querySelector<HTMLButtonElement>('#signout')!.hidden = !userId;
  document.querySelector<HTMLElement>('#site-control')!.hidden = !userId;
  document.querySelector('#identity')!.textContent = email ?? '';
  document.querySelector('#notice')!.textContent = '';
  if (!userId) {
    if (channel) await supabase.removeChannel(channel);
    selectedSite = undefined; reports = []; pendingSubmission = undefined; pendingCheckins.clear();
    return;
  }
  try {
    const result = await supabase.from('sites').select('*').order('name');
    if (result.error) throw result.error;
    if (currentUser !== userId) return;
    sites = result.data;
    document.querySelector('#site')!.innerHTML = sites.map(site => `<option value="${site.id}">${escape(site.name)}</option>`).join('');
    document.querySelector<HTMLElement>('#no-sites')!.hidden = sites.length > 0;
    document.querySelector<HTMLElement>('#site-workspace')!.hidden = sites.length === 0;
    if (sites[0]) await selectSite(sites[0].id);
  } catch (error) { announce(errorMessage(error), true); }
}
setInterval(() => { if (selectedSite && !document.hidden) scheduleRefresh(); }, 60000);
