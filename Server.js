// Server Monitor Widget — Ultimate Mega Edition (All Specs Restored)
export default async function (ctx) {

  // ─── 核心辅助函数 ────────────────
  const fmtBytes = b => {
    if (!b || isNaN(b)) return '0B';
    if (b >= 1024 ** 4) return (b / 1024 ** 4).toFixed(1) + 'T';
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + 'G';
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + 'M';
    if (b >= 1024)      return (b / 1024).toFixed(0) + 'K';
    return Math.round(b) + 'B';
  };

  const formatUptime = (rawStr) => {
    let clean = rawStr.replace(/^up\s+/, '').replace(/,\s*$/, '').trim();
    if (!clean || clean === 'unknown') return '在线: —';

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
    
    return result ? `在线: ${result}` : '刚刚开机';
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
    const bwhVeid   = env.BWH_VEID || '';
    const bwhApiKey = env.BWH_API_KEY || '';

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
      'echo "[CMD4]"; awk \'/MemTotal/{mt=$2}/MemFree/{mf=$2}/Buffers/{mb=$2}/^Cached/{mc=$2}/SwapTotal/{st=$2}/SwapFree/{sf=$2}END{print mt*1024,(mt-mf-mb-mc)*1024,st*1024,(st-sf)*1024}\' /proc/meminfo 2>/dev/null || echo "1 0 1 0"',
      'echo "[CMD5]"; df -B1 / 2>/dev/null | tail -1 || echo "/ 1 0 0 0%"',
      'echo "[CMD6]"; nproc 2>/dev/null || echo "1"',
      'echo "[CMD7]"; awk \'/^ *(eth|en|wlan|ens|eno|bond|veth)/{rx+=$2;tx+=$10}END{print rx,tx}\' /proc/net/dev 2>/dev/null || echo "0 0"',
      'echo "[CMD8]"; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || cat /sys/class/hwmon/hwmon0/temp1_input 2>/dev/null || echo "0"',
      'echo "[CMD9]"; awk \'$3~/^(sd[a-z]|vd[a-z]|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$/{r+=$6;w+=$10}END{print r*512,w*512}\' /proc/diskstats 2>/dev/null || echo "0 0"',
      'echo "[CMD10]"; ls /proc 2>/dev/null | grep -c \'^[0-9]\' || echo "0"',
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

    const memNums = (parseOutput(stdout, 4) || '1 0 1 0').split(/\s+/).map(Number);
    const memTotal = memNums[0] || 1, memUsed = memNums[1] || 0;
    const swapTotal = memNums[2] || 0, swapUsed = memNums[3] || 0;
    
    const memPct = Math.min(100, Math.round((memUsed / memTotal) * 100)) || 0;
    const swapPct = swapTotal > 0 ? Math.min(100, Math.round((swapUsed / swapTotal) * 100)) : 0;

    const memHist = ctx.storage.getJSON('_memH') || [];
    memHist.push(memPct);
    while (memHist.length > 20) memHist.shift();
    ctx.storage.setJSON('_memH', memHist);

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

    const procs = parseInt(parseOutput(stdout, 10)) || 0;

    let tfUsed = 0, tfTotal = 1, tfPct = 0, tfReset = '—';
    if (bwhData && bwhData.data_counter !== undefined) {
      tfUsed  = bwhData.data_counter;
      tfTotal = bwhData.plan_monthly_data || 1;
      tfPct   = Math.min((tfUsed / tfTotal) * 100, 100);
      if (bwhData.data_next_reset) {
        const rd = new Date(bwhData.data_next_reset * 1000);
        tfReset = `${rd.getMonth() + 1}月${rd.getDate()}日`;
      }
    }

    d = {
      hostname, load, uptime, cpuPct, cpuHist, cores,
      memTotal, memUsed, memPct, memHist,
      swapTotal, swapUsed, swapPct, procs,
      diskTotal, diskUsed, diskPct, diskRd, diskWr,
      rxRate, txRate, netRx, netTx,
      tfUsed, tfTotal, tfPct, tfReset, temp
    };
  } catch (e) {
    d = { error: String(e.message || e) };
  }

  const C = {
    bg1:   { light: '#ffffff', dark: '#0d1117' },
    bg2:   { light: '#f6f8fa', dark: '#161b22' },
    barBg: { light: '#ebedef', dark: '#30363d' },
    text:  { light: '#1f2328', dark: '#e6edf3' },
    muted: { light: '#656d76', dark: '#9198a1' },
    dim:   { light: '#8c959f', dark: '#6e7681' },
    cpu:   { light: '#1a7f37', dark: '#3fb950' },
    mem:   { light: '#0969da', dark: '#58a6ff' },
    net:   { light: '#bf3989', dark: '#f778ba' },
    netTx: { light: '#8250df', dark: '#a371f7' },
    disk:  { light: '#9a6700', dark: '#d29922' },
    temp:  { light: '#cf222e', dark: '#ff7b72' },
  };

  const trafficColor = (pct) => pct >= 85 ? C.temp : pct >= 60 ? C.disk : C.cpu;
  const pctColor = (pct, lo, hi) => pct >= hi ? C.temp : pct >= lo ? C.disk : C.cpu;
  const alphaHex = a => Math.round(a * 255).toString(16).padStart(2, '0');
  const bgGradient = { type: 'linear', colors: [C.bg1, C.bg2], startPoint: { x: 0, y: 0 }, endPoint: { x: 0.3, y: 1 } };

  const bar = (pct, color, h = 5) => ({
    type: 'stack', direction: 'row', height: h, borderRadius: h / 2, backgroundColor: C.barBg,
    children: pct > 0 ? [
      { type: 'stack', flex: Math.max(1, pct), height: h, borderRadius: h / 2, backgroundColor: color, children: [] },
      ...(pct < 100 ? [{ type: 'spacer', flex: 100 - pct }] : []),
    ] : [{ type: 'spacer' }],
  });

  const spark = (data, color, h = 18) => {
    if (!data || data.length === 0) return { type: 'spacer', length: h };
    const mx = Math.max(...data, 1);
    return {
      type: 'stack', direction: 'row', alignItems: 'end', height: h, gap: 1,
      children: data.map(v => {
        const r = v / mx;
        const bg = typeof color === 'string' ? color + alphaHex(0.3 + 0.7 * r) : { light: color.light + alphaHex(0.3 + 0.7 * r), dark: color.dark + alphaHex(0.3 + 0.7 * r) };
        return { type: 'stack', flex: 1, borderRadius: 1, children: [], backgroundColor: bg, height: Math.max(1, Math.round(r * h)) };
      }),
    };
  };

  const metric = (icon, label, pct, val, color) => ({
    type: 'stack', direction: 'column', gap: 3,
    children: [
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
        { type: 'image', src: `sf-symbol:${icon}`, color, width: 11, height: 11 },
        { type: 'text', text: label, font: { size: 'caption1', weight: 'semibold' }, textColor: C.text },
        { type: 'spacer' },
        { type: 'text', text: val, font: { size: 11, weight: 'medium', family: 'Menlo' }, textColor: color },
      ]},
      bar(pct, color),
    ],
  });

  const divider = { type: 'stack', height: 0.5, backgroundColor: C.barBg, children: [{ type: 'spacer' }] };
  const header = (iconSize) => ({
    type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
      { type: 'image', src: 'sf-symbol:server.rack', color: C.cpu, width: iconSize, height: iconSize },
      { type: 'text', text: d.hostname, font: { size: 'headline', weight: 'bold' }, textColor: C.text, maxLines: 1 },
      { type: 'spacer' },
      ...(d.temp > 0 ? [
        { type: 'image', src: 'sf-symbol:thermometer.medium', color: pctColor(d.temp, 60, 80), width: 11, height: 11 },
        { type: 'text', text: `${d.temp}°C`, font: { size: 11, family: 'Menlo' }, textColor: pctColor(d.temp, 60, 80) },
        { type: 'spacer', width: 6 }
      ] : []),
      { type: 'text', text: d.uptime, font: { size: 'caption2', weight: 'semibold' }, textColor: C.muted, maxLines: 1, minScale: 0.7 },
    ],
  });

  if (d.error) {
    return {
      type: 'widget', padding: 16, gap: 8, backgroundColor: C.bg1,
      children: [
        { type: 'stack', direction: 'row', alignItems: 'center', gap: 8, children: [
          { type: 'image', src: 'sf-symbol:exclamationmark.triangle.fill', color: C.temp, width: 20, height: 20 },
          { type: 'text', text: 'Connection Failed', font: { size: 'headline', weight: 'bold' }, textColor: C.text },
        ]},
        { type: 'text', text: d.error, font: { size: 'caption1' }, textColor: C.muted, maxLines: 3 },
      ],
    };
  }

  if (ctx.widgetFamily === 'accessoryInline') return { type: 'widget', children: [{ type: 'text', text: `${d.hostname}  CPU ${d.cpuPct}%  MEM ${d.memPct}%` }] };
  if (ctx.widgetFamily === 'accessoryCircular') return { type: 'widget', padding: 4, children: [{ type: 'spacer' }, { type: 'text', text: `${d.cpuPct}%`, font: { size: 'title2', weight: 'bold' }, textAlign: 'center' }, { type: 'spacer' }] };
  if (ctx.widgetFamily === 'accessoryRectangular') return { type: 'widget', gap: 2, children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:server.rack', width: 11, height: 11 }, { type: 'text', text: d.hostname, font: { size: 'headline', weight: 'bold' }, maxLines: 1 }] }, { type: 'text', text: `CPU ${d.cpuPct}%  MEM ${d.memPct}%  DSK ${d.diskPct}%`, font: { size: 11, family: 'Menlo' } }, { type: 'text', text: `↓${fmtBytes(d.rxRate)}/s  ↑${fmtBytes(d.txRate)}/s`, font: { size: 11, family: 'Menlo' }, opacity: 0.7 }] };

  if (ctx.widgetFamily === 'systemSmall') {
    return {
      type: 'widget', backgroundGradient: bgGradient, padding: 12, gap: 6,
      children: [
        { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
          { type: 'image', src: 'sf-symbol:server.rack', color: C.cpu, width: 13, height: 13 },
          { type: 'text', text: d.hostname, font: { size: 'subheadline', weight: 'bold' }, textColor: C.text, maxLines: 1, minScale: 0.8 },
          { type: 'spacer' },
        ]},
        spark(d.cpuHist, C.cpu, 20),
        metric('cpu', 'CPU', d.cpuPct, `${d.cpuPct}%`, pctColor(d.cpuPct, 60, 85)),
        metric('memorychip', 'MEM', d.memPct, `${d.memPct}%`, pctColor(d.memPct, 60, 85)),
        metric('antenna.radiowaves.left.and.right', 'TRAF', d.tfPct, `${d.tfPct.toFixed(0)}%`, trafficColor(d.tfPct)),
      ],
    };
  }

  if (ctx.widgetFamily === 'systemMedium') {
    return {
      type: 'widget', backgroundGradient: bgGradient, padding: [10, 14],
      children: [
        { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [{ type: 'image', src: 'sf-symbol:server.rack', color: C.cpu, width: 14, height: 14 }, { type: 'text', text: d.hostname, font: { size: 'headline', weight: 'bold' }, textColor: C.text, maxLines: 1 }, { type: 'spacer' }] }, 
        { type: 'spacer' },
        { type: 'stack', direction: 'column', gap: 6, children: [
          { type: 'stack', direction: 'column', gap: 2, children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:cpu', color: C.cpu, width: 11, height: 11 }, { type: 'text', text: `CPU ${d.cores}C`, font: { size: 'caption1', weight: 'semibold' }, textColor: C.text }, { type: 'text', text: `${d.cpuPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.cpuPct, 60, 85) }, { type: 'spacer' }, { type: 'text', text: `Load ${d.load.join(' ')}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] }, bar(d.cpuPct, pctColor(d.cpuPct, 60, 85), 4)] },
          { type: 'stack', direction: 'column', gap: 2, children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:memorychip', color: C.mem, width: 11, height: 11 }, { type: 'text', text: 'MEM', font: { size: 'caption1', weight: 'semibold' }, textColor: C.text }, { type: 'text', text: `${d.memPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.memPct, 60, 85) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] }, bar(d.memPct, pctColor(d.memPct, 60, 85), 4)] },
          { type: 'stack', direction: 'column', gap: 2, children: [{ type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', color: trafficColor(d.tfPct), width: 11, height: 11 }, { type: 'text', text: 'TRAF', font: { size: 'caption1', weight: 'semibold' }, textColor: C.text }, { type: 'text', text: `${d.tfPct.toFixed(1)}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: trafficColor(d.tfPct) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.tfUsed)} / ${fmtBytes(d.tfTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] }, bar(d.tfPct, trafficColor(d.tfPct), 4)] },
        ]},
        { type: 'spacer' },
        { type: 'stack', direction: 'row', alignItems: 'center', children: [{ type: 'text', text: getRefreshTimeString(), font: { size: 'caption2' }, textColor: C.dim }, { type: 'spacer' }, { type: 'text', text: `流量重置: ${d.tfReset || '—'}`, font: { size: 'caption2' }, textColor: C.dim }] }
      ],
    };
  }

  // 大组件 (终极豪华紧凑调校版)
  return {
    type: 'widget', backgroundGradient: bgGradient, padding: [10, 14], gap: 4,
    children: [
      header(16), divider, { type: 'spacer', length: 2 },
      
      // CPU 区
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:cpu', color: C.cpu, width: 13, height: 13 }, { type: 'text', text: `CPU ${d.cores}C`, font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.cpuPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.cpuPct, 60, 85) }, { type: 'spacer' }, { type: 'text', text: `Load ${d.load.join(' ')}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      spark(d.cpuHist, pctColor(d.cpuPct, 60, 85), 22), bar(d.cpuPct, pctColor(d.cpuPct, 60, 85), 5), divider, { type: 'spacer', length: 2 },
      
      // MEM & Swap 区
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:memorychip', color: C.mem, width: 13, height: 13 }, { type: 'text', text: 'MEM', font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.memPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.memPct, 60, 85) }, { type: 'spacer' }, { type: 'text', text: `Procs: ${d.procs}`, font: { size: 10, weight: 'medium' }, textColor: C.text }, { type: 'spacer', width: 6 }, { type: 'text', text: `${fmtBytes(d.memUsed)} / ${fmtBytes(d.memTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      spark(d.memHist, C.mem, 20), bar(d.memPct, pctColor(d.memPct, 60, 85), 5),
      // 智能隐藏/展示 Swap 机制
      ...(d.swapTotal > 0 ? [
        { type: 'stack', direction: 'row', children: [{ type: 'text', text: `Swap: ${d.swapPct}%`, font: { size: 10, family: 'Menlo' }, textColor: d.swapPct > 50 ? C.temp : C.dim }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.swapUsed)} / ${fmtBytes(d.swapTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] }
      ] : []),
      divider, { type: 'spacer', length: 2 },
      
      // Disk 区
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:internaldrive', color: C.disk, width: 13, height: 13 }, { type: 'text', text: 'Disk', font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.diskPct}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: pctColor(d.diskPct, 70, 90) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.diskUsed)} / ${fmtBytes(d.diskTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      bar(d.diskPct, pctColor(d.diskPct, 70, 90), 5), { type: 'stack', direction: 'row', children: [{ type: 'text', text: `R ${fmtBytes(d.diskRd)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.disk }, { type: 'spacer' }, { type: 'text', text: `W ${fmtBytes(d.diskWr)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.disk }] }, divider, { type: 'spacer', length: 2 },
      
      // Traffic 区
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [{ type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', color: trafficColor(d.tfPct), width: 13, height: 13 }, { type: 'text', text: 'Traffic', font: { size: 'caption1', weight: 'bold' }, textColor: C.text }, { type: 'text', text: `${d.tfPct.toFixed(1)}%`, font: { size: 'caption1', weight: 'bold', family: 'Menlo' }, textColor: trafficColor(d.tfPct) }, { type: 'spacer' }, { type: 'text', text: `${fmtBytes(d.tfUsed)} / ${fmtBytes(d.tfTotal)}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] },
      bar(d.tfPct, trafficColor(d.tfPct), 5), 
      { type: 'stack', direction: 'row', children: [{ type: 'text', text: `↓ 下载: ${fmtBytes(d.rxRate)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }, { type: 'spacer' }, { type: 'text', text: `↑ 上传: ${fmtBytes(d.txRate)}/s`, font: { size: 10, family: 'Menlo' }, textColor: C.dim }] }, 
      divider,
      
      { type: 'stack', direction: 'row', alignItems: 'center', children: [{ type: 'text', text: getRefreshTimeString(), font: { size: 'caption2' }, textColor: C.dim }, { type: 'spacer' }, { type: 'text', text: `流量重置: ${d.tfReset || '—'}`, font: { size: 'caption2' }, textColor: C.dim }] },
    ],
  };
}
