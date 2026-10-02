// La profe desde la app de socio (Inicio y Plan → Clases): la rueda abre la hoja de la fecha del
// panel (anotados, mensaje, tomar lista, anotar a mano, horario, suspender). Esa hoja y lo que
// necesita (socios, profes, si gestiona todas) se cargan recién al tocarla.
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { can } from '../lib/permissions.js'
import { errorText } from '../lib/errors.js'
import { classesApi } from '../lib/classes.js'
import Icon from './Icon.jsx'

export async function openClassManager(occ, { onChange } = {}) {
  const user = useStore.getState().user
  try {
    const [{ sessionSheet }, types, members] = await Promise.all([
      import('../views/admin/clases/SessionSheet.jsx'),
      classesApi.types(),
      can(user, 'members.view') ? api('/api/admin/users') : Promise.resolve({ users: [] })
    ])
    sessionSheet(occ, { canManage: !!types.canManage, teachers: types.teachers || [], users: members.users || [], onChange })
  } catch (e) { useUI.getState().toast(errorText(e, t('Failed to load'))) }
}

// Botón de la rueda (no propaga el toque: tocar la clase abre su hoja, la rueda la gestión).
export function GearButton({ occ, onChange, className = '' }) {
  return <button type="button" className={'iconbtn class-gear ' + className} aria-label={t('Gestionar {0}', occ.name)}
    onClick={e => { e.stopPropagation(); openClassManager(occ, { onChange }) }}>
    <Icon name="gear" />
  </button>
}
