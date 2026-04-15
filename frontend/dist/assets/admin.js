
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));
const state = {
  session: null,
  workspaces: [],
  domains: [],
  mailboxes: [],
  aliases: [],
  admins: [],
};

async function api(path, opts={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {'Content-Type':'application/json', ...(csrfToken() ? {'X-CSRF-Token': csrfToken()} : {}), ...(opts.headers||{})},
    ...opts
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.error?.code || data?.code || 'Request failed';
    throw new Error(msg);
  }
  return data;
}
function showBox(id, kind, msg) {
  const el = qs(id);
  el.className = kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideBox(id){ const el=qs(id); if(el) el.classList.add('hidden'); }
function badge(active){ return `<span class="badge ${active ? 'green':'red'}">${active ? 'active':'disabled'}</span>`; }
function yesno(v){ return v ? '✓' : '—'; }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function csrfToken(){ const pair = document.cookie.split('; ').find(v=>v.startsWith('mailadmin_csrf_admin=')); return pair ? decodeURIComponent(pair.split('=')[1] || '') : ''; }

function buildTabs() {
  const tabs = [
    ['dashboard','Dashboard'],
    ['domains','Domains'],
    ['mailboxes','Mailboxes'],
    ['aliases','Aliases'],
  ];
  if (state.session?.workspace_scope === 'platform') {
    tabs.splice(1, 0, ['workspaces','Workspaces'], ['admins','Admins']);
    tabs.push(['health','Health']);
  }
  const host = qs('#tabs');
  host.innerHTML = tabs.map(([k,label], i)=>`<div class="tab ${i===0?'active':''}" data-tab="${k}">${label}</div>`).join('');
  qsa('.tab', host).forEach(t => t.onclick = () => activateTab(t.dataset.tab));
  activateTab('dashboard');
}
function activateTab(tab) {
  qsa('.tabpane').forEach(p => p.classList.add('hidden'));
  qsa('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const el = qs(`#tab-${tab}`); if (el) el.classList.remove('hidden');
}
function syncSessionUI() {
  const sess = state.session;
  qs('#sessionBadge').textContent = sess ? `${sess.username} · ${sess.role}` : '未登录';
  qs('#btnLogout').classList.toggle('hidden', !sess);
  qs('#loginBox').classList.toggle('hidden', !!sess);
  qs('#appBox').classList.toggle('hidden', !sess);
  if (sess) {
    const p = (sess.permissions || []).map(x => `${x.workspace_slug}: ${['read='+x.can_read,'write='+x.can_write,'domains='+x.manage_domains,'mailboxes='+x.manage_mailboxes,'aliases='+x.manage_aliases].join(', ')}`).join(' | ');
    qs('#sessionInfo').innerHTML = `workspace_scope: <b>${escapeHtml(sess.workspace_scope)}</b><br>allowed_workspaces: <span class="code">${escapeHtml((sess.allowed_workspaces || []).join(', ') || '(none)')}</span>${p ? `<br>permissions: <span class="code">${escapeHtml(p)}</span>`:''}`;
    qs('#sessionInfo').classList.remove('hidden');
  }
}
function workspaceOptions(includeAll=true){
  const arr = [];
  if (includeAll) arr.push(`<option value="">全部 workspace</option>`);
  for (const ws of state.workspaces) arr.push(`<option value="${ws.slug}">${ws.slug} · ${ws.name}</option>`);
  return arr.join('');
}
function refreshWorkspaceSelectors(){
  ['#dashboardWorkspaceFilter','#domainWorkspaceFilter','#mailboxWorkspaceFilter','#aliasWorkspaceFilter'].forEach(sel=>{
    const el=qs(sel); if(el) el.innerHTML=workspaceOptions(true);
  });
  const bw=qs('#bindWorkspace'); if(bw) bw.innerHTML=workspaceOptions(false);
}

async function refreshSession(){
  try{
    const data = await api('/api/v1/platform/auth/session');
    state.session = data;
    syncSessionUI();
    buildTabs();
    await loadAll();
  }catch(e){
    state.session = null;
    syncSessionUI();
  }
}
async function loadAll(){
  const tasks = [loadWorkspaces(), loadDomains(), loadMailboxes(), loadAliases()];
  if (state.session?.workspace_scope === 'platform') tasks.push(loadHealth());
  await Promise.all(tasks);
  if (state.session?.workspace_scope === 'platform') await loadAdmins();
  renderDashboard();
}
async function loadWorkspaces(){
  const data = await api('/api/v1/platform/workspaces');
  state.workspaces = data.items || [];
  refreshWorkspaceSelectors();
  renderWorkspaces();
}
async function loadDomains(){
  const ws = qs('#domainWorkspaceFilter')?.value || qs('#dashboardWorkspaceFilter')?.value || '';
  const data = await api('/api/v1/platform/mail/domains' + (ws ? `?workspace=${encodeURIComponent(ws)}` : ''));
  state.domains = data.items || [];
  renderDomains();
}
async function loadMailboxes(){
  const ws = qs('#mailboxWorkspaceFilter')?.value || qs('#dashboardWorkspaceFilter')?.value || '';
  const data = await api('/api/v1/platform/mail/mailboxes' + (ws ? `?workspace=${encodeURIComponent(ws)}` : ''));
  state.mailboxes = data.items || [];
  renderMailboxes();
}
async function loadAliases(){
  const ws = qs('#aliasWorkspaceFilter')?.value || qs('#dashboardWorkspaceFilter')?.value || '';
  const data = await api('/api/v1/platform/mail/aliases' + (ws ? `?workspace=${encodeURIComponent(ws)}` : ''));
  state.aliases = data.items || [];
  renderAliases();
}
async function loadHealth(){
  try {
    const data = await api('/api/v1/platform/mail/health/maps');
    qs('#mapsBox').textContent = (data.items || []).map(x => `${x.path} | parse_ok=${x.parse_ok} | required_complete=${x.required_complete}`).join('\n');
  } catch(e) {
    qs('#mapsBox').textContent = `读取失败：${e.message}`;
  }
}
async function loadAdmins(){
  const data = await api('/api/v1/platform/admin-users');
  state.admins = data.items || [];
  renderAdmins();
}
function workspaceNameForDomain(domain){
  for(const ws of state.workspaces){ if((ws.domains||[]).includes(domain)) return `${ws.slug} · ${ws.name}`; }
  return '-';
}
function renderDashboard(){
  qs('#kpiWorkspaces').textContent = state.workspaces.length;
  qs('#kpiDomains').textContent = state.domains.length;
  qs('#kpiMailboxes').textContent = state.mailboxes.length;
  qs('#kpiAliases').textContent = state.aliases.length;
}
function renderWorkspaces(){
  const tb = qs('#workspaceTable');
  if (!tb) return;
  tb.innerHTML = state.workspaces.map(ws=>`<tr>
    <td><b>${escapeHtml(ws.slug)}</b></td>
    <td>${escapeHtml(ws.name)}</td>
    <td>${escapeHtml(ws.default_domain || '')}<div class="smalltext">${escapeHtml((ws.domains||[]).join(', '))}</div></td>
    <td>${badge(ws.active)}</td>
    <td>
      ${state.session?.workspace_scope === 'platform' ? `
      <button class="small secondary" data-fill-ws="${ws.slug}">填充表单</button>
      <button class="small ${ws.active?'ghost':'secondary'}" data-toggle-ws="${ws.slug}" data-active="${ws.active ? '0':'1'}">${ws.active ? '停用':'启用'}</button>` : '—'}
    </td>
  </tr>`).join('') || '<tr><td colspan="5" class="muted">暂无数据</td></tr>';
  qsa('[data-fill-ws]').forEach(b=>b.onclick=()=>{
    const ws = state.workspaces.find(x=>x.slug===b.dataset.fillWs); if(!ws) return;
    qs('#wsSlug').value = ws.slug; qs('#wsName').value = ws.name; qs('#wsDefaultDomain').value = ws.default_domain || '';
    activateTab('workspaces');
  });
  qsa('[data-toggle-ws]').forEach(b=>b.onclick=async()=>{
    try{
      await api(`/api/v1/platform/workspaces/${encodeURIComponent(b.dataset.toggleWs)}/status`, {method:'PATCH', body:JSON.stringify({active:b.dataset.active==='1'})});
      showBox('#wsMsg','success','Workspace 状态已更新');
      await loadWorkspaces();
    }catch(e){ showBox('#wsMsg','error',e.message); }
  });
}
function renderDomains(){
  const tb = qs('#domainTable');
  if (!tb) return;
  tb.innerHTML = state.domains.map(row=>`<tr>
    <td>${escapeHtml(row.name)}</td>
    <td>${escapeHtml(workspaceNameForDomain(row.name))}</td>
    <td>${row.active == null ? '<span class="badge yellow">unknown</span>' : badge(row.active)}</td>
    <td>
      <button class="small secondary" data-toggle-domain="${row.name}" data-active="${row.active ? '0':'1'}">${row.active ? '停用':'启用'}</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="4" class="muted">暂无数据</td></tr>';
  qsa('[data-toggle-domain]').forEach(b=>b.onclick=async()=>{
    try{
      await api(`/api/v1/platform/mail/domains/${encodeURIComponent(b.dataset.toggleDomain)}/status`, {method:'PATCH', body:JSON.stringify({active:b.dataset.active==='1'})});
      showBox('#domainMsg','success','域名状态已更新');
      await loadDomains();
    }catch(e){ showBox('#domainMsg','error',e.message); }
  });
}
function renderMailboxes(){
  const tb = qs('#mailboxTable');
  if (!tb) return;
  tb.innerHTML = state.mailboxes.map(row=>`<tr>
    <td>${escapeHtml(row.email)}</td>
    <td>${row.active == null ? '<span class="badge yellow">unknown</span>' : badge(row.active)}</td>
    <td class="toolbar">
      <button class="small secondary" data-toggle-mailbox="${row.email}" data-active="${row.active ? '0':'1'}">${row.active ? '停用':'启用'}</button>
      <button class="small ghost" data-password-mailbox="${row.email}">改密</button>
      <button class="small danger" data-delete-mailbox="${row.email}">删除</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="3" class="muted">暂无数据</td></tr>';
  qsa('[data-toggle-mailbox]').forEach(b=>b.onclick=async()=>{
    try{
      await api(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(b.dataset.toggleMailbox)}/status`, {method:'PATCH', body:JSON.stringify({active:b.dataset.active==='1'})});
      showBox('#mailboxMsg','success','邮箱状态已更新');
      await loadMailboxes();
    }catch(e){ showBox('#mailboxMsg','error',e.message); }
  });
  qsa('[data-password-mailbox]').forEach(b=>b.onclick=async()=>{
    const pwd = prompt(`为 ${b.dataset.passwordMailbox} 设置新密码（至少8位）`);
    if(!pwd) return;
    try{
      await api(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(b.dataset.passwordMailbox)}/password`, {method:'POST', body:JSON.stringify({new_password:pwd})});
      showBox('#mailboxMsg','success','邮箱密码已更新');
    }catch(e){ showBox('#mailboxMsg','error',e.message); }
  });
  qsa('[data-delete-mailbox]').forEach(b=>b.onclick=async()=>{
    if(!confirm(`确认删除邮箱 ${b.dataset.deleteMailbox} ?`)) return;
    try{
      await api(`/api/v1/platform/mail/mailboxes/${encodeURIComponent(b.dataset.deleteMailbox)}`, {method:'DELETE'});
      showBox('#mailboxMsg','success','邮箱已删除');
      await loadMailboxes();
    }catch(e){ showBox('#mailboxMsg','error',e.message); }
  });
}
function renderAliases(){
  const tb = qs('#aliasTable');
  if (!tb) return;
  tb.innerHTML = state.aliases.map(row=>`<tr>
    <td>${escapeHtml(row.source)}</td>
    <td>${escapeHtml(row.destination)}</td>
    <td>${row.active == null ? '<span class="badge yellow">unknown</span>' : badge(row.active)}</td>
    <td class="toolbar">
      <button class="small secondary" data-toggle-alias="${row.source}" data-active="${row.active ? '0':'1'}">${row.active ? '停用':'启用'}</button>
      <button class="small danger" data-delete-alias="${row.source}">删除</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="4" class="muted">暂无数据</td></tr>';
  qsa('[data-toggle-alias]').forEach(b=>b.onclick=async()=>{
    try{
      await api(`/api/v1/platform/mail/aliases/${encodeURIComponent(b.dataset.toggleAlias)}/status`, {method:'PATCH', body:JSON.stringify({active:b.dataset.active==='1'})});
      showBox('#aliasMsg','success','别名状态已更新');
      await loadAliases();
    }catch(e){ showBox('#aliasMsg','error',e.message); }
  });
  qsa('[data-delete-alias]').forEach(b=>b.onclick=async()=>{
    if(!confirm(`确认删除别名 ${b.dataset.deleteAlias} ?`)) return;
    try{
      await api(`/api/v1/platform/mail/aliases/${encodeURIComponent(b.dataset.deleteAlias)}`, {method:'DELETE'});
      showBox('#aliasMsg','success','别名已删除');
      await loadAliases();
    }catch(e){ showBox('#aliasMsg','error',e.message); }
  });
}
function renderAdmins(){
  const tb = qs('#adminTable');
  if (!tb) return;
  qs('#bindAdmin').innerHTML = state.admins.map(a=>`<option value="${a.username}">${a.username} · ${a.role}</option>`).join('');
  tb.innerHTML = state.admins.map(a=>`<tr>
    <td>${escapeHtml(a.username)}</td>
    <td>${escapeHtml(a.role)}</td>
    <td>${badge(a.active)}</td>
    <td><span class="smalltext">${escapeHtml((a.workspaces||[]).join(', '))}</span></td>
    <td class="toolbar">
      <button class="small secondary" data-toggle-admin="${a.username}" data-active="${a.active ? '0':'1'}">${a.active ? '停用':'启用'}</button>
      <button class="small ghost" data-password-admin="${a.username}">改密</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="5" class="muted">暂无数据</td></tr>';
  qsa('[data-toggle-admin]').forEach(b=>b.onclick=async()=>{
    try{
      await api(`/api/v1/platform/admin-users/${encodeURIComponent(b.dataset.toggleAdmin)}/status`, {method:'PATCH', body:JSON.stringify({active:b.dataset.active==='1'})});
      showBox('#adminMsg','success','管理员状态已更新');
      await loadAdmins();
    }catch(e){ showBox('#adminMsg','error',e.message); }
  });
  qsa('[data-password-admin]').forEach(b=>b.onclick=async()=>{
    const pwd = prompt(`为管理员 ${b.dataset.passwordAdmin} 设置新密码（至少8位）`);
    if(!pwd) return;
    try{
      await api(`/api/v1/platform/admin-users/${encodeURIComponent(b.dataset.passwordAdmin)}/password`, {method:'POST', body:JSON.stringify({new_password:pwd})});
      showBox('#adminMsg','success','管理员密码已更新');
    }catch(e){ showBox('#adminMsg','error',e.message); }
  });
}

async function loadBindingForSelected(){
  try{
    const username = qs('#bindAdmin').value;
    const ws = qs('#bindWorkspace').value;
    const data = await api(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/workspaces`);
    const row = (data.items || []).find(x => x.workspace_slug === ws);
    qs('#permRead').checked = !!row?.can_read;
    qs('#permWrite').checked = !!row?.can_write;
    qs('#permDomains').checked = !!row?.manage_domains;
    qs('#permMailboxes').checked = !!row?.manage_mailboxes;
    qs('#permAliases').checked = !!row?.manage_aliases;
    showBox('#bindingMsg','success', row ? '已加载现有绑定' : '当前没有绑定，保存后将创建');
  }catch(e){ showBox('#bindingMsg','error',e.message); }
}
async function saveBinding(){
  try{
    const username = qs('#bindAdmin').value;
    const existing = await api(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/workspaces`);
    const items = (existing.items || []).filter(x => x.workspace_slug !== qs('#bindWorkspace').value);
    items.push({
      workspace_slug: qs('#bindWorkspace').value,
      can_read: qs('#permRead').checked,
      can_write: qs('#permWrite').checked,
      manage_domains: qs('#permDomains').checked,
      manage_mailboxes: qs('#permMailboxes').checked,
      manage_aliases: qs('#permAliases').checked,
    });
    await api(`/api/v1/platform/admin-users/${encodeURIComponent(username)}/workspaces`, {method:'PUT', body:JSON.stringify({bindings:items})});
    showBox('#bindingMsg','success','绑定权限已保存');
    await loadAdmins();
  }catch(e){ showBox('#bindingMsg','error',e.message); }
}

document.addEventListener('DOMContentLoaded', async () => {
  qs('#btnLogin').onclick = async () => {
    hideBox('#loginMsg');
    try{
      await api('/api/v1/platform/auth/login', {method:'POST', body:JSON.stringify({
        username: qs('#loginUsername').value.trim(),
        password: qs('#loginPassword').value
      })});
      await refreshSession();
    }catch(e){ showBox('#loginMsg','error',e.message); }
  };
  qs('#btnLogout').onclick = async () => { await api('/api/v1/platform/auth/logout',{method:'POST'}).catch(()=>{}); location.reload(); };
  qs('#btnRefresh').onclick = async () => { if(state.session) await loadAll(); else await refreshSession(); };
  qs('#btnReloadDashboard').onclick = async () => { await loadAll(); };

  qs('#btnCreateWorkspace').onclick = async () => {
    hideBox('#wsMsg');
    try{
      await api('/api/v1/platform/workspaces', {method:'POST', body:JSON.stringify({
        slug: qs('#wsSlug').value.trim(),
        name: qs('#wsName').value.trim(),
        default_domain: qs('#wsDefaultDomain').value.trim(),
      })});
      showBox('#wsMsg','success','Workspace 已保存');
      await loadWorkspaces();
    }catch(e){ showBox('#wsMsg','error',e.message); }
  };
  qs('#btnSaveAdmin').onclick = async () => {
    hideBox('#adminMsg');
    try{
      await api('/api/v1/platform/admin-users', {method:'POST', body:JSON.stringify({
        username: qs('#adminUsername').value.trim(),
        password: qs('#adminPassword').value,
        role: qs('#adminRole').value,
        active: qs('#adminActive').checked,
      })});
      showBox('#adminMsg','success','管理员已保存');
      await loadAdmins();
    }catch(e){ showBox('#adminMsg','error',e.message); }
  };
  qs('#btnLoadBinding').onclick = loadBindingForSelected;
  qs('#btnSaveBinding').onclick = saveBinding;

  qs('#btnAddDomain').onclick = async () => {
    hideBox('#domainMsg');
    try{
      const ws = qs('#domainWorkspaceFilter').value || qs('#dashboardWorkspaceFilter').value || state.workspaces[0]?.slug || 'default';
      await api('/api/v1/platform/mail/domains', {method:'POST', body:JSON.stringify({domain: qs('#domainName').value.trim(), workspace_slug: ws})});
      showBox('#domainMsg','success','域名已保存');
      await Promise.all([loadWorkspaces(), loadDomains()]);
    }catch(e){ showBox('#domainMsg','error',e.message); }
  };
  qs('#btnAddMailbox').onclick = async () => {
    hideBox('#mailboxMsg');
    try{
      await api('/api/v1/platform/mail/mailboxes', {method:'POST', body:JSON.stringify({
        email: qs('#mailboxEmail').value.trim(),
        password: qs('#mailboxPassword').value,
      })});
      showBox('#mailboxMsg','success','邮箱已创建');
      await loadMailboxes();
    }catch(e){ showBox('#mailboxMsg','error',e.message); }
  };
  qs('#btnAddAlias').onclick = async () => {
    hideBox('#aliasMsg');
    try{
      await api('/api/v1/platform/mail/aliases', {method:'POST', body:JSON.stringify({
        source: qs('#aliasSource').value.trim(),
        destination: qs('#aliasDestination').value.trim(),
      })});
      showBox('#aliasMsg','success','别名已保存');
      await loadAliases();
    }catch(e){ showBox('#aliasMsg','error',e.message); }
  };
  qs('#btnEnsureSystemAliases').onclick = async () => {
    hideBox('#aliasMsg');
    try{
      await api('/api/v1/platform/mail/system-aliases', {method:'POST', body:JSON.stringify({
        domain: qs('#sysAliasDomain').value.trim(),
        target_email: qs('#sysAliasTarget').value.trim(),
      })});
      showBox('#aliasMsg','success','系统别名已确保');
      await loadAliases();
    }catch(e){ showBox('#aliasMsg','error',e.message); }
  };

  ['#dashboardWorkspaceFilter','#domainWorkspaceFilter','#mailboxWorkspaceFilter','#aliasWorkspaceFilter'].forEach(sel=>{
    const el = qs(sel); if(el) el.onchange = async ()=> { await Promise.all([loadDomains(), loadMailboxes(), loadAliases()]); renderDashboard(); };
  });

  await refreshSession();
});
