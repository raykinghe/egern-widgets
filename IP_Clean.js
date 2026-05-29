/**
* 📌 桌面小组件: 🛡️ IP 纯净度（双节点版）
* 环境变量：
* 1. policy1 - 第一个策略组名称
* 2. policy2 - 第二个策略组名称
* 🔗 原作者: https://raw.githubusercontent.com/IBL3ND/module/main/IP_Clean.JS
*/
export default async function(ctx) {
 const POLICY1 = ctx.env.policy1 || 'DIRECT';
 const POLICY2 = ctx.env.policy2 || 'DIRECT';
 const NAME1 = ctx.env.name1 || POLICY1;
 const NAME2 = ctx.env.name2 || POLICY2;

 const BG_COLOR   = { light: '#FFFFFF', dark: '#2C2C2E' };
 const C_TITLE    = { light: '#1A1A1A', dark: '#FFD700' };
 const C_SUB      = { light: '#666666', dark: '#B0B0B0' };
 const C_MAIN     = { light: '#1A1A1A', dark: '#FFFFFF' };
 const C_GREEN    = { light: '#32D74B', dark: '#32D74B' };
 const C_ICON_IP  = { light: '#007AFF', dark: '#0A84FF' };
 const C_ICON_LOC = { light: '#5856D6', dark: '#5E5CE6' };

 const SMALL_FONT = 11;
 const SMALL_ICON = 12;

 async function fetchInfo(policy) {
   try {
     const res = await ctx.http.get('https://my.ippure.com/v1/info', {
       timeout: 4000,
       policy: policy
     });
     return JSON.parse(await res.text());
   } catch (e) {
     return null;
   }
 }

 function buildInfo(d) {
   if (!d) return {
     ip: "获取失败", asn: "未知",
     loc: "未知位置", ipTypeText: "未知",
     riskTxt: "获取失败", riskCol: C_SUB, riskIc: "questionmark.shield.fill"
   };

   const ip = d.ip || "获取失败";
   const asn = d.asn ? `AS${d.asn}` : "未知";

   let code = d.countryCode || "";
   if (code.toUpperCase() === 'TW') code = 'CN';
   const flag = code
     ? String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt()))
     : "🌐";
   const loc = `${flag} ${code.toUpperCase()} ${d.city || ""}`.trim() || "未知";

   const ipTypeText = d.isBroadcast === true ? "📡 广播" : (d.isBroadcast === false ? "🏠 原生" : "未知");

   const risk = d.fraudScore;
   let riskTxt = "获取失败", riskCol = C_SUB, riskIc = "questionmark.shield.fill";
   if (risk !== undefined) {
     if (risk >= 80) {
       riskTxt = `极高 (${risk})`; riskCol = { light: '#FF3B30', dark: '#FF3B30' }; riskIc = "xmark.shield.fill";
     } else if (risk >= 70) {
       riskTxt = `高危 (${risk})`; riskCol = { light: '#FF9500', dark: '#FF9500' }; riskIc = "exclamationmark.shield.fill";
     } else if (risk >= 40) {
       riskTxt = `中等 (${risk})`; riskCol = { light: '#FFD60A', dark: '#FFD60A' }; riskIc = "exclamationmark.shield.fill";
     } else {
       riskTxt = `低危 (${risk})`; riskCol = C_GREEN; riskIc = "checkmark.shield.fill";
     }
   }

   return { ip, asn, loc, ipTypeText, riskTxt, riskCol, riskIc };
 }

 const [d1, d2] = await Promise.all([fetchInfo(POLICY1), fetchInfo(POLICY2)]);
 const i1 = buildInfo(d1);
 const i2 = buildInfo(d2);

 const Row = (iconName, iconColor, value, valueColor) => ({
   type: 'stack',
   direction: 'row',
   alignItems: 'center',
   gap: 4,
   children: [
     { type: 'image', src: `sf-symbol:${iconName}`, color: iconColor, width: SMALL_ICON, height: SMALL_ICON },
     { type: 'text', text: value, font: { size: SMALL_FONT, weight: 'bold', family: 'Menlo' }, textColor: valueColor, maxLines: 1, minScale: 0.6 }
   ]
 });

 const Column = (name, info) => ({
   type: 'stack',
   direction: 'column',
   gap: 6,
   flex: 1,
   children: [
     { type: 'text', text: name, font: { size: 11, weight: 'heavy' }, textColor: C_TITLE },
     Row("globe", C_ICON_IP, info.ip, C_GREEN),
     Row("number.square", C_ICON_IP, info.asn, C_GREEN),
     Row("mappin.and.ellipse", C_ICON_LOC, info.loc, C_MAIN),
     Row("antenna.radiowaves.left.and.right", C_ICON_LOC, info.ipTypeText, C_SUB),
     Row(info.riskIc, info.riskCol, info.riskTxt, info.riskCol)
   ]
 });

 return {
   type: 'widget',
   padding: [10, 12],
   gap: 8,
   backgroundColor: BG_COLOR,
   children: [
     {
       type: 'stack',
       direction: 'row',
       alignItems: 'center',
       gap: 6,
       children: [
         { type: 'image', src: 'sf-symbol:shield.lefthalf.filled', color: C_TITLE, width: 16, height: 16 },
         { type: 'text', text: 'IP 纯净度', font: { size: 14, weight: 'heavy' }, textColor: C_TITLE },
         { type: 'spacer' }
       ]
     },
     {
       type: 'stack',
       height: 0.5,
       backgroundColor: { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.12)' }
     },
     {
       type: 'stack',
       direction: 'row',
       gap: 12,
       children: [
         Column(NAME1, i1),
         Column(NAME2, i2)
       ]
     }
   ]
 };
}
