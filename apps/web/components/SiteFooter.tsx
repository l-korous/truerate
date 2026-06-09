import { Logo } from "./Logo";

// Public marketing footer for the CustomRates site.
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-10 sm:flex-row sm:items-center">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm text-ink-muted">
            Your guests, booking direct. CustomRates shows which discounts and perks apply — never prices.
          </p>
        </div>
        <div className="text-sm text-ink-muted">
          © {year} CustomRates · customrates.online
        </div>
      </div>
    </footer>
  );
}
