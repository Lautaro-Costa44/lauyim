// Aviso de suplementos (spec, "Primer uso"): información general, lista de condiciones que no se
// guarda y, si falta la edad, "¿Tenés 18 años o más?". Un solo botón: "Leí y acepto". Sin aceptar no
// se guarda nada y vuelve a aparecer; el gesto atrás puede cerrarla (no se traba al usuario).
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { useSupplements, acceptNotice, noticeAccepted, loadSupplements } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { Button, Segmented } from '../ui.jsx'

const CONDITIONS = [['🤰', 'Embarazo o lactancia'], ['🫘', 'Enfermedad renal o hepática'], ['❤️', 'Presión alta o problemas cardíacos'], ['💊', 'Tomás medicación de forma habitual'], ['😵', 'Ansiedad o problemas para dormir (por la cafeína)']]

function Aviso({ close, then }) {
  const askAge = useSupplements(s => s.adult === 'unknown')
  const [adult, setAdult] = useState(null)
  const [busy, setBusy] = useState(false)
  const accept = async () => {
    setBusy(true)
    try { await acceptNotice(askAge ? { adult: adult === 'si' } : {}); close(); then && then() }
    catch (e) {
      useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
      if (e?.data?.error === 'ack_version_changed') loadSupplements()   // el aviso cambió: trae la versión nueva
    }
    setBusy(false)
  }
  return <div className="supp-notice">
    <h3>{t('Antes de empezar')}</h3>
    <div className="supp-box">{t('Esta guía es información general basada en IOC, AIS, ISSN, NIH y EFSA. No es consejo médico ni reemplaza a un profesional de la salud.')}</div>
    <div className="supp-label">{t('Consultá a un profesional antes si te aplica alguna')}</div>
    <ul className="supp-conditions">{CONDITIONS.map(([e, c]) => <li key={c}><span aria-hidden="true">{e}</span> {t(c)}</li>)}</ul>
    <div className="small dim">{t('No guardamos cuál te aplica: solo que leíste esto.')}</div>
    {askAge && <div className="supp-age">
      <div className="supp-label">{t('¿Tenés 18 años o más?')}</div>
      <Segmented options={[{ value: 'si', label: t('Sí') }, { value: 'no', label: t('No') }]} value={adult} onChange={setAdult} />
    </div>}
    <Button variant="primary" disabled={busy || (askAge && !adult)} onClick={accept}>{t('Leí y acepto')}</Button>
  </div>
}

export const openNotice = then => useUI.getState().openSheet(close => <Aviso close={close} then={then} />, { locked: true, backGesture: true })
export const withNotice = fn => noticeAccepted(useSupplements.getState()) ? fn() : openNotice(fn)
