import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// Términos y condiciones de uso de la app para los socios y el staff del gimnasio. Comparten la
// versión con el aviso de privacidad (api/legal.js): si cambia cualquiera de los dos, la app
// vuelve a pedir la aceptación. El gimnasio presta el servicio; lauyim provee y aloja la app.
// `info` es la respuesta de /api/privacy (nombre del gym, contacto, versión).
export const SOURCE_URL = 'https://github.com/Lautaro-Costa44/lauyim'

export function legalDate(version) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version || '')) return null
  return new Date(version + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function LegalVersion({ info }) {
  const date = legalDate(info?.legalVersion)
  return date ? <p className="privacy-version dim small">{t('Versión vigente desde el {0}.', date)}</p> : null
}

function Sect({ title, children }) {
  return <section className="privacy-sect">
    <h2>{title}</h2>
    {children}
  </section>
}

export function TermsNotice({ info, onSupport }) {
  if (!info) return <div className="dim small">{t('Loading…')}</div>
  // Al principio de una oración: sin nombre cargado, "El gimnasio" con mayúscula.
  const gym = info.gymName || t('El gimnasio')
  const contact = info.contact
  return <div className="privacy-doc">
    <Sect title={t('Quién presta el servicio')}>
      <p>{t('{0} te da acceso a esta app para usar sus servicios: tu cuenta de socio, tus rutinas, tu cuota y tu asistencia. lauyim provee la app y la aloja por cuenta del gimnasio.', gym)}</p>
      {info.appName && info.appName !== 'lauyim' && <p>{t('{0} es la app del gimnasio, provista y alojada por lauyim.', info.appName)}</p>}
      <p>{t('Al crear tu cuenta o seguir usándola aceptás estos términos y el aviso de privacidad. Si no estás de acuerdo, no uses la app y consultá en la recepción.')}</p>
    </Sect>

    <Sect title={t('Tu cuenta')}>
      <ul>
        <li>{t('Es personal e intransferible. Entrás con una passkey guardada en tu dispositivo: tu huella, rostro o PIN nunca salen de él.')}</li>
        <li>{t('Lo que se haga desde tu cuenta queda a tu cargo. Si perdés un dispositivo, usá Ajustes → "Cerrar sesión en todos los dispositivos" y avisá en la recepción.')}</li>
        <li>{t('Tus datos tienen que ser verdaderos. El gimnasio puede corregirlos o pedirte que los actualices.')}</li>
      </ul>
    </Sect>

    <Sect title={t('Uso permitido')}>
      <p>{t('Usá la app para tu entrenamiento y tu relación con el gimnasio. No está permitido:')}</p>
      <ul>
        <li>{t('Compartir tu cuenta o usar la de otra persona.')}</li>
        <li>{t('Intentar ver o cambiar datos de otros socios, o vulnerar la seguridad de la app.')}</li>
        <li>{t('Cargar en notas o nombres contenido ofensivo, ilegal o que no te pertenezca.')}</li>
      </ul>
    </Sect>

    <Sect title={t('Salud y entrenamiento')}>
      <p>{t('Las rutinas, las cargas sugeridas, las metas y sugerencias de nutrición y los cálculos de la app (calorías, 1RM, fatiga) son orientativos. No reemplazan la consulta con un médico, un nutricionista ni las indicaciones del staff.')}</p>
      <p>{t('Antes de empezar un plan, y ante cualquier dolor, lesión o condición de salud, consultá a un profesional y avisá al staff. Entrenás bajo tu responsabilidad y siguiendo las indicaciones del gimnasio.')}</p>
    </Sect>

    <Sect title={t('Cuota y acceso')}>
      <p>{t('Los precios, vencimientos y medios de pago los fija el gimnasio, y los pagos se registran en la recepción: la app no cobra. Si el gimnasio lo configura, la app puede bloquear tu acceso con la cuota vencida hasta que la regularices.')}</p>
    </Sect>

    <Sect title={t('Disponibilidad')}>
      <p>{t('La app puede interrumpirse por mantenimiento o por fallas. Lo que cargues sin conexión queda guardado en tu dispositivo y se sincroniza al volver a conectarte. No la uses para emergencias médicas.')}</p>
    </Sect>

    <Sect title={t('Contenido')}>
      <p>{t('Las imágenes, animaciones e instrucciones de los ejercicios son ilustrativas y en parte de terceros: solo se usan dentro de la app. El código de la app es software libre bajo la licencia AGPL v3 y está publicado.')}</p>
      <p><a className="privacy-link" href={SOURCE_URL} target="_blank" rel="noopener">{t('Ver el código fuente')}</a></p>
    </Sect>

    <Sect title={t('Baja de la cuenta')}>
      <p>{t('Podés pedir la baja de tu cuenta en la recepción. Tus datos se tratan según el aviso de privacidad. El gimnasio puede desactivar tu cuenta si dejás de ser socio o no cumplís estos términos.')}</p>
    </Sect>

    <Sect title={t('Cambios y ley aplicable')}>
      <p>{t('Si estos términos o el aviso de privacidad cambian, la app te los muestra y te pide aceptarlos de nuevo antes de seguir.')}</p>
      <p>{t('Se rigen por las leyes de la República Argentina. No limitan los derechos que te da la ley de Defensa del Consumidor (Ley 24.240) frente al gimnasio.')}</p>
    </Sect>

    <Sect title={t('Contacto')}>
      <p>{contact
        ? t('Por consultas sobre el servicio o tu cuenta: {0}.', contact)
        : t('Por consultas sobre el servicio o tu cuenta, acercate a la recepción del gimnasio.')}</p>
      {onSupport && <div className="privacy-support"><Button size="sm" icon="wrench" onClick={onSupport}>{t('Problemas técnicos con la app')}</Button></div>}
    </Sect>
    <LegalVersion info={info} />
  </div>
}
