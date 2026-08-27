import { CheckCircle2 } from 'lucide-react';

export interface PackageCardData {
  id: string;
  name: string;
  price: string;
  paxLabel: string;
  features: string[];
  isCustom?: boolean;
}

export function PackageCard({
  pkg,
  isActive,
  reducedMotion,
  onAction,
}: {
  pkg: PackageCardData;
  isActive: boolean;
  reducedMotion: boolean;
  onAction: () => void;
}) {
  const isCustom = pkg.isCustom;
  const buttonText = isCustom ? "Start a plan" : "See details";

  /* The spotlight card is sized for a short list, but inclusions are admin-authored
     and a real package carries a dozen — enough to stretch this card to three times
     its neighbours. Show the first few and count the rest; "See details" opens the
     modal, which lists every one. */
  const MAX_FEATURES = 5;
  const shownFeatures = pkg.features.slice(0, MAX_FEATURES);
  const extraFeatures = pkg.features.length - shownFeatures.length;

  return (
    <div
      className={`flex flex-col rounded-[24px] p-8 min-w-0 transition-all duration-300 ${
        isActive
          ? 'bg-[var(--pkgc-lift)] text-[var(--pkgc-ink)] shadow-[var(--shadow-lg)] scale-105 border border-transparent'
          : 'bg-[var(--pkgc-side)] text-[var(--pkgc-side-ink)] border border-[var(--pkgc-side-edge)]'
      } ${!reducedMotion ? 'transform' : ''} h-full`}
    >
      <h3 className={`font-display font-medium tracking-tight ${isActive ? 'text-[1.75rem] mb-2' : 'text-[1.35rem] mb-2 font-semibold'}`}>
        {pkg.name}
      </h3>

      <div className={`tabular-nums font-semibold leading-none mb-1 tracking-tight ${isActive ? 'text-[2.75rem]' : 'text-[1.85rem]'}`}>
        {pkg.price}
      </div>
      <div className={`font-body text-sm mb-6 ${isActive ? 'text-[var(--pkgc-muted)]' : 'text-[var(--pkgc-side-muted)]'}`}>
        {pkg.paxLabel}
      </div>

      {isActive && pkg.features && pkg.features.length > 0 && (
        <ul className="list-none m-0 mb-6 p-0 flex flex-col gap-3">
          {shownFeatures.map((feature) => (
            <li key={feature} className="flex gap-2.5 items-start font-body text-sm text-[var(--pkgc-muted)]">
              <CheckCircle2 size={16} strokeWidth={2} className="flex-none text-[var(--pkgc-accent)] mt-0.5" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
          {extraFeatures > 0 && (
            <li className="font-body text-sm text-[var(--pkgc-muted)] pl-[26px]">
              +{extraFeatures} more {extraFeatures === 1 ? 'inclusion' : 'inclusions'}
            </li>
          )}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        {isActive ? (
           <button
             type="button"
             onClick={onAction}
             className="w-full font-body font-semibold text-sm py-[15px] px-[18px] bg-[var(--pkgc-accent)] text-[var(--pkgc-accent-on)] hover:bg-[var(--pkgc-accent-hover)] rounded-full transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--pkgc-accent)] focus-visible:outline-offset-2"
           >
             {buttonText}
           </button>
        ) : (
           /* Decorative on an inactive card: it is aria-hidden and out of the tab
              order, so it carries no onClick of its own — the click bubbles to the
              carousel wrapper, which brings this card forward. Firing onAction here
              too would open the modal and promote the card from one press. */
           <button
             type="button"
             className="w-full font-body font-semibold text-xs py-[13px] px-[18px] bg-transparent text-[var(--pkgc-side-ink)] border border-[var(--pkgc-side-edge)] rounded-full"
             tabIndex={-1}
             aria-hidden="true"
           >
             {buttonText}
           </button>
        )}
      </div>
    </div>
  );
}
