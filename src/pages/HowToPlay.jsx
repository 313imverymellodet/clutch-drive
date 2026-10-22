import { FAQ, GUIDE } from '../seo'
import { BRAND } from '../brand'
import { Link } from '../router'
import { Logo } from '../ui/Logo'

/** The guide: football and basketball tips plus FAQ (same text as the static page crawlers read). */
export default function HowToPlay() {
  return (
    <div className="landing guide-page">
      <nav className="land-nav">
        <Link to="/" className="land-logo" aria-label={`${BRAND.name} home`}>
          <Logo />
          <span>{BRAND.name.toUpperCase()}</span>
        </Link>
        <div className="land-links">
          <Link to="/play?mode=daily">🏈 Daily Drive</Link>
          <Link to="/hoops">🏀 Daily Hoops</Link>
          <Link to="/play?mode=daily" className="btn primary small">Play</Link>
        </div>
      </nav>
      <main className="guide">
        <h1>How to play</h1>
        <p className="lede">Everything you need to win the Daily: the football playbook and read progressions, how to beat each coverage, and how to run the basketball sets and time your shot.</p>
        <nav className="guide-toc" aria-label="Sections">
          {GUIDE.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="chip">{g.title}</a>
          ))}
          <a href="#faq" className="chip">Questions</a>
        </nav>
        {GUIDE.map((g) => (
          <section key={g.id} id={g.id} className="guide-section">
            <h2>{g.title}</h2>
            <div className="guide-grid">
              {g.items.map(([h, t]) => (
                <article key={h}>
                  <h3>{h}</h3>
                  <p>{t}</p>
                </article>
              ))}
            </div>
            <Link to={g.id === 'hoops' ? '/hoops' : '/play?mode=daily'} className="btn primary">{g.id === 'hoops' ? '🏀 Play Daily Hoops' : '🏈 Play the Daily Drive'}</Link>
          </section>
        ))}
        <section id="faq" className="guide-section">
          <h2>Questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      </main>
      <footer className="land-foot">
        <p>{BRAND.disclaimer}</p>
      </footer>
    </div>
  )
}
