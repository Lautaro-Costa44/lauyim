import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { WorkoutDetail, workoutDetailSheet } from '../sheets.jsx'
import WorkoutHistoryList from '../components/workout/WorkoutHistoryList.jsx'
import { useDesktop } from './admin/useDesktop.js'
import Icon from '../components/Icon.jsx'
import { classesApi, liveClasses } from '../lib/classes.js'
import { classSheet } from '../components/ClassSheet.jsx'

// Historial del socio: agrupado por mes, con filtros. En escritorio el entreno elegido se ve al
// lado; en tablet y celular se abre como panel (hoja desde abajo en el celular).
export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const desktop = useDesktop()
  const [selectedId, setSelectedId] = useState(null)
  const selected = desktop ? S.workouts.find(w => w.id === selectedId) : null
  const open = w => desktop ? setSelectedId(w.id) : workoutDetailSheet(w)
  const classesOn = useStore(s => !!s.config?.classes_available)
  // Clases en curso del socio ("Ahora", arriba): las de hoy, revisadas cada minuto.
  const [today, setToday] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!classesOn) return
    const load = () => classesApi.list().then(setToday).catch(() => {})
    load()
    const id = setInterval(() => { setNow(Date.now()); load() }, 60000)
    return () => clearInterval(id)
  }, [classesOn])
  const live = today ? liveClasses(today.occurrences, now, today.tz) : []
  const openLive = o => classSheet(o, { today: today.today, tz: today.tz, cancelHours: today.settings?.cancelHours ?? 2 })
  const data = { workouts: S.workouts, routines: S.routines, unit: S.unit, classesOn, live }
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('History')}</h1><div className="sub">{t('{0} workouts', S.workouts.length)}</div></div></div>
    <div className={desktop ? 'wh-split' : undefined}>
      <WorkoutHistoryList data={data} selectedId={selected?.id} onOpen={open} onOpenLive={openLive} />
      {desktop && S.workouts.length > 0 && <div className="card wh-split-detail">
        {/* keyed: otro entreno arranca con su propia nota, nunca con la del anterior */}
        {selected ? <WorkoutDetail key={selected.id} w={selected} close={() => setSelectedId(null)} />
          : <div className="empty">{t('Elegí un entreno para ver el detalle')}</div>}
      </div>}
    </div>
  </>
}
