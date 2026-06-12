const $ = (id) => document.getElementById(id);

async function refresh() {
  const cfg = await chrome.storage.local.get(['port', 'token', 'enabled']);
  if (cfg.port) $('port').value = cfg.port;
  if (cfg.token) $('token').value = cfg.token;
  $('enabled').checked = cfg.enabled !== false;
  const s = await chrome.storage.session.get(['bridgeStatus', 'bridgeStatusAt']);
  const el = $('status');
  if (s.bridgeStatus === 'connected') {
    el.textContent = '● Connected to the Personas app';
    el.className = 'ok';
  } else if (s.bridgeStatus) {
    el.textContent = `○ ${s.bridgeStatus} — check the app is running and the token matches`;
    el.className = 'bad';
  } else {
    el.textContent = '';
  }
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    port: Number($('port').value) || 17400,
    token: $('token').value.trim(),
    enabled: $('enabled').checked,
  });
  setTimeout(refresh, 1200);
});

chrome.storage.session.onChanged?.addListener(refresh);
refresh();
setInterval(refresh, 2000);
