import { useEffect, useId, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import { TermsNotice, LegalVersion } from './TermsNotice.jsx'

// Aviso de privacidad (Ley 25.326). El responsable es el gym (nombre y contacto los configura el
// owner en Acceso); lauyim es el encargado. La lista de datos sale de la config real de la
// instancia (/api/privacy): campos de la ficha pedidos, cuotas activas, auditoría, ingreso físico
// y clases. Las copias de seguridad: 6 meses (scripts/backup.sh, BACKUP_KEEP_MONTHLY). Comparte la
// versión con los términos y condiciones (api/legal.js): al cambiar este texto, subir LEGAL_VERSION.

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

// onSupport: botón de problemas técnicos (el reporte de Ajustes, que le llega a lauyim). Solo en la
// página pública: en los pasos internos de un sheet abriría un sheet encima de otro. Las consultas
// sobre datos personales siguen yendo al contacto del gym (responsable).
export function PrivacyNotice({ info, onSupport }) {
  if (!info) return <div className="dim small">{t('Loading…')}</div>
  const gym = info.gymName || t('el gimnasio')
  const contact = info.contact
  // Encargado: "lauyim", o con nombre y CUIT si la instancia los configura (OPERATOR_NAME / _CUIT).
  const op = info.operator || {}
  const operator = op.name || op.cuit ? `lauyim (${[op.name, op.cuit && 'CUIT ' + op.cuit].filter(Boolean).join(', ')})` : 'lauyim'
  const fields = (info.fields || []).map(k => t(FIELD_LABELS[k] || k))
  return <div className="privacy-doc">
    <Sect title={t('Quién es responsable de tus datos')}>
      <p>{t('El responsable de la base de datos es {0}, el gimnasio donde entrenás. Es quien decide qué datos se piden y para qué.', gym)}</p>
      <p>{t('{0} provee la app y la aloja por cuenta del gimnasio (encargado del tratamiento): usa los datos solo para que la app funcione y no los usa para fines propios.', operator)}</p>
      {info.appName && info.appName !== 'lauyim' && <p>{t('{0} es la app del gimnasio, provista y alojada por lauyim.', info.appName)}</p>}
    </Sect>

    <Sect title={t('Qué datos se guardan')}>
      <ul>
        <li>{t('Tu cuenta: el nombre de usuario que elegís y la clave pública de tu passkey. Tu huella, rostro o PIN nunca salen de tu dispositivo.')}</li>
        {fields.length > 0 && <li>{t('Tus datos de socio: {0}.', fields.join(', '))}</li>}
        {info.billingEnabled && <li>{t('Tu cuota: plan, vencimientos, pagos registrados en recepción y pruebas gratis.')}</li>}
        <li>{t('Tu entrenamiento: rutinas, programas, series, pesos levantados e historial.')}</li>
        {info.checkinEnabled && <li>{t('Tu asistencia: los ingresos al gimnasio que se registran en la recepción, con fecha y hora.')}</li>}
        {info.classes && <li>{t('Tus clases: reservas, lista de espera, asistencia, cancelaciones y las calificaciones que des.')}</li>}
        <li>{t('Tus datos de salud, si das tu consentimiento: peso corporal, edad, género, altura, lesiones, nutrición y los suplementos que registres.')}</li>
        <li>{t('Notificaciones: si las activás, la dirección de envío que da tu navegador.')}</li>
        <li>{t('Registros técnicos de seguridad: ingresos y acciones del staff, con fecha y hora.')}</li>
      </ul>
      <p>{t('Peso, edad, género, altura, lesiones y nutrición se tratan como datos sensibles (art. 7 de la Ley 25.326): solo se guardan con tu consentimiento expreso y solo se usan para adaptar tu entrenamiento. Podés retirarlo cuando quieras desde Ajustes → Datos de salud: la app sigue funcionando para entrenar, esas secciones se ocultan y podés borrar lo que ya cargaste.')}</p>
      <p>{t('Los suplementos que registres son un dato de salud: solo los ves vos (el staff del gimnasio no tiene acceso) y se borran con "Borrar mis datos de salud".')}</p>
    </Sect>

    <Sect title={t('Para qué se usan')}>
      <ul>
        <li>{t('Identificarte como socio del gimnasio y evitar cuentas duplicadas.')}</li>
        {info.billingEnabled && <li>{t('Controlar tu cuota y avisarte antes del vencimiento.')}</li>}
        <li>{t('Guardar y sincronizar tus entrenamientos y mostrarte tu progreso.')}</li>
        {info.classes && <li>{t('Gestionar las reservas de clases, los cupos y las listas de espera, y avisarte si una clase cambia.')}</li>}
        {(info.checkinEnabled || info.classes) && <li>{t('Armar estadísticas de uso del gimnasio (asistencia y ocupación) para organizar horarios y clases.')}</li>}
        <li>{t('Mandarte los avisos que activaste.')}</li>
        <li>{t('Proteger la cuenta y detectar usos indebidos.')}</li>
      </ul>
      <p>{t('No se venden ni se ceden a terceros, y no se usan para publicidad.')}</p>
    </Sect>

    <Sect title={t('Quién accede')}>
      <ul>
        <li>{t('El staff del gimnasio (dueño, recepción, entrenadores y nutricionistas), solo para atenderte. Cada persona ve solo lo que su rol le permite.')}</li>
        {info.classes && <li>{t('La profe de cada clase ve quiénes están anotados. El gimnasio puede pasarle la lista (por ejemplo, por WhatsApp) con nombre e inicial del apellido, o con el nombre completo. El staff ve las calificaciones de las clases para mejorarlas.')}</li>}
        <li>{t('lauyim, solo para soporte y mantenimiento técnico.')}</li>
        <li>{t('Las copias de seguridad se guardan cifradas en un servicio de almacenamiento en la nube, que no puede leerlas.')}</li>
        <li>{t('Cloudflare, que conecta la app con el servidor: el cifrado de la conexión termina en su red, así que puede ver el tráfico para entregarlo. No lo usa para otros fines.')}</li>
        <li>{t('Si mandás un reporte de problemas técnicos, Brevo (servicio de correo de la Unión Europea) se lo entrega a lauyim con tu nombre de usuario, el mail que escribas y tu mensaje.')}</li>
        <li>{t('Si activás las notificaciones, el servicio de avisos de tu navegador (Google, Apple, Mozilla o Microsoft) recibe el texto de cada aviso para entregártelo.')}</li>
      </ul>
    </Sect>

    <Sect title={t('Transferencia internacional')}>
      <p>{t('Algunos de estos servicios (el almacenamiento de las copias de seguridad, Cloudflare, los servicios de avisos de los navegadores y Brevo) usan servidores fuera de Argentina, principalmente en Estados Unidos y en la Unión Europea. Reciben solo lo indispensable y las copias de seguridad viajan y se guardan cifradas.')}</p>
    </Sect>

    <Sect title={t('Cuánto tiempo se guardan')}>
      <p>{t('Mientras seas socio o tengas la cuenta. Si pedís la baja se borran, salvo lo que el gimnasio tenga que conservar por ley (por ejemplo, registros de pagos).')}</p>
      {info.auditDays && <p>{t('Los registros de seguridad se borran a los {0} días.', info.auditDays)}</p>}
      <p>{t('Las copias de seguridad se guardan hasta 6 meses, cifradas, y después se borran. Si pedís la baja, tus datos pueden seguir en esas copias hasta que venzan: solo se usan para recuperar el sistema ante una falla.')}</p>
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
      {onSupport && <div className="privacy-support"><Button size="sm" icon="wrench" onClick={onSupport}>{t('Problemas técnicos con la app')}</Button></div>}
    </Sect>
    <LegalVersion info={info} />
  </div>
}

// Paso interno de un sheet o de una pantalla (registro, vinculación, alta de ficha, importación,
// aceptación de una sola vez): el aviso de privacidad (`open`) o los términos (`openTerms`), con
// el formulario oculto con `hidden` para que conserve lo cargado. Mismo contrato que usePickerStep.
export function usePrivacyStep() {
  const [doc, setDoc] = useState(null)
  return {
    open: () => setDoc('privacy'),
    openTerms: () => setDoc('terms'),
    close: () => setDoc(null),
    isOpen: !!doc,
    view: doc ? <LegalStepView doc={doc} onBack={() => setDoc(null)} /> : null
  }
}

function LegalStepView({ doc, onBack }) {
  const info = usePrivacyInfo()
  return <div className="picker-step">
    <Button size="sm" icon="chevronLeft" onClick={onBack}>{t('Volver')}</Button>
    <h3 style={{ margin: '12px 0 10px' }}>{doc === 'terms' ? t('Términos y condiciones') : t('Aviso de privacidad')}</h3>
    {doc === 'terms' ? <TermsNotice info={info} /> : <PrivacyNotice info={info} />}
  </div>
}

// Dentro del texto de un check (un <label>): el clic abre el texto y nunca marca ni desmarca el
// check.
export function PrivacyLink({ onClick, children }) {
  return <button type="button" className="linkbtn privacy-link" onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }}>{children || t('Aviso de privacidad')}</button>
}

export const HEALTH_DATA_LABEL = 'peso, edad, género, lesiones, nutrición y suplementos'

// Check "Acepto los términos y condiciones y el aviso de privacidad", con los dos textos como
// links. Los links quedan fuera del <label>: tocarlos abre el texto y nunca marca el check (un
// botón dentro de un label lo marca en algunos navegadores). El check se nombra con la frase entera.
export function LegalAcceptCheck({ checked, onChange, step, className = '' }) {
  const id = useId()
  return <div className={'privacy-accept ' + className}>
    <input id={id + 'c'} type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} aria-labelledby={id + 't'} />
    <span id={id + 't'}>
      <label htmlFor={id + 'c'}>{t('Acepto los')}</label> <PrivacyLink onClick={step.openTerms}>{t('términos y condiciones')}</PrivacyLink>{' '}
      <label htmlFor={id + 'c'}>{t('y el')}</label> <PrivacyLink onClick={step.open}>{t('aviso de privacidad')}</PrivacyLink>.
    </span>
  </div>
}

// Registro y vinculación con código del gym: dos decisiones separadas. Los términos y el aviso
// son obligatorios; los datos de salud (Ley 25.326, art. 7: sensibles), un consentimiento
// expreso y opcional. Sin él la cuenta se crea igual, sin Nutrición ni peso corporal, y se puede
// dar más tarde en Ajustes → Datos de salud.
export function ConsentChecks({ legal, onLegal, health, onHealth, step }) {
  return <div className="consent-checks">
    <LegalAcceptCheck checked={legal} onChange={onLegal} step={step} />
    <label className="privacy-accept consent-health">
      <input type="checkbox" checked={!!health} onChange={e => onHealth(e.target.checked)} />
      <span>
        <b>{t('Datos de salud')}</b> <span className="dim">{t('(opcional)')}</span><br />
        {t('Acepto que se guarden mis datos de salud ({0}) para adaptar mi entrenamiento. Lo puedo cambiar cuando quiera en Ajustes.', t(HEALTH_DATA_LABEL))}
      </span>
    </label>
  </div>
}
