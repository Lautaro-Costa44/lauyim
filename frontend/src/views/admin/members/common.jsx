import { useEffect, useState } from 'react'
import { api } from '../../../lib/api.js'
import { t } from '../../../lib/i18n.js'
import { Button, Row } from '../../../components/ui.jsx'

// Fichas de socio (admin): piezas chicas que van con UserDetail y Usuarios. Los formularios y
// flujos (alta, edición, código de vinculación, unir con una cuenta) están en MemberSheets.jsx,
// que se descarga recién al abrir uno de ellos.

// Campos de la ficha: clave de la config (api/members.js) → clave del body y del perfil.
export const MEMBER_FIELDS = [
  { key: 'full_name', prop: 'fullName', label: 'Nombre y apellido' },
  { key: 'dni', prop: 'dni', label: 'DNI' },
  { key: 'phone', prop: 'phone', label: 'Celular' },
  { key: 'email', prop: 'email', label: 'Mail' },
]

export const profileUrl = userId => '/api/admin/users/' + encodeURIComponent(userId) + '/profile'

export function NoAppBadge({ style }) {
  return <span className="tag nocap" style={{ marginLeft: 6, ...style }}>{t('Sin app')}</span>
}

// Cuenta registrada con la aprobación del staff encendida, todavía sin habilitar.
export function PendingBadge({ style }) {
  return <span className="tag nocap member-pending" style={{ marginLeft: 6, ...style }}>{t('Pendiente')}</span>
}

// Algún dato obligatorio (según la config de campos) vacío: típico de una ficha importada.
export function IncompleteBadge({ style }) {
  return <span className="tag nocap member-incomplete" style={{ marginLeft: 6, ...style }}>{t('Datos incompletos')}</span>
}
export const profileIncomplete = (profile, fields) =>
  MEMBER_FIELDS.some(f => fields[f.key]?.enabled && fields[f.key]?.required && !String(profile?.[f.prop] ?? '').trim())

// ¿Hay otra persona con este DNI? → { userId, name, hasApp } o null. Un DNI mal escrito, el
// DNI apagado en la config o un error de red cuentan como "no hay": el alta igual lo valida.
export function lookupDni(dni) {
  const clean = String(dni || '').trim()
  if (!clean) return Promise.resolve(null)
  return api('/api/admin/members/lookup?dni=' + encodeURIComponent(clean)).catch(() => null)
}

// Solo dígitos, 6 a 8 (igual que el servidor): la búsqueda de Usuarios también pregunta por DNI.
export const looksLikeDni = q => /^\d{6,8}$/.test(String(q || '').replace(/[.\s]/g, ''))

// "Ya existe {nombre} (con app / sin app)" con Abrir y, si corresponde, Vincular.
export function DuplicateNotice({ other, onOpen, onLink }) {
  return <div className="member-dup" role="alert">
    <div className="member-dup-t">{t('Ya existe {0} ({1})', other.name, other.hasApp ? t('con app') : t('sin app'))}</div>
    <div className="member-dup-a">
      {onOpen && <Button size="sm" variant="tinted" onClick={() => onOpen(other.userId)}>{t('Abrir')}</Button>}
      {onLink && <Button size="sm" variant="tinted" onClick={onLink}>{t('Vincular')}</Button>}
    </div>
  </div>
}

// Exportar socios (solo owner): el servidor arma el CSV (BOM, ';', fórmulas neutralizadas) y
// deja el conteo en Logs; acá solo se descarga. El nombre del archivo lo pone el servidor.
export async function exportMembersCsv() {
  const res = await fetch('/api/owner/members/export', { credentials: 'same-origin' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'HTTP ' + res.status)
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'socios.csv'
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Los flujos pesados viven en otro chunk; se abren como un sheet a pantalla completa con pasos
// internos (atrás retrocede un paso), igual que la ficha de cuota.
const openLazySheet = (load, openSheet, name, props) => load().then(mod => {
  const Sheet = mod[name]
  openSheet((close, { setOnBack } = {}) => <Sheet {...props} close={close} setOnBack={setOnBack} />,
    { locked: true, fullScreen: true, backGesture: true })
})
export const openMemberSheet = (openSheet, name, props) => openLazySheet(() => import('./MemberSheets.jsx'), openSheet, name, props)
// Importar socios (solo owner): chunk propio, que además carga el lector de .xlsx recién al usarlo.
export const openImportSheet = (openSheet, props) => openLazySheet(() => import('./ImportMembersSheet.jsx'), openSheet, 'ImportMembersSheet', props)

// Card "Ficha" de UserDetail: los datos de identificación del socio y el botón para editarlos.
// openSheet, openUser y onLink vienen de UserDetail (onLink abre "unir" con los dos elegidos).
export function FichaCard({ user, users, openSheet, openUser, onLink }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api(profileUrl(user.id)).then(d => { setData(d); setError(null) }).catch(e => setError(e.message))
  useEffect(() => { load() }, [user.id])
  const fields = data?.fields || {}, profile = data?.profile || {}
  const edit = () => openMemberSheet(openSheet, 'ProfileEditSheet', {
    user, users, profile, fields, onSaved: load, openUser, onLink
  })
  const rows = MEMBER_FIELDS.filter(f => fields[f.key]?.enabled || profile[f.prop])
  return <div className="card member-ficha">
    <div className="row between">
      <div className="member-ficha-h">
        <h2 style={{ margin: 0 }}>{t('Ficha')}</h2>
        {data && profileIncomplete(profile, fields) && <IncompleteBadge style={{ marginLeft: 0 }} />}
      </div>
      <Button size="sm" variant="tinted" icon="pencil" disabled={!data} onClick={edit}>{t('Editar')}</Button>
    </div>
    {error ? <div className="form-error" role="alert">{error}</div>
      : !data ? <div className="dim small" style={{ marginTop: 6 }}>{t('Loading…')}</div>
      : <div className="member-ficha-rows">
        {rows.map(f => <Row key={f.key} title={t(f.label)} value={profile[f.prop] || '—'} />)}
      </div>}
  </div>
}
