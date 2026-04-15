
const qs = (s, el=document) => el.querySelector(s);
async function api(path, opts={}) {
  const res = await fetch(path, {credentials:'include', headers:{'Content-Type':'application/json', ...(opts.headers||{})}, ...opts});
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if(!res.ok){ throw new Error(data?.error?.message || data?.message || data?.error?.code || data?.code || 'Request failed'); }
  return data;
}
function showBox(id, kind, msg){ const el=qs(id); el.className=kind; el.textContent=msg; el.classList.remove('hidden'); }
function hideBox(id){ const el=qs(id); if(el) el.classList.add('hidden'); }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

let currentWorkspace = 'default';
let webmailToken = '';
async function loadTenantOptions(){
  const data = await api('/api/v1/tenants');
  const items = data.items || [];
  const sel = qs('#portalWorkspace');
  sel.innerHTML = items.map(x=>`<option value="${x.slug}">${x.slug} · ${x.name}</option>`).join('');
  if(items.length) currentWorkspace = items[0].slug;
  sel.value = currentWorkspace;
  sel.onchange = ()=> currentWorkspace = sel.value;
}
function portalPath(suffix){ return `/api/v1/tenants/${encodeURIComponent(currentWorkspace)}/mail/${suffix}`; }
function csrfToken(){
  const pair = document.cookie.split('; ').find(v=>v.startsWith('mailadmin_csrf_portal='));
  return pair ? decodeURIComponent(pair.split('=').slice(1).join('=')) : '';
}
function authHeaders(){
  const headers = {};
  const csrf = csrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (webmailToken) headers.Authorization = `Bearer ${webmailToken}`;
  return headers;
}

async function refreshPortalSession(){
  try{
    const data = await api(portalPath('auth/session'));
    qs('#portalLoginBox').classList.add('hidden');
    qs('#portalApp').classList.remove('hidden');
    qs('#portalSessionBadge').textContent = `${data.email || data.subject || 'session'} · ${data.workspace_slug || currentWorkspace}`;
    await Promise.all([loadProfile(), loadAliases()]);
    if(webmailToken){
      await loadInbox();
    }else{
      showBox('#portalMailMsg','error','请点击“连接邮箱”获取短期 Webmail Token');
    }
  }catch(e){
    qs('#portalLoginBox').classList.remove('hidden');
    qs('#portalApp').classList.add('hidden');
  }
}
async function loadProfile(){
  const data = await api(portalPath('account/profile'));
  const p = data.profile || {};
  qs('#portalProfileCard').innerHTML = `
    <h3>邮箱信息</h3>
    <div class="list">
      <div class="list-item"><b>Email</b><div>${escapeHtml(p.email || '')}</div></div>
      <div class="list-item"><b>Workspace</b><div>${escapeHtml((p.workspace_slug || '') + (p.workspace_name ? ' · ' + p.workspace_name : ''))}</div></div>
      <div class="list-item"><b>Domain</b><div>${escapeHtml(p.domain || '')}</div></div>
      <div class="list-item"><b>Status</b><div>${p.active ? '<span class="badge green">active</span>' : '<span class="badge red">disabled</span>'}</div></div>
      <div class="list-item"><b>Service Host</b><div>${escapeHtml(p.service_host || '')}</div></div>
      <div class="list-item"><b>IMAP / SMTP</b><div>IMAP SSL ${escapeHtml(String(p.imap_ssl_port || 993))} · SMTP TLS ${escapeHtml(String(p.smtp_tls_port || 587))} · SMTP SSL ${escapeHtml(String(p.smtp_ssl_port || 465))}</div></div>
      <div class="list-item"><b>Aliases</b><div>${escapeHtml(String(p.alias_count ?? 0))}</div></div>
    </div>`;
}
async function loadAliases(){
  const data = await api(portalPath('account/aliases'));
  const host = qs('#portalAliases');
  const items = data.items || [];
  host.innerHTML = items.length ? items.map(x => `<div class="list-item"><div><b>${escapeHtml(x.source || '')}</b></div><div class="smalltext">→ ${escapeHtml(x.destination || '')}</div></div>`).join('') : '<div class="muted">暂无别名</div>';
}
function renderInbox(items){
  const host = qs('#portalInboxList');
  if(!items.length){
    host.innerHTML = '<div class="muted">暂无邮件</div>';
    return;
  }
  host.innerHTML = items.map(item=>`<button class="mail-item" data-uid="${item.uid}">
    <div class="mail-item-subject">${escapeHtml(item.subject || '(无主题)')}</div>
    <div class="mail-item-meta">${escapeHtml(item.from || '')}</div>
    <div class="mail-item-preview">${escapeHtml(item.preview || '')}</div>
  </button>`).join('');
  host.querySelectorAll('[data-uid]').forEach(el=>{
    el.onclick = ()=> loadMessage(el.dataset.uid);
  });
}
async function loadInbox(){
  hideBox('#portalMailMsg');
  if(!webmailToken){
    showBox('#portalMailMsg','error','请先连接邮箱获取 Webmail Token');
    return;
  }
  try{
    const data = await api(portalPath('webmail/inbox?limit=20'), {headers: authHeaders()});
    renderInbox(data.items || []);
  }catch(e){ showBox('#portalMailMsg','error',e.message); }
}
async function loadMessage(seq){
  hideBox('#portalMailMsg');
  try{
    const data = await api(portalPath(`webmail/messages/${encodeURIComponent(seq)}`), {headers: authHeaders()});
    const m = data.item || {};
    qs('#portalMailViewer').classList.remove('muted');
    qs('#portalMailViewer').innerHTML = `
      <div class="mail-viewer-meta"><b>${escapeHtml(m.subject || '(无主题)')}</b></div>
      <div class="mail-viewer-meta">From: ${escapeHtml(m.from || '')}</div>
      <div class="mail-viewer-meta">Date: ${escapeHtml(m.date || '')}</div>
      <hr/>
      <pre class="mail-body">${escapeHtml(m.body || '')}</pre>
    `;
  }catch(e){ showBox('#portalMailMsg','error',e.message); }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  try { await loadTenantOptions(); } catch(e) { showBox('#portalLoginMsg','error',e.message); }
  qs('#portalBtnLogin').onclick = async ()=>{
    hideBox('#portalLoginMsg');
    try{
      const password = qs('#portalPassword').value;
      await api(portalPath('auth/login'), {method:'POST', headers: authHeaders(), body:JSON.stringify({email:qs('#portalEmail').value.trim(), password})});
      webmailToken = '';
      await refreshPortalSession();
    }catch(e){ showBox('#portalLoginMsg','error',e.message); }
  };
  qs('#portalBtnLogout').onclick = async ()=> {
    await api(portalPath('auth/logout'), {method:'POST', headers: authHeaders()}).catch(()=>{});
    location.reload();
  };
  qs('#portalBtnReload').onclick = refreshPortalSession;
  qs('#portalBtnMailConnect').onclick = async ()=>{
    hideBox('#portalMailMsg');
    try{
      const password = prompt('请输入当前邮箱密码以连接 Webmail（15 分钟有效）');
      if(!password){
        showBox('#portalMailMsg','error','已取消连接');
        return;
      }
      const resp = await api(portalPath('webmail/connect'), {method:'POST', headers: authHeaders(), body:JSON.stringify({password})});
      webmailToken = resp.webmail_token || '';
      await loadInbox();
      showBox('#portalMailMsg','success','邮箱连接成功');
    }catch(e){
      showBox('#portalMailMsg','error',e.message);
    }
  };
  qs('#portalBtnInbox').onclick = loadInbox;
  qs('#portalBtnSendMail').onclick = async ()=>{
    hideBox('#portalComposeMsg');
    try{
      if(!webmailToken){
        throw new Error('请先连接邮箱获取 token');
      }
      await api(portalPath('webmail/send'), {
        method:'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          to: qs('#portalComposeTo').value.trim(),
          subject: qs('#portalComposeSubject').value.trim(),
          body: qs('#portalComposeBody').value
        })
      });
      qs('#portalComposeSubject').value = '';
      qs('#portalComposeBody').value = '';
      showBox('#portalComposeMsg','success','发送成功');
    }catch(e){ showBox('#portalComposeMsg','error',e.message); }
  };
  qs('#portalBtnPassword').onclick = async ()=>{
    hideBox('#portalPwdMsg');
    try{
      await api(portalPath('account/password'), {method:'POST', headers: authHeaders(), body:JSON.stringify({
        current_password: qs('#portalCurrentPassword').value,
        new_password: qs('#portalNewPassword').value
      })});
      qs('#portalCurrentPassword').value = '';
      qs('#portalNewPassword').value = '';
      showBox('#portalPwdMsg','success','密码已更新');
    }catch(e){ showBox('#portalPwdMsg','error',e.message); }
  };
  await refreshPortalSession();
});
