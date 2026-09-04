import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startTourA, startTourB } from '../lib/onboarding.js'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ } from '../lib/format.js'
import { effortOf } from '../lib/history.js'
import { POLICIES, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import Stepper from '../components/Stepper.jsx'
import { api, webauthnOK, passkeyLogin, passkeyRegister, passkeyAddCredential, IS_ANDROID } from '../lib/api.js'
import { supportSheet } from '../sheets.jsx'

function ClaimDeviceSheet({ close }) {
  const toast = useUI(s => s.toast)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(null)
  const [loading, setLoading] = useState(false)

  const checkCode = async () => {
    const c = code.trim().toUpperCase()
    if (!c) { toast(t('Ingresa un código')); return }
    setLoading(true)
    try {
      const res = await api('/api/auth/device/claim', { method: 'POST', body: JSON.stringify({ code: c }) })
      setPending(res)
    } catch (e) {
      toast(e.message || t('Código no válido o expirado'))
    } finally {
      setLoading(false)
    }
  }

  const confirmPairing = async () => {
    if (!pending) return
    setLoading(true)
    try {
      await api('/api/auth/device/confirm', { method: 'POST', body: JSON.stringify({ pairingId: pending.pairingId }) })
      toast(t('¡Dispositivo vinculado con éxito!'))
      close()
    } catch (e) {
      toast(e.message || t('Error al confirmar vinculación'))
    } finally {
      setLoading(false)
    }
  }

  return <>
    <h3>{t('Vincular dispositivo')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Ingresá el código corto de 8 caracteres que se muestra en la computadora para iniciarle sesión en tu cuenta.')}
    </div>
    {!pending ? <>
      <input
        className="input"
        placeholder="XXXX-XXXX"
        maxLength={9}
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        style={{ letterSpacing: '.18em', fontWeight: 700, fontSize: 20, textAlign: 'center' }}
      />
      <div style={{ height: 14 }} />
      <Button variant="primary" onClick={checkCode} disabled={loading}>{loading ? t('Verificando...') : t('Verificar código')}</Button>
    </> : <>
      <div className="card" style={{ background: 'var(--surface-2)', padding: 16, margin: '12px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{t('¿Confirmás iniciar sesión?')}</div>
        <div className="muted small">{t('Un nuevo dispositivo está solicitando acceso a tu perfil de lauyim.')}</div>
      </div>
      <Button variant="primary" onClick={confirmPairing} disabled={loading}>{loading ? t('Aprobando...') : t('Aprobar e iniciar sesión')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
  </>
}
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { DEMO, REPO } from '../lib/demo.js'
import { loadStarterPlan, confirmSheet, importFromApp, equipmentProfileSheet } from '../sheets.jsx'
import { routinesFromPresets } from '../lib/starter.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField } from '../components/ui.jsx'
import { LANGS, INSTR_LANGS, getLang, setLang, t } from '../lib/i18n.js'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [presetGroups, setPresetGroups] = useState([])
  useEffect(() => { api('/api/presets').then(d => setPresetGroups(d.groups || [])).catch(() => {}) }, [])
  const selectDefaultGroup = () => useUI.getState().openSheet(close => <>
    <h3>{t('Seleccionar rutina predeterminada')}</h3>
    <div className="list">{presetGroups.map(g => <button key={g.name} className="item" onClick={async () => {
      const d = await api('/api/presets'); const routines = routinesFromPresets((d.presets || []).filter(p => (p.group_name || p.groupName || 'General') === g.name))
      update(s => { s.routines = routines; s.week = {}; routines.forEach((r, i) => { s.week[[1,2,3,4,5,6,0][i]] = r.id }); s.configuracion = { ...(s.configuracion || {}), rutinaPredeterminadaGrupo: g.name } })
      close()
    }}><span className="grow"><div className="tt">{g.name}</div><div className="ss">{g.count} {t('rutinas')}</div></span><Icon name="chevronRight" /></button>)}</div>
    {!presetGroups.length && <div className="dim small">{t('No hay grupos de rutinas creados.')}</div>}
  </>)
  const config = useStore(s => s.config)
  const { update, replaceState, setUser, pullState, pushState, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = 'lauyim-backup-' + todayISO() + '.json'
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not an lauyim backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)
  // Ends the profile's sessions on every device — this one included, so on success it lands in
  // the same place as the plain sign-out above (home, local data cleared). On failure nothing
  // local is touched: still signed in here, and say so rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- account ---------- */}
    <Section title={DEMO ? t('Demo') : t('Account')}>
      {DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host lauyim')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : user ? <>
        <Row icon="personCircle" iconTint="var(--grey)" title={user.name} subtitle={t('Signed in with passkey — data syncs to this profile.')} />
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <Row icon="link" iconTint="var(--blue)" title={t('Vincular otro dispositivo')} subtitle={t('Iniciar sesión en una compu ingresando su código')} accessory="chevron" onClick={() => useUI.getState().openSheet(c => <ClaimDeviceSheet close={c} />)} />
        <Row icon="key" iconTint="var(--acc)" title={t('Agregar otra passkey')} subtitle={t('Registrar una passkey adicional de respaldo')} accessory="chevron" onClick={async () => {
          try {
            await passkeyAddCredential()
            toast(t('¡Nueva passkey agregada con éxito!'))
          } catch (e) {
            if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Error al agregar passkey'))
          }
        }} />
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
      </> : webauthnOK() ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />
      </> : (
        <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
      )}
    </Section>
    {!user && !DEMO && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* ---------- general ---------- */}
    <Section title={t('General')} footer={t('Nota: Cambiar las unidades no transforma los números. La edad y la altura se usan para estimar el gasto calórico en Progreso.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={getLang() || S.lang || 'es'}
        onChange={v => {
          update(s => { s.lang = v })
          setLang(v)
        }}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => update(s => { s.unit = v })} />
      </Row>
      <SelectRow
        icon="target" iconTint="var(--acc)" title={t('Objetivo principal')}
        value={S.objetivo || 'fitness_general'}
        onChange={v => update(s => { s.objetivo = v })}
        options={[
          { value: 'hipertrofia', label: t('Ganar músculo') },
          { value: 'fuerza', label: t('Ganar fuerza') },
          { value: 'perder_grasa', label: t('Perder grasa') },
          { value: 'fitness_general', label: t('Fitness general') },
        ]}
      />
      <Row icon="person" iconTint="var(--orange)" title={t('Edad')}>
        <input
          type="text" inputMode="numeric" className="timef" placeholder="—"
          defaultValue={S.edad ?? ''}
          key={S.edad ?? 'edad'}
          onBlur={e => {
            const n = parseInt(e.target.value, 10)
            update(s => { s.edad = isNaN(n) ? null : Math.max(14, Math.min(90, n)) })
          }}
          style={{ width: 68, textAlign: 'right' }}
        />
        <span className="dim small" style={{ marginLeft: 6 }}>{t('años')}</span>
      </Row>
      <Row icon="figureStrength" iconTint="var(--purple)" title={t('Altura')}>
        <input
          type="text" inputMode="numeric" className="timef" placeholder="—"
          defaultValue={S.altura ?? ''}
          key={S.altura ?? 'altura'}
          onBlur={e => {
            const n = parseInt(e.target.value, 10)
            update(s => { s.altura = isNaN(n) ? null : Math.max(100, Math.min(250, n)) })
          }}
          style={{ width: 68, textAlign: 'right' }}
        />
        <span className="dim small" style={{ marginLeft: 6 }}>cm</span>
      </Row>
    </Section>

    <Section title={t('During a workout')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[{ value: 0, label: t('Off') }, ...[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))]} />

      <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
        subtitle={wakeOK ? null : t('Not supported in this browser.')}>
        <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
          onChange={v => update(s => { s.keepAwake = v })} />
      </Row>

      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        <Switch checked={!!S.sound} onChange={v => update(s => { s.sound = v })} />
      </Row>

      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>

      <SelectRow icon="target" iconTint="var(--purple)" title={t('Tipo de progresión')} sheetTitle={t('Tipo de progresión')}
        value={S.progressionType || 'linear'}
        onChange={v => update(s => {
          s.progressionType = v;
          if (!s.progressionConfig) s.progressionConfig = {};
          if (v === 'linear' && s.progressionConfig.increment_kg == undefined) {
            s.progressionConfig.increment_kg = 2.5;
          } else if (v === 'double') {
            if (s.progressionConfig.rep_range_min == undefined) s.progressionConfig.rep_range_min = 8;
            if (s.progressionConfig.rep_range_max == undefined) s.progressionConfig.rep_range_max = 12;
            if (s.progressionConfig.increment_kg == undefined) s.progressionConfig.increment_kg = 2.5;
          } else if (s.progressionConfig.increment_kg == undefined) {
            s.progressionConfig.increment_kg = 2.5;
          }
          if (v === 'dup') {
            s.progressionConfig.pattern = [
              { day_index: 0, rep_target: 8, intensity_pct: 80 },
              { day_index: 1, rep_target: 10, intensity_pct: 75 },
              { day_index: 2, rep_target: 12, intensity_pct: 70 }
            ];
          }
        })}
        options={POLICIES.filter(p => p !== 'time').map(p => ({ value: p, label: t(POLICY_NAME[p]) }))}
      />

      {POLICY_DESC[S.progressionType || 'linear'] && (
        <div className="muted small" style={{ paddingLeft: 12, paddingRight: 12, marginBottom: 8 }}>
          {t(POLICY_DESC[S.progressionType || 'linear'])}
        </div>
      )}

      {/* Muestra incremento en kg en todos los tipos de progresión excepto en DUP */}
      {S.progressionType !== 'dup' && (
        <Row title={t('Incremento en kg')}>
          <input
            type="number"
            step="0.5"
            min="0.5"
            style={{ width: 80, padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', textAlign: 'right' }}
            value={S.progressionConfig?.increment_kg ?? 2.5}
            onChange={e => {
              const val = parseFloat(e.target.value);
              update(s => {
                if (!s.progressionConfig) s.progressionConfig = {};
                s.progressionConfig.increment_kg = isNaN(val) ? 2.5 : val;
              });
            }}
          />
        </Row>
      )}

      {S.progressionType === 'double' && (
        <Row title={t('Rango de reps')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min="1"
              style={{ width: 50, padding: '6px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', textAlign: 'center' }}
              value={S.progressionConfig?.rep_range_min ?? 8}
              onChange={e => {
                const val = parseInt(e.target.value, 10);
                update(s => {
                  if (!s.progressionConfig) s.progressionConfig = {};
                  s.progressionConfig.rep_range_min = isNaN(val) ? 8 : val;
                });
              }}
            />
            <span>-</span>
            <input
              type="number"
              min="1"
              style={{ width: 50, padding: '6px 8px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', textAlign: 'center' }}
              value={S.progressionConfig?.rep_range_max ?? 12}
              onChange={e => {
                const val = parseInt(e.target.value, 10);
                update(s => {
                  if (!s.progressionConfig) s.progressionConfig = {};
                  s.progressionConfig.rep_range_max = isNaN(val) ? 12 : val;
                });
              }}
            />
          </div>
        </Row>
      )}

      <SelectRow icon="flame" iconTint="var(--pink)" title={t('Intensificador por defecto')} sheetTitle={t('Intensificador')}
        value={S.defaultIntensifier?.type || 'none'}
        onChange={v => update(s => {
          s.defaultIntensifier = !v || v === 'none' ? { type: 'none' } : v === 'dropset'
            ? { type: 'dropset', count: 1, pct: 80, dropRestSec: 5 }
            : v === 'topback'
            ? { type: 'topback', count: 2, pct: 80, backoffReps: 10 }
            : { type: 'restpause', totalReps: 10, restSec: s.restPauseSec || 20 };
        })}
        options={[
          { value: 'none', label: t('Ninguno') },
          { value: 'dropset', label: t('Drop-set') },
          { value: 'topback', label: t('Top-set + Backoff') },
          { value: 'restpause', label: t('Rest-pause') },
        ]}
      />

      {S.defaultIntensifier?.type === 'dropset' && <div className="row cfgrow" style={{ marginBottom: 8, paddingLeft: 12 }}>
        <Stepper label={t('Drops')} value={S.defaultIntensifier.count ?? 1} step={1} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, count: Math.max(1, v) } })} />
        <Stepper label={t('Weight drop (%)')} value={S.defaultIntensifier.pct ?? 80} step={5} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, pct: Math.max(5, v) } })} />
      </div>}

      {S.defaultIntensifier?.type === 'topback' && <div className="row cfgrow" style={{ marginBottom: 8, paddingLeft: 12 }}>
        <Stepper label={t('Backoff sets')} value={S.defaultIntensifier.count ?? 2} step={1} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, count: Math.max(1, v) } })} />
        <Stepper label={t('Weight drop (%)')} value={S.defaultIntensifier.pct ?? 80} step={5} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, pct: Math.max(5, v) } })} />
        <Stepper label={t('Backoff reps')} value={S.defaultIntensifier.backoffReps ?? 10} step={1} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, backoffReps: Math.max(1, v) } })} />
      </div>}

      {S.defaultIntensifier?.type === 'restpause' && <div className="row cfgrow" style={{ marginBottom: 8, paddingLeft: 12 }}>
        <Stepper label={t('Rest-pause reps')} value={S.defaultIntensifier.totalReps ?? 10} step={1} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, totalReps: Math.max(1, v) } })} />
        <Stepper label={t('Rest (s)')} value={S.defaultIntensifier.restSec ?? 20} step={5} decimal={false}
          onChange={v => update(s => { s.defaultIntensifier = { ...s.defaultIntensifier, restSec: Math.max(5, v) } })} />
      </div>}

      {/* <Row icon="list" iconTint="var(--blue)" title={t('Series por ejercicio (por defecto)')}>
        <div style={{ maxWidth: 110 }}>
          <Stepper value={S.defaultSets ?? 3} min={1} max={6} step={1} decimal={false}
            onChange={v => update(s => { s.defaultSets = Math.max(1, Math.min(6, v)) })} />
        </div>
      </Row> */}
    </Section>

    {user && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- equipment ---------- */}
    <EquipmentCard S={S} update={update} />

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[
            { value: 'dark', icon: 'moon', label: t('Dark') },
            { value: 'light', icon: 'sun', label: t('Light') },
            { value: 'system', icon: 'gear', label: t('System') },
          ]}
          value={S.theme || 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body || (S.genero === 'femenino' ? 'female' : 'male')}
          onChange={v => update(s => {
            s.body = v
            s.genero = v === 'female' ? 'femenino' : 'masculino'
          })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <Section title={t('Data')}>
      {config?.survey_enabled !== false && (
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Volver a hacer la encuesta')}
          subtitle={t('Regenera tu rutina con respuestas actualizadas.')}
          accessory="chevron"
          onClick={() => confirmSheet({
            title: t('¿Reemplazar tu rutina actual?'),
            message: t('La nueva encuesta va a reemplazar tu rutina recomendada. Tus entrenamientos registrados no se modifican.'),
            confirmText: t('Continuar'),
            onConfirm: () => nav('/onboarding/encuesta'),
          })}
        />
      )}
      <Row icon="folder" iconTint="var(--acc)" title={t('Seleccionar rutina predeterminada')} subtitle={t('Elegí un grupo creado por los administradores.')} accessory="chevron" onClick={selectDefaultGroup} />
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load starter plan (PPL)')} accessory="chevron" onClick={loadStarterPlan} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      <Row icon="sparkles" iconTint="var(--indigo)" title={t('Tutorial: Primeros pasos')} subtitle={t('Repasá las funciones principales de la app.')} accessory="chevron" onClick={() => { nav('/home'); setTimeout(() => startTourA(nav, true), 400) }} />
      <Row icon="chart" iconTint="var(--indigo)" title={t('Tutorial: Tu progreso')} subtitle={t('Repasá las gráficas de progreso y balance muscular.')} accessory="chevron" onClick={() => { nav('/stats'); setTimeout(() => startTourB(true), 400) }} />
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <Section title={t('Contacto')}>
      <Row icon="mail" iconTint="var(--acc)" title={t('Reportar un problema')} subtitle={t('Envianos tus comentarios o reportá un error.')} accessory="chevron" onClick={supportSheet} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install lauyim as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>

    {/* The version, at the bottom of Settings — which is where the support template has been
        telling people to look for it, and where it was not. On the phone build there is no
        address bar and no about box, so without this there is no way to tell which build you
        are running, or whether an update actually installed. */}
    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      lauyim v{__APP_VERSION__} · {t('free & open source (AGPL v3)')}<br />
      <a href="https://github.com/Lautaro-Costa44/lauyim" target="_blank" rel="noopener">source code</a> · exercise data: hasaneyldrm/exercises-dataset (MIT)<br />
      exercise images and animations © <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2


function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

function NotificationsCard({ S, update, toast }) {
  return <PushCard S={S} update={update} toast={toast} />
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { 
      const msg = e.message === 'not signed in' ? t('Not signed in') : (e.message || t('Test failed'))
      toast(msg) 
    }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts, even if lauyim is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && (S.reminder?.on || S.reminder?.feeOn) && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
      {on && <Row icon="calendar" iconTint="var(--teal)" title={t('Gym membership fee')} subtitle={t('Receive a reminder when your membership fee is due.')}>
        <Switch checked={!!S.reminder?.feeOn} onChange={v => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), feeOn: v, tz: localTZ() } })} />
      </Row>}
      {on && S.reminder?.feeOn && <>
        <SelectRow icon="timer" iconTint="var(--teal)" title={t('Payment frequency')}
          value={S.reminder?.feeInterval || 'monthly'} onChange={v => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), feeInterval: v } })}
          options={[['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['bimonthly', 'Every two months'], ['annual', 'Annual']].map(([value, label]) => ({ value, label: t(label) }))} />
        <Row icon="calendar" iconTint="var(--teal)" title={t('Next payment date')}>
          <input type="date" className="timef" value={S.reminder?.feeDate || ''}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), feeDate: e.target.value } })} />
        </Row>
      </>}
      {on && (
        <div style={{ marginTop: 12, marginBottom: 4, display: 'flex', justifyContent: 'center' }}>
          <Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button>
        </div>
      )}
    </Section>
  </>
}

// Equipment profiles ("Home", "Gym", ...) — each an id/name/eq-list; the active one filters
// the Library, exercise picker, and flags routine entries that need something outside it
// (see lib/equipment.js). Purely local/synced state — no server changes needed.
function EquipmentCard({ S, update }) {
  const profiles = S.equipProfiles || []
  const remove = p => confirmSheet({
    title: t('Delete profile?'), message: t('"{0}" and its equipment list will be removed.', p.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => {
      s.equipProfiles = (s.equipProfiles || []).filter(x => x.id !== p.id)
      if (s.activeEquipId === p.id) s.activeEquipId = (s.equipProfiles[0] && s.equipProfiles[0].id) || null
    }),
  })
  return <Section title={t('Equipment')} footer={t('Filters the exercise library and picker, and flags routine exercises that need something you don’t have in the active profile.')}>
    {profiles.length > 0 && <Row icon="dumbbell" iconTint="var(--acc)" title={t('Filter by equipment')}>
      <Switch checked={!!S.equipFilterOn} onChange={v => update(s => { s.equipFilterOn = v })} />
    </Row>}
    {profiles.length > 0 && <SelectRow icon="list" iconTint="var(--blue)" title={t('Active profile')}
      value={S.activeEquipId || ''} onChange={v => update(s => { s.activeEquipId = v })}
      options={profiles.map(p => ({ value: p.id, label: p.name }))} />}
    {profiles.map(p => (
      <Row key={p.id} icon="dumbbell" iconTint="var(--teal)" title={p.name}
        subtitle={t('{0} equipment types', p.equipment.length)} accessory="chevron"
        onClick={() => equipmentProfileSheet(p)}>
        <button className="iconbtn" aria-label={t('Delete')} onClick={ev => { ev.stopPropagation(); remove(p) }}><Icon name="trash" /></button>
      </Row>
    ))}
    <Row icon="plus" iconTint="var(--acc)" title={t('Add equipment profile')} accessory="chevron" onClick={() => equipmentProfileSheet(null)} />
  </Section>
}

// The same registration as the sign-in screen's, reached from Settings instead. It asks for
// the invite code on the same terms: an invite-only instance rejects a registration without
// one, so a form that cannot collect it is a form that cannot succeed.
function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim()); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}
