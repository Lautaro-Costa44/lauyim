import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import RoutineEditor from './RoutineEditor.jsx'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = (S.routines || []).find(x => x.id === id)

  useEffect(() => {
    if (!r) nav('/plan')
  }, [r, nav])

  useEffect(() => () => {
    try { useStore.getState().autoBackupNow() } catch (e) { /* fallback */ }
  }, [])

  if (!r) return null

  return <RoutineEditor
    routine={r}
    S={S}
    update={fn => update(s => fn(s.routines || (s.routines = [])))}
    onBack={() => nav('/plan')}
    onDeleted={() => {
      update(s => {
        s.routines = (s.routines || []).filter(x => x.id !== id)
        Object.keys(s.week || {}).forEach(k => { if (s.week[k] === id) delete s.week[k] })
        Object.keys(s.dayPlan || {}).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
      })
      nav('/plan')
    }}
  />
}
