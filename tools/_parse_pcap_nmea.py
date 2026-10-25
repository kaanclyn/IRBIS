import subprocess, re, collections, binascii, sys
tshark = r"C:\Program Files\Wireshark\tshark.exe"
pcap = r"C:\Users\Kaan\Desktop\IRBIS\AISveGPS.pcapng"
# Export all UDP data as hex for key ports
cmd = [tshark, "-r", pcap, "-Y", "udp && data", "-T", "fields",
       "-e", "frame.time_relative", "-e", "ip.src", "-e", "udp.dstport", "-e", "data.data"]
p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
talkers = collections.Counter()
sentences = collections.Counter()
ais_mmsi = collections.Counter()
gps_pos = []
names = {}
sources_by_port = collections.defaultdict(lambda: collections.Counter())
sample = {20000: [], 60001: [], 60002: [], 1005: []}
aivdm_raw = []
ownship_rmc = []
for line in p.stdout.splitlines():
    parts = line.split("\t")
    if len(parts) < 4 or not parts[3]:
        continue
    t, src, port, hx = parts[0], parts[1], parts[2], parts[3].replace(":","")
    try:
        raw = binascii.unhexlify(hx)
    except Exception:
        continue
    text = raw.decode("latin-1", errors="ignore")
    port_i = int(port) if port.isdigit() else -1
    if port_i in sample and len(sample[port_i]) < 8:
        # first printable chunk
        sample[port_i].append(text[:200].replace("\r","\\r").replace("\n"," | "))
    for m in re.finditer(r"\$[^$]*?\*[0-9A-Fa-f]{2}", text, re.S):
        s = m.group(0).replace("\r","").replace("\n","")
        talker = s[1:3] if len(s)>3 else "?"
        typ = s[3:6] if len(s)>6 else "?"
        # MXPGN special
        if s.startswith("$MXPGN"):
            typ = "PGN"
            talker = "MX"
        talkers[talker] += 1
        sentences[f"{talker}{typ}"] += 1
        sources_by_port[port_i][f"{talker}{typ}"] += 1
        if "RMC" in s or "GGA" in s or "GLL" in s:
            fields = s.split(",")
            if "RMC" in s and len(fields) > 6:
                ownship_rmc.append((t, src, port, fields[3], fields[4], fields[5], fields[6], fields[7] if len(fields)>7 else ""))
        if s.startswith("!AIVDM") or s.startswith("!AIVDO") or "VDM" in s[:6] or s.startswith("!AI"):
            aivdm_raw.append(s)
            # crude MMSI from type 1-3 payload is hard without decoder; collect channel talker
        # Some gateways put AIS as !AIVDM
    for m in re.finditer(r"![A-Z]{2}VD[MO],[^\r\n\*]*\*[0-9A-Fa-f]{2}", text):
        aivdm_raw.append(m.group(0))

print("=== SAMPLE BY PORT ===")
for port, rows in sample.items():
    print(f"\n-- {port} --")
    for r in rows[:5]:
        print(r[:180])

print("\n=== SENTENCE COUNTS (top) ===")
for k,v in sentences.most_common(40):
    print(f"{k}: {v}")

print("\n=== BY PORT ===")
for port, c in sorted(sources_by_port.items()):
    print(f"port {port}: {c.most_common(12)}")

print(f"\nAIVDM count: {len(aivdm_raw)}")
for s in aivdm_raw[:15]:
    print(s)

print(f"\nRMC samples: {len(ownship_rmc)}")
for r in ownship_rmc[:10]:
    print(r)
