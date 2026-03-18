const https = require('https');
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// Split into smaller focused prompt — more reliable JSON output
const SYSTEM_PROMPT = `You are an Indian food nutritionist API. Return ONLY a JSON object, nothing else — no explanation, no markdown, no backticks.

Rules:
- Split the user's input into individual food items
- For each item estimate realistic nutrition for Indian food
- All number fields must be actual numbers, never null or strings
- Use 0 if a micronutrient is negligible

JSON format (return exactly this structure):
{
  "items": [
    {
      "name": "string",
      "quantity": "string",
      "category": "one of: Roti/Bread, Rice/Grain, Dal/Lentil, Sabzi/Vegetable, Meat/Fish/Egg, Dairy/Paneer, Snack/Street Food, Beverage, Sweet/Dessert, Salad/Raita, Condiment",
      "calories": 0,
      "protein_g": 0,
      "carbs_g": 0,
      "fat_g": 0,
      "fiber_g": 0,
      "micros": {
        "iron_mg": 0,
        "calcium_mg": 0,
        "vitamin_c_mg": 0,
        "vitamin_b12_mcg": 0,
        "sodium_mg": 0,
        "potassium_mg": 0
      }
    }
  ],
  "meal_type": "Breakfast",
  "total_calories": 0,
  "notes": "one sentence health note"
}`;

function callGemini(food, callback) {
  const payload = JSON.stringify({
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: '{"items":' }] },
      { role: 'user', parts: [{ text: `Analyse this food: ${food}` }] }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json'
    }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => callback(null, data));
  });
  req.on('error', e => callback(e));
  req.write(payload);
  req.end();
}

function extractJSON(raw) {
  // Strip markdown fences
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  // Try direct parse first
  try { return JSON.parse(raw); } catch(_) {}

  // Find the outermost { ... } block
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');

  // Walk to find matching closing brace
  let depth = 0, inStr = false, escape = false, end = -1;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }

  if (end === -1) {
    // JSON was cut off — try to close it
    const partial = raw.slice(start);
    const fixed = attemptRepair(partial);
    return JSON.parse(fixed);
  }

  return JSON.parse(raw.slice(start, end + 1));
}

function attemptRepair(partial) {
  // Count open braces/brackets and close them
  let braces = 0, brackets = 0, inStr = false, escape = false;
  for (let i = 0; i < partial.length; i++) {
    const c = partial[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }

  // Remove trailing comma or incomplete field before closing
  let fixed = partial.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:\s*$/, '');

  // Close any open string
  if (inStr) fixed += '"';

  // Close brackets and braces
  while (brackets > 0) { fixed += ']'; brackets--; }
  while (braces > 0) { fixed += '}'; braces--; }

  return fixed;
}

function sanitiseResult(parsed) {
  // Ensure all numeric fields are numbers, not null/undefined
  if (!parsed.items || !Array.isArray(parsed.items)) parsed.items = [];
  parsed.items = parsed.items.map(item => ({
    name: item.name || 'Unknown food',
    quantity: item.quantity || '1 serving',
    category: item.category || 'Snack/Street Food',
    calories:  Number(item.calories)  || 0,
    protein_g: Number(item.protein_g) || 0,
    carbs_g:   Number(item.carbs_g)   || 0,
    fat_g:     Number(item.fat_g)     || 0,
    fiber_g:   Number(item.fiber_g)   || 0,
    micros: {
      iron_mg:        Number((item.micros||{}).iron_mg)        || 0,
      calcium_mg:     Number((item.micros||{}).calcium_mg)     || 0,
      vitamin_c_mg:   Number((item.micros||{}).vitamin_c_mg)   || 0,
      vitamin_b12_mcg:Number((item.micros||{}).vitamin_b12_mcg)|| 0,
      sodium_mg:      Number((item.micros||{}).sodium_mg)      || 0,
      potassium_mg:   Number((item.micros||{}).potassium_mg)   || 0,
    }
  }));
  parsed.meal_type     = parsed.meal_type     || 'Meal';
  parsed.total_calories= parsed.items.reduce((s,i) => s + i.calories, 0);
  parsed.notes         = parsed.notes         || '';
  return parsed;
}

require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200); res.end('Khana backend is running!'); return;
  }

  if (req.method !== 'POST' || req.url !== '/analyse') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let food;
    try { food = JSON.parse(body).food; } catch(_) {}
    if (!food) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No food provided' }));
      return;
    }

    console.log('Analysing:', food);

    callGemini(food, (err, rawData) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }

      try {
        const apiJson = JSON.parse(rawData);
        if (apiJson.error) throw new Error(apiJson.error.message);

        const rawText = apiJson.candidates[0].content.parts[0].text.trim();
        console.log('Raw Gemini response:', rawText.slice(0, 200));

        const parsed   = extractJSON(rawText);
        const clean    = sanitiseResult(parsed);
        const result   = JSON.stringify(clean);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));

      } catch(e) {
        console.error('Parse error:', e.message);
        // Retry once with simpler prompt
        retrySimple(food, res);
      }
    });
  });
}).listen(PORT, () => console.log('Khana backend running on port', PORT));

// Simple retry with an even simpler prompt if main call fails
function retrySimple(food, res) {
  const payload = JSON.stringify({
    contents: [{
      parts: [{ text: `List the calories and nutrition for: "${food}". Return JSON only: {"items":[{"name":"...","quantity":"...","category":"Snack/Street Food","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0,"micros":{"iron_mg":0,"calcium_mg":0,"vitamin_c_mg":0,"vitamin_b12_mcg":0,"sodium_mg":0,"potassium_mg":0}}],"meal_type":"Meal","total_calories":0,"notes":""}` }]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json' }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };

  const req = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.error) throw new Error(json.error.message);
        const raw    = json.candidates[0].content.parts[0].text.trim();
        const parsed = extractJSON(raw);
        const clean  = sanitiseResult(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: JSON.stringify(clean) }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not parse nutrition data. Try rephrasing your input.' }));
      }
    });
  });
  req.on('error', e => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  req.write(payload);
  req.end();
}
