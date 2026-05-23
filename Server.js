// Server Monitor Widget — Perfect Localized & Optimized Edition (Final)
export default async function (ctx) {

  const fmtBytes = b => {
    if (!b || isNaN(b)) return '0B';
    if (b >= 1024 ** 4) return (b / 1024 ** 4).toFixed(1) + 'T';
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + 'G';
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + 'M';
    if (b >= 1024)      return (b / 1024).toFixed(0) + 'K';
    return Math.round(b) + 'B';
  };

  const getNextResetDate = (resetDay) => {
    const now = new Date();
    const targetMonth = now.getMonth() + (now.getDate() >= resetDay ? 1 : 0);
    const lastDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(resetDay, lastDay);
    const next = new Date(now.getFullYear(), targetMonth, clampedDay);
    return `${next.getMonth() + 1}月${next.getDate()}日`;
  };

  const formatUptime = (rawStr) => {
    let clean = rawStr.replace(/^up\s+/, '').replace(/,\s*$/, '').trim();
    if (!clean || clean === 'unknown') return '—';
    let totalDays = 0, hours = 0, minutes = 0;
    const dayMatch = clean.match(/(\d+)\s+days?/);
    if (dayMatch) totalDays += parseInt(dayMatch[1]);
    const hourMatch = clean.match(/(\d+)\s+hours?/);
    if (hourMatch) hours = parseInt(hourMatch[1]);
    const minMatch = clean.match(/(\d+)\s+minutes?/);
    if (minMatch) minutes = parseInt(minMatch[1]);
    let result = '';
    if (totalDays > 0) result += `${totalDays}天`;
    if (hours > 0)     result += `${hours}小时`;
    if (minutes > 0 && totalDays === 0) result += `${minutes}分钟`;
    return result || '刚刚开机';
  };

  const getRefreshTimeString = () => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `刷新于 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };

  let d;
  try {
    const env = ctx.env;
    const { host, username, password, privateKey, port } = env;
    const bwhVeid = env.BWH_VEID || '', bwhApiKey = env.BWH_API_KEY || '';
    const trafficLimitGB = Number(env.TRAFFIC_LIMIT) || 2000, resetDay = Number(env.RESET_DAY) || 1;

    let finalKey = privateKey;
    if (privateKey && typeof privateKey === 'string') {
      const raw = privateKey.trim();
      finalKey = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : raw.replace(/\\n/g, '\n');
    }

    let bwhData = null;
    if (bwhVeid && bwhApiKey) {
      try { const resp = await ctx.http.get(`https://api.64clouds.com/v1/getServiceInfo?veid=${bwhVeid}&api_key=${bwhApiKey}`); bwhData = await resp.json(); } catch (e) { }
    }

    const session = await ctx.ssh.connect({ host, port: Number(port || 22), username, ...(finalKey ? { privateKey: finalKey } : { password }), timeout: 8000 });
    const cmds = [
      'echo "[CMD0]"; hostname -s 2>/dev/null || hostname',
      'echo "[CMD1]"; cat /proc/loadavg 2>/dev/null || echo "0 0 0"',
      'echo "[CMD2]"; uptime -p 2>/dev/null || uptime',
      'echo "[CMD3]"; head -1 /proc/stat 2>/dev/null || echo "cpu 0 0 0 0"',
      'echo "[CMD4]"; awk \'/MemTotal/{t=$2}/MemFree/{f=$2}/Buffers/{b=$2}/^Cached/{c=$2}END{print t*1024,(t-f-b-c)*1024}\' /proc/meminfo 2>/dev/null || echo "1 0"',
      'echo "[CMD5]"; df -B1 / 2>/dev/null | tail -1 || echo "/ 1 0 0 0%"',
      'echo "[CMD6]"; nproc 2>/dev/null || echo "1"',
      'echo "[CMD7]"; awk \'/^ *(eth|en|wlan|ens|eno|bond|veth)/{rx+=$2;tx+=$10}END{print rx,tx}\' /proc/net/dev 2>/dev/null || echo "0 0"',
      'echo "[CMD8]"; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || cat /sys/class/hwmon/hwmon0/temp1_input 2>/dev/null || echo "0"',
      'echo "[CMD9]"; awk \'$3~/^(sd[a-z]|vd[a-z]|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$/{r+=$6;w+=$10}END{print r*512,w*512}\' /proc/diskstats 2>/dev/null || echo "0 0"',
    ];
    const { stdout } = await session.exec(cmds.join(' ; '));
    await session.close();

    const parseOutput = (str, idx) => { const reg = new RegExp(`\\[CMD${idx}\\]\\n?([^]*?)(?=\\n?\\[CMD|$)`); const m = str.match(reg); return m ? m[1].trim() : ''; };
    const hostname = parseOutput(stdout, 0) || 'server';
    const la = (parseOutput(stdout, 1) || '0 0 0').split(' ');
    const load = [la[0], la[1], la[2]];
    const uptime = formatUptime(parseOutput(stdout, 2));
    const cpuNums = (parseOutput(stdout, 3) || 'cpu 0 0 0 0').replace(/^cpu\s+/, '').split(/\s+/).map(Number);
    const cpuTotal = cpuNums.reduce((a, b) => a + b, 0), cpuIdle = cpuNums[3];
    const prevCpu = ctx.storage.getJSON('_cpu');
    let cpuPct = 0;
    if (prevCpu && cpuTotal > prevCpu.t) cpuPct = Math.round(((cpuTotal - prevCpu.t - (cpuIdle - prevCpu.i)) / (cpuTotal - prevCpu.t)) * 100);
    ctx.storage.setJSON('_cpu', { t: cpuTotal, i: cpuIdle });
    cpuPct = Math.max(0, Math.min(100, isNaN(cpuPct) ? 0 : cpuPct));
    const cpuHist = ctx.storage.getJSON('_cpuH') || []; cpuHist.push(cpuPct); while (cpuHist.length > 20) cpuHist.shift(); ctx.storage.setJSON('_cpuH', cpuHist);

    const memNums = (parseOutput(stdout, 4) || '1 0').split(/\s+/).map(Number);
    const memTotal = memNums[0], memUsed = memNums[1], memPct = Math.min(100, Math.round((memUsed / memTotal) * 100)) || 0;

    const df = (parseOutput(stdout, 5) || '').split(/\s+/);
    const diskTotal = Number(df[1]) || 1, diskUsed = Number(df[2]) || 0, diskPct = parseInt(df[4]) || 0, cores = parseInt(parseOutput(stdout, 6)) || 1;
    const nn = (parseOutput(stdout, 7) || '0 0').split(' ');
    const netRx = Number(nn[0]), netTx = Number(nn[1]), now = Date.now(), prevNet = ctx.storage.getJSON('_net');
    let rxRate = 0, txRate = 0;
    if (prevNet && prevNet.ts) { const el = (now - prevNet.ts) / 1000; rxRate = Math.max(0, (netRx - prevNet.rx) / el); txRate = Math.max(0, (netTx - prevNet.tx) / el); }
    ctx.storage.setJSON('_net', { rx: netRx, tx: netTx, ts: now });

    const tempRaw = parseInt(parseOutput(stdout, 8)) || 0, temp = tempRaw > 1000 ? Math.round(tempRaw / 1000) : tempRaw;
    const dio = (parseOutput(stdout, 9) || '0 0').split(' ');
    const drt = Number(dio[0]), dwt = Number(dio[1]), prevDsk = ctx.storage.getJSON('_dsk');
    let diskRd = 0, diskWr = 0;
    if (prevDsk && prevDsk.ts) { const el = (now - prevDsk.ts) / 1000; diskRd = Math.max(0, (drt - prevDsk.r) / el); diskWr = Math.max(0, (dwt - prevDsk.w) / el); }
    ctx.storage.setJSON('_dsk', { r: drt, w: dwt, ts: now });

    let tfUsed = bwhData ? bwhData.data_counter : (netRx + netTx);
    let tfTotal = bwhData ? (bwhData.plan_monthly_data || 1) : (trafficLimitGB * (1024 ** 3));
    let tfPct = Math.min((tfUsed / tfTotal) * 100, 100), tfReset = bwhData && bwhData.data_next_reset ? `${new Date(bwhData.data_next_reset * 1000).getMonth() + 1}月${new Date(bwhData.data_next_reset * 1000).getDate()}日` : getNextResetDate(resetDay);

    d = { hostname, load, uptime, cpuPct, cpuHist, cores, memTotal, memUsed, memPct, diskTotal, diskUsed, diskPct, diskRd, diskWr, rxRate, txRate, netRx, netTx, tfUsed, tfTotal, tfPct, tfReset, temp };
  } catch (e) { d = { error: String(e.message || e) }; }

  const C = { bg1: { light: '#ffffff', dark: '#0d1117' }, bg2: { light: '#f6f8fa', dark: '#161b22' }, barBg: { light: '#ebedef', dark: '#30363d' }, text: { light: '#1f2328', dark: '#e6edf3' }, muted: { light: '#656d76', dark: '#9198a1' }, dim: { light: '#8c959f', dark: '#6e7681' }, cpu: { light: '#1a7f37', dark: '#3fb950' }, mem: { light: '#0969da', dark: '#58a6ff' }, net: { light: '#bf3989', dark: '#f778ba' }, netTx: { light: '#8250df', dark: '#a371f7' }, disk: { light: '#9a6700', dark: '#d29922' }, temp: { light: '#cf222e', dark: '#ff7b72' } };
  const trafficColor = (pct) => pct >= 85 ? C.temp : pct >= 60 ? C.disk : C.cpu;
  const pctColor = (pct, lo, hi) => pct >= hi ? C.temp : pct >= lo ? C.disk : C.cpu;
  const bgGradient = { type: 'linear', colors: [C.bg1, C.bg2], startPoint: { x: 0, y: 0 }, endPoint: { x: 0.3, y: 1 } };
  const bar = (pct, color, h = 6) => ({ type: 'stack', direction: 'row', height: h, borderRadius: h / 2, backgroundColor: C.barBg, children: pct > 0 ? [{ type: 'stack', flex: Math.max(1, pct), height: h, borderRadius: h / 2, backgroundColor: color, children: [] }, ...(pct < 100 ? [{ type: 'spacer', flex: 100 - pct }] : [])] : [{ type: 'spacer' }] });
  const spark = (data, color, h = 20) => { const mx = Math.max(...data, 1); return { type: 'stack', direction: 'row', alignItems: 'end', height: h, gap: 1, children: data.map(v => { const r = v / mx; const alpha = Math.round((0.3 + 0.7 * r) * 255).toString(16).padStart(2, '0'); return { type: 'stack', flex: 1, borderRadius: 1, children: [], backgroundColor: { light: color.light + alpha, dark: color.dark + alpha }, height: Math.max(1, Math.round(r * h)) }; }) }; };
  const metric = (icon, label, pct, val, color) => ({ type: 'stack', direction: 'column', gap: 3, children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: `sf-symbol:${icon}`, color, width: 11, height: 11 }, { type: 'text', text: label, font: { size: 'caption1', weight: 'semibold' }, textColor: C.text }, { type: 'spacer' }, { type: 'text', text: val, font: { size: 11, weight: 'medium', family: 'Menlo' }, textColor: color }] }, bar(pct, color)] });
  const divider = { type: 'stack', height: 0.5, backgroundColor: C.barBg, children: [{ type: 'spacer' }] };
  const header = (iconSize) => ({ type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [{ type: 'image', src: 'sf-symbol:server.rack', color: C.cpu, width: iconSize, height: iconSize }, { type: 'text', text: d.hostname, font: { size: 'headline', weight: 'bold' }, textColor: C.text, maxLines: 1 }, { type: 'spacer' }, ...(d.temp > 0 ? [{ type: 'image', src: 'sf-symbol:thermometer.medium', color: pctColor(d.temp, 60, 80), width: 11, height: 11 }, { type: 'text', text: `${d.temp}°C`, font: { size: 11, family: 'Menlo' }, textColor: pctColor(d.temp, 60, 80) }] : []), { type: 'text', text: d.uptime, font: { size: 'caption2', weight: 'medium' }, textColor: C.muted, maxLines: 1, minScale: 0.7 }] });
  const makeFooter = () => ({ type: 'stack', direction: 'row', alignItems: 'center', children: [{ type: 'text', text: getRefreshTimeString(), font: { size: 'caption2' }, textColor: C.dim }, { type: 'spacer' }, { type: 'text', text: `流量重置: ${d.tfReset}`, font: { size: 'caption2' }, textColor: C.dim }] });

  return {
    type: 'widget', backgroundGradient: bgGradient, padding: [12, 14], gap: 6,
    children: [
      header(16), divider, 
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:cpu', color: C.cpu, width: 13, height: 13 }, { type: 'text', text: `CPU ${d.cores}C`, font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.cpuPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.cpuPct, 60, 85) }, { type: 'spacer' }, { type: 'text', text: `Load ${d.load.join(' ')}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      spark(d.cpuHist, pctColor(d.cpuPct, 60, 85), 28), bar(d.cpuPct, pctColor(d.cpuPct, 60, 85), 6), divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:memorychip', color: C.mem, width: 13, height: 13 }, { type: 'text', text: 'MEM', font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.memPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.memPct, 60, 85) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      bar(d.memPct, pctColor(d.memPct, 60, 85), 6), divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:internaldrive', color: C.disk, width: 13, height: 13 }, { type: 'text', text: 'Disk', font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.diskPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.diskPct, 70, 90) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.diskUsed)} / ${fmtBytes(d.diskTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      bar(d.diskPct, pctColor(d.diskPct, 70, 90), 6), { type: 'stack', direction: 'row', children: [{ type: 'text', text: `R ${fmtBytes(d.diskRd)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.disk }, { type: 'spacer' }, { type: 'text', text: `W ${fmtBytes(d.diskWr)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.disk }] }, divider,
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', color: trafficColor(d.tfPct), width: 13, height: 13 }, { type: 'text', text: 'Traffic', font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.tfPct.toFixed(1)}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: trafficColor(d.tfPct) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.tfUsed)} / ${fmtBytes(d.tfTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      bar(d.tfPct, trafficColor(d.tfPct), 6), 
      { type: 'stack', direction: 'row', children: [{ type: 'text', text: `↓ 下载: ${fmtBytes(d.rxRate)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }, { type: 'spacer' }, { type: 'text', text: `↑ 上传: ${fmtBytes(d.txRate)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] }, 
      divider, makeFooter(),
    ],
  };
}
