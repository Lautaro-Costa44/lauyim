import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// Aviso de privacidad (Ley 25.326). El responsable es el gym (nombre y contacto los configura el
// owner en Acceso); lauyim es el encargado. La lista de datos sale de la config real de la
// instancia (/api/privacy): campos de la ficha pedidos, cuotas activas y auditoría.
// BORRADOR: el texto todavía no pasó por una revisión legal.

let cached = null
export function usePrivacyInfo() {
  const [info, setInfo] = useState(cached)
  useEffect(() => {
    let alive = true
    api('/api/privacy')
      .then(d => { cached = d; if (alive) setInfo(d) })
      .catch(() => { if (alive) setInfo(cached || {}) })
    return () => { alive = false }
  }, [])
  return info
}

const FIELD_LABELS = { full_name: 'nombre y apellido', dni: 'DNI', phone: 'celular', email: 'mail' }

function Sect({ title, children }) {
  return <section className="privacy-sect">
    <h2>{title}</h2>
    {children}
  </section>
}

export function PrivacyNotice({ info }) {
  if (!info) return <div className="dim small">{t('Loading…')}</div>
  const gym = info.gymName || t('el gimnasio')
  const contact = info.contact
  const fields = (info.fields || []).map(k => t(FIELD_LABELS[k] || k))
  return <div className="privacy-doc">
    <div className="privacy-draft" role="note">
      <strong>{t('Borrador para revisión legal.')}</strong> {t('Este texto todavía no fue revisado por un abogado y puede cambiar.')}
    </div>

    <Sect title={t('Quién es responsable de tus datos')}>
      <p>{t('El responsable de la base de datos es {0}, el gimnasio donde entrenás. Es quien decide qué datos se piden y para qué.', gym)}</p>
      <p>{t('lauyim provee la app y la aloja por cuenta del gimnasio (encargado del tratamiento): usa los datos solo para que la app funcione y no los usa para fines propios.')}</p>
    </Sect>

    <Sect title={t('Qué datos se guardan')}>
      <ul>
        <li>{t('Tu cuenta: el nombre de usuario que elegís y la clave pública de tu passkey. Tu huella, rostro o PIN nunca salen de tu dispositivo.')}</li>
        {fields.length > 0 && <li>{t('Tus datos de socio: {0}.', fields.join(', '))}</li>}
        {info.billingEnabled && <li>{t('Tu cuota: plan, vencimientos, pagos registrados en recepción y pruebas gratis.')}</li>}
        <li>{t('Tu entrenamiento: rutinas, series, pesos, historial, peso corporal y, si los cargás, nutrición y lesiones.')}</li>
        <li>{t('Notificaciones: si las activás, la dirección de envío que da tu navegador.')}</li>
        <li>{t('Registros técnicos de seguridad: ingresos y acciones del staff, con fecha y hora.')}</li>
      </ul>
      <p>{t('Las lesiones y la nutrición son datos de salud (datos sensibles): cargarlos es voluntario y solo se usan para adaptar tu entrenamiento.')}</p>
    </Sect>

    <Sect title={t('Para qué se usan')}>
      <ul>
        <li>{t('Identificarte como socio del gimnasio y evitar cuentas duplicadas.')}</li>
        {info.billingEnabled && <li>{t('Controlar tu cuota y avisarte antes del vencimiento.')}</li>}
        <li>{t('Guardar y sincronizar tus entrenamientos y mostrarte tu progreso.')}</li>
        <li>{t('Mandarte los avisos que activaste.')}</li>
        <li>{t('Proteger la cuenta y detectar usos indebidos.')}</li>
      </ul>
      <p>{t('No se venden ni se ceden a terceros, y no se usan para publicidad.')}</p>
    </Sect>

    <Sect title={t('Quién accede')}>
      <ul>
        <li>{t('El staff del gimnasio (dueño, recepción, entrenadores y nutricionistas), solo para atenderte.')}</li>
        <li>{t('lauyim, solo para soporte y mantenimiento técnico.')}</li>
        <li>{t('Las copias de seguridad se guardan cifradas en un servicio de almacenamiento en la nube, que no puede leerlas.')}</li>
        <li>{t('Si activás las notificaciones, el servicio de avisos de tu navegador (Google, Apple, Mozilla o Microsoft) recibe el texto de cada aviso para entregártelo.')}</li>
      </ul>
    </Sect>

    <Sect title={t('Cuánto tiempo se guardan')}>
      <p>{t('Mientras seas socio o tengas la cuenta. Si pedís la baja se borran, salvo lo que el gimnasio tenga que conservar por ley (por ejemplo, registros de pagos).')}</p>
      <p>{info.auditDays
        ? t('Los registros de seguridad se borran a los {0} días y las copias de seguridad a los pocos días (7 por defecto).', info.auditDays)
        : t('Las copias de seguridad se borran a los pocos días (7 por defecto).')}</p>
    </Sect>

    <Sect title={t('Tus derechos')}>
      <p>{t('Podés pedir ver tus datos (acceso), corregirlos o actualizarlos (rectificación) y que se borren (supresión), según la Ley 25.326 de Protección de Datos Personales. El gimnasio tiene que responder el acceso dentro de los 10 días corridos y la rectificación o supresión dentro de los 5 días hábiles.')}</p>
      <p className="privacy-legal">{t('El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326.')}</p>
      <p className="privacy-legal">{t('La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.')}</p>
    </Sect>

    <Sect title={t('Contacto')}>
      <p>{contact
        ? t('Para ejercer tus derechos o hacer una consulta: {0}.', contact)
        : t('Para ejercer tus derechos o hacer una consulta, acercate a la recepción del gimnasio.')}</p>
    </Sect>
  </div>
}

// Paso interno de un sheet (registro, alta de ficha, importación): el formulario queda oculto
// con `hidden` y conserva lo cargado. Mismo contrato que usePickerStep.
export function usePrivacyStep() {
  const [open, setOpen] = useState(false)
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: open,
    view: open ? <PrivacyStepView onBack={() => setOpen(false)} /> : null
  }
}

function PrivacyStepView({ onBack }) {
  const info = usePrivacyInfo()
  return <div className="picker-step">
    <Button size="sm" icon="chevronLeft" onClick={onBack}>{t('Volver')}</Button>
    <h3 style={{ margin: '12px 0 10px' }}>{t('Aviso de privacidad')}</h3>
    <PrivacyNotice info={info} />
  </div>
}

export function PrivacyLink({ onClick, children }) {
  return <button type="button" className="linkbtn privacy-link" onClick={onClick}>{children || t('Aviso de privacidad')}</button>
}
