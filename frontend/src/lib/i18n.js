import { useSyncExternalStore } from 'react'
import {
  LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, instrFor, exerciseNameFor, exerciseNameSearchText, getVersion, _setLangState
} from './i18n-core.js'

import esDict from '../locales/es.js'

export {
  LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, instrFor, exerciseNameFor, exerciseNameSearchText
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')
const exerciseNamePacks = import.meta.glob('../exercise-names/*.js')

const subs = new Set()
const notify = () => { subs.forEach(f => f()) }

export async function setLang(l) {
  if (!LANGS[l]) l = 'es'
  
  let dict = {}, instr = null, exerciseNames = null
  
  if (l === 'es') {
    dict = esDict
  } else if (l !== 'en') {
    try { dict = (await localePacks['../locales/' + l + '.js']()).default } catch (e) { dict = {} }
  }

  try { instr = l === 'en' || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default } catch (e) { instr = null }
  try {
    exerciseNames = l === 'en' || !EXERCISE_NAME_LANGS.includes(l)
      ? null
      : (await exerciseNamePacks['../exercise-names/' + l + '.js']()).default
  } catch (e) { exerciseNames = null }

  _setLangState(l, dict, instr, exerciseNames)
  notify()
}

// Carga inicial forzada en español
setLang('es')

export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, getVersion)
}