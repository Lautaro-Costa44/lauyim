import { t } from '../lib/i18n.js'
import { NO_AUTOFILL } from '../lib/input-safety.js'
import { PrivacyLink } from './PrivacyNotice.jsx'

// Datos del socio que pide el gym (config de campos de Acceso), para el registro y el formulario
// de una sola vez. El staff usa su propio formulario (admin/members/MemberSheets.jsx).
export const PROFILE_FIELDS = [
  { key: 'full_name', prop: 'fullName', label: 'Nombre y apellido', input: { type: 'text', inputMode: 'text', maxLength: 80, autoCapitalize: 'words' } },
  { key: 'dni', prop: 'dni', label: 'DNI', input: { type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8 } },
  { key: 'phone', prop: 'phone', label: 'Celular', input: { type: 'tel', inputMode: 'tel', maxLength: 30 } },
  { key: 'email', prop: 'email', label: 'Mail', input: { type: 'email', inputMode: 'email', maxLength: 120 } },
]

export const askedFields = fields => PROFILE_FIELDS.filter(f => fields?.[f.key]?.enabled)

// Solo lo que se pide y está cargado: el servidor valida formatos y obligatorios.
export function profileBody(fields, values) {
  const body = {}
  for (const f of askedFields(fields)) {
    const v = String(values[f.prop] || '').trim()
    if (v) body[f.prop] = v
  }
  return body
}

// Obligatorios vacíos, para no mandar la passkey a crear con el formulario incompleto.
export const missingRequired = (fields, values) =>
  askedFields(fields).filter(f => fields[f.key].required && !String(values[f.prop] || '').trim())

export function ProfileFields({ fields, values, onChange, errors = {}, accepted, onAccept, onPrivacy }) {
  const shown = askedFields(fields)
  return <div className="profile-fields">
    {shown.map(f => <label key={f.key} className="member-field">
      <span className="member-field-l">{t(f.label)}{fields[f.key].required && ' *'}</span>
      <input {...NO_AUTOFILL} {...f.input} name={'app-profile-' + f.key} className="input" value={values[f.prop] || ''}
        aria-invalid={!!errors[f.key]}
        onChange={e => onChange(f.prop, f.key === 'dni' ? e.target.value.replace(/\D/g, '').slice(0, 8) : e.target.value)} />
      {errors[f.key] && <span className="form-error" role="alert">{errors[f.key]}</span>}
    </label>)}
    {shown.some(f => fields[f.key].required) && <div className="dim small">{t('* Obligatorio')}</div>}
    <label className="privacy-accept">
      <input type="checkbox" checked={!!accepted} onChange={e => onAccept(e.target.checked)} />
      <span>{t('Acepto el')} <PrivacyLink onClick={onPrivacy}>{t('aviso de privacidad')}</PrivacyLink></span>
    </label>
  </div>
}
