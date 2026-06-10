import { HotelDemo } from "@/components/HotelDemo";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata = {
  title: "CustomRates for hotels — your guests, booking direct",
  description:
    "See exactly what a CustomRates end-user is told about your hotel: book direct, skip the OTA commission, plus the loyalty perks members get.",
};

const REASONS = [
  {
    t: "Win the direct booking",
    d: "Guests are steered to book on your own site — past the OTA's 15–25% commission. The discount and perks live where you control them.",
  },
  {
    t: "Reach travelers everywhere",
    d: "Your offer surfaces inside travelers' AI assistants and the CustomRates browser extension — right when they're choosing a hotel.",
  },
  {
    t: "Never a price war",
    d: "We show which discounts, perks and conditions apply — and an estimated perk value — but never a price. You stay in control of your rates.",
  },
];

export default function ForHotelsPage() {
  return (
    <main className="min-h-screen bg-paper font-sans text-ink">
      <SiteNav />

      {/* Hero + live demo, both on the warm sun-glow wash. */}
      <section className="bg-sunwash">
        <div className="mx-auto max-w-3xl px-5 pb-6 pt-16 text-center sm:pt-24">
          <span className="pill">For hotels</span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl animate-fade-up">
            Your guests are about to <span className="text-sunset">book direct</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-muted">
            When a traveler considers your hotel, CustomRates steers them to book direct with you —
            past the OTA&apos;s 15–25% commission — and surfaces the loyalty perks they already hold.
          </p>
          <p className="mt-4 text-sm font-medium text-ink">Type your hotel and see exactly what they see ↓</p>
        </div>

        <div id="demo" className="scroll-mt-20 px-5 pb-20">
          <HotelDemo />
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-ink-muted">
            CustomRates never shows prices — only which discounts and perks apply, and where to book direct.
          </p>
        </div>
      </section>

      {/* Why hotels love it */}
      <section id="how" className="scroll-mt-20 border-t border-line bg-card px-5 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Why hotels love it
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {REASONS.map((r, i) => (
              <div key={r.t} className="card-soft p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-grad-sun font-semibold text-white shadow-sun">
                  {i + 1}
                </div>
                <h3 className="mt-4 font-display text-xl font-semibold">{r.t}</h3>
                <p className="mt-2 text-sm text-ink-muted">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA on the full sunset-over-sea gradient */}
      <section className="bg-grad-sunset-sea px-5 py-16 text-center text-white">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Put your hotel in front of every member.
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-white/85">
          Free for travelers, always. Hotels start with a 3-month trial.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-full bg-white px-7 py-3 font-semibold text-sun-deep shadow-soft transition hover:brightness-95"
        >
          Get started
        </a>
      </section>

      <SiteFooter />
    </main>
  );
}
