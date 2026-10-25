/** NMEA 0183 XOR checksum between `$`/`!` and `*`. */
export function nmeaChecksumOk(sentence: string): boolean {
  const star = sentence.lastIndexOf("*");
  if (star < 0 || star + 3 > sentence.length) return false;
  const bodyStart = sentence[0] === "$" || sentence[0] === "!" ? 1 : 0;
  const body = sentence.slice(bodyStart, star);
  const expected = sentence.slice(star + 1, star + 3).toUpperCase();
  let cs = 0;
  for (let i = 0; i < body.length; i += 1) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, "0") === expected;
}

export function stripNmea(sentence: string): string {
  const s = sentence.trim();
  const star = s.lastIndexOf("*");
  const core = star >= 0 ? s.slice(0, star) : s;
  return core.startsWith("$") || core.startsWith("!") ? core.slice(1) : core;
}
