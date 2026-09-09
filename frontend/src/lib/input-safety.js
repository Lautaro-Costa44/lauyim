let autofillFieldSeq = 0
const autofillFieldNames = new WeakMap()

export function disableKeyboardAutofill(root) {
  root.querySelectorAll('input:not([type="file"]), textarea').forEach(field => {
    // Keep the semantic input type intact. Changing text/number fields to search
    // changes the iOS/Android action key and disables native numeric validation.
    const originalType = field.getAttribute('type') || 'text'
    if (field.tagName === 'INPUT' && !field.getAttribute('inputmode') && originalType === 'number') {
      field.setAttribute('inputmode', field.getAttribute('step')?.includes('.') ? 'decimal' : 'numeric')
    }
    if (field.tagName === 'INPUT' && !field.getAttribute('enterkeyhint')) {
      field.setAttribute('enterkeyhint', originalType === 'search' ? 'search' : originalType === 'email' ? 'done' : 'next')
    }
    field.setAttribute('autocomplete', 'off')
    field.setAttribute('autocorrect', 'off')
    field.setAttribute('autocapitalize', 'none')
    field.setAttribute('spellcheck', 'false')
    field.setAttribute('data-lpignore', 'true')
    field.setAttribute('data-1p-ignore', 'true')
    field.setAttribute('data-bwignore', 'true')
    field.setAttribute('data-form-type', 'other')
    if (!autofillFieldNames.has(field)) {
      autofillFieldSeq += 1
      autofillFieldNames.set(field, `app_field_${autofillFieldSeq}_${Math.random().toString(36).slice(2)}`)
    }
    field.setAttribute('name', autofillFieldNames.get(field))
  })
}

