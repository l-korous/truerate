import Link from "next/link";
import { Logo } from "./Logo";

// Public marketing nav for the CustomRates site.
export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/for-hotels" aria-label="CustomRates home" className="shrink-0">
          <Logo />
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium text-ink-muted md:flex">
          <a href="#how" className="transition hover:text-ink">How it works</a>
          <a href="#demo" className="transition hover:text-ink">Live demo</a>
          <Link href="/" className="transition hover:text-ink">For travelers</Link>
        </div>
        <Link href="/" className="btn-primary px-5 py-2.5 text-sm">
          Get started
        </Link>
      </nav>
    </header>
  );
}
