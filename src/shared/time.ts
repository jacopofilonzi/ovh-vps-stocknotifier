/** Time of day for today's dates, date and time otherwise. */
export function formatTime(iso: string | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString("en-GB") : date.toLocaleString("en-GB");
}
