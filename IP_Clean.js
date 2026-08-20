/**
 * 📌 桌面小组件: 🛡️ IP 纯净度
 * 小组件环境变量：
 * 1. 名称 policy，值为策略组名称，默认 DIRECT
 */
export default async function(ctx) {
  const POLICY = ctx.env.policy || 'DIRECT';

  const BG_COLOR   = { light: '#FFFFFF', dark: '#2C2C2E' };
  const C_TITLE    = { light: '#1A1A1A', dark: '#FFD700' };
  const C_SUB      = { light: '#666666', dark: '#B0B0B0' };
  const C_MAIN     = { light: '#1A1A1A', dark: '#FFFFFF' };
  const C_GREEN    = { light: '#32D74B', dark: '#32D74B' };
  const C_ICON_IP  = { light: '#007AFF', dark: '#0A84FF' };
  const C_ICON_LOC = { light: '#5856D6', dark: '#5E5CE6' };

  let d = {};
  let fetchError = false;
  try {
    const res = await ctx.http.get('https://my.ippure.com/v1/info', {
      timeout: 8000,
      policy: POLICY
    });
    const text = await res.text();
    d = JSON.parse(text);
    if (typeof d !== 'object' || d === null) d = {};
  } catch (e) {
    fetchError = true;
  }

  const ipRaw = d.ip || "";
  const ip = ipRaw || "获取失败";
  const ipLabel = !ipRaw ? "IP" : ipRaw.includes(':') ? "IPv6" : "IPv4";
  const ipColor = ipRaw ? C_GREEN : C_SUB;

  const asn = d.asn ? `AS${d.asn} ${d.asOrganization || ""}`.trim() : "未知";
  const asnColor = d.asn ? C_GREEN : C_SUB;

  let code = d.countryCode || "";
  if (code.toUpperCase() === 'TW') code = 'CN';
  const flag = code
    ? String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt()))
    : "";
  const loc = (d.country || d.city)
    ? ((d.country !== d.city)
      ? `${flag} ${d.country || ""} ${d.city || ""}`.trim()
      : `${flag} ${d.city || ""}`.trim())
    : "未知位置";
  const locColor = (d.country || d.city) ? C_MAIN : C_SUB;

  const ipTypeText = d.isBroadcast === true ? "📡 广播IP" : (d.isBroadcast === false ? "🏠 原生IP" : "未知");

  const risk = d.fraudScore;
  let riskTxt = "获取失败", riskCol = C_SUB, riskIc = "shield.slash";
  if (risk !== undefined) {
    if (risk >= 80) {
      riskTxt = `极高风险 (${risk})`;
      riskCol = { light: '#FF3B30', dark: '#FF3B30' };
      riskIc = "xmark.shield.fill";
    } else if (risk >= 70) {
      riskTxt = `高风险 (${risk})`;
      riskCol = { light: '#FF9500', dark: '#FF9500' };
      riskIc = "exclamationmark.shield.fill";
    } else if (risk >= 40) {
      riskTxt = `中等风险 (${risk})`;
      riskCol = { light: '#FFD60A', dark: '#FFD60A' };
      riskIc = "exclamationmark.shield.fill";
    } else {
      riskTxt = `纯净低危 (${risk})`;
      riskCol = C_GREEN;
      riskIc = "checkmark.shield.fill";
    }
  }

  const Row = (iconName, iconColor, label, value, valueColor) => ({
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 8,
    children: [
      { type: 'image', src: `sf-symbol:${iconName}`, color: iconColor, width: 16, height: 16 },
      { type: 'text', text: label, font: { size: 13 }, textColor: C_SUB },
      { type: 'spacer' },
      { type: 'text', text: value, font: { size: 13, weight: 'bold', family: 'Menlo' }, textColor: valueColor, maxLines: 1, minScale: 0.6 }
    ]
  });

  return {
    type: 'widget',
    padding: 16,
    gap: 12,
    backgroundColor: BG_COLOR,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 8,
        children: [
          { type: 'image', src: 'sf-symbol:shield.lefthalf.filled', color: C_TITLE, width: 18, height: 18 },
          { type: 'text', text: 'IP 纯净度', font: { size: 16, weight: 'heavy' }, textColor: C_TITLE },
          { type: 'spacer' },
          ...(fetchError ? [{ type: 'text', text: '⚠️ 请求失败', font: { size: 11 }, textColor: C_SUB }] : [])
        ]
      },
      {
        type: 'stack',
        direction: 'column',
        gap: 10,
        children: [
          Row("globe", C_ICON_IP, ipLabel, ip, ipColor),
          Row("number.square", C_ICON_IP, "归属网络", asn, asnColor),
          Row("mappin.and.ellipse", C_ICON_LOC, "位置", loc, locColor),
          Row("antenna.radiowaves.left.and.right", C_ICON_LOC, "IP属性", ipTypeText, C_SUB),
          Row(riskIc, riskCol, "风险评级", riskTxt, riskCol)
        ]
      }
    ]
  };
}
