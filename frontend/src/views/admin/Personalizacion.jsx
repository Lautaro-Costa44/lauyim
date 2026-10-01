import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { ACCENTS } from '../../lib/format.js'
import { contrastWarnings, shortNameFor, DEFAULT_APP_NAME, MAX_SHORT_NAME } from '../../lib/branding.js'
import { checkLogoFile, loadImage, analyzeImage, defaultIconBackground, renderIcons } from '../../lib/branding-image.js'
import { Button, Switch, TextField } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import BrandingPreview from '../../components/BrandingPreview.jsx'
import { confirmSheet } from '../../sheets.jsx'

// Admin → Personalización (solo el owner): nombre de la app, frase del login, logo y color del gym,
// con vista previa antes de guardar (api/branding.js, lib/branding.js, lib/branding-image.js).
const DEFAULT_TAGLINE = 'Tus entrenamientos. Tus pesos. Tus perfiles.'
const ICON_FILES = ['logo.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']
const FACTORY_ICONS = { 'logo.png': 'logo-perf.svg?v=3', 'icon-192.png': 'icon-192.png?v=3', 'icon-512.png': 'icon-512.png?v=3', 'icon-maskable-512.png': 'icon-512.png?v=3', 'apple-touch-icon.png': 'icon-180.png?v=3' }
const draftOf = b => ({ appName: b.appName, shortName: b.shortName || '', tagline: b.tagline || '', color: b.color, lockColor: !!b.lockColor })

export default function Personalizacion() {
  const toast = useUI(s => s.toast)
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  // logo: { kind: 'saved' | 'new' | 'none', img?, analysis?, background?, icons?, blurry? }
  const [logo, setLogo] = useState({ kind: 'saved' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    api('/api/owner/branding').then(d => { setSaved(d.branding); setDraft(draftOf(d.branding)) })
      .catch(e => toast(errorText(e, t('Failed to load'))))
  }, [])

  // Íconos que se ven (vista previa y miniaturas): los nuevos, los guardados o los de fábrica.
  const icons = useMemo(() => {
    if (logo.kind === 'new') return logo.icons
    if (logo.kind === 'saved' && saved?.logo) return Object.fromEntries(ICON_FILES.map(n => [n, `/api/branding/${n}?v=${saved.logo}`]))
    return FACTORY_ICONS
  }, [logo, saved])

  if (!draft) return <div className="dim small">{t('Loading…')}</div>

  const set = patch => { setDraft(d => ({ ...d, ...patch })); setErrors({}) }
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved)) || logo.kind === 'new' || (logo.kind === 'none' && !!saved.logo)
  const warnings = draft.color ? contrastWarnings(draft.color) : []

  const pickFile = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const bad = checkLogoFile(file)
    if (bad) return toast(t(bad.error))
    try {
      const img = await loadImage(file)
      const { analysis, crop, small, blurry } = analyzeImage(img)
      if (small) return toast(t('El logo tiene que medir al menos 192 px de lado'))
      const background = defaultIconBackground(analysis)
      setLogo({ kind: 'new', img, analysis, crop, background, blurry, icons: renderIcons(img, background, crop) })
    } catch (err) { toast(errorText(err, t('No se pudo leer la imagen'))) }
  }
  const setBackground = background => setLogo(l => ({ ...l, background, icons: renderIcons(l.img, background, l.crop) }))

  const save = async () => {
    setBusy(true)
    try {
      const body = { ...draft, ...(logo.kind === 'new' ? { assets: logo.icons } : {}), ...(logo.kind === 'none' && saved.logo ? { removeLogo: true } : {}) }
      const { branding } = await api('/api/owner/branding', { method: 'PUT', body: JSON.stringify(body) })
      applyLive(branding)
      setSaved(branding); setDraft(draftOf(branding)); setLogo({ kind: 'saved' })
      toast(t('Personalización guardada'))
    } catch (e) {
      if (e?.data?.field) setErrors({ [e.data.field]: e.data.message })
      toast(errorText(e, t('No se pudo guardar')))
    }
    setBusy(false)
  }
  const reset = () => confirmSheet({
    title: t('¿Volver a lauyim?'),
    message: t('Se borran el nombre, la frase, el logo y el color del gym, y la app vuelve a verse como lauyim.'),
    confirmText: t('Volver a lauyim'), danger: true,
    onConfirm: async () => {
      try {
        const { branding } = await api('/api/owner/branding/reset', { method: 'POST', body: '{}' })
        applyLive(branding)
        setSaved(branding); setDraft(draftOf(branding)); setLogo({ kind: 'saved' })
        toast(t('La app volvió a lauyim'))
      } catch (e) { toast(errorText(e, t('No se pudo guardar'))) }
    }
  })

  const hasLogo = logo.kind === 'new' || (logo.kind === 'saved' && !!saved.logo)
  const bgChoices = logo.kind === 'new' ? [...new Set([defaultIconBackground(logo.analysis), '#ffffff', '#000000', draft.color].filter(Boolean))] : []

  return <div className="branding-admin">
    <div className="card">
      <h2>{t('Personalización')}</h2>
      <p className="small muted">{t('Cómo se ve la app de tu gimnasio: nombre, logo y color. Lo ven todos, también antes de iniciar sesión.')}</p>
    </div>

    <div className="card">
      <h3 className="branding-h">{t('Nombre y frase')}</h3>
      <div className="member-form">
        <label className="member-field">
          <span className="member-field-l">{t('Nombre de la app')} <span className="dim">{draft.appName.length}/30</span></span>
          <TextField type="text" inputMode="text" name="app-brand-name" maxLength={30} value={draft.appName}
            aria-invalid={!!errors.appName} onChange={e => set({ appName: e.target.value })} />
          {errors.appName && <span className="form-error" role="alert">{errors.appName}</span>}
        </label>
        <label className="member-field">
          <span className="member-field-l">{t('Nombre bajo el ícono')} <span className="dim">{t('(Android y iPhone cortan los nombres largos)')}</span></span>
          <TextField type="text" inputMode="text" name="app-brand-short" maxLength={MAX_SHORT_NAME} value={draft.shortName}
            placeholder={shortNameFor({ appName: draft.appName })} aria-invalid={!!errors.shortName} onChange={e => set({ shortName: e.target.value })} />
          {errors.shortName && <span className="form-error" role="alert">{errors.shortName}</span>}
        </label>
        <label className="member-field">
          <span className="member-field-l">{t('Frase del login')} <span className="dim">{draft.tagline.length}/80</span></span>
          <TextField type="text" inputMode="text" name="app-brand-tagline" maxLength={80} value={draft.tagline}
            placeholder={t(DEFAULT_TAGLINE)} aria-invalid={!!errors.tagline} onChange={e => set({ tagline: e.target.value })} />
          {errors.tagline && <span className="form-error" role="alert">{errors.tagline}</span>}
        </label>
        {draft.appName.trim() && draft.appName.trim() !== DEFAULT_APP_NAME && <div className="small dim">{t('En el login aparece "con lauyim", y los términos y el aviso de privacidad aclaran que lauyim provee la app.')}</div>}
      </div>
    </div>

    <div className="card">
      <h3 className="branding-h">{t('Logo')}</h3>
      <div className="branding-logo-row">
        <div className="branding-icons">
          <figure><img className="bi-android" src={icons['icon-maskable-512.png']} alt="" /><figcaption>Android</figcaption></figure>
          <figure><img className="bi-iphone" src={icons['apple-touch-icon.png']} alt="" /><figcaption>iPhone</figcaption></figure>
          <figure><span className="bi-login"><img src={icons['logo.png']} alt="" /></span><figcaption>{t('Login')}</figcaption></figure>
        </div>
        <div className="branding-logo-actions">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={pickFile} />
          <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>{hasLogo ? t('Cambiar logo') : t('Subir logo')}</Button>
          {hasLogo && <Button size="sm" variant="ghost" className="dim" onClick={() => setLogo({ kind: 'none' })}>{t('Quitar logo')}</Button>}
          <div className="small dim">{t('PNG o JPG, cuadrado y de 512 px o más. Si no es cuadrado, se centra entero.')}</div>
        </div>
      </div>
      {logo.kind === 'new' && <div className="branding-bg">
        <div className="small">{logo.analysis.transparent
          ? t('Tu logo tiene fondo transparente: elegí el color de fondo de los íconos (iPhone no admite transparencia).')
          : t('Tu imagen tiene fondo propio: lo extendimos para que llene el ícono. Podés cambiarlo.')}</div>
        {logo.blurry && <div className="access-warn small" role="note">{t('La imagen mide menos de 512 px: el ícono puede verse borroso.')}</div>}
        <div className="swatches">
          {bgChoices.map(c => <button key={c} type="button" className={'swatch' + (logo.background === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => setBackground(c)} />)}
          <label className="swatch swatch-picker" title={t('Otro color')}>
            <input type="color" value={logo.background} onChange={e => setBackground(e.target.value)} aria-label={t('Fondo de los íconos')} />
            <Icon name="plus" />
          </label>
        </div>
      </div>}
      {errors.logo && <span className="form-error" role="alert">{errors.logo}</span>}
    </div>

    <div className="card">
      <h3 className="branding-h">{t('Color del gimnasio')}</h3>
      <div className="swatches">
        <button type="button" className={'swatch swatch-none' + (!draft.color ? ' on' : '')} aria-label={t('Sin color propio')} title={t('Sin color propio: cada usuario elige')} onClick={() => set({ color: null, lockColor: false })} />
        {Object.values(ACCENTS).map(c => <button key={c} type="button" className={'swatch' + (draft.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => set({ color: c })} />)}
        <label className={'swatch swatch-picker' + (draft.color && !Object.values(ACCENTS).includes(draft.color) ? ' on' : '')}
          style={draft.color && !Object.values(ACCENTS).includes(draft.color) ? { background: draft.color } : undefined} title={t('Elegir cualquier color')}>
          <input type="color" value={draft.color || '#30d158'} onChange={e => set({ color: e.target.value })} aria-label={t('Elegir cualquier color')} />
          <Icon name="plus" />
        </label>
      </div>
      {draft.color && <div className="branding-hex small dim">{draft.color.toUpperCase()}</div>}
      {warnings.length > 0 && <div className="access-warn small" role="note">{warnings.includes('light') && warnings.includes('dark')
        ? t('Este color se lee mal en modo claro y en modo oscuro.')
        : warnings.includes('light') ? t('Este color se lee poco sobre el fondo del modo claro.') : t('Este color se lee poco sobre el fondo del modo oscuro.')}</div>}
      <div className="branding-lock">
        <div>
          <div>{t('Usar solo el color del gimnasio')}</div>
          <div className="small dim">{draft.lockColor
            ? t('Nadie ve la paleta de colores en Ajustes: toda la app usa el color del gimnasio.')
            : t('Cada usuario puede elegir otro color en Ajustes; el del gimnasio es el de entrada.')}</div>
        </div>
        <Switch checked={draft.lockColor} disabled={!draft.color} onChange={v => set({ lockColor: v })} label={t('Usar solo el color del gimnasio')} />
      </div>
    </div>

    <div className="small dim branding-note">{t('El ícono y el nombre de la app instalada: Android los actualiza solo en unos días; en iPhone, quien ya la instaló tiene que volver a instalarla. Conviene definirlos antes de que los socios la instalen.')}</div>

    <div className="card branding-reset">
      <div className="small dim">{t('Volver a como viene lauyim: sin nombre, frase, logo ni color propios.')}</div>
      <Button size="sm" variant="ghost" className="dim" disabled={busy} onClick={reset}>{t('Volver a lauyim')}</Button>
    </div>

    <div className="branding-actions">
      <Button icon="sparkles" onClick={() => setPreview(true)}>{t('Vista previa')}</Button>
      <Button variant="primary" disabled={busy || !dirty} onClick={save}>{busy ? t('Guardando…') : t('Guardar')}</Button>
    </div>

    {preview && <BrandingPreview draft={draft} icons={icons} onClose={() => setPreview(false)} />}
  </div>
}

// La app de quien está guardando cambia en el acto (los demás la ven al abrir la app).
function applyLive(branding) {
  useStore.setState(s => ({ config: { ...(s.config || {}), branding } }))
  try {
    const cfg = JSON.parse(localStorage.getItem('gym_config') || '{}')
    localStorage.setItem('gym_config', JSON.stringify({ ...cfg, branding }))
  } catch { /* storage off */ }
}
