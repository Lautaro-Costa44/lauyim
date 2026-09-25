// Backend + WebAuthn helpers (ported from the vanilla app).
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
// PublicKeyCredential is the WebAuthn-specific capability signal. Do not also gate the UI on
// navigator.credentials: some browsers expose WebAuthn while that generic Credential Management
// API check produces a false negative (notably Chrome on iOS). The real create/get calls still run
// only after the user chooses a passkey action and surface any genuine browser error there.
export const webauthnOK = () => typeof window.PublicKeyCredential !== 'undefined'

// What this build knows how to round-trip. 'routine-extras': routine exercises carry intensifier,
// target reps, warm-ups and double progression; the server trusts their absence as "none" (an
// older build without the header keeps what is stored instead).
export const CLIENT_CAPABILITIES = 'routine-extras'

export async function api(path, opts) {
  const headers = Object.assign({ 'Content-Type': 'application/json', 'X-Lauyim-Client': CLIENT_CAPABILITIES }, opts && opts.headers)
  // A disconnected mobile browser may leave fetch pending for a long time instead of
  // rejecting promptly. Keep boot and background sync responsive; callers can retry later.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs || 8000)
  const requestOpts = Object.assign({}, opts, { headers, signal: opts?.signal || controller.signal })
  delete requestOpts.timeoutMs
  let r
  try { r = await fetch(path, requestOpts) } finally { clearTimeout(timer) }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { 
    const e = new Error(data.error || ('HTTP ' + r.status))
    e.status = r.status
    e.data = data
    // A 403 is also used for normal business errors such as an invalid invite.
    // Only the explicit license error must switch the whole app to the expiry view.
    if (data.error === 'license_expired') {
      window.dispatchEvent(new CustomEvent('gym:license_expired', { detail: data }))
    }
    // Cuota bloqueada: el socio conserva la sesión, pero la app pasa a la pantalla de bloqueo.
    if (data.error === 'membership_blocked') {
      window.dispatchEvent(new CustomEvent('gym:membership_blocked', { detail: data }))
    }
    throw e 
  }
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code, qr) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '', qr: qr || '' }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// Vinculación de una ficha con un código del gym, en dos pasos para poder mostrar a quién se
// vincula antes de crear la passkey: linkOptions valida el código (devuelve el nombre) y
// linkPasskey crea la credencial con esas opciones. Se clonan en cada intento porque
// toCreationOptions las convierte en el lugar: cancelar la passkey y reintentar sigue andando.
export async function linkOptions(code) {
  return api('/api/link/options', { method: 'POST', body: JSON.stringify({ code }) })
}
export async function linkPasskey({ cid, options }) {
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(structuredClone(options)) })
  const res = await api('/api/link/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyAddCredential() {
  const { cid, options } = await api('/api/credentials/add/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/credentials/add/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res
}
