const saoPauloFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function saoPauloCurrentMonth(): string {
  return saoPauloFormatter.format(new Date()).slice(0, 7);
}

export function formatDateBR(date: string): string {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}
