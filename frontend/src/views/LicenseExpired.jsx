import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'

export default function LicenseExpired() {
  return (
    <div className="view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24, textAlign: 'center', backgroundColor: 'var(--bg, #000)', color: 'var(--text, #fff)' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, color: '#ef4444' }}>
        <Icon name="alert-triangle" size={32} />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>Licencia Expirada</h1>
      <p style={{ fontSize: 15, opacity: 0.7, maxWidth: 400, lineHeight: 1.5, marginBottom: 24 }}>
        El período de licencia de esta instancia ha expirado. Por favor, póngase en contacto con el soporte técnico o el administrador del sistema para renovar su licencia y continuar utilizando la aplicación.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'center', justifyContent: 'center' }}>
        <a 
          href="mailto:soporte@lauyim.online?subject=Renovaci%C3%B3n%20de%20Licencia" 
          className="btn primary"
          style={{ padding: '12px 24px', borderRadius: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <Icon name="mail" size={18} />
          Contactar Soporte
        </a>
      </div>
      <div style={{ marginTop: 40, fontSize: 13, opacity: 0.4 }}>
        Lauyim — Licencia de Instancia
      </div>
    </div>
  )
}
