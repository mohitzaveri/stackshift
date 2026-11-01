const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatUsd(amount: number): string {
  return usd.format(amount);
}

/** An hourly rate: whole dollars when it's a whole number, otherwise with cents ($87.35). */
export function formatRate(rate: number): string {
  return Number.isInteger(rate) ? usd.format(rate) : usdCents.format(rate);
}

/** Small amounts, like the cost of one analysis, with cents. */
export function formatUsdPrecise(amount: number): string {
  return amount < 0.01 && amount > 0 ? "< $0.01" : `$${amount.toFixed(2)}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatRange(low: number, high: number, format: (n: number) => string = formatNumber): string {
  return low === high ? format(low) : `${format(low)}–${format(high)}`;
}

export function formatWeeks(low: number, high: number): string {
  const unit = high === 1 && low === 1 ? "week" : "weeks";
  return `${formatRange(low, high, (n) => String(n))} ${unit}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
