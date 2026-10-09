// @vitest-environment happy-dom
// Admin → Roles: lista con sus íconos según quién mira, editor (dependencias entre permisos),
// asignar tocando y eliminar con confirmación.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const passkeyMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock, passkeyAssertion: passkeyMock }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { bindUI } = await import('../../components/ui.jsx')
const { setLang } = await import('../../lib/i18n.js')
const { AdminContext } = await import('./context.js')
const { default: Roles, togglePermission } = await import('./Roles.jsx')
const { default: Modals } = await import('../../components/Modals.jsx')
const { RolePickSheet, canReceiveOwnership, ownerTransferDialog } = await import('./roles-common.jsx')
bindUI(useUI)

const CATALOG = [
  { code: 'members.view', area: 'Socios', name: 'Ver socios', help: 'La lista.', requires: [] },
  { code: 'fees.view', area: 'Cuotas', name: 'Ver cuotas', help: 'Quién debe.', requires: ['members.view'] },
  { code: 'fees.manage', area: 'Cuotas', name: 'Registrar pagos y gestionar cuotas', help: 'Cobrar.', requires: ['fees.view'] },
  { code: 'roles.assign', area: 'Staff', name: 'Asignar roles', help: 'Dar roles.', requires: ['members.view'] },
]
const ROLES = [
  { id: 'admin', name: 'Administrador', color: '#ff453a', permissions: ['members.view', 'fees.view', 'fees.manage'], feeExempt: true, builtin: true, members: 2 },
  { id: 'reception', name: 'Recepción', color: '#0a84ff', permissions: ['members.view', 'fees.view'], feeExempt: true, builtin: false, members: 1 },
]
const USERS = [
  { id: 'ana', name: 'ana', fullName: 'Ana Pérez', hasApp: true, role: { id: 'reception', name: 'Recepción', color: '#0a84ff' } },
  { id: 'beto', name: 'beto', hasApp: true, role: null },
  { id: 'dueno', name: 'dueño', owner: true, hasApp: true },
  { id: 'pend', name: 'pend', pending: true, hasApp: true },
  { id: 'ficha', name: 'ficha', hasApp: false },
]

let root, container
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function mount(user) {
  useStore.setState({ user })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  const ctx = { users: USERS, loadUsers: vi.fn() }
  await act(async () => { root.render(<><AdminContext.Provider value={ctx}><Roles /></AdminContext.Provider><Modals /></>) })
  for (let i = 0; i < 4; i++) await tick()
}
const labels = () => [...document.querySelectorAll('.role-actions button')].map(b => b.getAttribute('aria-label'))
const click = async el => { await act(async () => { el.click() }); await tick() }
const sheetButton = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset()
  useUI.setState({ sheets: [] })
  apiMock.mockImplementation((url, opts) => {
    if (url === '/api/admin/roles') return Promise.resolve({ roles: ROLES, catalog: CATALOG })
    if (url === '/api/admin/users/role') { const { roleId } = JSON.parse(opts.body); return Promise.resolve({ ok: true, role: roleId ? { id: roleId, name: 'Recepción', color: '#0a84ff' } : null }) }
    return Promise.resolve({ ok: true, role: ROLES[1] })
  })
})
afterEach(async () => { await act(async () => { root.unmount() }); container.remove() })

describe('Roles', () => {
  it('owner: nuevo rol, y en cada fila editar, asignar y eliminar (Administrador sin tacho)', async () => {
    await mount({ id: 'o', owner: true })
    expect(sheetButton('Nuevo rol')).toBeTruthy()
    expect(container.textContent).toContain('2 personas')
    expect(container.textContent).toContain('1 persona')
    expect(labels()).toEqual(['Editar Administrador', 'Asignar Administrador', 'Editar Recepción', 'Asignar Recepción', 'Eliminar Recepción'])
  })

  it('con "asignar roles": solo asignar, y solo los roles que no lo superan', async () => {
    await mount({ id: 'r', permissions: ['members.view', 'fees.view', 'roles.assign'] })
    expect(sheetButton('Nuevo rol')).toBeFalsy()
    expect(labels()).toEqual(['Asignar Recepción'])
  })

  it('editor: activar "Registrar pagos" activa "Ver cuotas" y "Ver socios"; apagar "Ver socios" apaga todo lo que depende', async () => {
    expect(togglePermission(CATALOG, [], 'fees.manage', true)).toEqual(['members.view', 'fees.view', 'fees.manage'])
    expect(togglePermission(CATALOG, ['members.view', 'fees.view', 'fees.manage', 'roles.assign'], 'members.view', false)).toEqual([])
    await mount({ id: 'o', owner: true })
    await click(sheetButton('Nuevo rol'))
    const name = document.querySelector('input[name="role-name"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Caja')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(document.querySelector('[role="switch"][aria-label="Registrar pagos y gestionar cuotas"]'))
    expect(document.querySelector('[role="switch"][aria-label="Ver cuotas"]').getAttribute('aria-checked')).toBe('true')
    await click(sheetButton('Guardar'))
    const [, opts] = apiMock.mock.calls.find(([u]) => u === '/api/owner/roles/save')
    expect(JSON.parse(opts.body)).toMatchObject({ name: 'Caja', feeExempt: true, permissions: ['members.view', 'fees.view', 'fees.manage'] })
  })

  it('asignar: cuentas activas, también fichas sin app (con su etiqueta); tocar asigna y tocar de nuevo quita', async () => {
    await mount({ id: 'o', owner: true })
    await click(document.querySelector('[aria-label="Asignar Recepción"]'))
    const rows = () => [...document.querySelectorAll('.role-assign-list .lrow')]
    // Como en Usuarios: nombre y apellido de la ficha y, en gris y entre corchetes, el usuario.
    expect(rows().map(r => r.querySelector('.lrow-t').textContent)).toEqual(['Ana Pérez [ana]', 'beto', 'fichaSin app'])
    expect(rows().filter(r => r.querySelector('.tag.nocap')).map(r => r.querySelector('.lrow-t').firstChild.textContent)).toEqual(['ficha'])
    await click(rows()[2])
    expect(JSON.parse(apiMock.mock.calls.find(([u]) => u === '/api/admin/users/role')[1].body)).toEqual({ userId: 'ficha', roleId: 'reception' })
    apiMock.mockClear()
    expect(rows()[0].querySelector('.unick').textContent).toBe(' [ana]')
    expect(rows()[0].getAttribute('aria-pressed')).toBe('true')
    await click(rows().find(r => r.textContent.includes('beto')))
    expect(JSON.parse(apiMock.mock.calls.find(([u]) => u === '/api/admin/users/role')[1].body)).toEqual({ userId: 'beto', roleId: 'reception' })
    expect(useUI.getState().toastMsg).toBe('beto: Ninguno → Recepción')
    await click(rows().find(r => r.textContent.includes('Ana')))
    expect(JSON.parse(apiMock.mock.calls.filter(([u]) => u === '/api/admin/users/role').at(-1)[1].body)).toEqual({ userId: 'ana', roleId: null })
  })

  it('eliminar pide confirmación y avisa cuántos quedan sin rol', async () => {
    await mount({ id: 'o', owner: true })
    await click(document.querySelector('[aria-label="Eliminar Recepción"]'))
    expect(document.body.textContent).toContain('1 persona queda sin rol.')
    await click(sheetButton('Eliminar'))
    expect(apiMock.mock.calls.some(([u]) => u === '/api/owner/roles/delete')).toBe(true)
  })

  it('Gestionar roles (ficha): Ninguno y los roles; los que superan a quien asigna, bloqueados', async () => {
    useStore.setState({ user: { id: 'r', permissions: ['members.view', 'fees.view', 'roles.assign'] } })
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    const onChanged = vi.fn()
    await act(async () => { root.render(<RolePickSheet user={{ id: 'beto', name: 'beto', role: null }} close={() => {}} onChanged={onChanged} />) })
    for (let i = 0; i < 4; i++) await tick()
    const radios = () => [...container.querySelectorAll('[role="radio"]')]
    expect(radios().map(r => r.querySelector('.lrow-t').textContent)).toEqual(['Ninguno', 'Recepción'])
    expect(radios()[0].getAttribute('aria-checked')).toBe('true')
    await click(radios()[1])
    expect(JSON.parse(apiMock.mock.calls.find(([u]) => u === '/api/admin/users/role')[1].body)).toEqual({ userId: 'beto', roleId: 'reception' })
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('Dueño del gimnasio', () => {
  const ana = { id: 'ana', name: 'Ana', role: null, hasApp: true, disabled: false, pending: false, owner: false }
  const wait = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)) }) }
  const renderPick = async member => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(<RolePickSheet user={member} close={() => {}} onChanged={() => {}} />) })
    await wait()
    return { host, done: () => { act(() => r.unmount()); host.remove() } }
  }
  const renderLastSheet = async () => {
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) })
    return { sheet, host, done: () => { act(() => r.unmount()); host.remove() } }
  }
  const btnWith = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
  const realVerify = useStore.getState().verifySession
  beforeEach(() => { passkeyMock.mockReset(); useUI.setState({ sheets: [], toastMsg: '' }) })
  afterEach(() => { useStore.setState({ verifySession: realVerify, config: null }) })

  it('canReceiveOwnership: con app, activa, aprobada y no dueña', () => {
    expect(canReceiveOwnership(ana)).toBe(true)
    for (const extra of [{ hasApp: false }, { disabled: true }, { pending: true }, { owner: true }]) expect(canReceiveOwnership({ ...ana, ...extra })).toBe(false)
  })

  it('solo el dueño la ve, y solo con el interruptor prendido y alguien que puede recibirlo', async () => {
    apiMock.mockImplementation(url => url === '/api/admin/roles' ? Promise.resolve({ roles: [] }) : Promise.resolve({}))
    useStore.setState({ user: { id: 'owner', owner: true }, config: { owner_transfer_enabled: true } })
    let v = await renderPick(ana)
    expect(v.host.textContent).toContain('Dueño del gimnasio')
    expect(v.host.textContent).toContain('Pide tu passkey')
    expect(v.host.textContent).toContain('Pasarle el rol de dueño a Ana')
    v.done()
    v = await renderPick({ ...ana, hasApp: false }); expect(v.host.textContent).not.toContain('Dueño del gimnasio'); v.done()
    useStore.setState({ config: { owner_transfer_enabled: false } })
    v = await renderPick(ana); expect(v.host.textContent).not.toContain('Dueño del gimnasio'); v.done()
    useStore.setState({ user: { id: 'adm', permissions: ['roles.assign', 'members.view'] }, config: { owner_transfer_enabled: true } })
    v = await renderPick(ana); expect(v.host.textContent).not.toContain('Dueño del gimnasio'); v.done()
  })

  it('confirmar: options → passkey → verify y refresca la sesión', async () => {
    const verifySession = vi.fn(() => Promise.resolve())
    useStore.setState({ user: { id: 'owner', owner: true }, config: { owner_transfer_enabled: true }, verifySession })
    apiMock.mockImplementation(url => url === '/api/admin/roles' ? Promise.resolve({ roles: [] })
      : url === '/api/owner/transfer/options' ? Promise.resolve({ cid: 'c1', options: { challenge: 'x' } })
      : url === '/api/owner/transfer/verify' ? Promise.resolve({ ok: true, owner: { id: 'ana', name: 'Ana' } })
      : Promise.resolve({}))
    passkeyMock.mockResolvedValue({ id: 'cred' })
    const v = await renderPick(ana)
    await act(async () => { btnWith(v.host, 'Pasarle el rol de dueño').click() })
    const d = await renderLastSheet()
    expect(d.sheet.kind).toBe('center')
    expect(d.host.textContent).toContain('¿Pasarle el rol de dueño a Ana?')
    expect(d.host.textContent).toContain('Vos pasás a Administrador')
    await act(async () => { btnWith(d.host, 'Confirmar con mi passkey').click() })
    await wait()
    expect(apiMock).toHaveBeenCalledWith('/api/owner/transfer/options', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'ana' }) }))
    expect(passkeyMock).toHaveBeenCalledWith({ challenge: 'x' })
    expect(apiMock).toHaveBeenCalledWith('/api/owner/transfer/verify', expect.objectContaining({ method: 'POST', body: JSON.stringify({ cid: 'c1', credential: { id: 'cred' } }) }))
    expect(verifySession).toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('Ana ahora es dueño/a del gimnasio')
    d.done(); v.done()
  })

  it('cancelar la passkey no llama a verify', async () => {
    useStore.setState({ user: { id: 'owner', owner: true }, config: { owner_transfer_enabled: true } })
    apiMock.mockImplementation(url => url === '/api/owner/transfer/options' ? Promise.resolve({ cid: 'c1', options: {} }) : Promise.resolve({ roles: [] }))
    passkeyMock.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    ownerTransferDialog({ member: ana, onDone: () => {} })
    const d = await renderLastSheet()
    await act(async () => { btnWith(d.host, 'Confirmar con mi passkey').click() })
    await wait()
    expect(apiMock.mock.calls.some(([u]) => u === '/api/owner/transfer/verify')).toBe(false)
    expect(useUI.getState().toastMsg).toBe('Se canceló la passkey')
    d.done()
  })
})
