import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { calcularMetasNutricionales } from '../lib/nutricion.js'
import Icon from '../components/Icon.jsx'

export default function Nutricion() {
  const S = useStore(s => s.S)
  const { sugerido, metaProteina } = calcularMetasNutricionales(S)

  return <>
    <div className="hdr">
      <div><h1>{t('Nutrición')}</h1><div className="sub">{t('Tus metas diarias')}</div></div>
      <Icon name="apple" />
    </div>

    <div className="card">
      <div className="row between" style={{ padding: '11px 14px', background: 'var(--acc-soft)', borderRadius: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 15, color: 'var(--label-2)' }}>{t('Meta calórica')}</span>
        <span style={{ fontWeight: 600, color: 'var(--acc)' }}>{sugerido.toLocaleString()} <span className="dim small">kcal / día</span></span>
      </div>
      <div className="row between" style={{ padding: '11px 14px', background: 'var(--surface-2)', borderRadius: 10 }}>
        <span style={{ fontSize: 15, color: 'var(--label-2)' }}>{t('Meta de proteína')}</span>
        <span style={{ fontWeight: 500 }}>{metaProteina.toLocaleString()} <span className="dim small">g / día</span></span>
      </div>
    </div>

    <div className="card muted small">{t('Registro de comidas — próximamente')}</div>
  </>
}
