/**
 * =================================================================
 * 🖥️ Server Monitor Widget Pro (完美闭环终结版)
 * =================================================================
 */

export default async function (ctx) {
  const env = ctx.env || {}; 
  
  const SERVER_CONFIG = {
    widgetName: env.WIDGET_NAME || 'My Node',        
    host: env.SERVER_HOST || '',                     
    port: Number(env.SERVER_PORT) || 22,             
    username: env.SERVER_USER || 'root',             
    password: env.SERVER_PASSWORD || '',             
    privateKey: env.SERVER_KEY || '',                
    maskIp: String(env.MASK_IP).toLowerCase() === 'true', 
    bwhVeid: env.BWH_VEID || '',                     
    bwhApiKey: env.BWH_API_KEY || '',                
    trafficLimitGB: Number(env.TRAFFIC_LIMIT) || 2000, 
    resetDay: Number(env.RESET_DAY) || 1             
  };

  const C = {
    bg: { light: '#FFFFFF', dark: '#121212' },       
    barBg: { light: '#0000001A', dark: '#FFFFFF22' },
    text: { light: '#1C1C1E', dark: '#FFFFFF' },     
    dim: { light: '#8E8E93', dark: '#8E8E93' },      
    
    cpu: { light: '#34C759', dark: '#30D158' },      
    mem: { light: '#007AFF', dark: '#0A84FF' },      
    disk: { light: '#FF9500', dark: '#FF9F0A' },     
  };

  const getTrafficColor = (pct) => {
    if (pct >= 85) return { light: '#FF3B30', dark: '#FF453A' }; 
    if (pct >= 60) return { light: '#FF9500', dark: '#FF9F0A' }; 
    return { light: '#34C759', dark: '#30D158' };                
  };

  const fmtBytes = (b) => {
    if (b >= 1024 ** 4) return (b / 1024 ** 4).toFixed(1) + 'T';
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + 'G';
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + 'M';
    if (b >= 1024)      return (b / 1024).toFixed(1) + 'K';
    return Math.round(b) + 'B';
  };

  const processIP = (ip) => {
    if (!ip || !SERVER_CONFIG.maskIp) return ip;
    if (ip.includes('.')) return ip.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*');
    if (ip.includes(':')) {
      const parts = ip.split(':');
      return parts.length >= 3 ? `${parts[0]}:${parts[1]}:${parts[2]}:****` : ip;
    }
    return ip;
  };

  const getNextResetDate = (resetDay) => {
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth();
    if (now.getDate() >= resetDay) m += 1; 
    if (m > 11) { m = 0; y += 1; }
    return `${m + 1}月${resetDay}日`;
  };

  let d;
  try {
    const { host, port, username, password, privateKey, widgetName, bwhVeid, bwhApiKey, trafficLimitGB, resetDay } = SERVER_CONFIG;
    if (!host) throw new Error('未配置 SERVER_HOST');

    const safeHost = encodeURIComponent(host);
    const storageVer = 'v2_'; 

    let finalKey = privateKey;
    if (privateKey && typeof privateKey === 'string') {
      const raw = privateKey.trim();
      const headerMatch = raw.match(/-----BEGIN [A-Z ]+-----/);
      const footerMatch = raw.match(/-----END [A-Z ]+-----/);
      if (headerMatch && footerMatch) {
        const header = headerMatch[0], footer = footerMatch[0];
        let body = raw.substring(raw.indexOf(header) + header.length, raw.indexOf(footer));
        body = body.replace(/\s+/g, '');
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

    const SEP = '<<SEP>>';
    // 💡 采用分号隔离，加入第 10 项 uptime -p
    const cmds = [
      'hostname -s 2>/dev/null || hostname',
      'cat /proc/loadavg 2>/dev/null || echo "0 0 0"',
      'head -1 /proc/stat 2>/dev/null || echo ""',
      "awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/MemFree/{f=$2}/Buffers/{b=$2}/^Cached/{c=$2}END{print t,a,f,b,c}' /proc/meminfo 2>/dev/null || echo '0 0 0 0 0'",
      'df -B1 --output=size,used,pcent / 2>/dev/null | tail -1 || LANG=C df -B1 / | tail -1 2>/dev/null || echo ""',
      'nproc 2>/dev/null || echo "1"',
      "curl -4 -s -m 2 ipv4.ip.sb || curl -6 -s -m 2 ipv6.ip.sb || echo ''",
      "awk '/^[ ]*[a-z]/ && !/^(lo|veth|docker|br-|zt|tailscale)/ {sub(/.*:/, \"\"); rx+=$1; tx+=$9} END{print rx,tx}' /proc/net/dev 2>/dev/null || echo '0 0'",
      'find /proc -maxdepth 1 -type d -regex \'.*/[0-9]+\' 2>/dev/null | wc -l || echo "0"',
      'uptime -p 2>/dev/null || echo "up 1 hour"'
    ];

    const { stdout } = await session.exec(cmds.join(` ; echo '${SEP}' ; `));
    await session.close();

    const p = stdout.split(SEP).map(s => s.trim());
    const hostname = widgetName !== 'My Node' ? widgetName : (p[0] || 'Server');

    const loadArr = (p[1] || '0 0 0').split(' ').slice(0, 3);
    const loadStr = `${loadArr[0]} ${loadArr[1]} ${loadArr[2]}`;

    // CPU 计算
    const load1 = parseFloat(loadArr[0]) || 0;
    const cores = parseInt(p[5]) || 1;
    const cpuNums = (p[2] || '').replace(/^cpu\s+/, '').split(/\s+/).map(Number);
    const cpuTotal = cpuNums.reduce((a, b) => a + b, 0);
    const cpuIdle = (cpuNums[3] || 0) + (cpuNums[4] || 0); 
    const prevCpu = ctx.storage.getJSON(`${storageVer}cpu_${safeHost}`);
    let cpuPct = 0;
    if (prevCpu && cpuTotal > prevCpu.t) {
      cpuPct = Math.round(((cpuTotal - prevCpu.t - (cpuIdle - prevCpu.i)) / (cpuTotal - prevCpu.t)) * 100);
    } else {
      cpuPct = Math.round((load1 / cores) * 100);
    }
    ctx.storage.setJSON(`${storageVer}cpu_${safeHost}`, { t: cpuTotal, i: cpuIdle });
    cpuPct = Math.max(0, Math.min(100, cpuPct));

    // MEM 计算
    const memInfo = (p[3] || '0 0 0 0 0').split(' ').map(Number);
    const memTotal = memInfo[0] * 1024 || 1;
    let memAvailable = memInfo[1] * 1024 || 0;
    if (memAvailable === 0) {
      memAvailable = (memInfo[2] + memInfo[3] + memInfo[4]) * 1024 || 0;
    }
    const memUsed = memTotal - memAvailable;
    const memPct = Math.min(100, Math.round((memUsed / memTotal) * 100));

    // DISK 计算
    const df = (p[4] || '').split(/\s+/);
    const diskTotal = Number(df[df.length - 3]) || 1;
    const diskUsed = Number(df[df.length - 2]) || 0;
    const diskPct = parseInt((df[df.length - 1] || '0').replace('%', '')) || 0;

    // IP
    let ipInfo = processIP(p[6] || host);

    // Network 速率
    const nn = (p[7] || '0 0').split(' ');
    const netRx = Number(nn[0]) || 0, netTx = Number(nn[1]) || 0;
    const prevNet = ctx.storage.getJSON(`${storageVer}net_${safeHost}`);
    const now = Date.now();
    let rxRate = 0, txRate = 0;
    if (prevNet && prevNet.ts) {
      const el = (now - prevNet.ts) / 1000;
      if (el > 0 && el < 3600) {
        rxRate = Math.max(0, (netRx - prevNet.rx) / el);
        txRate = Math.max(0, (netTx - prevNet.tx) / el);
      }
    }
    ctx.storage.setJSON(`${storageVer}net_${safeHost}`, { rx: netRx, tx: netTx, ts: now });

    const processesCount = parseInt(p[8]) || 0;
    
    // 💡 运行时间精简格式化：将 "up 2 weeks, 3 days" 缩短为 "up 2w 3d"
    const uptimeRaw = p[9] || 'up 1 hour';
    const uptimeStr = uptimeRaw.replace('weeks', 'w').replace('week', 'w').replace('days', 'd').replace('day', 'd').replace('hours', 'h').replace('hour', 'h').replace(/,\s*/g, ' ');

    // 流量周期统计
    let tfUsed = 0, tfTotal = 1, tfPct = 0, tfReset = '';
    const trafficKey = `${storageVer}traffic_${safeHost}_${resetDay}`;
    const prevTraffic = ctx.storage.getJSON(trafficKey);

    if (bwhData && bwhData.data_counter !== undefined) {
      let bwhCounter = bwhData.data_counter || 0;
      let bwhPlan = bwhData.plan_monthly_data || 1;
      if (bwhPlan < 50000) { 
        bwhCounter = bwhCounter * (1024 ** 3);
        bwhPlan = bwhPlan * (1024 ** 3);
      }
      tfUsed = bwhCounter;
      tfTotal = bwhPlan;
      tfPct = Math.min((tfUsed / tfTotal) * 100, 100) || 0;
      const rd = new Date((bwhData.data_next_reset || 0) * 1000);
      tfReset = `${rd.getMonth() + 1}月${rd.getDate()}日`;
      if (bwhData.ip_addresses?.[0]) ipInfo = processIP(bwhData.ip_addresses[0]);
    } else {
      tfTotal = trafficLimitGB * (1024 ** 3);
      const nowDate = new Date();
      let cycleDate = new Date(nowDate);
      if (nowDate.getDate() < resetDay) {
        cycleDate.setMonth(cycleDate.getMonth() - 1);
      }
      const currentCycle = `${cycleDate.getFullYear()}-${cycleDate.getMonth()}`;

      const currentNetTotal = netRx + netTx;
      const isRebooted = prevTraffic && currentNetTotal < (prevTraffic.lastRaw || 0);
      const isNewCycle = !prevTraffic || prevTraffic.cycle !== currentCycle || isRebooted;
      
      if (isNewCycle) {
        tfUsed = 0;
        ctx.storage.setJSON(trafficKey, { cycle: currentCycle, base: currentNetTotal, lastRaw: currentNetTotal });
      } else {
        tfUsed = Math.max(0, currentNetTotal - (prevTraffic.base || 0));
        ctx.storage.setJSON(trafficKey, { cycle: currentCycle, base: prevTraffic.base, lastRaw: currentNetTotal });
      }
      tfPct = Math.min((tfUsed / tfTotal) * 100, 100) || 0;
      tfReset = getNextResetDate(resetDay);
    }

    const dNow = new Date();
    const timeStr = `${String(dNow.getHours()).padStart(2, '0')}:${String(dNow.getMinutes()).padStart(2, '0')}`;

    d = {
      hostname, loadStr, cpuPct, cores,
      memTotal, memUsed, memPct, processesCount,
      diskTotal, diskUsed, diskPct, 
      rxRate, txRate, tfUsed, tfTotal, tfPct, tfReset, timeStr, uptimeStr, ipInfo
    };
  } catch (e) {
    d = { error: String(e.message || e) };
  }

  const segCount = ctx.widgetFamily === 'systemSmall' ? 18 : 24;
  const bar = (pct, color, h = 6) => {
    const activeCount = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segCount);
    return {
      type: 'stack', direction: 'row', height: h, gap: 1.5,
      children: Array.from({ length: segCount }).map((_, i) => ({
        type: 'stack', flex: 1, height: h, borderRadius: 1,
        backgroundColor: i < activeCount ? color : C.barBg,
      }))
    };
  };

  if (d.error) {
    return { type: 'widget', padding: [14, 16], backgroundColor: C.bg, children: [
      { type: 'text', text: '⚠️ 无法建立连接', font: { size: 'headline', weight: 'bold' }, textColor: '#FF3B30' },
      { type: 'text', text: d.error, font: { size: 'caption1' }, textColor: C.dim, maxLines: 3 },
    ]};
  }

  // ==================== Small 尺寸布局 ====================
  if (ctx.widgetFamily === 'systemSmall') {
    return {
      type: 'widget', backgroundColor: C.bg, padding: [12, 16], gap: 6,
      children: [
        { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
          { type: 'image', src: 'sf-symbol:server.rack', color: C.text, width: 14, height: 14 },
          { type: 'text', text: d.hostname, font: { size: 'subheadline', weight: 'bold' }, textColor: C.text },
        ]},
        { type: 'text', text: d.ipInfo, font: { size: 9.5, family: 'Menlo' }, textColor: C.dim, maxLines: 1 },
        ...[
          { lb: 'CPU', pt: d.cpuPct, c: C.cpu },
          { lb: 'MEM', pt: d.memPct, c: C.mem },
          { lb: 'TRAF', pt: d.tfPct, c: getTrafficColor(d.tfPct) }
        ].map(item => ({
          type: 'stack', direction: 'column', gap: 3, children: [
            { type: 'stack', direction: 'row', alignItems: 'center', children: [
              { type: 'text', text: item.lb, font: { size: 10, weight: 'bold' }, textColor: C.text },
              { type: 'spacer' },
              { type: 'text', text: `${item.pt}%`, font: { size: 11, weight: 'heavy', family: 'Menlo' }, textColor: item.c },
            ]},
            bar(item.pt, item.c, 6)
          ]
        }))
      ]
    };
  }

  // ==================== Medium 尺寸布局 ====================
  return {
    type: 'widget', backgroundColor: C.bg, padding: [12, 14], gap: 8,
    children: [
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
        { type: 'image', src: 'sf-symbol:server.rack', color: C.text, width: 15, height: 15 },
        { type: 'text', text: d.hostname, font: { size: 14, weight: 'bold' }, textColor: C.text },
        // 💡 完美的左侧名字 + 你的 16:57 刷新整点时间
        { type: 'text', text: `•  ${d.timeStr}`, font: { size: 10 }, textColor: C.dim }, 
        { type: 'spacer' },
        // 💡 完美的右侧：运行时间与负载并列，极其协调
        { type: 'text', text: `${d.uptimeStr}  •  Load: ${d.loadStr}`, font: { size: 10, family: 'Menlo' }, textColor: C.dim },
      ]},

      { type: 'stack', direction: 'column', gap: 7, children: [
        // CPU
        { type: 'stack', direction: 'column', gap: 3, children: [
          { type: 'stack', direction: 'row', alignItems: 'center', children: [
            { type: 'text', text: `CPU ${d.cores}C`, font: { size: 11.5, weight: 'bold' }, textColor: C.text },
            { type: 'spacer' },
            { type: 'text', text: `${d.cpuPct}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: C.cpu },
          ]},
          bar(d.cpuPct, C.cpu, 6)
        ]},

        // MEM
        { type: 'stack', direction: 'column', gap: 3, children: [
          { type: 'stack', direction: 'row', alignItems: 'center', children: [
            { type: 'text', text: 'MEM', font: { size: 11.5, weight: 'bold' }, textColor: C.text },
            { type: 'spacer' },
            { type: 'text', text: `${d.memPct}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: C.mem },
            { type: 'spacer' },
            { type: 'text', text: `${fmtBytes(d.memUsed)}/${fmtBytes(d.memTotal)}`, font: { size: 9.5, family: 'Menlo' }, textColor: C.dim },
          ]},
          bar(d.memPct, C.mem, 6)
        ]},

        // DISK
        { type: 'stack', direction: 'column', gap: 3, children: [
          { type: 'stack', direction: 'row', alignItems: 'center', children: [
            { type: 'text', text: 'DISK', font: { size: 11.5, weight: 'bold' }, textColor: C.text },
            { type: 'spacer' },
            { type: 'text', text: `${d.diskPct}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: C.disk },
            { type: 'spacer' },
            { type: 'text', text: `${fmtBytes(d.diskUsed)}/${fmtBytes(d.diskTotal)}`, font: { size: 9.5, family: 'Menlo' }, textColor: C.dim },
          ]},
          bar(d.diskPct, C.disk, 6)
        ]},

        // TRAFFIC (实时速率稳稳吸附在此处)
        { type: 'stack', direction: 'column', gap: 3, children: [
          { type: 'stack', direction: 'row', alignItems: 'center', children: [
            { type: 'text', text: 'TRAFFIC', font: { size: 11.5, weight: 'bold' }, textColor: C.text },
            { type: 'spacer' },
            { type: 'text', text: `${d.tfPct.toFixed(1)}%`, font: { size: 12, weight: 'heavy', family: 'Menlo' }, textColor: getTrafficColor(d.tfPct) },
            { type: 'spacer' },
            { type: 'text', text: `↓${fmtBytes(d.rxRate)}/s ↑${fmtBytes(d.txRate)}/s  (${fmtBytes(d.tfUsed)}/${fmtBytes(d.tfTotal)})`, font: { size: 9.5, family: 'Menlo' }, textColor: C.dim },
          ]},
          bar(d.tfPct, getTrafficColor(d.tfPct), 6)
        ]}
      ]},

      // 底部栏
      { type: 'stack', direction: 'row', alignItems: 'center', gap: 8, children: [
        { type: 'text', text: `⚙️ ${d.processesCount}`, font: { size: 9 }, textColor: C.dim },
        { type: 'text', text: d.ipInfo, font: { size: 9.5, family: 'Menlo', weight: 'bold' }, textColor: C.dim },
        { type: 'spacer' },
        { type: 'text', text: `重置 ${d.tfReset}`, font: { size: 9 }, textColor: C.dim },
      ]}
    ]
  };
}
