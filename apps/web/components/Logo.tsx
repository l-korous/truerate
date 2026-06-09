// CustomRates logo — a sun setting over the sea, with its reflection shimmering
// below the horizon. Original mark; pairs with the sunset-over-sea palette.

export function Logo({
  size = 30,
  showWordmark = true,
  className = "",
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  const gid = "cr-sun-grad";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
        role="img"
      >
        <defs>
          <linearGradient id={gid} x1="24" y1="8" x2="24" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffc65e" />
            <stop offset="1" stopColor="#ff6f4d" />
          </linearGradient>
        </defs>
        {/* the sun */}
        <circle cx="24" cy="19" r="10" fill={`url(#${gid})`} />
        {/* horizon + reflection shimmer on the sea */}
        <line x1="6" y1="30.5" x2="42" y2="30.5" stroke="#11808f" strokeWidth="3" strokeLinecap="round" />
        <line x1="16" y1="36.5" x2="32" y2="36.5" stroke="#11808f" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <line x1="20" y1="42" x2="28" y2="42" stroke="#11808f" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
      </svg>
      {showWordmark && (
        <span className="font-display text-xl font-semibold tracking-tight text-ink">
          Custom<span className="text-sunset">Rates</span>
        </span>
      )}
    </span>
  );
}
