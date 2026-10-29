import { WHATS_NEW } from '../seo'
import { BRAND } from '../brand'
import { Link } from '../router'
import { Logo } from '../ui/Logo'

/** V2 release notes: the same text crawlers read in whats-new.html, with the screenshots. */
export default function WhatsNew() {
  return (
    <div className="landing guide-page whats-new-page">
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
        <span className="v2-badge">V2</span>
        <h1>What’s new in {BRAND.name} V2</h1>
        <p className="lede">The biggest update yet to both games: new players, new animations, living crowds, night games, a new basketball mode and a lot more feel.</p>
        <nav className="guide-toc" aria-label="Sections">
          {WHATS_NEW.map((w) => (
            <a key={w.id} href={`#${w.id}`} className="chip">{w.emoji} {w.title}</a>
          ))}
        </nav>
        {WHATS_NEW.map((w, i) => (
          <section key={w.id} id={w.id} className={`wn-block${w.image ? '' : ' wn-text'}${i % 2 ? ' flip' : ''}`}>
            {w.image && <img src={w.image} alt={w.alt} width="1200" height={w.image.includes('players') ? 600 : 675} loading={i < 2 ? 'eager' : 'lazy'} decoding="async" />}
            <div className="wn-copy">
              <h2><span aria-hidden="true">{w.emoji}</span> {w.title}</h2>
              <p>{w.text}</p>
            </div>
          </section>
        ))}
        <div className="wn-ctas">
          <Link to="/play?mode=daily" className="btn primary big">🏈 Play today’s drive</Link>
          <Link to="/hoops?mode=survivor" className="btn big">🏀 Hoops Survivor</Link>
          <Link to="/locker" className="btn big">🎽 Locker Room</Link>
        </div>
      </main>
      <footer className="land-foot">
        <p>{BRAND.disclaimer} NBA team names and colors are used the same way.</p>
      </footer>
    </div>
  )
}
