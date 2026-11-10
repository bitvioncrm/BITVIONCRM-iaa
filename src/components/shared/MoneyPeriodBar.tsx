import { MONEY_PERIODS, type MoneyPeriod } from "@/lib/money-filter";

export function MoneyPeriodBar({
  period,
  customFrom,
  customTo,
  onPeriod,
  onFrom,
  onTo,
  countLabel,
}: {
  period: MoneyPeriod;
  customFrom: string;
  customTo: string;
  onPeriod: (value: MoneyPeriod) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  countLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MONEY_PERIODS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onPeriod(item.key)}
            className={`min-h-11 shrink-0 rounded-full px-3.5 text-sm ${period === item.key ? "bg-[#0e1420] text-[#e8d5a3]" : "border border-line bg-white text-ink"}`}
          >
            {item.label}
          </button>
        ))}
        {period === "custom" ? (
          <>
            <input type="date" aria-label="From" className="h-11 shrink-0 rounded-full border border-line bg-white px-3 text-base" value={customFrom} onChange={(event) => onFrom(event.target.value)} />
            <input type="date" aria-label="To" className="h-11 shrink-0 rounded-full border border-line bg-white px-3 text-base" value={customTo} onChange={(event) => onTo(event.target.value)} />
          </>
        ) : null}
      </div>
      {countLabel ? <p className="text-sm text-muted">{countLabel}</p> : null}
    </div>
  );
}
