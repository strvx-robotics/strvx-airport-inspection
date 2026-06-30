/** Local pass time in 24-hour HH:MM (matches backend normalize_schedule_time). */
export const SCHEDULE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidScheduleTime(time: string): boolean {
  return SCHEDULE_TIME_RE.test(time.trim());
}
