import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, healthOff } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, weeklyTarget, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, bwDeltaColor, confirmSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { startTourA } from '../lib/onboarding.js'
import { api } from '../lib/api.js'
import ProgramPicker, { programsOf } from '../components/ProgramPicker.jsx'
import { cachedBranding } from '../lib/branding.js'
import HomeClassCard from '../components/HomeClassCard.jsx'
import { useMyClasses } from '../components/useMyClasses.js'
import { classesByDate, classOverlap } from '../lib/classes.js'
import { isClassWorkout } from '../lib/workout-history.js'
import { loadOfRoutine, MUSCLE_NAME } from '../lib/muscles.js'


// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const brand = useStore(s => s.config?.branding) ?? cachedBranding()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const noHealth = useStore(healthOff)   // sin consentimiento de datos de salud: sin peso corporal
  // Programas del gym para el cartel de bienvenida (se piden solo mientras no hay rutinas).
  const [presetData, setPresetData] = useState(null)
  useEffect(() => { if (S.routines.length === 0) api('/api/presets').then(setPresetData).catch(() => {}) }, [S.routines.length])
  const [weekOffset, setWeekOffset] = useState(0)
  // Clases del socio (reservadas y hechas) por fecha: el punto de clase en la semana y "Hoy".
  const myClasses = useMyClasses()

  useEffect(() => {
    if (user && !S.onboardingCompletado) {
      setTimeout(() => startTourA(nav), 600)
    }
  }, [user, S.onboardingCompletado, nav])

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const classDays = classesByDate(myClasses?.occurrences, S.workouts)
  // The last session logged for today, if any — what the row below reports instead of asking
  // you to start the one you already did. Last wins, so a second session names itself.
  // Una clase no reemplaza la rutina planeada: con rutina, solo un entreno que no sea clase la da
  // por hecha; sin rutina, la clase hecha es lo de hoy.
  const todayWorkouts = S.workouts.filter(w => w.d === todayISO())
  const doneToday = todayWorkouts.filter(w => !isClassWorkout(w)).at(-1) || (routine ? null : todayWorkouts.at(-1)) || null
  // Las clases de hoy que no son la que ya se muestra como hecha, y si cargan lo mismo que la rutina.
  const classesToday = (classDays[todayISO()] || []).filter(c => !doneToday || c.workout?.id !== doneToday.id)
  const pendingRoutine = routine && !doneToday && !S.active ? routine : null
  const overlap = pendingRoutine ? classesToday.map(c => ({ c, slugs: classOverlap(c.occ?.log?.muscles || c.workout?.muscleLoad?.muscles, loadOfRoutine(pendingRoutine)) })).find(x => x.slugs.length) : null
  const muscleList = slugs => { const names = slugs.slice(0, 2).map(s => t(MUSCLE_NAME[s] || s).toLowerCase()); return names.length > 1 ? t('{0} y {1}', names[0], names[1]) : names[0] }
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    const cls = classDays[iso]?.[0]
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div>
      <div className="dots"><div className={'dot' + dot} />{cls && <div className="dot cls" style={{ background: cls.color || 'var(--acc)' }} title={cls.name} />}</div></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const thisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO()))
  const wThisWeek = thisWeek.length
  const classesThisWeek = thisWeek.filter(isClassWorkout).length
  // El mismo objetivo que la racha (con grupos de rutinas); las clases cuentan como entrenos.
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const plannedPerWeek = weeklyTarget(S, thisMonday)
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }

  // Cartel de bienvenida: solo hasta que el socio empieza su plan. planIniciado (persistido en el
  // servidor, se prende al tener una rutina, elegir un programa o descartar el cartel) no se
  // apaga, así que borrar todas las rutinas no lo trae de vuelta: queda el estado vacío de Plan.
  // Guardas para un estado local de antes del flag (hasta que baje el del servidor): ya eligió un
  // camino (estadoInicial) o ya entrenó.
  const surveyEnabled = config?.survey_enabled !== false   // default true si config aún no cargó
  const mostrarBienvenida = !S.active && !S.planIniciado && S.routines.length === 0
    && (S.estadoInicial || 'pendiente') === 'pendiente' && !(S.workouts || []).length

  const irAlPlan = () => {
    useStore.getState().update(st => { st.estadoInicial = 'plan_manual'; st.planIniciado = true })
    nav('/plan')
  }
  const descartarBienvenida = () => useStore.getState().update(st => { st.planIniciado = true })

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : (brand?.appName || 'lauyim')}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" data-tour="settings-btn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      {/* Once today's session is logged the row stops asking for it. The week strip already
          knew (its dot goes 'done'); this row did not, so a finished day kept showing the
          routine name behind a green Start tag and read as still outstanding (issue #4).
          An in-progress session still wins — that one is happening right now. Tapping the
          row keeps working, so a second session in one day is a tap away, just not urged. */}
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
              style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name)
              : doneToday ? (doneToday.name ? t('{0} — done', doneToday.name) : t('Workout done'))
              : routine ? routine.name : t('Rest day')}{todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''}</div>
            {classesToday.length > 0 && <div className="today-classes small">
              <span className="muted">{routine || doneToday ? t('También hoy:') : t('Hoy:')}</span>{' '}
              {classesToday.map((c, i) => <span key={c.key} className="today-class">{i > 0 && ', '}<i style={{ background: c.color || 'var(--acc)' }} />{c.name}{c.start ? ' ' + c.start : ''}{c.done ? ' ✓' : ''}</span>)}
            </div>}
            {overlap && <div className="today-overlap small">{t('{0} también trabaja {1}.', overlap.c.name, muscleList(overlap.slugs))}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
    </div>

    <HomeClassCard />

    {mostrarBienvenida && (
      <div className="card" data-tour="welcome">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22, flex: 1 }}>{t('Welcome!')}</div>
          <button type="button" className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={descartarBienvenida}
            aria-label={t('Cerrar bienvenida')} title={t('Cerrar')}><Icon name="xmark" /></button>
        </div>
        <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {t('Configurá tu rutina semanal para empezar.')}
        </div>
        {surveyEnabled && (
          <>
            <Button variant="primary" icon="sparkles" onClick={() => nav('/onboarding/encuesta')} style={{ width: '100%' }}>
              {t('Recomendarme una rutina')}
            </Button>
            <div style={{ height: 10 }} />
          </>
        )}
        {programsOf(presetData).length > 0 && <>
          <div className="muted small" style={{ margin: '8px 0 6px' }}>{surveyEnabled ? t('O elegí uno de los programas del gimnasio') : t('Elegí uno de los programas del gimnasio')}</div>
          <ProgramPicker data={presetData} />
          <div style={{ height: 8 }} />
        </>}
        <button
          style={{ background: 'none', border: 'none', color: 'var(--acc)', fontSize: '0.93rem', cursor: 'pointer', width: '100%', padding: '6px 0', textAlign: 'center' }}
          onClick={irAlPlan}
        >
          {t('Crear rutina manualmente')}
        </button>
      </div>
    )}


    {!noHealth && <div className="card" data-tour="bw-card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>}

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')}{classesThisWeek ? ' · ' + (classesThisWeek === 1 ? t('1 clase') : t('{0} clases', classesThisWeek)) : ''} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>
  </div>
}
