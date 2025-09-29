# Р СѓС‡РЅРѕРµ СЂР°Р·РІРµСЂС‚С‹РІР°РЅРёРµ РєР°С‚Р°Р»РѕРіР° РЅР° СЃРµСЂРІРµСЂРµ

## РЁР°РіРё СЂР°Р·РІРµСЂС‚С‹РІР°РЅРёСЏ:

1. **РћСЃС‚Р°РЅРѕРІРёС‚Рµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ РїСЂРѕС†РµСЃСЃС‹:**
   `ash
   pm2 stop catalog-parser 2>/dev/null || true
   pm2 stop catalog-server 2>/dev/null || true
   `

2. **РЎРєРѕРїРёСЂСѓР№С‚Рµ С„Р°Р№Р»С‹ РІ СЂР°Р±РѕС‡СѓСЋ РґРёСЂРµРєС‚РѕСЂРёСЋ:**
   `ash
   cp catalog-parser.js /var/www/wolmar-parser/
   cp catalog-server.js /var/www/wolmar-parser/
   cp catalog-monitor.js /var/www/wolmar-parser/
   cp -r catalog-public/ /var/www/wolmar-parser/
   `

3. **РЈСЃС‚Р°РЅРѕРІРёС‚Рµ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё:**
   `ash
   cd /var/www/wolmar-parser
   npm install
   `

4. **Р—Р°РїСѓСЃС‚РёС‚Рµ РєР°С‚Р°Р»РѕРі:**
   `ash
   pm2 start catalog-parser.js --name catalog-parser
   pm2 start catalog-server.js --name catalog-server
   pm2 save
   `

5. **РџСЂРѕРІРµСЂСЊС‚Рµ СЃС‚Р°С‚СѓСЃ:**
   `ash
   pm2 status
   curl http://localhost:3000
   `

## РђР»СЊС‚РµСЂРЅР°С‚РёРІРЅРѕ - РёСЃРїРѕР»СЊР·СѓР№С‚Рµ СЃРєСЂРёРїС‚С‹:

### РњСЏРіРєРѕРµ СЂРµС€РµРЅРёРµ РєРѕРЅС„Р»РёРєС‚Р°:
`ash
chmod +x fix-server-git-conflict.sh
./fix-server-git-conflict.sh
`

### РџСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕРµ РѕР±РЅРѕРІР»РµРЅРёРµ:
`ash
chmod +x force-update-catalog.sh
./force-update-catalog.sh
`
