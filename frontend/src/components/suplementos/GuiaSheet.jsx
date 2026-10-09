// Guía de suplementos (spec, "Guía (contenido)"): agua arriba, lista por nivel y la ficha de cada uno
// en una sola página con lo práctico primero y las precauciones siempre a la vista. En PC, lista y
// ficha lado a lado.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { lastBW } from '../../lib/history.js'
import { SUPLEMENTOS, LEVELS, WATER_TIP, fichaById } from '../../lib/suplementos-data.js'
import { caffeineRange } from '../../lib/suplementos.js'
import { Button } from '../ui.jsx'

const FEM_TAKE = new Set(['creatina', 'cafeina', 'proteina', 'betaalanina', 'vitaminad'])
const howToTitle = id => FEM_TAKE.has(id) ? 'Cómo tomarla' : 'Cómo tomarlo'
const openConfig = id => import('./ConfigSuplemento.jsx').then(m => m.openConfig(id))

function Ficha({ id, onBack }) {
  const f = fichaById(id)
  const S = useStore(s => s.S)
  const minor = useSupplements(s => s.adult === 'minor')
  const mine = useSupplements(s => s.items.find(i => i.catalogId === id && i.status === 'active'))
  if (!f) return null
  const range = id === 'cafeina' ? caffeineRange(lastBW(S)?.w) : null
  const Sec = ({ title, children }) => <><div className="supp-sec">{t(title)}</div><div className="supp-box">{children}</div></>
  return <div className="supp-ficha">
    {onBack && <button type="button" className="link supp-back" onClick={onBack} aria-label={t('Volver a la lista')}>‹ {t('Guía')}</button>}
    <h3>{f.name}</h3>
    <span className="supp-level" style={{ '--lvl': LEVELS[f.level].color }}>{LEVELS[f.level].label.toUpperCase()}{f.ais ? ' · AIS ' + f.ais : ''}</span>
    {f.badge && <span className="supp-pill">{f.badge}</span>}
    <p className="dim">{f.intro}</p>
    {minor ? <Sec title={howToTitle(id)}>{t('No recomendado para menores de 18 sin supervisión profesional.')}</Sec>
      : f.howTo?.length > 0 && <Sec title={howToTitle(id)}>
        {f.howTo.map((h, i) => <div key={i} className="supp-how"><span aria-hidden="true">{h.icon}</span><span>{h.text}</span></div>)}
        {id === 'cafeina' && <div className="supp-how"><span aria-hidden="true">🎯</span><span>{range
          ? `Para tus ${Math.round(lastBW(S).w)} kg: ${range.min} a ${range.max} mg (empezá por lo más bajo). Más de 200 mg de una vez supera la referencia de EFSA para una sola toma.`
          : 'Cargá tu peso para ver el rango para vos.'}</span></div>}
      </Sec>}
    {!minor && f.loading && <div className="supp-box supp-loading">⚡ {f.loading}</div>}
    <Sec title="Qué dice la evidencia">{f.evidence}</Sec>
    <Sec title="Para quién sirve">{f.forWhom}</Sec>
    {f.notice && <Sec title="Qué podés notar">{f.notice}</Sec>}
    <Sec title="Precauciones"><ul className="supp-list">{f.cautions.map(c => <li key={c}>{c}</li>)}</ul></Sec>
    <Sec title="Comprar con criterio">{f.buy}</Sec>
    <div className="supp-sec">{t('Fuentes')}</div>
    <div className="small dim">{f.sources.join(' · ')}<br />{t('Revisado: {0}', f.reviewed)}</div>
    {f.trackable && !minor && (mine
      ? <Button onClick={() => openConfig(id)}>{t('Ya lo tomás · Configurar')}</Button>
      : <Button variant="primary" icon="plus" onClick={() => openConfig(id)}>{t('Agregar a mis suplementos')}</Button>)}
  </div>
}

function Lista({ selected, onPick }) {
  const genero = useStore(s => s.S.genero)
  const items = useSupplements(s => s.items)
  const has = id => items.some(i => i.catalogId === id && i.status === 'active')
  const water = genero === 'femenino' ? WATER_TIP.mujeres : genero === 'masculino' ? WATER_TIP.hombres : WATER_TIP.ambos
  const levels = Object.entries(LEVELS).sort((a, b) => a[1].order - b[1].order)
  return <div className="supp-list-col">
    <h3>{t('Guía de suplementos')}</h3>
    <div className="small dim">{t('Basado en IOC, AIS, ISSN, NIH y EFSA')}</div>
    <div className="supp-water">💧 {water}</div>
    {levels.map(([lvl, info]) => <div key={lvl}>
      <div className="supp-lvl-title" style={{ '--lvl': info.color }}><i />{info.label}</div>
      {SUPLEMENTOS.filter(f => f.level === lvl).map(f => <button key={f.id} type="button" className={'supp-item' + (selected === f.id ? ' sel' : '')} onClick={() => onPick(f.id)}>
        <div className="grow"><b>{f.name}</b><div className="small dim">{lvl === 'puntual' ? t('Solo información') : f.short}</div></div>
        {has(f.id) && <span className="supp-mine">✓ {t('la tomás')}</span>}
      </button>)}
    </div>)}
    <button type="button" className="supp-item supp-other" onClick={() => openConfig(null)}>＋ {t('Otro suplemento (cargalo vos)')}</button>
  </div>
}

function Guia({ initial }) {
  const [id, setId] = useState(initial)
  return <div className="supp-guide-cols">
    <div className={id ? 'supp-hide-phone' : ''}><Lista selected={id} onPick={setId} /></div>
    <div className={id ? '' : 'supp-hide-phone'}>{id ? <Ficha id={id} onBack={() => setId(null)} /> : <div className="dim supp-empty-pc">{t('Elegí un suplemento para ver su ficha.')}</div>}</div>
  </div>
}

export const openGuide = id => useUI.getState().openSheet(() => <Guia initial={id} />, { fullScreen: true })
