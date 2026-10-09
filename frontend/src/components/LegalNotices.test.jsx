// @vitest-environment happy-dom
// Aviso de privacidad y términos según lo que el gimnasio tiene prendido (/api/privacy): ingreso
// físico y clases suman datos, usos y reglas; sin ellos, los textos no los mencionan.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { PrivacyNotice } = await import('./PrivacyNotice.jsx')
const { TermsNotice } = await import('./TermsNotice.jsx')
const { setLang } = await import('../lib/i18n.js')

const BASE = { gymName: 'Gimnasio Norte', contact: '', fields: ['full_name'], billingEnabled: true, auditDays: 90, legalVersion: '2026-10-04', checkinEnabled: false, classes: null }
const CLASSES = { cancelHours: 2, penalty: null, planLimits: false }

let root, container
async function render(el) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(el) })
  return container.textContent
}

beforeEach(async () => { await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('aviso de privacidad', () => {
  it('menciona los suplementos como dato de salud que el staff no ve', async () => {
    const text = await render(<PrivacyNotice info={BASE} />)
    expect(text).toMatch(/los suplementos que registres/)
    expect(text).toMatch(/el staff del gimnasio no tiene acceso/)
  })

  it('sin ingreso físico ni clases: no los menciona', async () => {
    const text = await render(<PrivacyNotice info={BASE} />)
    expect(text).not.toMatch(/ingresos al gimnasio/)
    expect(text).not.toMatch(/Tus clases/)
  })

  it('con ingreso físico: la asistencia al gimnasio', async () => {
    const text = await render(<PrivacyNotice info={{ ...BASE, checkinEnabled: true }} />)
    expect(text).toMatch(/Tu asistencia: los ingresos al gimnasio que se registran en la recepción/)
  })

  it('con clases: reservas, asistencia y calificaciones, para qué y quién las ve', async () => {
    const text = await render(<PrivacyNotice info={{ ...BASE, classes: CLASSES }} />)
    expect(text).toMatch(/Tus clases: reservas, lista de espera, asistencia, cancelaciones y las calificaciones que des/)
    expect(text).toMatch(/Gestionar las reservas de clases/)
    expect(text).toMatch(/La profe de cada clase ve quiénes están anotados/)
    expect(text).toMatch(/nombre e inicial del apellido/)
  })

  it('las copias de seguridad se guardan hasta 6 meses, también después de la baja', async () => {
    const text = await render(<PrivacyNotice info={BASE} />)
    expect(text).toMatch(/hasta 6 meses/)
    expect(text).not.toMatch(/7 por defecto/)
  })
})

describe('términos', () => {
  it('sin clases: no hay sección de clases', async () => {
    const text = await render(<TermsNotice info={BASE} />)
    expect(text).not.toMatch(/Clases/)
  })

  it('con clases: cupo, cancelación con las horas del gym, cambios y recordatorios', async () => {
    const text = await render(<TermsNotice info={{ ...BASE, classes: CLASSES }} />)
    expect(text).toMatch(/Clases/)
    expect(text).toMatch(/cupo/)
    expect(text).toMatch(/hasta 2 horas antes/)
    expect(text).toMatch(/cancelación tardía/)
    expect(text).toMatch(/puede cambiar el horario o la profe de una clase, o suspenderla/)
    expect(text).toMatch(/recordatorios son una ayuda/)
    expect(text).not.toMatch(/no vas a poder reservar/)
    expect(text).not.toMatch(/tu plan incluye/)
  })

  it('con penalización y planes con límite: sus números', async () => {
    const text = await render(<TermsNotice info={{ ...BASE, classes: { cancelHours: 1, penalty: { absences: 3, windowDays: 30, blockDays: 7 }, planLimits: true } }} />)
    expect(text).toMatch(/hasta 1 hora antes/)
    expect(text).toMatch(/3 ausencias o cancelaciones tardías en 30 días, no vas a poder reservar durante 7 días/)
    expect(text).toMatch(/tu plan incluye/)
  })

  it('cancelar sin límite (0 horas): hasta que empieza', async () => {
    const text = await render(<TermsNotice info={{ ...BASE, classes: { ...CLASSES, cancelHours: 0 } }} />)
    expect(text).toMatch(/hasta que empieza la clase/)
  })
})

describe('términos: guía de suplementos', () => {
  it('es información general, sin marcas y no reemplaza a un profesional', async () => {
    const text = await render(<TermsNotice info={BASE} />)
    expect(text).toMatch(/La Guía de suplementos es información general/)
    expect(text).toMatch(/no recomienda marcas ni productos/)
  })
})
