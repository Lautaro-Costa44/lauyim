// @vitest-environment happy-dom
// useStore pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('./useStore.js')

// Las metas las escribe solo un admin y su escritura no bumpea user_state._ts, así que
// ningún camino de sync las trae mientras la sesión del socio sigue abierta. Esta acción es
// el único refresco que tienen: sin ella el socio veía los valores viejos hasta reinstalar
// o reiniciar la PWA, aunque el guardado del admin fuera correcto.
describe('refreshNutritionGoals', () => {
  beforeEach(() => {
    apiMock.mockReset()
    useStore.setState({ user: { id: 'u1' }, S: { ...useStore.getState().S, nutritionGoals: { mode: 'automatic' } } })
  })

  it('applies the goals an admin saved while the session stayed open', async () => {
    const goals = { mode: 'manual', calories: 1800, protein: 140, carbs: 180, fat: 55 }
    apiMock.mockResolvedValue({ goals })

    await useStore.getState().refreshNutritionGoals()

    expect(apiMock).toHaveBeenCalledWith('/api/nutrition/goals')
    expect(useStore.getState().S.nutritionGoals).toEqual(goals)
  })

  it('leaves the state untouched when nothing changed', async () => {
    const before = useStore.getState().S
    apiMock.mockResolvedValue({ goals: { mode: 'automatic' } })

    await useStore.getState().refreshNutritionGoals()

    expect(useStore.getState().S).toBe(before)
  })

  it('keeps the local goals when the request fails', async () => {
    apiMock.mockRejectedValue(new Error('offline'))

    await useStore.getState().refreshNutritionGoals()

    expect(useStore.getState().S.nutritionGoals).toEqual({ mode: 'automatic' })
  })

  it('does nothing for a guest with no session', async () => {
    useStore.setState({ user: null })

    await useStore.getState().refreshNutritionGoals()

    expect(apiMock).not.toHaveBeenCalled()
  })
})
