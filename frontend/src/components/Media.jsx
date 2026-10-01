import { useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { mediaKindFor, exerciseGifsOn } from '../lib/exercise-media.js'
import { musclesOf } from '../lib/muscles.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import BodyMap from './BodyMap.jsx'

// Si los gifs del catálogo están encendidos (EXERCISE_GIFS en el .env de la instancia).
export const useExerciseGifs = () => exerciseGifsOn(useStore(s => s.config))

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Sin gif (ejercicios creados por un socio o por el staff, o el catálogo con EXERCISE_GIFS=0) va el
// mapa muscular en el mismo lugar y del mismo tamaño: ver lib/exercise-media.js.
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
//
// `steps` (las instrucciones del ejercicio): botón "Ver instrucciones" en la esquina del gif; al
// tocarlo, la lista se despliega debajo con animación y se vuelve a plegar. No pausa el gif.
export default function Media({ ex, id, compact, minimizable, steps }) {
  const [playing, setPlaying] = useState(true)
  const [showSteps, setShowSteps] = useState(false)
  const gifSize = useStore(s => s.S.gifSize)
  const body = useStore(s => s.S.body)
  const update = useStore(s => s.update)
  const kind = mediaKindFor(ex, useExerciseGifs())
  if (!kind) return null
  const isGif = kind === 'gif'
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const hasSteps = Array.isArray(steps) && steps.length > 0
  const stepsId = 'steps-' + ex.id
  return (<>
    <div className={'exmedia' + (isGif ? '' : ' exmap') + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (hasSteps && showSteps ? ' with-steps' : '')}
      id={id} onClick={isGif ? () => setPlaying(p => !p) : undefined}>
      {hasSteps && (
        <button type="button" className="gifsteps" aria-expanded={showSteps} aria-controls={stepsId}
          onClick={e => { e.stopPropagation(); setShowSteps(v => !v) }}>
          <Icon name="list" />{showSteps ? t('Ocultar instrucciones') : t('Ver instrucciones')}
        </button>
      )}
      {isGif
        ? <img decoding="async" src={playing ? gifSrc(ex) : imgSrc(ex)} alt={exerciseNameFor(ex)} />
        : <BodyMap load={musclesOf(ex)} body={body} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {isGif && !mini && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
    {hasSteps && <div className={'exsteps' + (showSteps ? ' open' : '')} id={stepsId} aria-hidden={!showSteps}>
      <div className="exsteps-in"><ol className="steps-list">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
    </div>}
  </>)
}

export function Thumb({ ex }) {
  const gifsOn = useExerciseGifs()
  if (!ex || !ex.img || !gifsOn) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={imgSrc(ex)} alt="" />
}
