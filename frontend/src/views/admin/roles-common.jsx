// Piezas de roles que usan la sección Roles y la ficha del socio (shared.jsx): la etiqueta de color
// y "Gestionar roles". Aparte de Roles.jsx para que la ficha no cargue toda la sección.
import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api, passkeyAssertion } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { can } from '../../lib/permissions.js'
import Icon from '../../components/Icon.jsx'

export const peopleText = n => n === 0 ? t('Nadie') : n === 1 ? t('1 persona') : t('{0} personas', n)

// Solo roles con permisos que quien asigna también tiene (el servidor lo vuelve a controlar).
export const canAssign = (user, role) => !!user?.owner || role.permissions.every(code => can(user, code))

// Etiqueta de color con el nombre del rol.
export function RoleTag({ role }) {
  if (!role) return null
  return <span className="tag nocap role-tag" style={{ '--role': role.color }}>{role.name}</span>
}

// ¿Puede recibir el rol de dueño? Cuenta con app, activa, aprobada y que no sea la dueña (el servidor
// lo vuelve a controlar al pedir la passkey y al confirmar).
export const canReceiveOwnership = m => !!m && !!m.hasApp && !m.disabled && !m.pending && !m.owner

// Cartel para pasar el rol de dueño: qué cambia y "Confirmar con mi passkey" (una passkey del dueño,
// con huella, cara o PIN). Al terminar, la sesión se refresca: quien lo pasó queda como Administrador.
function OwnerTransfer({ member, onDone, close }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const { cid, options } = await api('/api/owner/transfer/options', { method: 'POST', body: JSON.stringify({ userId: member.id }) })
      let credential
      try { credential = await passkeyAssertion(options) } catch (e) {
        toast(e?.name === 'NotAllowedError' || e?.name === 'AbortError' ? t('Se canceló la passkey') : errorText(e, t('No se pudo verificar la passkey. Intentá de nuevo.')))
        setBusy(false)
        return
      }
      await api('/api/owner/transfer/verify', { method: 'POST', body: JSON.stringify({ cid, credential }) })
      close()
      onDone && onDone()
      toast(t('{0} ahora es dueño/a del gimnasio', member.name))
      await useStore.getState().verifySession()
    } catch (e) { toast(errorText(e, t('No se pudo pasar el rol de dueño'))); setBusy(false) }
  }
  return <div className="owner-transfer">
    <div className="owner-transfer-icon" aria-hidden="true">👑</div>
    <h3>{t('¿Pasarle el rol de dueño a {0}?', member.name)}</h3>
    <ul className="owner-transfer-list small">
      <li>{t('{0} va a poder todo: cuotas, roles, personalización, borrar cuentas.', member.name)}</li>
      <li>{t('Vos pasás a Administrador. {0} te lo puede cambiar o quitar.', member.name)}</li>
      <li>{t('Para deshacerlo, {0} tiene que devolvértelo.', member.name)}</li>
    </ul>
    <button type="button" className="btn primary owner-transfer-go" disabled={busy} onClick={go}>🔑 {t('Confirmar con mi passkey')}</button>
    <button type="button" className="btn plain" disabled={busy} onClick={close}>{t('Cancel')}</button>
  </div>
}
export const ownerTransferDialog = ({ member, onDone }) =>
  useUI.getState().openSheet(close => <OwnerTransfer member={member} onDone={onDone} close={close} />, { kind: 'center' })

// "Gestionar roles" desde la ficha: Ninguno o uno de los roles que quien asigna puede dar. Para el
// dueño, abajo de todo, "Dueño del gimnasio": pasarle su rol a esta persona.
export function RolePickSheet({ user: member, close, onChanged }) {
  const me = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [roles, setRoles] = useState(null)
  const [busy, setBusy] = useState(false)
  const transferOn = useStore(s => !!s.config?.owner_transfer_enabled)
  const showOwner = !!me?.owner && transferOn && canReceiveOwnership(member)
  useEffect(() => { api('/api/admin/roles').then(d => setRoles(d.roles)).catch(e => toast(errorText(e, t('Failed to load')))) }, [])
  const current = member.role?.id || null
  const pick = async role => {
    if ((role?.id || null) === current) return close()
    setBusy(true)
    try {
      await api('/api/admin/users/role', { method: 'POST', body: JSON.stringify({ userId: member.id, roleId: role?.id || null }) })
      toast(`${member.name}: ${member.role?.name || t('Ninguno')} → ${role?.name || t('Ninguno')}`)
      onChanged()
      close()
    } catch (e) { toast(errorText(e, t('No se pudo guardar'))); setBusy(false) }
  }
  const options = roles ? [null, ...roles.filter(r => canAssign(me, r) || r.id === current)] : []
  return <div className="role-pick">
    <h3 style={{ marginTop: 0 }}>{t('Rol de {0}', member.name)}</h3>
    <p className="small muted">{t('El rol dice qué puede hacer en el panel. Sin rol, es un socio más.')}</p>
    {!roles ? <div className="dim small">{t('Loading…')}</div> : <div className="sect-b" role="radiogroup" aria-label={t('Rol')}>
      {options.map(role => {
        const on = (role?.id || null) === current
        const locked = role && !canAssign(me, role)
        return <button key={role?.id || 'none'} type="button" role="radio" aria-checked={on} className="lrow tap" disabled={busy || locked} onClick={() => pick(role)}>
          {role ? <span className="role-dot" style={{ background: role.color }} aria-hidden="true" /> : <span className="role-dot role-dot-none" aria-hidden="true" />}
          <span className="lrow-m"><span className="lrow-t">{role ? role.name : t('Ninguno')}</span>
            {locked && <span className="lrow-s">{t('Tiene permisos que vos no tenés')}</span>}</span>
          {on && <Icon name="check" className="lrow-k" />}
        </button>
      })}
    </div>}
    {showOwner && <div className="owner-section">
      <h4 className="sec">{t('Dueño del gimnasio')}</h4>
      <p className="small muted">{t('Solo puede haber uno. Pide tu passkey y vos pasás a Administrador.')}</p>
      <button type="button" className="lrow tap owner-row" disabled={busy} onClick={() => ownerTransferDialog({ member, onDone: () => { onChanged(); close() } })}>
        <span className="owner-crown" aria-hidden="true">👑</span>
        <span className="lrow-m"><span className="lrow-t">{t('Pasarle el rol de dueño a {0}', member.name)}</span></span>
        <Icon name="chevronRight" className="lrow-k" />
      </button>
    </div>}
  </div>
}
