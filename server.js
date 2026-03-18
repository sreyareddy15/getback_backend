const https = require('https');

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const PROMPT_PREFIX = `You are an expert Indian food nutritionist. Analyse the food described and return ONLY valid JSON with no markdown or backticks:
{"items":[{"name":"Food name","quantity":"serving","category":"one of: Roti/Bread, Rice/Grain, Dal/Lentil, Sabzi/Vegetable, Meat/Fish/Egg, Dairy/Paneer, Snack/Street Food, Beverage, Sweet/Dessert, Salad/Raita, Condiment","calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"micros":{"iron_mg":number,"calcium_mg":number,"vitamin_c_mg":number,"vitamin_b12_mcg":number,"sodium_mg":number,"potassium_mg":number}}],"meal_type":"Breakfast/Lunch/Dinner/Snack","total_calories":number,"notes":"1 line health note"}
User said: `;

require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/analyse') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let food;
    try { food = JSON.parse(body).food; } catch { }
    if (!food) { res.writeHead(400); res.end(JSON.stringify({error:'No food provided'})); return; }

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: PROMPT_PREFIX + food }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };

    const apiReq = https.request(options, apiRes => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          let result = json.candidates[0].content.parts[0].text.trim();
          result = result.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim();
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({result}));
        } catch(e) {
          res.writeHead(500, {'Content-Type':'application/json'});
          res.end(JSON.stringify({error: e.message}));
        }
      });
    });

    apiReq.on('error', e => {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: e.message}));
    });
    apiReq.write(payload);
    apiReq.end();
  });
}).listen(PORT, () => console.log('Khana backend running on port', PORT));
