import subprocess, binascii, re, collections
from pyais import decode

tshark = r"C:\Program Files\Wireshark\tshark.exe"
pcap = r"C:\Users\Kaan\Desktop\IRBIS\AISveGPS.pcapng"
cmd = [
    tshark,
    "-r",
    pcap,
    "-Y",
    "udp.dstport == 60001",
    "-T",
    "fields",
    "-e",
    "data.data",
]
p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

msgs = []
aivdo = []
for line in p.stdout.splitlines():
    hx = line.strip().replace(":", "")
    if not hx:
        continue
    text = binascii.unhexlify(hx).decode("latin-1", errors="ignore")
    for m in re.finditer(r"![A-Z]{2}VD[MO],[^\r\n\*]*\*[0-9A-Fa-f]{2}", text):
        s = m.group(0)
        msgs.append(s)
        if "VDO" in s[:6]:
            aivdo.append(s)

parts = {}
decoded = []
for s in msgs:
    fields = s.split(",")
    try:
        total = int(fields[1])
        num = int(fields[2])
        seq = fields[3]
        key = (seq, fields[0][1:3], total)
        parts.setdefault(key, {})[num] = s
        if len(parts[key]) == total:
            ordered = [parts[key][i] for i in range(1, total + 1)]
            try:
                d = decode(*ordered)
                decoded.append((s.startswith("!AIVDO") or "VDO," in ordered[0], d))
            except Exception:
                pass
            del parts[key]
    except Exception:
        continue

aivdo_mmsi = set()
for s in aivdo:
    try:
        d = decode(s)
        aivdo_mmsi.add(int(d.mmsi))
    except Exception:
        pass

by_mmsi = collections.defaultdict(list)
for is_own_sentence, d in decoded:
    mmsi = int(d.mmsi)
    by_mmsi[mmsi].append(
        {
            "type": getattr(d, "msg_type", getattr(d, "type", "?")),
            "lat": getattr(d, "lat", None),
            "lon": getattr(d, "lon", None),
            "sog": getattr(d, "speed", None),
            "cog": getattr(d, "course", None),
            "hdg": getattr(d, "heading", None),
            "name": getattr(d, "shipname", None),
            "callsign": getattr(d, "callsign", None),
            "ship_type": getattr(d, "ship_type", None),
            "status": getattr(d, "status", None),
            "own_sentence": is_own_sentence,
        }
    )

print(f"AIS sentences: {len(msgs)}  decoded: {len(decoded)}  unique MMSI: {len(by_mmsi)}")
print(f"AIVDO ownship MMSI: {sorted(aivdo_mmsi)}")
print()

rows = []
for mmsi, ev in by_mmsi.items():
    names = [e["name"] for e in ev if e.get("name")]
    name = names[-1].strip() if names else None
    lats = [e["lat"] for e in ev if e.get("lat") not in (None, 91.0)]
    lons = [e["lon"] for e in ev if e.get("lon") not in (None, 181.0)]
    sogs = [e["sog"] for e in ev if e.get("sog") not in (None, 102.3)]
    types = sorted({e["type"] for e in ev})
    ship_types = [e["ship_type"] for e in ev if e.get("ship_type") is not None]
    own = mmsi in aivdo_mmsi
    rows.append(
        {
            "mmsi": mmsi,
            "own": own,
            "name": name,
            "n": len(ev),
            "types": types,
            "lat": round(lats[-1], 5) if lats else None,
            "lon": round(lons[-1], 5) if lons else None,
            "sog": sogs[-1] if sogs else None,
            "ship_type": ship_types[-1] if ship_types else None,
            "callsign": next((e["callsign"] for e in reversed(ev) if e.get("callsign")), None),
            "status": next((e["status"] for e in reversed(ev) if e.get("status") is not None), None),
        }
    )

rows.sort(key=lambda r: (not r["own"], -r["n"]))
for r in rows:
    tag = "OWN" if r["own"] else "TGT"
    print(f"[{tag}] MMSI {r['mmsi']}  n={r['n']}  msg={r['types']}")
    print(f"     name={r['name']!r}  call={r['callsign']!r}  shiptype={r['ship_type']}  status={r['status']}")
    print(f"     pos={r['lat']},{r['lon']}  sog={r['sog']}")
    print()
