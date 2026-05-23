// Server Monitor Widget — Perfect Localized & Optimized Edition (Cleaned)
export default async function (ctx) {

  // ─── Helpers ────────────────────────────────
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
    const weekMatch = clean.match(/(\d+)\s+weeks?/);
    if (weekMatch) totalDays += parseInt(weekMatch[1]) * 7;
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
    const bwhVeid        = env.BWH_VEID || '';
    const bwhApiKey      = env.BWH_API_KEY || '';
    const trafficLimitGB = Number(env.TRAFFIC_LIMIT) || 2000;
    const resetDay       = Number(env.RESET_DAY) || 1;

    let finalKey = privateKey;
    if (privateKey && typeof privateKey === 'string') {
      const raw = privateKey.trim();
      const headerMatch = raw.match(/-----BEGIN [A-Z ]+-----/);
      const footerMatch = raw.match(/-----END [A-Z ]+-----/);
      if (headerMatch && footerMatch) {
        const header = headerMatch[0], footer = footerMatch[0];
        let body = raw.substring(raw.indexOf(header) + header.length, raw.indexOf(footer)).replace(/\s+/g, '');
        const lines = body.match(/.{1,64}/g) || [];
        finalKey = `${header}\n${lines.join('\n')}\n${footer}`;
      } else {
        finalKey = raw.replace(/\\n/g, '\n');
      }
    }

    let bwhData = null;
    if (bwhVeid && bwhApiKey) {
      try {
        const resp = await ctx.http.get(`https://api.64clouds.com/v1/getServiceInfo?veid=${bwhVeid}&api_key=${bwhApiKey}`);
        bwhData = await resp.json();
      } catch (e) { console.log('BWH API Error:', e); }
    }

    const session = await ctx.ssh.connect({
      host, port: Number(port || 22), username,
      ...(finalKey ? { privateKey: finalKey } : { password }),
      timeout: 8000,
    });

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

    const parseOutput = (outputStr, index) => {
      const regex = new RegExp(`\\[CMD${index}\\]\\n?([^]*?)(?=\\n?\\[CMD|$)`);
      const match = outputStr.match(regex);
      return match ? match[1].trim() : '';
    };

    const hostname = parseOutput(stdout, 0) || 'server';
    const la = (parseOutput(stdout, 1) || '0 0 0').split(' ');
    const load = [la[0] || '0', la[1] || '0', la[2] || '0'];
    const uptime = formatUptime(parseOutput(stdout, 2));

    const cpuStr = parseOutput(stdout, 3) || 'cpu 0 0 0 0';
    const cpuNums = cpuStr.replace(/^cpu\s+/, '').split(/\s+/).map(Number);
    const cpuTotal = cpuNums.reduce((a, b) => a + b, 0) || 0;
    const cpuIdle = cpuNums[3] || 0;
    const prevCpu = ctx.storage.getJSON('_cpu');
    let cpuPct = 0;
    if (prevCpu && cpuTotal > prevCpu.t) {
      cpuPct = Math.round(((cpuTotal - prevCpu.t - (cpuIdle - prevCpu.i)) / (cpuTotal - prevCpu.t)) * 100);
    }
    ctx.storage.setJSON('_cpu', { t: cpuTotal, i: cpuIdle });
    cpuPct = Math.max(0, Math.min(100, isNaN(cpuPct) ? 0 : cpuPct));
    const cpuHist = ctx.storage.getJSON('_cpuH') || [];
    cpuHist.push(cpuPct);
    while (cpuHist.length > 20) cpuHist.shift();
    ctx.storage.setJSON('_cpuH', cpuHist);

    const memNums = (parseOutput(stdout, 4) || '1 0').split(/\s+/).map(Number);
    const memTotal = memNums[0] || 1, memUsed = memNums[1] || 0;
    const memPct = Math.min(100, Math.round((memUsed / memTotal) * 100)) || 0;

    const df = (parseOutput(stdout, 5) || '').split(/\s+/);
    const diskTotal = Number(df[1]) || 1, diskUsed = Number(df[2]) || 0;
    const diskPct = parseInt(df[4]) || 0;
    const cores = parseInt(parseOutput(stdout, 6)) || 1;

    const nn = (parseOutput(stdout, 7) || '0 0').split(' ');
    const netRx = Number(nn[0]) || 0, netTx = Number(nn[1]) || 0;
    const prevNet = ctx.storage.getJSON('_net');
    const now = Date.now();
    let rxRate = 0, txRate = 0;
    if (prevNet && prevNet.ts) {
      const el = (now - prevNet.ts) / 1000;
      if (el > 0 && el < 3600) {
        rxRate = Math.max(0, (netRx - prevNet.rx) / el);
        txRate = Math.max(0, (netTx - prevNet.tx) / el);
      }
    }
    ctx.storage.setJSON('_net', { rx: netRx, tx: netTx, ts: now });

    const tempRaw = parseInt(parseOutput(stdout, 8)) || 0;
    const temp = tempRaw > 1000 ? Math.round(tempRaw / 1000) : tempRaw;

    const dio = (parseOutput(stdout, 9) || '0 0').split(' ');
    const drt = Number(dio[0]) || 0, dwt = Number(dio[1]) || 0;
    const prevDsk = ctx.storage.getJSON('_dsk');
    let diskRd = 0, diskWr = 0;
    if (prevDsk && prevDsk.ts) {
      const el = (now - prevDsk.ts) / 1000;
      if (el > 0 && el < 3600) {
        diskRd = Math.max(0, (drt - prevDsk.r) / el);
        diskWr = Math.max(0, (dwt - prevDsk.w) / el);
      }
    }
    ctx.storage.setJSON('_dsk', { r: drt, w: dwt, ts: now });

    let tfUsed = 0, tfTotal = 1, tfPct = 0, tfReset = '—';
    if (bwhData && bwhData.data_counter !== undefined) {
      tfUsed  = bwhData.data_counter;
      tfTotal = bwhData.plan_monthly_data || 1;
      tfPct   = Math.min((tfUsed / tfTotal) * 100, 100);
      tfReset = bwhData.data_next_reset ? `${new Date(bwhData.data_next_reset * 1000).getMonth() + 1}月${new Date(bwhData.data_next_reset * 1000).getDate()}日` : '—';
    } else {
      tfUsed  = netRx + netTx;
      tfTotal = trafficLimitGB * (1024 ** 3);
      tfPct   = Math.min((tfUsed / tfTotal) * 100, 100);
      tfReset = getNextResetDate(resetDay);
    }

    d = { hostname, load, uptime, cpuPct, cpuHist, cores, memTotal, memUsed, memPct, diskTotal, diskUsed, diskPct, diskRd, diskWr, rxRate, txRate, netRx, netTx, tfUsed, tfTotal, tfPct, tfReset, temp };
  } catch (e) { d = { error: String(e.message || e) }; }

  // ... [其余 UI 渲染逻辑保持不变，确保所有调用 d.procs 和 d.memHist 的地方已移除]
}
