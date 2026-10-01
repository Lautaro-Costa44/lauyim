// Admin → Roles (docs/superpowers/specs/2026-10-01-roles-design.md). El owner crea, edita y borra
// roles; quien tiene "Asignar roles" solo asigna, y solo roles con permisos que también tiene. El
// catálogo de permisos (nombres, explicación, dependencias) llega con la lista: api/permissions.js.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { ACCENTS } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'
import { Button, Switch, TextField } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { confirmSheet } from '../../sheets.jsx'
import { useAdmin } from './context.js'

const MAX_ROLE_NAME = 30
export const peopleText = n => n === 0 ? t('Nadie') : n === 1 ? t('1 persona') : t('{0} personas', n)

// Permisos con los que necesitan (activar) o sin los que dependen de él (apagar), según el catálogo.
export function togglePermission(catalog, current, code, on) {
  const requires = new Map(catalog.map(p => [p.code, p.requires || []]))
  const out = new Set(current)
  if (on) {
    const add = c => { if (out.has(c) || !requires.has(c)) return; out.add(c); requires.get(c).forEach(add) }
    add(code)
  } else {
    const gone = new Set([code])
    let grew = true
    while (grew) {
      grew = false
      for (const [c, reqs] of requires) if (!gone.has(c) && reqs.some(r => gone.has(r))) { gone.add(c); grew = true }
    }
    gone.forEach(c => out.delete(c))
  }
  return catalog.map(p => p.code).filter(c => out.has(c))
}

export default function Roles() {
  const user = useStore(s => s.user)
  const isOwner = !!user?.owner
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { users, loadUsers } = useAdmin()
  const [data, setData] = useState(null)      // { roles, catalog }
  const load = () => api('/api/admin/roles').then(setData).catch(e => toast(errorText(e, t('Failed to load'))))
  useEffect(() => { load() }, [])

  if (!data) return <div className="card"><div className="dim small">{t('Loading…')}</div></div>

  const changed = () => { load(); loadUsers() }
  // Solo roles con permisos que quien asigna también tiene (el servidor lo vuelve a controlar).
  const assignable = role => isOwner || role.permissions.every(code => can(user, code))
  const edit = role => openSheet(close => <RoleEditor role={role} catalog={data.catalog} roles={data.roles} close={close} onSaved={changed} />)
  const assign = role => openSheet(close => <AssignSheet role={role} users={users} close={close} onChanged={changed} />)
  const remove = role => confirmSheet({
    title: t('¿Eliminar {0}?', role.name),
    message: role.members === 1 ? t('1 persona queda sin rol.') : role.members ? t('{0} quedan sin rol.', peopleText(role.members)) : t('Nadie tiene este rol.'),
    confirmText: t('Eliminar'), danger: true,
    onConfirm: () => api('/api/owner/roles/delete', { method: 'POST', body: JSON.stringify({ id: role.id }) })
      .then(() => { toast(t('Rol eliminado')); changed() }).catch(e => toast(errorText(e, t('No se pudo eliminar'))))
  })

  return <div className="card roles-admin">
    <div className="row between roles-head">
      <h2 style={{ margin: 0 }}>{t('Roles')}</h2>
      {isOwner && <Button variant="primary" size="sm" icon="plus" onClick={() => edit(null)}>{t('Nuevo rol')}</Button>}
    </div>
    <p className="small muted">{t('Cada persona del staff tiene un rol, y el rol dice qué puede hacer en el panel. Sin rol, es un socio más.')}</p>
    <div className="roles-list">
      {data.roles.map(role => <div key={role.id} className="role-row">
        <span className="role-dot" style={{ background: role.color }} aria-hidden="true" />
        <span className="role-m">
          <span className="role-name">{role.name}{role.builtin && <Icon name="lock" className="role-lock" />}</span>
          <span className="role-sub">{peopleText(role.members)}{!role.feeExempt && ' · ' + t('paga cuota')}</span>
        </span>
        <span className="role-actions">
          {isOwner && <button type="button" className="iconbtn" aria-label={t('Editar {0}', role.name)} onClick={() => edit(role)}><Icon name="pencil" /></button>}
          {assignable(role) && <button type="button" className="iconbtn" aria-label={t('Asignar {0}', role.name)} onClick={() => assign(role)}><Icon name="personPlus" /></button>}
          {isOwner && !role.builtin && <button type="button" className="iconbtn role-del" aria-label={t('Eliminar {0}', role.name)} onClick={() => remove(role)}><Icon name="trash" /></button>}
        </span>
      </div>)}
    </div>
  </div>
}

// Nuevo o editar: nombre (el de Administrador es fijo), color, exento de cuota y permisos por área.
function RoleEditor({ role, catalog, roles, close, onSaved }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(role?.name || '')
  const [color, setColor] = useState(role?.color || '#0a84ff')
  const [feeExempt, setFeeExempt] = useState(role ? role.feeExempt : true)
  const [perms, setPerms] = useState(role?.permissions || [])
  const [error, setError] = useState(null)       // { field, message }
  const [busy, setBusy] = useState(false)
  const areas = useMemo(() => [...new Set(catalog.map(p => p.area))], [catalog])
  const taken = roles.filter(r => r.id !== role?.id).map(r => r.name.toLocaleLowerCase('es'))
  const nameError = error?.field === 'name' ? error.message
    : name.trim() && taken.includes(name.trim().toLocaleLowerCase('es')) ? t('Ya hay un rol con ese nombre') : null

  const save = async () => {
    setBusy(true)
    try {
      await api('/api/owner/roles/save', { method: 'POST', body: JSON.stringify({ id: role?.id, name, color, feeExempt, permissions: perms }) })
      toast(role ? t('Rol guardado') : t('Rol creado'))
      onSaved()
      close()
    } catch (e) {
      if (e?.data?.field) setError({ field: e.data.field, message: e.data.message })
      else toast(errorText(e, t('No se pudo guardar')))
    }
    setBusy(false)
  }

  return <div className="role-editor">
    <h3 style={{ marginTop: 0 }}>{role ? t('Editar rol') : t('Nuevo rol')}</h3>
    <label className="member-field">
      <span className="member-field-l">{t('Nombre')} <span className="dim">{name.length}/{MAX_ROLE_NAME}</span></span>
      <TextField type="text" inputMode="text" name="role-name" maxLength={MAX_ROLE_NAME} value={name} disabled={!!role?.builtin}
        aria-invalid={!!nameError} onChange={e => { setName(e.target.value); setError(null) }} />
      {role?.builtin && <span className="small dim">{t('El rol Administrador no cambia de nombre.')}</span>}
      {nameError && <span className="form-error" role="alert">{nameError}</span>}
    </label>
    <div className="member-field">
      <span className="member-field-l">{t('Color')}</span>
      <div className="swatches">
        {Object.values(ACCENTS).map(c => <button key={c} type="button" className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />)}
        <label className={'swatch swatch-picker' + (!Object.values(ACCENTS).includes(color) ? ' on' : '')}
          style={!Object.values(ACCENTS).includes(color) ? { background: color } : undefined} title={t('Elegir cualquier color')}>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label={t('Elegir cualquier color')} />
          <Icon name="plus" />
        </label>
      </div>
    </div>
    <div className="branding-lock">
      <div>
        <div>{t('Exento de cuota')}</div>
        <div className="small dim">{feeExempt ? t('No le aparecen vencimientos ni bloqueos por cuota.') : t('Paga la cuota como cualquier socio.')}</div>
      </div>
      <Switch checked={feeExempt} onChange={setFeeExempt} label={t('Exento de cuota')} />
    </div>
    {areas.map(area => <div key={area} className="perm-group">
      <h4 className="sec">{t(area)}</h4>
      <div className="sect-b">
        {catalog.filter(p => p.area === area).map(p => <div key={p.code} className="lrow perm-row">
          <span className="lrow-m"><span className="lrow-t">{t(p.name)}</span><span className="lrow-s">{t(p.help)}</span></span>
          <Switch checked={perms.includes(p.code)} label={t(p.name)}
            onChange={on => setPerms(cur => togglePermission(catalog, cur, p.code, on))} />
        </div>)}
      </div>
    </div>)}
    <div className="row" style={{ gap: 8, marginTop: 16 }}>
      <Button className="grow" onClick={close}>{t('Cancelar')}</Button>
      <Button className="grow" variant="primary" disabled={busy || !name.trim() || !!nameError} onClick={save}>{busy ? t('Guardando…') : t('Guardar')}</Button>
    </div>
  </div>
}

// Tocar asigna este rol (reemplaza el que tenía); tocar a quien ya lo tiene lo deja sin rol. Solo
// cuentas activas con la app: no el owner, ni pendientes, ni desactivadas, ni fichas sin celular.
function AssignSheet({ role, users, close, onChanged }) {
  const toast = useUI(s => s.toast)
  const [list, setList] = useState(() => (users || []).filter(u => !u.owner && !u.pending && !u.disabled && u.hasApp))
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const needle = q.trim().toLocaleLowerCase('es')
  const shown = list
    .filter(u => !needle || (u.fullName || '').toLocaleLowerCase('es').includes(needle) || u.name.toLocaleLowerCase('es').includes(needle))
    .sort((a, b) => (b.role?.id === role.id) - (a.role?.id === role.id) || (a.fullName || a.name).localeCompare(b.fullName || b.name, 'es'))

  const toggle = async u => {
    const next = u.role?.id === role.id ? null : role
    setBusy(u.id)
    try {
      const res = await api('/api/admin/users/role', { method: 'POST', body: JSON.stringify({ userId: u.id, roleId: next?.id || null }) })
      setList(cur => cur.map(x => x.id === u.id ? { ...x, role: res.role } : x))
      toast(`${u.fullName || u.name}: ${u.role?.name || t('Ninguno')} → ${next?.name || t('Ninguno')}`)
      onChanged()
    } catch (e) { toast(errorText(e, t('No se pudo guardar'))) }
    setBusy(null)
  }

  return <div className="role-assign">
    <h3 style={{ marginTop: 0 }}><span className="role-dot" style={{ background: role.color }} aria-hidden="true" /> {t('Asignar {0}', role.name)}</h3>
    <TextField type="search" name="role-search" placeholder={t('Buscar por nombre')} value={q} onChange={e => setQ(e.target.value)} />
    <div className="sect-b role-assign-list">
      {shown.map(u => {
        const has = u.role?.id === role.id
        return <button key={u.id} type="button" className={'lrow tap' + (has ? ' on' : '')} disabled={busy === u.id} aria-pressed={has} onClick={() => toggle(u)}>
          <span className="lrow-m"><span className="lrow-t">{u.fullName || u.name}</span>
            {u.role && !has && <span className="lrow-s"><RoleTag role={u.role} /></span>}</span>
          {has && <Icon name="check" className="lrow-k" />}
        </button>
      })}
      {!shown.length && <div className="empty small">{needle ? t('Nadie con ese nombre.') : t('No hay cuentas activas con la app.')}</div>}
    </div>
    <Button style={{ width: '100%', marginTop: 12 }} onClick={close}>{t('Listo')}</Button>
  </div>
}

// Etiqueta de color con el nombre del rol (lista de usuarios, ficha, asignar).
export function RoleTag({ role }) {
  if (!role) return null
  return <span className="tag nocap role-tag" style={{ '--role': role.color }}>{role.name}</span>
}
