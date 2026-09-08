function safe(value) { return Number.isFinite(Number(value)) ? Number(value) : 0 }

function ProgressBar({ label, consumed, goal }) {
  const value = safe(consumed)
  const meta = safe(goal)
  const pct = meta > 0 ? Math.min(100, Math.max(0, value / meta * 100)) : 0
  const exceeded = meta > 0 && value > meta
  return <div className="nutri-bar-row">
    <div className="row between small"><span>{label}</span><span className="dim">{value.toFixed(1)} / {meta.toFixed(1)} g</span></div>
    <div className="nutri-bar" aria-label={`${label}: ${value} de ${meta} gramos`}>
      <span className="nutri-bar-fill" style={{ width: `${pct}%`, background: exceeded ? 'var(--acc-2)' : 'var(--acc)' }} />
      {meta > 0 && <span className="nutri-bar-goal" style={{ left: '100%' }} />}
    </div>
  </div>
}

export default function ResumenNutricional({
  caloriasConsumidas, caloriasMeta, proteinaConsumida, proteinaMeta,
  carbosConsumidos, carbosMeta, grasasConsumidas, grasasMeta,
}) {
  const consumed = safe(caloriasConsumidas)
  const goal = safe(caloriasMeta)
  const pct = goal > 0 ? Math.min(100, Math.max(0, consumed / goal * 100)) : 0
  const radius = 62
  const circumference = 2 * Math.PI * radius
  const dash = circumference * pct / 100
  return <div className="nutri-summary">
    <div className="nutri-ring-wrap">
      <svg className="nutri-ring" viewBox="0 0 160 160" role="img" aria-label={`${Math.round(pct)}% de calorías consumidas`}>
        <circle className="nutri-ring-bg" cx="80" cy="80" r={radius} />
        <circle className="nutri-ring-progress" cx="80" cy="80" r={radius}
          strokeDasharray={`${dash} ${circumference - dash}`} />
      </svg>
      <div className="nutri-ring-label"><strong>{Math.round(consumed).toLocaleString()}</strong><span>/ {Math.round(goal).toLocaleString()} kcal</span></div>
    </div>
    <div className="nutri-bars">
      <ProgressBar label="Proteína" consumed={proteinaConsumida} goal={proteinaMeta} />
      <ProgressBar label="Carbohidratos" consumed={carbosConsumidos} goal={carbosMeta} />
      <ProgressBar label="Grasas" consumed={grasasConsumidas} goal={grasasMeta} />
    </div>
  </div>
}
