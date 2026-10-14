// Resumen del plan generado por la encuesta (paso de revisión): qué días, cuánto dura, cuánto
// volumen recibe cada músculo y cómo se entrena, con explicación en los conceptos clave.
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SPLIT_NOMBRE = { fullbody: 'Full Body', torso_pierna: 'Torso / Pierna', ppl: 'Push / Pull / Legs', pierna_prioridad: 'Piernas y Glúteos' }
// Músculos que se muestran en "Series por semana", de arriba hacia abajo.
const MUSCULOS = ['chest', 'upper-back', 'deltoids', 'biceps', 'triceps', 'quadriceps', 'hamstring', 'gluteal']

function infoSheet(titulo, parrafos) {
  useUI.getState().openSheet(close => <>
    <h3>{titulo}</h3>
    <div className="muted small" style={{ lineHeight: 1.6, marginBottom: 16 }}>
      {parrafos.map((p, i) => <p key={i} style={{ marginBottom: 8 }}>{p}</p>)}
    </div>
    <Button onClick={close}>{t('Entendido')}</Button>
  </>)
}

const Info = ({ label, onClick }) => <button type="button" className="helpbtn" aria-label={label} onClick={onClick}><Icon name="info" /></button>

export default function PlanResumen({ resumen }) {
  if (!resumen) return null
  const { split, dias, series, volumenObjetivo: [volMin, volMax], reps, descanso, progresion, esfuerzo, lesiones = [], avisos = [], disclaimer } = resumen
  const musculos = MUSCULOS.filter(m => series[m] > 0)
  const escala = Math.max(volMax * 1.25, ...musculos.map(m => series[m]))
  const pct = v => Math.min(100, Math.round(v / escala * 100))

  return <div className="plan-resumen">
    {(lesiones.length > 0 || avisos.length > 0) && <div className="survey-banner plan-avisos" role="note">
      <Icon name="info" style={{ fontSize: 16, marginTop: 1, flexShrink: 0 }} />
      <div>
        {lesiones.map(l => <p key={l.zona}>{l.nota}</p>)}
        {avisos.map(a => <p key={a}>{a}</p>)}
        {disclaimer && <p className="plan-disclaimer">{disclaimer}</p>}
      </div>
    </div>}

    <div className="card plan-card">
      <h2>{t('Tu plan')} · {SPLIT_NOMBRE[split] || split}, {dias.length} {dias.length === 1 ? t('día') : t('días')}</h2>
      {dias.map(d => <div key={d.diaSemana + d.rutinaNombre} className="row between plan-dia">
        <span>{DIA_CORTO[d.diaSemana]} · {d.rutinaNombre}</span>
        <span className="small muted">{d.ejercicios} {t('ejercicios')} · ~{d.minutos} min</span>
      </div>)}
    </div>

    {musculos.length > 0 && <div className="card plan-card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Series por semana')}</h2>
        <Info label={t('¿Qué son las series por semana?')} onClick={() => infoSheet(t('Series por semana'), [
          t('Cuántas series trabajan cada músculo en toda la semana. Es lo que más influye en cuánto crece y se fortalece.'),
          t('Un ejercicio cuenta completo para el músculo principal y menos para los que ayudan (por ejemplo, el press de banca suma un poco a tríceps y hombros).'),
          t('La zona punteada es lo recomendado para tu nivel: {0} a {1} series por músculo grande.', volMin, volMax),
        ])} />
      </div>
      {musculos.map(m => <div key={m} className="plan-vol">
        <span className="plan-vol-nm">{t(MUSCLE_NAME[m])}</span>
        <span className="plan-vol-bar">
          <span className="plan-vol-band" style={{ left: pct(volMin) + '%', width: (pct(volMax) - pct(volMin)) + '%' }} />
          <i style={{ width: pct(series[m]) + '%' }} />
        </span>
        <span className="plan-vol-v">{series[m]}</span>
      </div>)}
      <div className="small dim" style={{ marginTop: 6 }}>{t('Zona punteada: lo recomendado para tu nivel ({0}–{1}).', volMin, volMax)}</div>
    </div>}

    <div className="card plan-card">
      <h2>{t('Cómo se entrena')}</h2>
      <div className="row between plan-dia">
        <span>{t('Reps')}</span>
        <span className="small muted">{reps.compuesto} {t('básicos')} · {reps.aislamiento} {t('resto')}</span>
      </div>
      <div className="row between plan-dia">
        <span>{t('Descanso')}</span>
        <span className="small muted">{descanso.compuestos === 105 ? '90–120' : descanso.compuestos} s {t('básicos')} · {descanso.aislamiento} s {t('resto')}</span>
      </div>
      <div className="row between plan-dia">
        <span>{t('Esfuerzo')}</span>
        <span className="small muted">{esfuerzo.nombre} <Info label={t('¿Qué es {0}?', esfuerzo.nombre)} onClick={() => infoSheet(esfuerzo.nombre, [
          esfuerzo.explicacion,
          t('Ejemplo: si con un peso podrías hacer 12 reps como máximo y hacés 10, te quedaron 2 en reserva.'),
        ])} /></span>
      </div>
      <div className="row between plan-dia">
        <span>{t('Progresión')}</span>
        <span className="small muted">{progresion.nombre} <Info label={t('¿Cómo funciona la progresión?')} onClick={() => infoSheet(progresion.nombre, [
          progresion.explicacion,
          t('La app te sugiere el peso y las reps de cada serie según lo que hiciste la vez anterior.'),
        ])} /></span>
      </div>
      <div className="row between plan-dia" style={{ borderBottom: 0 }}>
        <span>{t('Primer día')}</span>
        <span className="small muted plan-texto">{t('Elegí un peso con el que llegues a las reps dejando 2 en reserva.')}</span>
      </div>
    </div>
  </div>
}
